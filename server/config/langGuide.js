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
  - Vocabulary: Top 500 high-frequency words only. Simple nouns, verbs, adjectives.
  - Grammar: ${guide.basic} One clause per sentence. No subordinate clauses.
  - Length: 3–8 ${unit}.
  - Goal: Express immediate needs in the simplest form possible.`,
        intermediate: `Intermediate (B1/B2)
  - Vocabulary: Common collocations, everyday idioms, and expressions natural to ${langName}.
  - Grammar: ${guide.inter} Up to 2 clauses per sentence.
  - Length: 5–12 ${unit}.
  - Goal: Express opinions, reasons, and polite requests with context.`,
        high: `Advanced (C1/C2)
  - Vocabulary: Nuanced idioms, domain-specific terms, sophisticated expressions.
  - Grammar: ${guide.adv} Complex sentences with 3+ clauses.
  - Length: 8–20 ${unit}.
  - Goal: Handle nuanced social situations with native-level fluency.`,
    };
    return descs[level] || descs.intermediate;
}

module.exports = { LANG_NAMES, LANG_SPECIFIC_GUIDE, getDifficultyDesc };
