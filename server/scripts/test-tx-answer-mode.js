#!/usr/bin/env node
/**
 * UGC 번역 "답변 모드" 회귀 테스트 (2026-09-09)
 *
 * 사고: 아랍어 답글 "ممكن تعلميني كيف افتح الحلقات عشان نزلتو جديد"(새 회차 어떻게 보나요?)를 ko로 AI 번역했더니
 * 번역문 대신 "저희 앱은 영상 스트리밍 서비스가 아니라 … 영상 시청은 지원하지 않는 점 참고 부탁드려요!"라는
 * **앱 운영자 답변**이 나와 그대로 표시됨. 프롬프트의 앱 성격 줄(APP_NATURE_LINE)이 "사용자가 영상 못 봐서
 * 불평한다"는 서사를 심어, 2인칭 질문을 만나면 모델이 번역가 역할을 버리고 답변자로 전환하는 것.
 * (9/5 빈 스포일러 환각 "I thought this was a streaming app"도 같은 뿌리.)
 *
 * 실행:  cd server && node scripts/test-tx-answer-mode.js            (기본 4회 반복)
 *        node scripts/test-tx-answer-mode.js --trials 6 --model gemini-2.5-flash-lite
 * 필요: server/.env 의 GEMINI_API_KEY (+ KCULTURE_SERVICE_ACCOUNT_BASE64 — 컨텍스트 케이스)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { callGeminiText } = require('../utils/geminiCall');
const { nuanceLines } = require('../lib/txNuance');
const community = require('../routes/community');
const { buildTxPrompt, buildTranslationContext, KDL_TX_MODEL, langName } = community._tx;
const { txModelFor } = require('../config/langGuide');
const txGlossary = require('../lib/txGlossary');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MODEL_OVERRIDE = arg('--model', null);
const TRIALS = Number(arg('--trials', 4));
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 없음 (server/.env)'); process.exit(1); }

// 최애의 사원(296140) 스레드 답글 위치 — 사고 현장과 같은 위치 판정(titles + replies)
const REPLY_PATH = 'titles/296140/discussion/c0/replies/r0/translations/';
const AR = 'ممكن تعلميني كيف افتح الحلقات عشان نزلتو جديد';

// "답변 모드" 시그니처(번역이 아니라 앱이 대답한 흔적) — 하나라도 걸리면 FAIL
const ANSWER_KO = /저희 앱|스트리밍|지원하지|참고 부탁|안내드|커뮤니티 앱|정보 제공/;
const ANSWER_EN = /our app|this app|does not (stream|host)|doesn't (stream|host)|streaming service|we (do not|don't)|information (and|&) community/i;
// 번역 성공 시그니처(원문 의미가 살아 있는가)
const OK_KO = /(알려|가르쳐|어떻게).*(에피소드|회차|화|영상|재생)|(에피소드|회차|영상).*(어떻게|여는|보는|열|재생)/;
const OK_EN = /(how|teach|show).*(episode)/i;

// [원문, 타깃, scope, cachePath|null, 답변모드 정규식, 번역성공 정규식, 설명]
const CASES = [
    [AR, 'ko', 'dreply', REPLY_PATH + 'ko', ANSWER_KO, OK_KO, '★ 사고 원문 → ko (답글 컨텍스트)'],
    [AR, 'ko', 'dcomment', null, ANSWER_KO, OK_KO, '사고 원문 → ko (컨텍스트 없음)'],
    [AR, 'en', 'dreply', REPLY_PATH + 'en', ANSWER_EN, OK_EN, '사고 원문 → en (답글 컨텍스트)'],
    ['gimana cara nonton episode barunya? gak nemu tombolnya', 'ko', 'dreply', REPLY_PATH + 'ko', ANSWER_KO, /(에피소드|회차).*(어떻게|봐|보)|버튼/, '인니어 같은 취지 질문 → ko'],
    ['새 에피소드 어디서 봐요? 재생 버튼이 없어요', 'en', 'dreply', REPLY_PATH + 'en', ANSWER_EN, /episode.*(where|how)|play button/i, '한국어 같은 취지 질문 → en'],
];

async function run() {
    await txGlossary.ready().catch(() => {});
    let fail = 0;
    for (const [text, targetLang, scope, cachePath, answerRe, okRe, desc] of CASES) {
        const targetName = langName(targetLang);
        const ctx = cachePath ? await buildTranslationContext(cachePath, targetLang, targetName).catch(() => ({ lines: [], titleId: null })) : { lines: [], titleId: null };
        const hits = txGlossary.matchText(text, { anchoredTitleId: ctx.titleId });
        const glossaryLines = await txGlossary.buildGlossaryLines(hits, targetLang, targetName).catch(() => []);
        const styleLines = nuanceLines(text, targetLang, targetName, scope);
        const prompt = buildTxPrompt({ text, targetLang, targetName, ctxLines: ctx.lines, glossaryLines, styleLines });
        const model = MODEL_OVERRIDE || txModelFor(targetLang, KDL_TX_MODEL);
        console.log(`\n── ${desc}  [ctx=${ctx.lines.length ? 'Y' : 'n'} model=${model}]`);
        let answerMode = 0, ok = 0;
        for (let i = 0; i < TRIALS; i += 1) {
            const r = await callGeminiText(prompt, KEY, { label: 'test-answer-mode', model, genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' } });
            let out = r.text || '';
            try { const p = JSON.parse(out); out = p.same ? '{same}' : (p.translated || out); } catch { /* raw */ }
            const isAnswer = answerRe.test(out);
            const isOk = !isAnswer && okRe.test(out);
            if (isAnswer) answerMode += 1;
            if (isOk) ok += 1;
            console.log(`  ${isAnswer ? '✗ ANSWER' : isOk ? '✓ ok    ' : '? other '} ${String(out).replace(/\s+/g, ' ').slice(0, 140)}`);
        }
        console.log(`  → 답변모드 ${answerMode}/${TRIALS} · 번역OK ${ok}/${TRIALS}`);
        if (answerMode > 0) fail += 1;
    }
    console.log(`\n${fail ? `FAIL: ${fail}개 케이스에서 답변 모드 발생` : 'PASS: 답변 모드 0건'}`);
    process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
