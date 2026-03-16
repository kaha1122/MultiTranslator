const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const LANG_NAMES = {
    'ko': 'Korean', 'en': 'English', 'ja': 'Japanese',
    'zh-CN': 'Chinese (Simplified)', 'vi': 'Vietnamese',
    'fr': 'French', 'de': 'German', 'es': 'Spanish',
    'ru': 'Russian', 'pt-BR': 'Portuguese (Brazilian)',
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

router.post('/api/vocab-words', requireAuth, async (req, res) => {
    const { topic, topicLabel, category, level, targetLang, sourceLang, byokGeminiKey, avoidWords } = req.body;
    if (!topic || !targetLang) {
        return res.status(400).json({ error: 'Missing topic or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';

    const guide = LANG_SPECIFIC_GUIDE[targetLang] || LANG_SPECIFIC_GUIDE['en'];
    const unit = guide.unit || 'words';
    const langName = LANG_NAMES[targetLang] || 'the target language';
    const levelDesc = {
        basic: `Beginner (A1/A2)
  - Single words or 2-word phrases only. No idioms or advanced expressions.
  - Top 500 high-frequency words tied to the topic in ${langName}.
  - Concrete nouns, basic verbs, simple adjectives that a complete beginner needs first.
  - ${guide.basic}
  - Example sentences: one clause, 3–8 ${unit}.`,
        intermediate: `Intermediate (B1/B2)
  - Mix of single words, collocations, common idioms, and fixed expressions natural to ${langName}.
  - Vocabulary that adds nuance to daily conversations — include expressions unique to ${langName} that have no direct equivalent in other languages.
  - Include emotion/situation adjectives and practical fixed expressions.
  - ${guide.inter}
  - Example sentences: compound sentences, 5–12 ${unit}.`,
        advanced: `Advanced (C1/C2)
  - Sophisticated idioms, proverbs, slang, domain-specific terms, and multi-word expressions in ${langName}.
  - Nuanced synonyms that native ${langName} speakers prefer over textbook equivalents.
  - Include culturally rich expressions, subtle connotation differences, and formal/informal register pairs.
  - ${guide.adv}
  - Example sentences: complex sentences with 2+ clauses, 8–20 ${unit}.`,
    }[level] || 'intermediate level';

    const avoidBlock = (avoidWords && avoidWords.length > 0)
        ? `\nIMPORTANT — The learner has already learned the following words. You MUST generate completely different words:\n${avoidWords.map((w, i) => `${i + 1}. "${w}"`).join('\n')}\n`
        : '';

    const prompt = `You are a vocabulary teacher for language learners.

Context:
- Topic: ${topicLabel || topic} (Category: ${category || ''})
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- Level: ${levelDesc}
${avoidBlock}
Generate exactly 5 vocabulary items related to this topic.

Rules:
1. **Variety of form**: Mix different types — single words, collocations, idioms, fixed expressions, and forms natural to ${targetLangName} — as appropriate for the level. Do NOT generate 5 simple single words unless the level is Beginner.
2. **Topic relevance**: Every item must be highly relevant and practically useful for the given topic and category.
3. **Level compliance**: Strictly match the vocabulary complexity and example sentence structure defined in the Level guidelines above.
4. **Anti-duplication**: Do NOT repeat any word from the exclusion list above.
5. **Natural examples**: Each example sentence must show the word/phrase used in a realistic, contextually rich situation — not a generic textbook sentence.
6. For zh-CN: include pinyin with tone marks. For ja: include hiragana reading. For others: include romanization if applicable.
7. All meanings, tips, and example translations must be in ${sourceLangName}.
8. For each word, provide 2-3 concise learning tips in ${sourceLangName}: (1) Part of speech & core meaning (2) Synonyms/antonyms or common collocations (3) Usage note or cultural context. Each tip should be one sentence.
9. **CRITICAL — "word" field must contain ONLY the pure word/phrase in ${targetLangName}. NEVER include pronunciation, pinyin, hiragana, romanization, hanja, parenthetical readings, or any annotation in the "word" field.** Bad: "咖啡 (kāfēi)", "食べる（たべる）", "おんがく (音楽)", "커피(coffee)". Good: "咖啡", "食べる", "音楽", "커피". For Japanese: the "word" field must use the standard written form (kanji where natural, e.g. "音楽" not "おんがく"). Hiragana reading goes ONLY in the "pronunciation" field.
10. **"example" field must also contain ONLY the pure sentence in ${targetLangName} — no pronunciation annotations, no parenthetical readings.**

Return ONLY valid JSON (no markdown):
{
  "words": [
    {
      "word": "<PURE word/phrase in ${targetLangName} — NO pronunciation or reading annotations>",
      "pronunciation": "<pinyin/hiragana/romanization or empty string>",
      "meaning": "<concise meaning in ${sourceLangName}>",
      "example": "<example sentence in ${targetLangName}>",
      "examplePronunciation": "<pinyin/hiragana/romanization of the example sentence, or empty string if not applicable>",
      "exampleTranslation": "<example translation in ${sourceLangName}>",
      "learningTip": ["<tip1 in ${sourceLangName}>", "<tip2 in ${sourceLangName}>"]
    }
  ]
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.5, topK: 64, topP: 0.95 },
            }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        res.json(parsed);
    } catch (e) {
        console.error('[VocabWords] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate vocabulary' });
    }
});

module.exports = router;
