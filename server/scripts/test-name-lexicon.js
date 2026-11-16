#!/usr/bin/env node
/**
 * 작품 호칭 사전(lib/nameLexicon.js) 테스트 (2026-11-16)
 *
 * 1부(오프라인, 항상): 철자 변형·애칭·줄임말이 올바른 인물로 묶이는지, 오탐이 없는지.
 * 2부(--live): 같은 원문을 사전 없이 / 사전 주입으로 번역해 비교(A/B). GEMINI_API_KEY + 캐스트 표용 서비스 계정 필요.
 *
 * 실행:  cd server && node scripts/test-name-lexicon.js
 *        node scripts/test-name-lexicon.js --live --trials 2
 *        node scripts/test-name-lexicon.js --file C:/Kculture/content/lexicon/303745.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const L = require('../lib/nameLexicon');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const FILE = arg('--file', 'C:/Kculture/content/lexicon/303745.json');
const LIVE = argv.includes('--live');
const TRIALS = Number(arg('--trials', 2));

const lex = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const index = L.buildIndex(lex);

// ── 1부: 매칭 ──────────────────────────────────────────────────────────────
// [원문, anchored, 기대 키 목록(인물·nick은 인물 키, 'title:', 'couple:'), 설명]
const MATCH = [
    ['Yun I Jun finally caught on', true, ['yoon-yi-jun'], '레딧 헤더식 Yun I Jun'],
    ['yijoon is so jealous lol', true, ['yoon-yi-jun'], '관측 없는 철자 Yijoon(규칙 생성)'],
    ['Lee Jun looked at her', true, ['yoon-yi-jun'], '성 없이 Lee Jun(이준 → lee+jun)'],
    ['Jaehui and Yi-jun in the car scene', true, ['kang-jae-hee', 'yoon-yi-jun'], 'Jaehui + Yi-jun'],
    ['Jae Hee Kang deserves better', true, ['kang-jae-hee'], '서양식 어순 Jae Hee Kang'],
    ['Chaehee was amazing in the fight', true, ['kang-jae-hee'], 'MR식 Chaehee'],
    ['Kim Sihyun is shady', true, ['kim-si-hyeon'], 'Kim Sihyun'],
    ['상무님 사자후 미쳤다', true, ['yoon-yi-jun'], '애칭 상무님'],
    ['쭌상무님 말투 그저 퀸', true, ['yoon-yi-jun'], '애칭 쭌상무'],
    ['Secretary Kang is getting drunk', true, ['kang-jae-hee'], '영어 애칭 Secretary Kang'],
    ['secretary Han knew too much', true, ['secretary-han'], '직함형 인물 Secretary Han'],
    ['유죄인간 이준재희 키스신 언제 나와', true, ['yoon-yi-jun', 'kang-jae-hee', 'title:유죄인간', 'couple:이준재희'], '줄임말+커플명'],
    // 오탐 방지
    ['재희를 수행비서로 위장시킨 설정', true, ['kang-jae-hee'], '수행비서 ≠ 한비서'],
    ['정인아, 네 목소리는 보물 같아', true, [], 'OST 가수 정인아는 배역 아님'],
    ['I just finished episode 8', true, [], '"I just" ≠ I Jun'],
    ['Jun is a common name', false, [], '작품 미특정 글: 약한 형태(Jun) 매칭 금지'],
];

function keysOf(m) {
    return [
        ...m.characters.map((h) => h.entry.key),
        ...m.titles.map((t) => `title:${t.form}`),
        ...(m.couples || []).map((c) => `couple:${c.form}`),
    ].sort();
}
let fail = 0;
console.log(`사전: ${FILE} — 인물 ${index.entries.length} · 작품 별칭 ${index.titleAliases.length} · 커플 ${index.couples.length}`);
for (const [text, anchored, want, desc] of MATCH) {
    const got = keysOf(L.match(index, text, { anchored }));
    const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
    if (!ok) fail += 1;
    console.log(`${ok ? '✓' : '✗'} ${desc.padEnd(34)} ${ok ? '' : `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`}`);
}
console.log(`\n1부 매칭: ${MATCH.length - fail}/${MATCH.length} 통과`);

// 사용자 예시(가경) — 규칙 생성 단독 확인
const ga = L.romanForms('가경');
console.log(`가경 변형 ${ga.size}개 — gakyoung:${ga.has('gakyoung')} ga-kyoung:${ga.has(L.normLatin('ga-kyoung'))} kakyoung:${ga.has('kakyoung')} gagyeong:${ga.has('gagyeong')}`);

if (!LIVE) process.exit(fail ? 1 : 0);

// ── 2부: 실번역 A/B ─────────────────────────────────────────────────────────
(async () => {
    const { callGeminiText } = require('../utils/geminiCall');
    const { nuanceLines } = require('../lib/txNuance');
    const community = require('../routes/community');
    const { buildTxPrompt, buildTranslationContext, KDL_TX_MODEL, langName, txOutText } = community._tx;
    const { txModelFor } = require('../config/langGuide');
    const KEY = process.env.GEMINI_API_KEY;
    const PATH = `titles/${lex.titleId}/discussion/_test/translations/`;
    // [원문, srcLang, 타깃, 반드시(정규식), 금지(정규식), 설명]
    const CASES = [
        ['Yun I Jun finally saw through Secretary Kang. Jaehui is in so much trouble now', 'en', 'ko', /윤이준/, /아이\s?준|윤\s아이|강재희/, '레딧 철자 → ko (Jaehui는 이름만 → 재희)'],
        ['상무님 오늘 사자후 미쳤다 ㅋㅋ 강쥐재희 냥이이준 조합 최고', 'ko', 'en', /Yi-?jun|Director Yoon/i, /managing director|executive director|sangmu|Kang Jae|Yoon Yi/i, '애칭 → en (이름만 유지)'],
        ['유죄인간 이준재희 키스신 언제 나와요', 'ko', 'en', /Love in Disguise/i, /guilty (human|person)/i, '줄임말·커플명 → en'],
        ['Yijoon sama Kang Jae Hui makin dekat, aku deg-degan', 'id', 'en', /Yi-?jun/i, /Yijoon|Yoon Yi/, '관측 밖 철자 → en 대표 표기(이름만 유지)'],
        ['Yi Joon y Jae-hee son la mejor pareja del año', 'es', 'ja', /イジュン/, /Yi ?Joon|ユン/, '철자 → ja (이름만 → イジュン, 성 붙이지 않음)'],
    ];
    let liveFail = 0;
    for (const [text, srcLang, targetLang, mustRe, badRe, desc] of CASES) {
        const targetName = langName(targetLang);
        const ctx = await buildTranslationContext(PATH + targetLang, targetLang, targetName).catch(() => ({ lines: [] }));
        const styleLines = nuanceLines(text, targetLang, targetName, 'dcomment');
        const lexLines = L.promptLines(L.match(index, text, { anchored: true }), lex, targetLang, targetName);
        const model = txModelFor(targetLang, KDL_TX_MODEL);
        console.log(`\n── ${desc}  [${srcLang}→${targetLang}, ${model}]\n   원문: ${text}`);
        lexLines.slice(1).forEach((l) => console.log(`   주입 ${l.slice(0, 150)}`));
        for (const [label, glossaryLines] of [['사전 없음', []], ['사전 주입', lexLines]]) {
            const prompt = buildTxPrompt({ text, targetLang, targetName, ctxLines: ctx.lines, glossaryLines, styleLines, srcLang });
            let bad = 0;
            const outs = [];
            for (let i = 0; i < TRIALS; i += 1) {
                const r = await callGeminiText(prompt, KEY, { label: 'test-lexicon', model, genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' } });
                const out = String(txOutText(r.text) || r.error || '').replace(/\s+/g, ' ');
                const ok = mustRe.test(out) && !badRe.test(out);
                if (!ok) bad += 1;
                outs.push(`${ok ? '✓' : '✗'} ${out.slice(0, 140)}`);
            }
            console.log(`   [${label}] 실패 ${bad}/${TRIALS}`);
            outs.forEach((o) => console.log(`      ${o}`));
            if (label === '사전 주입' && bad) liveFail += 1;
        }
    }
    console.log(`\n2부 실번역(사전 주입): ${CASES.length - liveFail}/${CASES.length} 케이스 전부 통과`);
    process.exit(fail || liveFail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
