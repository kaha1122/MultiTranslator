/**
 * 짧은 텍스트(단어·감탄사) 번역 회귀 테스트 — 2026-09-13
 * 사고: "Vero"(it) → "베로"(음차), "Pavitra"(hi) → "Pavitra"(원문 유지). 문맥이 없어 모델이 고유명사로 취급.
 * 대응: routes/community.js buildTxPrompt — ① srcLang 힌트([Source language]) ② SHORT TEXT 규칙.
 * 실행: cd server && node scripts/test-short-tx.js            (힌트 있음/없음 둘 다, 실제 Gemini 호출·소액 과금)
 *       node scripts/test-short-tx.js --trials 2 --model gemini-2.5-flash-lite
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { callGeminiText } = require('../utils/geminiCall');
const { nuanceLines } = require('../lib/txNuance');
const community = require('../routes/community');
const { buildTxPrompt, KDL_TX_MODEL, langName } = community._tx;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MODEL = arg('--model', KDL_TX_MODEL);
const TRIALS = Number(arg('--trials', 2));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 없음 (server/.env)'); process.exit(1); }

// [원문, srcLang, 타깃, 통과 정규식, 설명]  — 정규식은 "의미 번역"이면 매칭, 음차·원문 유지면 불일치
const CASES = [
    ['Vero', 'it', 'ko', /맞|정말|진짜|사실|그래/, '★ 사고: it "Vero" → 의미(맞아/정말)'],
    ['Pavitra', 'hi', 'ko', /순수|순결|성스|신성|깨끗|청정/, '★ 사고: hi "Pavitra" → 의미(순수한·신성한)'],
    ['Bagus', 'id', 'ko', /좋|멋|훌륭|굿/, 'id "Bagus"'],
    ['Wow', 'en', 'ko', /와|우와|대박|헐/, 'en "Wow"'],
    ['Daebak', 'en', 'ko', /대박/, 'en 팬덤어 "Daebak" → 대박'],
    ['Hermoso', 'es', 'ko', /아름|예쁘|멋/, 'es "Hermoso"'],
    ['Vero', 'it', 'en', /\b(true|right|so true|indeed|exactly)\b/i, 'it "Vero" → en'],
    ['Pavitra', 'hi', 'en', /\b(pure|sacred|holy)\b/i, 'hi "Pavitra" → en'],
    ['최고', 'ko', 'en', /\b(best|the best|greatest|awesome)\b/i, 'ko "최고" → en'],
];

async function run(text, srcLang, targetLang, withHint) {
    const targetName = langName(targetLang);
    const styleLines = nuanceLines(text, targetLang, targetName, 'dcomment');
    const prompt = buildTxPrompt({ text, targetLang, targetName, styleLines, srcLang: withHint ? srcLang : null });
    const r = await callGeminiText(prompt, KEY, { label: 'short-test', model: MODEL, genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' } });
    if (r.error) return `ERR ${r.error}`;
    try { const p = JSON.parse(r.text); return p.same ? '{same}' : p.translated; } catch { return r.text; }
}

(async () => {
    let fail = 0;
    for (const withHint of [false, true]) {
        console.log(`\n=== srcLang 힌트 ${withHint ? '있음' : '없음'} (model=${MODEL}) ===`);
        for (const [text, src, tgt, re, desc] of CASES) {
            let ok = 0; const outs = [];
            for (let i = 0; i < TRIALS; i++) { const o = await run(text, src, tgt, withHint); outs.push(o); if (re.test(o || '')) ok++; }
            const pass = ok === TRIALS;
            if (withHint && !pass) fail++;
            console.log(`${pass ? '✅' : '❌'} ${ok}/${TRIALS} ${desc}  →  ${outs.map((o) => JSON.stringify(o)).join(' | ')}`);
        }
    }
    console.log(`\n힌트 있음 기준 실패 ${fail}건`);
    process.exit(fail ? 1 : 0);
})();
