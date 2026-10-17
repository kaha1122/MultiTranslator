#!/usr/bin/env node
/**
 * UGC 번역 "배역명 → 배우명 치환" 회귀 테스트 (2026-10-18)
 *
 * 사고: 너 말고 다른 연애(314939) 작품 페이지 인니어 댓글 "… Lee Mi-do sama Han Tae-seung bakal mulai romansa …"를
 * EN AI 번역 → "… Ahn Eun-jin and Lee Joo-ahn will start a steamy romance …". 극중 인물이 실제 배우 이름으로 바뀜.
 * 원인: txGlossary.castContextLines 지시문 "refers to their characters … use the renderings above"(+OVERRIDES)가
 * 배역 언급을 배우 표기로 바꾸라고 읽혔다. 배역·배우 분리 + "글쓴이가 쓴 이름 그대로" 규칙으로 수정.
 *
 * 실행:  cd server && node scripts/test-tx-character-names.js            (기본 4회 반복)
 *        node scripts/test-tx-character-names.js --trials 6 --model gemini-2.5-flash-lite
 * 필요: server/.env 의 GEMINI_API_KEY + KCULTURE_SERVICE_ACCOUNT_BASE64(캐스트 표 컨텍스트)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { callGeminiText } = require('../utils/geminiCall');
const { nuanceLines } = require('../lib/txNuance');
const community = require('../routes/community');
const { buildTxPrompt, buildTranslationContext, KDL_TX_MODEL, langName, castSwapWarning, txOutText } = community._tx;
const { txModelFor } = require('../config/langGuide');
const txGlossary = require('../lib/txGlossary');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MODEL_OVERRIDE = arg('--model', null);
const TRIALS = Number(arg('--trials', 4));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 없음 (server/.env)'); process.exit(1); }

// 사고 현장과 같은 위치(작품 페이지 댓글) — 캐스트 표: 안은진=Lee Mi-do, 이주안=Han Tae-seung
const PATH = 'titles/314939/discussion/_test/translations/';
const ID_SRC = 'Dari ep 9 kayaknya aku nonton sambil setengah takut, setengah berharap Lee Mi-do sama Han Tae-seung bakal mulai romansa yang panas. Mungkin aku juga penasaran Mi-do bakal berubah ke arah mana setelah itu. Tapi kayaknya sutradaranya nggak seberani itu deh 😅 Sejauh ini hubungan mereka cuma ditunjukin lewat ribut dan berantem mulu... Penasaran banget drama ini bakal beneran nunjukin sisi itu atau nggak.';

// [원문, 타깃, 반드시 있어야 할 정규식, 있으면 안 되는 정규식, 설명, (선택) 위치 경로 접두]
const ACTORS_LATIN = /Ahn Eun[- ]?jin|Lee Joo[- ]?ahn|Seo Kang[- ]?joon/i;
const CASES = [
    [ID_SRC, 'en', /Mi-?do/i, ACTORS_LATIN, '★ 사고 원문 id → en (배역명 유지)'],
    [ID_SRC, 'es', /Mi-?do/i, ACTORS_LATIN, '사고 원문 id → es'],
    [ID_SRC, 'ko', /미도/, /안은진|이주안|서강준/, '사고 원문 id → ko (음차는 배역명)'],
    [ID_SRC, 'ja', /ミド/, /アン・?ウンジン|イ・?ジュア|安恩真|안은진/, '사고 원문 id → ja (음차는 배역명)'],
    ['이미도랑 한태승 케미 미쳤다 진짜', 'en', /Mi-?do/i, ACTORS_LATIN, '한국어 배역명 → en'],
    // 배우 이름을 쓴 글은 배우 이름이 유지돼야 한다(역방향 치환 금지)
    ['Ahn Eun-jin aktingnya keren banget di sini, beda sama drama sebelumnya', 'en', /Ahn Eun[- ]?jin/i, /Mi-?do/i, '배우명 → en (배우명 유지, 배역명 삽입 금지)'],
    // 캐시 스캔 실사례(눈물의 여왕 215720): 이탈리아어 대명사 lui/lei → '김수현 배우는… 김지원 배우도'로 배우명 삽입
    ["Cosa dire non ci sono parole per dire che l'amore trionfa anche quando trapassiamo, commovente, lui straordinario lei molto brava.", 'ko', /그|남자|여자|그녀|남주|여주/, /김수현|김지원/, '대명사 lui/lei → ko (배우명 삽입 금지)', 'titles/215720/reviews/_test/translations/'],
];

async function run() {
    await txGlossary.ready().catch(() => {});
    let fail = 0;
    for (const [text, targetLang, mustRe, badRe, desc, path = PATH] of CASES) {
        const targetName = langName(targetLang);
        const ctx = await buildTranslationContext(path + targetLang, targetLang, targetName).catch(() => ({ lines: [], titleId: null }));
        if (!ctx.lines.some((l) => /Main cast/.test(l))) { console.error('캐스트 표 컨텍스트 없음 — KCULTURE 서비스 계정 확인'); process.exit(2); }
        const hits = txGlossary.matchText(text, { anchoredTitleId: ctx.titleId });
        const glossaryLines = await txGlossary.buildGlossaryLines(hits, targetLang, targetName).catch(() => []);
        const styleLines = nuanceLines(text, targetLang, targetName, 'dcomment');
        const prompt = buildTxPrompt({ text, targetLang, targetName, ctxLines: ctx.lines, glossaryLines, styleLines, srcLang: /[가-힣]/.test(text) ? 'ko' : /\b(lui|lei|che)\b/.test(text) ? 'it' : 'id' });
        const model = MODEL_OVERRIDE || txModelFor(targetLang, KDL_TX_MODEL);
        console.log(`\n── ${desc}  [model=${model}]`);
        // first = 프롬프트만(1차 응답), final = 라우트와 같은 치환 가드·재시도 후(사용자가 보는 결과)
        let firstBad = 0, bad = 0, retried = 0;
        for (let i = 0; i < TRIALS; i += 1) {
            const gen = (p, temperature) => callGeminiText(p, KEY, { label: 'test-char-names', model, genConfig: { temperature, topP: 0.9, responseMimeType: 'application/json' } });
            const r = await gen(prompt, 0.3);
            let out = txOutText(r.text);
            if (!(mustRe.test(out) && !badRe.test(out))) firstBad += 1;
            const swapped = txGlossary.castSwapSuspect(text, out, ctx.castActors);
            if (swapped.length) {
                retried += 1;
                const r2 = await gen(`${prompt}${castSwapWarning(swapped, targetName)}`, 0);
                if (!r2.error) out = txOutText(r2.text);
            }
            const ok = mustRe.test(out) && !badRe.test(out);
            if (!ok) bad += 1;
            console.log(`  ${ok ? '✓' : '✗'}${swapped.length ? ' (재시도)' : ''} ${String(out).replace(/\s+/g, ' ').slice(0, 150)}`);
        }
        console.log(`  → 1차 실패 ${firstBad}/${TRIALS} · 가드 재시도 ${retried} · 최종 실패 ${bad}/${TRIALS}`);
        if (bad) fail += 1;
    }
    console.log(`\n${fail ? `FAIL: ${fail}개 케이스에서 이름 치환/누락` : 'PASS: 이름 치환 0건'}`);
    process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
