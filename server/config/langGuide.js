/**
 * 언어별 문법/어휘 특성 가이드 — vocab, scene, listening 공유 모듈
 */

const LANG_NAMES = {
    // 기존 10개
    'ko': 'Korean', 'en': 'English', 'ja': 'Japanese',
    'zh-CN': 'Chinese (Simplified)', 'vi': 'Vietnamese',
    'fr': 'French', 'de': 'German', 'es': 'Spanish',
    'ru': 'Russian', 'pt-BR': 'Portuguese (Brazilian)',
    // 추가 Tier 1 (28개)
    'ar': 'Arabic', 'bn': 'Bengali', 'bg': 'Bulgarian',
    'zh-TW': 'Chinese (Traditional)', 'hr': 'Croatian', 'cs': 'Czech',
    'da': 'Danish', 'nl': 'Dutch', 'et': 'Estonian',
    'fi': 'Finnish', 'el': 'Greek', 'he': 'Hebrew',
    'hi': 'Hindi', 'hu': 'Hungarian', 'id': 'Indonesian',
    'it': 'Italian', 'lv': 'Latvian', 'lt': 'Lithuanian',
    'no': 'Norwegian', 'pl': 'Polish', 'ro': 'Romanian',
    'sr': 'Serbian', 'sk': 'Slovak', 'sl': 'Slovenian',
    'sw': 'Swahili', 'sv': 'Swedish', 'th': 'Thai',
    'tr': 'Turkish', 'uk': 'Ukrainian',
    // K-DramaAnyLang 단독 추가(2026-09-07) — PronunFit 클라 언어 목록에는 없다.
    // 여기 키셋 = 번역 targetLang·번역 캐시 키·langDetect 후보(lib/langDetect.js DETECT_CODES)의 단일 출처.
    'te': 'Telugu',
};

const LANG_SPECIFIC_GUIDE = {
    'en': {
        basic:  'Use simple SVO sentences. No phrasal verbs or idioms.',
        inter:  'Use phrasal verbs (e.g., "run into", "figure out"), modals (could/would) for politeness, and common collocations.',
        adv:    'Use conditionals, relative clauses, passive voice, and subtle idioms.',
        unit:   'words',
    },
    'ja': {
        basic:  'Use です/ます form only. Simple SOV structure. No compound particles.',
        inter:  'Use て-form connectors, たり…たり, ～けど/～から for compound sentences. Use 敬語 basics (～ていただけますか).',
        adv:    'Use 謙譲語/尊敬語, complex て-form chains, ～ものの/～にもかかわらず, and nuanced sentence-ending particles.',
        unit:   '文節 (bunsetsu)',
    },
    'zh-CN': {
        basic:  'Use simple SVO with 是/有/在. No 把/被 constructions or chengyu.',
        inter:  'Use 因为…所以, 虽然…但是, 把-construction, and common 成语. Modal verbs like 应该/可以 for politeness.',
        adv:    'Use 被-passive, 把-disposal, complex 连…都/也, literary 成语, and formal written expressions.',
        unit:   'characters/words',
    },
    'ko': {
        basic:  'Use 해요체 only. Simple SOV structure. Basic particles (은/는, 이/가, 을/를).',
        inter:  'Use -지만, -니까, -면 connectors. Appropriate 존댓말 levels. Common 관용구 (e.g., 발이 넓다).',
        adv:    'Use 격식체/비격식체 register pairs, complex connectors (-음에도 불구하고), 사자성어, and indirect speech (-다고 하다).',
        unit:   '어절',
    },
    'vi': {
        basic:  'Use simple SVO. Basic classifier-noun pairs (một cái, một con). No complex tense markers.',
        inter:  'Use conjunctions (nhưng, vì…nên, nếu…thì). Appropriate personal pronouns for social context (anh/chị/em).',
        adv:    'Use formal registers, proverbs (tục ngữ), Sino-Vietnamese compounds (한자어), and nuanced modal particles (ạ, nhé, đi).',
        unit:   'words',
    },
    'fr': {
        basic:  'Use présent/passé composé only. Simple SVO. No subjunctive.',
        inter:  'Use imparfait vs passé composé distinction, pronoms compléments (y, en), and common expressions idiomatiques.',
        adv:    'Use subjonctif, conditionnel passé, relative clauses with dont/lequel, and literary expressions.',
        unit:   'words',
    },
    'de': {
        basic:  'Use Präsens only. Main clause word order (SVO). No Nebensätze.',
        inter:  'Use trennbare Verben (separable verbs), Nebensätze with weil/dass/ob, and Konjunktiv II for politeness (könnte/würde).',
        adv:    'Use Konjunktiv I (reported speech), complex Relativsätze, Passiv, and idiomatic Redewendungen.',
        unit:   'words',
    },
    'es': {
        basic:  'Use presente/pretérito perfecto only. Simple SVO. No subjuntivo.',
        inter:  'Use pretérito vs imperfecto distinction, pronombres de objeto, and common modismos (e.g., "echar de menos").',
        adv:    'Use subjuntivo in all tenses, condicional compuesto, relative clauses with cuyo, and culturally rich refranes.',
        unit:   'words',
    },
    'ru': {
        basic:  'Use present tense only. Simple SVO. No participles or verbal adverbs (деепричастия).',
        inter:  'Use perfective/imperfective aspect pairs, common prefixed verbs, cases with prepositions (в/на + prepositional/accusative).',
        adv:    'Use participles (причастия), verbal adverbs (деепричастия), complex subordinate clauses, and idiomatic expressions (фразеологизмы).',
        unit:   'words',
    },
    'pt-BR': {
        basic:  'Use presente/pretérito perfeito only. Simple SVO. No subjuntivo.',
        inter:  'Use pretérito imperfeito vs perfeito, pronomes oblíquos, and common gírias/expressões (e.g., "dar uma mão").',
        adv:    'Use subjuntivo in all tenses, futuro do subjuntivo, orações relativas, and culturally rich provérbios.',
        unit:   'words',
    },
};

/**
 * CEFR 기반 난이도 설명 생성 (scene.js에서 사용하던 함수)
 */
function getDifficultyDesc(level, langCode) {
    const guide = LANG_SPECIFIC_GUIDE[langCode] || LANG_SPECIFIC_GUIDE['en'];
    const unit = guide.unit || 'words';
    const langName = LANG_NAMES[langCode] || 'the target language';
    const descs = {
        basic: `Beginner (A1/A2)
  - Vocabulary: Top 800 high-frequency words only. Simple nouns, verbs, adjectives.
  - Grammar: ${guide.basic} One clause per sentence. No subordinate clauses.
  - Length: 3–8 ${unit}.
  - Goal: Express immediate needs in the simplest form possible.`,
        intermediate: `Intermediate (B1–B2)
  - Vocabulary: Common collocations and practical fixed expressions natural to ${langName}. Avoid rare idioms.
  - Grammar: ${guide.inter} 1-2 clauses per sentence. Past and present tenses allowed.
  - Length: 6–12 ${unit}.
  - Goal: Express opinions, reasons, and polite requests in everyday situations.`,
        advanced: `Advanced (C1/C2)
  - Vocabulary: Nuanced idioms, domain-specific terms, sophisticated expressions.
  - Grammar: ${guide.adv} Complex sentences with 3+ clauses.
  - Length: 8–20 ${unit}.
  - Goal: Handle nuanced social situations with native-level fluency.`,
    };
    return descs[level] || descs.intermediate;
}

// ── 언어별 번역 모델 승격 (2026-09-07) ────────────────────────────────────────
// 저가 모델이 특정 언어에서만 무너질 때, 그 언어만 상위 모델로 올린다(전역 승격은 청구액 ~3배).
// 선례: 베트남어 무성조 오독 → KDL UGC 라우트 전체를 3.1-flash-lite로(routes/community.js KDL_TX_MODEL).
// 이 맵은 그보다 좁은 단위 — 호출자가 이미 쓰는 모델보다 이 맵이 우선한다.
//   te: 2.5-flash-lite는 텔루구 음절문자를 거치며 인명이 깎인다(실측 2026-09-07: 강하기 → "강하",
//       3.1-flash-lite는 강하기·남다름 정확). 한국 인명이 매 문장 나오는 앱이라 승격이 필요하다.
// Render env 로 즉시 되돌릴 수 있게 하려면 호출자 쪽 env(KDL_TX_MODEL_ID 등)를 그대로 두면 된다 —
// 이 맵에 없는 언어는 호출자 기본값을 100% 유지한다.
const TX_MODEL_BY_LANG = {
    te: 'gemini-3.1-flash-lite',
};

/**
 * 대상 언어의 번역 모델을 고른다. 맵에 없으면 호출자 기본값(fallback) 그대로.
 * @param {string} code - 대상 언어 ISO 코드('pt-BR'처럼 지역코드면 베이스로 폴백)
 * @param {string|null} fallback - 호출자가 쓰던 모델(미지정이면 전역 PRIMARY가 쓰인다)
 */
function txModelFor(code, fallback = null) {
    const c = String(code || '');
    return TX_MODEL_BY_LANG[c] || TX_MODEL_BY_LANG[c.split('-')[0]] || fallback;
}

module.exports = { LANG_NAMES, LANG_SPECIFIC_GUIDE, getDifficultyDesc, TX_MODEL_BY_LANG, txModelFor };
