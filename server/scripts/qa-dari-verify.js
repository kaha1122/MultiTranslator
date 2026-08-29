// ── L2 지적의 2차 검증 (더 강한 모델로 확정/기각) ────────────────────────────────────
// 사용: cd server && node scripts/qa-dari-verify.js [--model gemini-2.5-flash] [--concurrency 4]
//
// 1차 스크리닝(qa-dari-semantic.js, flash-lite)은 오탐률이 높다 — 2026-08-29 ko 표본 6건 중
// 확정 오류는 1건뿐이었다. 그래서 지적 하나하나를 **문맥과 함께** 더 강한 모델에 다시 물어
// 확정(CONFIRMED)/기각(REJECTED)을 받는다. 사람은 확정분만 보면 된다.
//
// 입력 logs/qa-semantic.jsonl → 출력 logs/qa-verified.jsonl (재개 가능: postId|lang|idx)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { callGeminiText } = require('../utils/geminiCall');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const IN = path.join(__dirname, '..', 'logs', 'qa-semantic.jsonl');
const OUT = path.join(__dirname, '..', 'logs', 'qa-verified.jsonl');

function prompt(claim, en, tgt, lang) {
    return [
        `A first-pass reviewer flagged a possible error in a published translation. Your job is to decide whether the flag is CORRECT.`,
        `Most flags are false alarms. Reject unless the error is unmistakable.`,
        ``,
        `THE CLAIM`,
        `  type: ${claim.type} · severity: ${claim.severity}`,
        `  source quote: ${JSON.stringify(claim.source || '')}`,
        `  target quote: ${JSON.stringify(claim.target || '')}`,
        `  reason given: ${JSON.stringify(claim.why || '')}`,
        ``,
        `REJECT the claim if any of these hold:`,
        `  - The target conveys the same meaning, even if worded differently, reordered, or more idiomatic.`,
        `  - The claim is about the SOURCE being outdated, wrong, or about what year it is now.`,
        `  - The claim is that a name or title is unfamiliar, invented, or "not known" — these are real Korean works and people.`,
        `  - The source and target quotes say the same thing.`,
        `  - The reason given is self-contradictory, vague, or does not actually describe a difference in meaning.`,
        ``,
        `CONFIRM only if a reader of the target would come away with a different fact, a different person, a`,
        `different number, a reversed relationship, or would be missing information the source gives.`,
        ``,
        `Answer with ONLY this JSON: {"verdict":"CONFIRMED"|"REJECTED","confidence":0.0-1.0,"note":"<one short sentence>","fix":"<if CONFIRMED, the corrected ${lang} wording for the target quote; else empty>"}`,
        ``,
        `--- FULL SOURCE (English) ---`,
        en,
        ``,
        `--- FULL TARGET (${lang}) ---`,
        tgt,
    ].join('\n');
}

function parseObj(text) {
    if (!text) return null;
    const s = text.indexOf('{');
    if (s < 0) return null;
    let d = 0;
    for (let i = s; i < text.length; i++) {
        if (text[i] === '{') d++;
        else if (text[i] === '}') { d--; if (!d) { try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; } } }
    }
    return null;
}

async function main() {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const model = arg('model', 'gemini-2.5-flash');
    const conc = Number(arg('concurrency', 4)) || 4;
    const onlySev = arg('severity', '');

    const rows = fs.readFileSync(IN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const done = new Set();
    if (fs.existsSync(OUT)) {
        fs.readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim()).forEach((l) => {
            try { const r = JSON.parse(l); done.add(`${r.postId}|${r.lang}|${r.idx}`); } catch { /* skip */ }
        });
        console.log(`[verify] 기존 ${done.size}건 건너뜀`);
    }

    // 본문은 (post,lang)당 한 번만 읽는다
    const cache = new Map();
    const bodyOf = async (postId, lang) => {
        const k = `${postId}|${lang}`;
        if (!cache.has(k)) cache.set(k, (await kcultureDb.doc(`posts/${postId}/translations/${lang}`).get()).data()?.body || '');
        return cache.get(k);
    };

    const jobs = [];
    for (const r of rows) {
        (r.issues || []).forEach((it, idx) => {
            if (onlySev && it.severity !== onlySev) return;
            if (done.has(`${r.postId}|${r.lang}|${idx}`)) return;
            jobs.push({ ...r, idx, claim: it });
        });
    }
    console.log(`[verify] 대상 ${jobs.length}건 (model=${model}, concurrency=${conc})\n`);

    const stream = fs.createWriteStream(OUT, { flags: 'a', encoding: 'utf8' });
    let i = 0, conf = 0, rej = 0, err = 0;
    async function worker() {
        for (;;) {
            const j = jobs[i++];
            if (!j) return;
            const en = await bodyOf(j.postId, 'en');
            const tgt = await bodyOf(j.postId, j.lang);
            const r = await callGeminiText(prompt(j.claim, en, tgt, j.lang), GEMINI_API_KEY, {
                label: 'qa-dari-verify', model,
                genConfig: { temperature: 0, topP: 0.9, responseMimeType: 'application/json' },
            });
            if (r.error) { err++; console.warn(`  ERR  ${j.name} [${j.lang}] ${r.error}`); continue; }
            const v = parseObj(r.text);
            if (!v || !v.verdict) { err++; console.warn(`  PARSE ${j.name} [${j.lang}]`); continue; }
            stream.write(`${JSON.stringify({ postId: j.postId, name: j.name, lang: j.lang, idx: j.idx, claim: j.claim, ...v })}\n`);
            if (v.verdict === 'CONFIRMED') { conf++; console.log(`  ✅CONFIRMED ${j.name.padEnd(28)} [${j.lang}] ${String(v.note || '').slice(0, 80)}`); }
            else { rej++; }
        }
    }
    await Promise.all(Array.from({ length: conc }, worker));
    stream.end();
    console.log(`\n[verify] 확정 ${conf} · 기각 ${rej} · 오류 ${err}  → ${OUT}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
