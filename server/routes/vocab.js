const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { geminiUrl } = require('../config/gemini');

const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { stripAnnotations } = require('../utils/stripAnnotations');

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
  - Top 800 high-frequency words tied to the topic in ${langName}.
  - Concrete nouns, basic verbs, simple adjectives that a complete beginner needs first.
  - ${guide.basic}
  - Example sentences: one clause, 3–8 ${unit}.`,
        intermediate: `Intermediate (B1–B2)
  - Single words, 2-3 word collocations, and common fixed expressions natural to ${langName}.
  - Vocabulary for everyday conversations: opinions, feelings, describing experiences, making comparisons.
  - Include practical phrasal verbs/expressions that bridge the gap from textbook to real conversation.
  - Avoid rare idioms or culturally obscure expressions — focus on high-utility expressions a confident beginner would encounter.
  - ${guide.inter}
  - Example sentences: 1-2 clauses, 6–12 ${unit}. Past and present tenses allowed.`,
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
   For ru (Russian stress marks — CRITICAL accuracy rule):
   - In "pronunciation" and "examplePronunciation", rewrite the word/sentence with an acute accent (´) placed ONLY on the stressed vowel of each word.
   - ACCURACY IS MANDATORY: Place the accent on the EXACT vowel that carries stress in standard Russian dictionary pronunciation. Do NOT guess.
   - Common stress errors to AVOID: "прívет" ✗ → "привéт" ✓ (second syllable), "извинúте" ✗ → "извини́те" ✓ (third syllable), "мóлоко" ✗ → "молокó" ✓ (last syllable).
   - The accent mark (´) must be placed DIRECTLY on the vowel letter (combining acute U+0301), not before or after it.
   - Words with ё do not need an accent mark (ё is always stressed). Single-syllable words (в, на, он, да) need no accent mark.
7. All meanings, tips, and example translations must be in ${sourceLangName}.
8. For each word, provide 2-3 concise learning tips in ${sourceLangName}: (1) Part of speech & core meaning (2) Synonyms/antonyms or common collocations (3) Usage note or cultural context. Each tip should be one sentence.
9. **CRITICAL — "word" field must contain ONLY the pure word/phrase in ${targetLangName}. NEVER include pronunciation, pinyin, hiragana, romanization, hanja, parenthetical readings, or any annotation in the "word" field.** Bad: "咖啡 (kāfēi)", "食べる（たべる）", "おんがく (音楽)", "커피(coffee)". Good: "咖啡", "食べる", "音楽", "커피". For Japanese: the "word" field must use the standard written form (kanji where natural, e.g. "音楽" not "おんがく"). Hiragana reading goes ONLY in the "pronunciation" field.
10. **"example" field must also contain ONLY the pure sentence in ${targetLangName} — no pronunciation annotations, no parenthetical readings.**

Return ONLY valid JSON (no markdown):
{
  "words": [
    {
      "word": "<PURE word/phrase in ${targetLangName} — NO pronunciation or reading annotations>",
      "pronunciation": "<pinyin for zh-CN/zh, hiragana for ja, stressed form with ´ marks for ru, or empty string>",
      "meaning": "<concise meaning in ${sourceLangName}>",
      "example": "<example sentence in ${targetLangName}>",
      "examplePronunciation": "<pinyin for zh-CN/zh, hiragana for ja, stressed form with ´ marks for ru, or empty string>",
      "exampleTranslation": "<example translation in ${sourceLangName}>",
      "learningTip": ["<tip1 in ${sourceLangName}>", "<tip2 in ${sourceLangName}>"]
    }
  ]
}`;

    try {
        const response = await axios.post(
            geminiUrl(geminiKey),
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.5, topK: 64, topP: 0.95 },
            }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        // Gemini가 rule을 무시하고 주입한 furigana/핀인 주석 제거 (보험)
        if (Array.isArray(parsed.words)) {
            parsed.words.forEach(w => {
                w.word = stripAnnotations(w.word, targetLang);
                w.example = stripAnnotations(w.example, targetLang);
            });
        }
        res.json(parsed);
    } catch (e) {
        console.error('[VocabWords] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate vocabulary' });
    }
});

module.exports = router;
