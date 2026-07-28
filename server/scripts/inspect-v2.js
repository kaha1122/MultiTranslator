// ── V2 재구축 결과 전수 검사 (읽기 전용) ─────────────────────────────────────
// metaV=2 문서 전부에 대해 12개 언어 번역 문서를 내려받아 규칙 위반을 기계 검사한다.
//   T1 제목 없음(metaNoTitle 예외) · T2 비원어 제목에 한글 · T3 길이>80/개행
//   T4 제목=줄거리 접두(>25자) · O1 줄거리 없음(metaNoSource 예외) · O2 비원어 줄거리에 한글 잔류
//   O3 문자 체계 불일치(ko/ja/zh-CN/ru/ar) · O4 언어 간 줄거리 동일(에코 의심) · S1 searchTitle 불일치
// 사용: node scripts/inspect-v2.js [--limit N] [--samples N]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { TARGETS } = require('../lib/tmdbBackfill');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? parseInt(process.argv[i + 1], 10) : d; }
const LIMIT = arg('limit', 0);
const SAMPLES = arg('samples', 8);

const HANGUL = /[가-힣]/;
const SCRIPT_RE = { ko: /[가-힣]/, ja: /[぀-ヿ一-鿿]/, 'zh-CN': /[一-鿿]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/ };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
    // 대상: metaV=2 완료 문서
    const snap = await kcultureDb.collection('titles')
        .where('metaV', '==', 2)
        .select('media', 'metaNoSource', 'metaNoTitle', 'searchTitle', 'metaTranslated')
        .get();
    let docs = [];
    snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));
    if (LIMIT) docs = docs.slice(0, LIMIT);
    console.log(`검사 대상: metaV=2 ${docs.length}편 × ${TARGETS.length}개 언어 = ${docs.length * TARGETS.length}문서\n`);

    const viol = []; // {code, id, lang, detail}
    const add = (code, id, lang, detail) => viol.push({ code, id, lang, detail });
    const srcStat = {}; // source 문자열 분포
    const perLangTitleSrc = {}; // lang → {official, gemini, orig, 'en-fallback'}
    let checked = 0, incomplete = 0;

    // 동시 8로 번역 서브컬렉션 로드
    let idx = 0;
    const results = new Array(docs.length);
    async function worker() {
        while (idx < docs.length) {
            const i = idx++;
            const t = docs[i];
            const s = await kcultureDb.collection(`titles/${t.id}/translations`).get();
            const tr = {}; s.forEach((d) => { tr[d.id] = d.data(); });
            results[i] = tr;
        }
    }
    await Promise.all(Array.from({ length: 8 }, worker));

    for (let i = 0; i < docs.length; i++) {
        const t = docs[i], tr = results[i];
        checked++;
        if (!t.metaTranslated) incomplete++;
        const ovs = {};
        for (const tg of TARGETS) {
            const v = tr[tg.code] || {};
            const title = norm(v.title), ov = norm(v.overview);
            const src = v.source || '?';
            srcStat[src] = (srcStat[src] || 0) + 1;
            const tSrc = src.split('+')[0];
            (perLangTitleSrc[tg.code] = perLangTitleSrc[tg.code] || {})[tSrc] = (perLangTitleSrc[tg.code][tSrc] || 0) + 1;

            // 제목 검사
            if (!title) { if (!t.metaNoTitle) add('T1:제목없음', t.id, tg.code, ''); }
            else {
                if (tg.code !== 'ko' && HANGUL.test(title)) add('T2:제목한글', t.id, tg.code, title);
                if (title.length > 80 || /\n/.test(v.title || '')) add('T3:제목길이/개행', t.id, tg.code, title.slice(0, 60));
                if (title.length > 25 && ov && ov.slice(0, title.length) === title) add('T4:제목=줄거리', t.id, tg.code, title.slice(0, 60));
            }
            // 줄거리 검사
            if (!ov) { if (!t.metaNoSource) add('O1:줄거리없음', t.id, tg.code, ''); }
            else {
                ovs[tg.code] = ov;
                if (tg.code !== 'ko' && HANGUL.test(ov)) add('O2:줄거리한글', t.id, tg.code, ov.slice(0, 60));
                const re = SCRIPT_RE[tg.code];
                if (re && !re.test(ov)) add('O3:문자체계', t.id, tg.code, ov.slice(0, 60));
            }
            // 검색 인덱스 정합
            const st = (t.searchTitle || {})[tg.code] || '';
            if (title && st !== title) add('S1:인덱스불일치', t.id, tg.code, `st="${st}" tr="${title.slice(0, 40)}"`);
        }
        // O4: 서로 다른 언어의 줄거리가 완전히 동일(번역 안 하고 복사) — en↔라틴계 상호 검사
        const langs = Object.keys(ovs);
        for (let a = 0; a < langs.length; a++) for (let b = a + 1; b < langs.length; b++) {
            if (ovs[langs[a]] === ovs[langs[b]]) add('O4:줄거리동일', t.id, `${langs[a]}=${langs[b]}`, ovs[langs[a]].slice(0, 50));
        }
    }

    // ── 보고 ──
    console.log('━━━━━━━━━━ 위반 집계 ━━━━━━━━━━');
    const byCode = {};
    for (const v of viol) (byCode[v.code] = byCode[v.code] || []).push(v);
    if (!viol.length) console.log('  ✔ 위반 0건');
    for (const [code, list] of Object.entries(byCode).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${code}: ${list.length}건`);
        for (const v of list.slice(0, 6)) console.log(`     - ${v.id} [${v.lang}] ${v.detail}`);
        if (list.length > 6) console.log(`     … 외 ${list.length - 6}건`);
    }
    console.log(`\n  검사 ${checked}편 (미완 metaTranslated=false ${incomplete}편)`);

    console.log('\n━━━━━━━━━━ 제목 소스 분포(언어별) ━━━━━━━━━━');
    for (const tg of TARGETS) {
        const d = perLangTitleSrc[tg.code] || {};
        const total = Object.values(d).reduce((a, b) => a + b, 0) || 1;
        const parts = Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n} (${Math.round(n / total * 100)}%)`);
        console.log(`  ${tg.code.padEnd(6)} ${parts.join(' · ')}`);
    }

    // 사람 검수용 무작위 표본 — 12개 언어 제목 나란히
    console.log(`\n━━━━━━━━━━ 무작위 표본 ${SAMPLES}편 (제목 12개 언어) ━━━━━━━━━━`);
    const picks = [];
    const step = Math.max(1, Math.floor(docs.length / SAMPLES));
    for (let i = 0; i < docs.length && picks.length < SAMPLES; i += step) picks.push(i);
    for (const i of picks) {
        const t = docs[i], tr = results[i];
        console.log(`\n  ■ ${t.media}/${t.id} 「${(tr.ko || {}).title || '?'}」`);
        for (const tg of TARGETS) {
            if (tg.code === 'ko') continue;
            const v = tr[tg.code] || {};
            console.log(`    ${tg.code.padEnd(6)} ${v.title || '(빈 제목)'}`);
        }
    }
    process.exit(0);
})();
