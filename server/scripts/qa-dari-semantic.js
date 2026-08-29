// ── Dari 리뷰 번역 시드 의미 검수 (L2 — Gemini 대조) ─────────────────────────────────
// 사용: cd server && node scripts/qa-dari-semantic.js [--post <id>] [--lang id,vi,ar]
//                    [--model gemini-3.1-flash-lite] [--concurrency 4] [--limit N]
//
// 기계 검수(qa-dari-reviews.js)는 형식·표기만 잡는다. 실제 독자가 읽는 오역
// (heir→왕세자, word of mouth→말해진 단어, 문장 통째 누락)은 정규식으로 원리적으로 못 잡는다.
// 여기서는 base 영문과 각 언어 번역을 **함께** 모델에 주고 의미가 어긋난 구간만 뽑는다.
//
// 재개 가능 — logs/qa-semantic.jsonl 에 (postId,lang) 단위로 append하고 이미 있는 조합은 건너뛴다.
// 중단 후 다시 실행하면 남은 것만 돈다.
//
// ⚠ 모델 판정은 1차 스크리닝이다. 결과를 그대로 패치하지 말고 사람/에이전트가 확인할 것
//   (모델이 정상 의역을 오역으로 신고하는 경우가 있다).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { callGeminiText } = require('../utils/geminiCall');
const { SEED_LANGS } = require('../lib/dari');
const { LANG_NAMES } = require('../config/langGuide');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const nameOf = (c) => LANG_NAMES[c] || LANG_NAMES[String(c).split('-')[0]] || c;

const OUT = path.join(__dirname, '..', 'logs', 'qa-semantic.jsonl');

function buildPrompt(en, tgt, lang) {
    return [
        `You are a strict bilingual reviewer auditing a published translation.`,
        `SOURCE is English. TARGET is its ${nameOf(lang)} translation, already visible to readers.`,
        ``,
        `Report ONLY places where a reader of the TARGET would get a DIFFERENT FACT OR MEANING than a reader of the SOURCE.`,
        `Report types:`,
        `  MISTRANSLATION — the meaning is changed or reversed (who did what to whom, negation, cause/effect)`,
        `  OMISSION       — a clause, sentence or whole section present in SOURCE is missing from TARGET`,
        `  ADDITION       — TARGET states something not in SOURCE`,
        `  PROPER_NOUN    — a person/show/place name became a DIFFERENT entity, or was left in Korean/another script a ${nameOf(lang)} reader cannot read`,
        `  NUMBER         — a figure, percentage, count, date or rank differs from SOURCE`,
        `  TERM           — a craft term lost its film/TV sense (chemistry = on-screen rapport, not the science; arc/beat = story terms; run = broadcast period; heir = business successor, NOT royalty; word of mouth = buzz, not "spoken word")`,
        ``,
        `Do NOT report: natural rephrasing, word-order changes, register/politeness choices, synonyms,`,
        `idiomatic adaptation, differences in punctuation or emoji, or anything you are not confident about.`,
        `If the translation is faithful, return an empty list. An empty list is a perfectly good answer.`,
        ``,
        `Return ONLY this JSON object:`,
        `{"issues":[{"type":"MISTRANSLATION","severity":"high","source":"<short SOURCE quote>","target":"<the TARGET quote>","why":"<one sentence, in English>"}]}`,
        `severity: "high" = a reader is misinformed; "medium" = noticeable but minor.`,
        ``,
        `--- SOURCE (English) ---`,
        en,
        ``,
        `--- TARGET (${nameOf(lang)}) ---`,
        tgt,
    ].join('\n');
}

function parseIssues(text) {
    if (!text) return null;
    const s = text.indexOf('{');
    if (s < 0) return null;
    let depth = 0;
    for (let i = s; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (!depth) { try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; } } }
    }
    return null;
}

async function main() {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const model = arg('model', 'gemini-3.1-flash-lite');
    const conc = Number(arg('concurrency', 4)) || 4;
    const limit = Number(arg('limit', 0)) || 0;
    const only = arg('post', '');
    const langFilter = arg('lang', '') ? arg('lang', '').split(',').map((s) => s.trim()) : SEED_LANGS;

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const done = new Set();
    if (fs.existsSync(OUT)) {
        for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try { const r = JSON.parse(line); done.add(`${r.postId}|${r.lang}`); } catch { /* 손상 줄 무시 */ }
        }
        console.log(`[semantic] 기존 결과 ${done.size}건 — 건너뜀`);
    }

    let posts;
    if (only) { const d = await kcultureDb.doc(`posts/${only}`).get(); posts = [{ id: d.id, ...d.data() }]; }
    else {
        const s = await kcultureDb.collection('posts').where('curator', '==', true).get();
        posts = s.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    }

    // 작업 목록 구성 (본문 read는 미리 한 번씩만)
    const jobs = [];
    for (const p of posts) {
        const snap = await kcultureDb.collection(`posts/${p.id}/translations`).get();
        const doc = {};
        snap.docs.forEach((d) => { doc[d.id] = d.data()?.body || ''; });
        if (!doc.en) { console.warn(`[semantic] ${p.id} en 본문 없음 — skip`); continue; }
        for (const L of langFilter) {
            if (!doc[L]) continue;
            if (done.has(`${p.id}|${L}`)) continue;
            jobs.push({ postId: p.id, name: (p.titleName || p.title || '?').slice(0, 30), lang: L, en: doc.en, tgt: doc[L] });
        }
    }
    const queue = limit ? jobs.slice(0, limit) : jobs;
    console.log(`[semantic] 대상 ${queue.length}건 (model=${model}, concurrency=${conc})\n`);

    const stream = fs.createWriteStream(OUT, { flags: 'a', encoding: 'utf8' });
    let i = 0, ok = 0, err = 0, found = 0;
    async function worker() {
        for (;;) {
            const job = queue[i++];
            if (!job) return;
            const r = await callGeminiText(buildPrompt(job.en, job.tgt, job.lang), GEMINI_API_KEY, {
                label: 'qa-dari-semantic',
                model,
                genConfig: { temperature: 0.1, topP: 0.9, responseMimeType: 'application/json' },
            });
            if (r.error) { err++; console.warn(`  ERR  ${job.name} [${job.lang}] ${r.error}`); continue; }
            const parsed = parseIssues(r.text);
            if (!parsed || !Array.isArray(parsed.issues)) { err++; console.warn(`  PARSE ${job.name} [${job.lang}]`); continue; }
            ok++; found += parsed.issues.length;
            stream.write(`${JSON.stringify({ postId: job.postId, name: job.name, lang: job.lang, issues: parsed.issues, at: new Date().toISOString() })}\n`);
            const high = parsed.issues.filter((x) => x.severity === 'high').length;
            console.log(`  ${parsed.issues.length ? `⚠${String(parsed.issues.length).padStart(2)}` : 'ok  '} ${job.name.padEnd(30)} [${job.lang}]${high ? ` high=${high}` : ''}`);
        }
    }
    await Promise.all(Array.from({ length: conc }, worker));
    stream.end();
    console.log(`\n[semantic] 완료 — 판정 ${ok} · 오류 ${err} · 지적 ${found}건`);
    console.log(`결과: ${OUT}  (요약: node scripts/qa-dari-semantic-report.js)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
