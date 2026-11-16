#!/usr/bin/env node
/**
 * 유사 이름·작품명 규칙(lib/nameRules.js + nameLexicon.analyze) 테스트 (2026-11-16)
 *
 * 1부(오프라인): 문자 체계별 철자 변형이 같은 배역으로 묶이는지·오탐이 없는지 / 작품명 변형
 * 2부(--live): 나의 유죄인간(303745) 작품 페이지 위치로 실제 프롬프트를 조립해 번역 — 규칙 줄 없음 vs 있음
 *   GEMINI_API_KEY + KCULTURE 서비스 계정 필요. Firestore 쓰기 없음(names 응답은 검증만 출력).
 *
 * 실행:  cd server && node scripts/test-name-rules.js
 *        node scripts/test-name-rules.js --live --trials 2
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const R = require('../lib/nameRules');

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const TRIALS = Number((argv[argv.indexOf('--trials') + 1]) || 2);

const CAST = [
    { name: '임시완', character: 'Yoon Yi-jun' }, { name: '설인아', character: 'Kang Jae-hee' },
    { name: '김정현', character: 'Kim Si-hyeon' }, { name: '연우', character: 'Lee Hye-jung' },
    { name: '김인권', character: 'Park Bong' }, { name: '홍은희', character: "Yi-jun's sister" },
];
const idx = R.buildCastIndex(CAST);
// [원문, anchored, 기대(배역 영문명[+g=이름만]), 설명]
const MATCH = [
    ['Yun I Jun finally caught on', 1, ['Yoon Yi-jun'], '로마자 Yun I Jun'],
    ['yijoon is so jealous', 1, ['Yoon Yi-jun+g'], '로마자 Yijoon(이름만)'],
    ['Lee Jun looked at her', 1, ['Yoon Yi-jun+g'], '로마자 Lee Jun'],
    ['Jae Hee Kang deserves better', 1, ['Kang Jae-hee'], '서양식 어순'],
    ['Chaehee was amazing', 1, ['Kang Jae-hee+g'], 'MR식 Chaehee'],
    ['Kim Sihyun is shady', 1, ['Kim Si-hyeon'], 'Kim Sihyun'],
    ['Kang Jaeheee is cool', 0, ['Kang Jae-hee'], '오타 1자(성+이름)'],
    ['Bak Bong again', 0, ['Park Bong'], '성씨 관습 Bak=Park'],
    ['李俊和姜在熙今天太甜了', 1, ['Kang Jae-hee', 'Yoon Yi-jun+g'], '한자 李俊·姜在熙(한국 한자음)'],
    ['尹以俊吃醋了', 0, ['Yoon Yi-jun'], '한자 성+이름'],
    ['ユン・イジュンとカン・ジェヒ', 1, ['Yoon Yi-jun', 'Kang Jae-hee'], '가타카나 성+이름'],
    ['イジュンとジェヒは最高', 1, ['Yoon Yi-jun+g', 'Kang Jae-hee+g'], '가타카나 이름만'],
    ['キム・シヒョン怪しい', 1, ['Kim Si-hyeon'], '가타카나 받침(キム)'],
    ['Юн И Джун и Кан Джэ Хи', 1, ['Yoon Yi-jun', 'Kang Jae-hee'], '키릴'],
    ['윤이준이가 재희를 지켜', 1, ['Yoon Yi-jun', 'Kang Jae-hee+g'], '한글+조사'],
    // 오탐 방지
    ['전 진짜 이 드라마 좋아', 1, [], '한글 1음절 전 ≠ Jun'],
    ['I just finished episode 8', 1, [], '"I just" ≠ I Jun'],
    ['jun is late today', 1, [], '소문자 짧은 1단어'],
    ['Yi-jun is so cute', 0, [], '작품 미특정 글: 이름만 매칭 금지'],
    ['カップルが最高', 1, [], '가타카나 일반어'],
    ["Yi-jun's sister is suspicious", 1, ['Yoon Yi-jun+g'], "배역 칸 Yi-jun's sister는 인물로 안 만든다"],
];
let fail = 0;
for (const [text, anchored, want, desc] of MATCH) {
    const got = R.matchCast(idx, text, { anchored: !!anchored }).map((h) => h.ch.en + (h.givenOnly ? '+g' : '')).sort();
    const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
    if (!ok) fail += 1;
    console.log(`${ok ? '✓' : '✗'} ${desc.padEnd(30)} ${ok ? '' : `기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`}`);
}
// 작품명
const TV = [
    [{ ko: '100일의 거짓말', en: 'Days of Deception' }, ['배커짓', '백거짓', '100일의거짓말', 'ㅂㅇㅇㄱㅈㅁ'], '숫자 제목 → 배커짓'],
    [{ ko: '나의 유죄인간', en: 'Love in Disguise' }, ['유죄인간', '나의유죄인간', 'lid'], '줄임말·머리글자'],
    [{ ko: '너에게 다이브', en: 'Dive Into You' }, ['너에게다이브'], 'DIY는 흔한 약어라 제외'],
];
for (const [t, must, desc] of TV) {
    const ks = R.titleVariants(t).filter((v) => v.strong).map((v) => v.k);
    const miss = must.filter((m) => !ks.includes(m));
    const bad = desc.includes('DIY') && ks.includes('diy');
    if (miss.length || bad) fail += 1;
    console.log(`${miss.length || bad ? '✗' : '✓'} ${desc.padEnd(30)} ${ks.join(' ')}`);
}
console.log(`\n1부: ${fail ? `실패 ${fail}` : '전부 통과'}`);
const ga = R.keyOfWords(['Gakyoung']);
console.log(`가경 키: Gakyoung=${ga} · Ga-kyoung=${R.keyOfWords(['Ga-kyoung'])} · Kakyoung=${R.keyOfWords(['Kakyoung'])} · Gagyeong=${R.keyOfWords(['Gagyeong'])} · 가경=${R.skeleton(R.hangulToRR('가경'))}`);
if (!LIVE) process.exit(fail ? 1 : 0);

// ── 2부 ────────────────────────────────────────────────────────────────────
(async () => {
    const { callGeminiText } = require('../utils/geminiCall');
    const { nuanceLines } = require('../lib/txNuance');
    const community = require('../routes/community');
    const { buildTxPrompt, buildTranslationContext, KDL_TX_MODEL, langName, txOutText } = community._tx;
    const { txModelFor } = require('../config/langGuide');
    const nameLexicon = require('../lib/nameLexicon');
    const KEY = process.env.GEMINI_API_KEY;
    const PATH = 'titles/303745/discussion/_test/translations/';
    // [원문, src, 타깃, 반드시, 금지, 설명]
    const CASES = [
        ['李俊和姜在熙今天太甜了，尹以俊吃醋的样子笑死我了', 'zh-CN', 'ko', /이준/, /리준|이쥔|리쥔|임시완|설인아/, '중국어 한자 이름 → ko'],
        ['イジュンとジェヒ、今週も最高だった', 'ja', 'en', /Yi-?jun[\s\S]*Jae-?hee|Jae-?hee[\s\S]*Yi-?jun/i, /Ijun|Jehi|Yoon|Kang|Si-?wan|In-?ah/i, '가타카나 이름만 → en(이름만 유지)'],
        ['Юн И Джун наконец понял, что Кан Джэ Хи — женщина', 'ru', 'en', /Yoon Yi-?jun[\s\S]*Kang Jae-?hee/i, /Yun I Jun|Dzh|Si-?wan|In-?ah/i, '키릴 → en 대표 표기'],
        ['Yun I Jun and Jaehui are endgame, no notes', 'en', 'ja', /イジュン[\s\S]*ジェヒ/, /Yun|Jaehui|シワン|インア/, '레딧 철자 → ja'],
        ['Kang Jaeheee is so cool in the fight scenes', 'en', 'ko', /강재희/, /설인아|재히/, '오타 → ko'],
        ['Kim Sihyun es el más sospechoso', 'es', 'en', /Kim Si-hyeon/, /Sihyun|Jung-?hyun/, '스페인어 속 철자 → en 대표 표기'],
    ];
    let liveFail = 0;
    for (const [text, srcLang, targetLang, mustRe, badRe, desc] of CASES) {
        const targetName = langName(targetLang);
        const ctx = await buildTranslationContext(PATH + targetLang, targetLang, targetName);
        const a = await nameLexicon.analyze({ titleId: '303745', text, targetLang, targetName, cast: ctx.castList || [], anchored: true });
        const styleLines = nuanceLines(text, targetLang, targetName, 'dcomment');
        const model = txModelFor(targetLang, KDL_TX_MODEL);
        console.log(`\n── ${desc}  [${srcLang}→${targetLang}, ${model}]\n   원문: ${text}`);
        a.lines.slice(1).forEach((l) => console.log(`   주입 ${l.slice(0, 160)}`));
        if (a.namesFor.length) console.log(`   names 요청: ${a.namesFor.join(', ')}`);
        for (const [label, gl, nf] of [['규칙 없음', [], []], ['규칙 주입', a.lines, a.namesFor]]) {
            const prompt = buildTxPrompt({ text, targetLang, targetName, ctxLines: ctx.lines, glossaryLines: gl, styleLines, srcLang, namesFor: nf });
            let bad = 0;
            const outs = [];
            for (let i = 0; i < TRIALS; i += 1) {
                const r = await callGeminiText(prompt, KEY, { label: 'test-name-rules', model, genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' } });
                const out = String(txOutText(r.text) || r.error || '').replace(/\s+/g, ' ');
                const ok = mustRe.test(out) && !badRe.test(out);
                if (!ok) bad += 1;
                let names = '';
                try { const p = JSON.parse(r.text); if (p.names) names = ` names=${JSON.stringify(p.names)}`; } catch { /* */ }
                outs.push(`${ok ? '✓' : '✗'} ${out.slice(0, 130)}${names}`);
            }
            console.log(`   [${label}] 실패 ${bad}/${TRIALS}`);
            outs.forEach((o) => console.log(`      ${o}`));
            if (label === '규칙 주입' && bad) liveFail += 1;
        }
    }
    console.log(`\n2부(규칙 주입): ${CASES.length - liveFail}/${CASES.length} 케이스 통과`);
    process.exit(fail || liveFail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
