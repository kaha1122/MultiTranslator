// ── Dari 꼬리 2줄 고정 주입 · Dari 음역 스크럽 · glossary ko 한정 규칙 회귀 테스트 ──
// Gemini 미호출(순수 함수만). 실행: cd server && node scripts/test-dari-tail.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { splitTail, applyFixedTail, scrubDariTranslit, TAIL_BY_LANG, properNounRules } = require('../lib/dari')._qa;

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); } };

const BASE = [
    '📌 At a glance', 'Occult romantic comedy · 12 episodes',
    '', '🌉 Dari\'s take', 'A remake can fail two ways.',
    '', '💬 That\'s my read as an AI curator — did these ghosts feel familiar?',
    '', '— Dari, your AI curator 🌉',
    'Note: this is Dari\'s AI perspective, separate from user ratings.',
].join('\n');

console.log('[1] splitTail — 꼬리 분리');
{
    const r = splitTail(BASE);
    t('서명 감지', r.hasSig);
    t('Note 감지', r.hasNote);
    t('head에 서명 없음', !/Dari, your AI curator/.test(r.head));
    t('head 마지막이 본문', r.head.endsWith('familiar?'), JSON.stringify(r.head.slice(-30)));

    const noNote = BASE.replace(/\nNote:.*$/, '');
    t('Note 없는 본문 → hasNote=false', splitTail(noNote).hasSig && !splitTail(noNote).hasNote);

    const noSig = '본문만 있고 서명이 없다.';
    t('서명 없는 본문 → hasSig=false', !splitTail(noSig).hasSig);
    t('서명 없으면 head=원문', splitTail(noSig).head === noSig);

    // ar 서명은 아랍 쉼표(،)를 쓴다 — 정규식이 둘 다 인정해야 한다
    const arTail = 'نص\n\n— Dari، منسقة الذكاء الاصطناعي الخاصة بك 🌉';
    t('ar 아랍 쉼표 서명 감지', splitTail(arTail).hasSig);
}

console.log('\n[2] applyFixedTail — 12개 언어 결정적 주입');
{
    const LANGS = Object.keys(TAIL_BY_LANG);
    t('테이블 12개 언어', LANGS.length === 12, `${LANGS.length}`);
    for (const L of LANGS) {
        const out = applyFixedTail('번역된 본문 끝', L, true, true);
        const lines = out.trim().split('\n');
        const okSig = lines[lines.length - 2] === TAIL_BY_LANG[L].sig;
        const okNote = lines[lines.length - 1] === TAIL_BY_LANG[L].note;
        const okDari = /Dari/.test(out) && !/다리|ダリ|Дари|داري|达里/.test(out.split('\n').slice(-2).join('\n'));
        t(`${L}: 서명·Note·Dari 라틴표기`, okSig && okNote && okDari, JSON.stringify(lines.slice(-2)));
    }
    // 모델이 스스로 붙인 잘못된 꼬리는 잘라내고 교체해야 한다
    const modelBad = '본문\n\n— 다리, 당신의 AI 큐레이터 🌉\n참고: 이것은 다리의 관점입니다.';
    const fixed = applyFixedTail(modelBad, 'ko', true, true);
    t('모델이 만든 음역 꼬리를 교체', fixed.endsWith(TAIL_BY_LANG.ko.note) && !/다리/.test(fixed), JSON.stringify(fixed));
    t('꼬리 중복 없음', (fixed.match(/AI 큐레이터/g) || []).length === 1);
    // ⚠ 언어별 쉼표 — ja `、` / 전각 `，`를 인정하지 않으면 꼬리가 중복된다(2026-08-29 실제 사고)
    const jaDup = ['本文', '', '— Dari、あなたのAIキュレーター 🌉', '注：これはDariのAIとしての見解であり、ユーザー評価とは別です。'].join('\n');
    const jaFixed = applyFixedTail(jaDup, 'ja', true, true);
    t('ja 일본어 쉼표 서명 교체(중복 없음)', (jaFixed.match(/AIキュレーター/g) || []).length === 1, JSON.stringify(jaFixed));
    // 꼬리가 두 겹 쌓인 문서도 한 겹으로 복구되어야 한다
    const doubled = `本文

${TAIL_BY_LANG.ja.sig}
${TAIL_BY_LANG.ja.note}

${TAIL_BY_LANG.ja.sig}
${TAIL_BY_LANG.ja.note}`;
    const repaired = applyFixedTail(doubled, 'ja', true, true);
    t('두 겹 꼬리 → 한 겹 복구', (repaired.match(/AIキュレーター/g) || []).length === 1, JSON.stringify(repaired));

    // hasNote=false면 Note를 붙이지 않는다
    t('hasNote=false → Note 없음', !/참고:/.test(applyFixedTail('본문', 'ko', true, false)));
}

console.log('\n[3] scrubDariTranslit — 음역 복원(오탐 없이)');
{
    t('ko 🌉 다리의 생각 → Dari', scrubDariTranslit('🌉 다리의 생각', 'ko') === '🌉 Dari의 생각');
    t('ko 다리의 AI 관점 → Dari', scrubDariTranslit('이것은 다리의 AI 관점입니다', 'ko') === '이것은 Dari의 AI 관점입니다');
    // ⚠ 정상 어휘 오탐 금지 — 2026-08-29 검수에서 "기다리는"이 대량 오탐을 냈다
    t('ko "기다리는" 불변', scrubDariTranslit('확인을 기다리는 시간', 'ko') === '확인을 기다리는 시간');
    t('ko "다리를 건너" 불변', scrubDariTranslit('다리를 건너면', 'ko') === '다리를 건너면');
    t('ko "다리의 길이" 불변', scrubDariTranslit('다리의 길이', 'ko') === '다리의 길이');
    t('ja ダリ → Dari', scrubDariTranslit('🌉 ダリの視点', 'ja') === '🌉 Dariの視点');
    t('ru Дари → Dari', scrubDariTranslit('Мнение Дари', 'ru') === 'Мнение Dari');
    t('ar داري → Dari', scrubDariTranslit('رأي داري', 'ar') === 'رأي Dari');
    t('zh-CN 达里 → Dari', scrubDariTranslit('达里的看法', 'zh-CN') === 'Dari的看法');
    t('en 무변경', scrubDariTranslit("Dari's take", 'en') === "Dari's take");
}

console.log('\n[4] properNounRules — glossary 문자열 값은 ko 한정');
{
    const rules = properNounRules({ 'Good Data Corporation': '굿데이터코퍼레이션' }).join('\n');
    t('KOREAN ONLY 명시', /KOREAN ONLY/.test(rules));
    t('비-ko 언어에 원문 유지 지시', /keep "Good Data Corporation" exactly as written/.test(rules));
    t('한글 삽입 금지 명시', /NEVER insert the Korean form/.test(rules));
    const obj = properNounRules({ 'Full House': { ko: '풀하우스', ja: 'フルハウス' } }).join('\n');
    t('객체형은 언어별 지정 유지', /ko: "풀하우스", ja: "フルハウス"/.test(obj));
    t('glossary 없으면 MANDATORY 블록 없음', !/MANDATORY glossary/.test(properNounRules(null).join('\n')));
}

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
