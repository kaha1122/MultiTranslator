#!/usr/bin/env node
/**
 * 베트남어 무성조(không dấu) 번역 회귀 테스트 (2026-08-29)
 *
 * 무엇을 검증하나: lib/txNuance.js 의 isTonelessVietnamese 감지 + 무성조 지시 블록 + "restored" 필드가
 * KDL_TX_MODEL(routes/community.js 기본 gemini-3.1-flash-lite)에서 ma/mà 오독을 잡는지.
 * 사고 원문: "sao cái này ko phải phim ma chỉ có ghi hữ vay" → 정답 "영화가 아니라 글만" (공포 ✕).
 *
 * 실행:  cd server && node scripts/test-vi-toneless.js            (기본 3회 반복, 실호출 ≈ 20건 · 센트 미만)
 *        node scripts/test-vi-toneless.js --model gemini-2.5-flash-lite   (비교용 — 원 댓글 0/N 예상)
 *        node scripts/test-vi-toneless.js --trials 5
 *
 * ⚠ 프롬프트 골격(규칙 1~4·응답 형식)은 routes/community.js /translate 의 미러다 — 라우트의 프롬프트를
 *   바꾸면 여기도 맞출 것. 감지·지시 블록·모델은 실제 모듈/환경변수를 그대로 쓴다.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { callGeminiText } = require('../utils/geminiCall');
const { nuanceLines, isTonelessVietnamese } = require('../lib/txNuance');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MODEL = arg('--model', process.env.KDL_TX_MODEL_ID || 'gemini-3.1-flash-lite');
const TRIALS = Number(arg('--trials', 3));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 없음 (server/.env)'); process.exit(1); }

// routes/community.js 와 동일 문구
const APP_NATURE_LINE = `- About the app: a K-content information & community app (metadata, ratings, reviews, comments). It does NOT stream or host video — users sometimes complain that they expected to watch a show but found only text/info.`;

// [원문, 타깃, 검사 정규식, 매칭돼야 하는가(true=있어야 정답), 설명]
const CASES = [
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', 'ko', /공포|귀신|호러/, false, '사고 원문(부분 성조+오타) — mà=접속사'],
    ['sao cai nay ko phai phim ma chi co ghi chu vay', 'ko', /공포|귀신|호러/, false, '완전 무성조'],
    ['toi so phim ma lam, phim nay co ghe ko', 'ko', /공포|귀신|호러|무서/, true, '진짜 phim ma(귀신 영화) — 과교정 방지'],
    ['phim nay hay qua ma ko co tap moi', 'ko', /공포|귀신|호러/, false, 'mà=그런데'],
    ['ko biet dien vien nay la ai, ma dep qua', 'ko', /공포|귀신|호러|엄마/, false, 'mà=근데 / má(엄마) 오독 방지'],
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', 'en', /horror|ghost/i, false, '사고 원문 → 영어'],
];
// 감지기 단위 케이스(호출 없음): 오발동 방지
const DETECT = [
    ['gak tau ini bagus banget, yg main siapa', false, '인니어'],
    ['this drama is so good lol', false, '영어'],
    ['이 드라마 진짜 ㅋㅋ', false, '한국어'],
    ['Làm thế nào để mở phim xem', false, '성조 완비 베트남어(지시 불필요)'],
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', true, '사고 원문'],
    ['Ko Yoon-jung and Hong Hae-in were great, Ko really shines', false, '한국 성씨 Ko/Hong(2026-08-29 퍼지 오발동)'],
    ['Linh hồn một đầu bếp nam nhập vào thân xác một vương phi triều Joseon, qua đó Hong trở thành', false, '정식 베트남어 + qua(정상 단어)'],
    ['ko biet dien vien nay la ai, ma dep qua', true, '문두 소문자 ko + dep qua'],
];

const LANG = { ko: 'Korean', en: 'English', vi: 'Vietnamese', id: 'Indonesian' };
function buildPrompt(text, targetLang) {
    const targetName = LANG[targetLang] || targetLang;
    const styleLines = nuanceLines(text, targetLang, targetName, 'dcomment');
    const viToneless = isTonelessVietnamese(text);
    return {
        viToneless,
        prompt: [
            `You are a professional translator for a multilingual community app.`, ``,
            `[Target language] ${targetName} (ISO code "${targetLang}")`,
            APP_NATURE_LINE,
            `- Where this text appears: a viewer's comment on a show's page.`,
            ...styleLines, ``,
            `[Rules — read carefully, apply in order]`,
            `1. Determine the source language of the TEXT below.`,
            `2. Respond with EXACTLY {"same": true} ONLY IF the source language is genuinely the SAME as the target language (${targetName}). When unsure, translate.`,
            `3. Otherwise translate the ENTIRE text into ${targetName}:`,
            `   - The "translated" value MUST be written 100% in ${targetName}.`,
            `   - Translate naturally and idiomatically, faithfully preserving meaning, nuance, tone, register (formality / slang / emotion), emoji and line breaks.`,
            `4. Self-check before answering: if your "translated" value is still (even partly) in the source language, you FAILED — redo it fully in ${targetName}.`, ``,
            `Respond with ONLY one JSON object, no markdown:`,
            viToneless
                ? `  {"restored": "<the source text with full diacritics restored and shorthand expanded, in the SOURCE language>", "translated": "<the text fully translated into ${targetName}>"}   — or {"same": true} per rule 2.`
                : `  {"translated": "<the text fully translated into ${targetName}>"}   — or {"same": true} per rule 2.`,
            ``, `TEXT:`, text,
        ].join('\n'),
    };
}

(async () => {
    let fail = 0;
    console.log('== 감지기 단위 ==');
    for (const [t, want, desc] of DETECT) {
        const got = isTonelessVietnamese(t);
        if (got !== want) fail++;
        console.log(`  ${got === want ? '✅' : '❌'} ${desc}: ${JSON.stringify(t)} → ${got}`);
    }
    console.log(`\n== 번역 (model=${MODEL}, trials=${TRIALS}) ==`);
    for (const [text, target, re, want, desc] of CASES) {
        const { prompt, viToneless } = buildPrompt(text, target);
        let ok = 0; const outs = [];
        for (let i = 0; i < TRIALS; i++) {
            const r = await callGeminiText(prompt, KEY, { label: 'vi-test', model: MODEL, genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' } });
            let out = r.error ? `ERR ${r.error}` : r.text, rest = '';
            try { const p = JSON.parse(r.text); out = p.translated; rest = p.restored || ''; } catch { /* 원문 출력 */ }
            if (re.test(out || '') === want) ok++;
            outs.push((rest ? `[${rest}] ` : '') + out);
        }
        const pass = ok === TRIALS;
        if (!pass) fail++;
        console.log(`  ${pass ? '✅' : '❌'} ${ok}/${TRIALS} ${desc}${viToneless ? '' : ' (⚠ 무성조 미감지)'}\n      ${outs.map((o) => `«${o}»`).join('\n      ')}`);
    }
    console.log(fail ? `\n❌ FAIL ${fail}` : '\n✅ ALL PASS');
    process.exit(fail ? 1 : 0);
})();
