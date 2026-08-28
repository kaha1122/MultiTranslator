#!/usr/bin/env node
/**
 * 베트남어 무성조(không dấu) 번역 회귀 테스트 (2026-08-29)
 *
 * 무엇을 검증하나: lib/txNuance.js 의 isTonelessVietnamese 감지 + normalizeTonelessVietnamese(ma→mà 전처리)
 * + 무성조 지시 블록 + "restored" 필드가 **실제 라우트 프롬프트**(routes/community.js buildTxPrompt,
 * 실제 작품 컨텍스트 buildTranslationContext 포함)와 KDL_TX_MODEL 에서 ma/mà 오독을 잡는지.
 *
 * 사고 원문: "sao cái này ko phải phim ma chỉ có ghi hữ vay" → 정답 "영화가 아니라 글만" (공포 ✕).
 * 2차 사고(같은 날): 태그 작품이 호텔 델루나(귀신 드라마)면 [Context]가 phim ma 읽기를 밀어 지시만으로는
 * 0/3 → 원문 전처리(ma→mà)로 4/4. 그래서 이 테스트는 실제 컨텍스트가 붙는 케이스를 반드시 포함한다.
 *
 * 실행:  cd server && node scripts/test-vi-toneless.js            (기본 3회 반복, 실호출 ≈ 20건 · 센트 미만)
 *        node scripts/test-vi-toneless.js --model gemini-2.5-flash-lite   (비교용)
 *        node scripts/test-vi-toneless.js --trials 5
 * 필요: server/.env 의 GEMINI_API_KEY + KCULTURE_SERVICE_ACCOUNT_BASE64(컨텍스트 케이스 — 없으면 그 케이스는 skip)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { callGeminiText } = require('../utils/geminiCall');
const { nuanceLines, isTonelessVietnamese, normalizeTonelessVietnamese } = require('../lib/txNuance');
const community = require('../routes/community');
const { buildTxPrompt, buildTranslationContext, KDL_TX_MODEL, langName } = community._tx;
const txGlossary = require('../lib/txGlossary');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MODEL = arg('--model', KDL_TX_MODEL);
const TRIALS = Number(arg('--trials', 3));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 없음 (server/.env)'); process.exit(1); }

// 실제 작품 컨텍스트 — 호텔 델루나(귀신 드라마)에 태그된 글의 cachePath(2026-08-29 사고 현장)
const HOTEL_DEL_LUNA_POST = 'posts/bQEsxOjOV3HqBgfPQwsy/translations/ko';

// [원문, 타깃, scope, cachePath(컨텍스트) | null, 검사 정규식, 매칭돼야 하는가, 설명]
const CASES = [
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', 'ko', 'post', HOTEL_DEL_LUNA_POST, /공포|귀신|호러/, false, '★ 사고 원문 + 호텔 델루나 컨텍스트(귀신 드라마) — mà=접속사'],
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', 'ko', 'dcomment', null, /공포|귀신|호러/, false, '사고 원문(컨텍스트 없음)'],
    ['sao cai nay ko phai phim ma chi co ghi chu vay', 'ko', 'dcomment', null, /공포|귀신|호러/, false, '완전 무성조'],
    ['toi so phim ma lam, phim nay co ghe ko', 'ko', 'dcomment', HOTEL_DEL_LUNA_POST, /공포|귀신|호러|무서/, true, '진짜 phim ma(귀신 영화) + 컨텍스트 — 과교정 방지'],
    ['phim nay hay qua ma ko co tap moi', 'ko', 'dcomment', null, /공포|귀신|호러/, false, 'mà=그런데'],
    ['ko biet dien vien nay la ai, ma dep qua', 'ko', 'dcomment', null, /공포|귀신|호러|엄마/, false, 'mà=근데 / má(엄마) 오독 방지'],
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', 'en', 'post', HOTEL_DEL_LUNA_POST, /horror|ghost/i, false, '사고 원문 + 컨텍스트 → 영어'],
];
// 감지기·정규화 단위 케이스(호출 없음)
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
const NORMALIZE = [
    ['sao cái này ko phải phim ma chỉ có ghi hữ vay', 'sao cái này ko phải phim mà chỉ có ghi hữ vay', 'ma chỉ → mà'],
    ['phim nay hay qua ma ko co tap moi', 'phim nay hay qua mà ko co tap moi', 'ma ko → mà'],
    ['toi so phim ma lam, phim nay co ghe ko', 'toi so phim ma lam, phim nay co ghe ko', 'ma lắm(귀신) 불변'],
    ['this drama is so good lol', 'this drama is so good lol', '비베트남어 불변'],
];

async function buildRealPrompt(text, targetLang, scope, cachePath) {
    const targetName = langName(targetLang);
    const ctx = cachePath ? await buildTranslationContext(cachePath, targetLang, targetName) : { lines: [], titleId: null };
    const hits = txGlossary.matchText(text, { anchoredTitleId: ctx.titleId });
    const glossaryLines = await txGlossary.buildGlossaryLines(hits, targetLang, targetName).catch(() => []);
    const styleLines = nuanceLines(text, targetLang, targetName, scope);
    const viToneless = isTonelessVietnamese(text);
    const srcText = viToneless ? normalizeTonelessVietnamese(text) : text;
    return { prompt: buildTxPrompt({ text: srcText, targetLang, targetName, ctxLines: ctx.lines, glossaryLines, styleLines, viToneless }), viToneless, hasCtx: ctx.lines.length > 0 };
}

(async () => {
    let fail = 0;
    console.log('== 감지기 단위 ==');
    for (const [t, want, desc] of DETECT) {
        const got = isTonelessVietnamese(t);
        if (got !== want) fail++;
        console.log(`  ${got === want ? '✅' : '❌'} ${desc}: ${JSON.stringify(t)} → ${got}`);
    }
    console.log('\n== 정규화(ma→mà) 단위 ==');
    for (const [t, want, desc] of NORMALIZE) {
        const got = normalizeTonelessVietnamese(t);
        if (got !== want) fail++;
        console.log(`  ${got === want ? '✅' : '❌'} ${desc}: → ${JSON.stringify(got)}`);
    }
    await txGlossary.ready().catch(() => { /* fail-open */ });
    console.log(`\n== 번역 (model=${MODEL}, trials=${TRIALS}, 실제 buildTxPrompt) ==`);
    for (const [text, target, scope, cachePath, re, want, desc] of CASES) {
        const { prompt, viToneless, hasCtx } = await buildRealPrompt(text, target, scope, cachePath);
        if (cachePath && !hasCtx) { console.log(`  ⚠ skip(컨텍스트 read 불가 — 서비스 계정?) ${desc}`); continue; }
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
        console.log(`  ${pass ? '✅' : '❌'} ${ok}/${TRIALS} ${desc}${viToneless ? '' : ' (⚠ 무성조 미감지)'}${hasCtx ? ' [ctx]' : ''}\n      ${outs.map((o) => `«${o}»`).join('\n      ')}`);
    }
    console.log(fail ? `\n❌ FAIL ${fail}` : '\n✅ ALL PASS');
    process.exit(fail ? 1 : 0);
})();
