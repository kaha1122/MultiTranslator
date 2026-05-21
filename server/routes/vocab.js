const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { geminiUrl } = require('../config/gemini');

const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { stripAnnotations } = require('../utils/stripAnnotations');

router.post('/api/vocab-words', requireAuth, async (req, res) => {
    const { topic, topicLabel, category, isCustom, level, targetLang, sourceLang, byokGeminiKey, avoidWords } = req.body;
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

    // Anti-Duplication 블록 — 단순 negative list 한계(LLM lost-in-the-middle, 형태소 변형으로 우회) 보완.
    // self-check chain-of-thought 강제 + 어근/동의어/sub-cluster 차단 룰. 30개 cap (200개 박는 토큰 낭비 + 효과 저하).
    const recent = Array.isArray(avoidWords) ? avoidWords.slice(-30) : [];
    const olderCount = Array.isArray(avoidWords) ? Math.max(0, avoidWords.length - recent.length) : 0;
    const avoidBlock = recent.length > 0
        ? `
=== ANTI-DUPLICATION (CRITICAL — read carefully) ===
The learner has already learned ${avoidWords.length} word(s) under this exact (topic + level + lang) combo.
${olderCount > 0 ? `(${olderCount} older words omitted; ${recent.length} most recent shown.)\n` : ''}Recent avoided words:
${recent.map((w, i) => `${i + 1}. "${w}"`).join('\n')}

You MUST avoid ALL of the following overlap types — not just exact string matches:

1. **Same root / stem / family** — if "旅行" is in the list, you cannot use 旅遊, 旅人, 旅館, 旅程; if "run" is listed, you cannot use running, runner, runs.
2. **Synonyms / near-synonyms** — if "美味しい" is listed, you cannot use 旨い, うまい, 美味, おいしそう; if "happy" is listed, you cannot use joyful, glad, cheerful.
3. **Same semantic micro-cluster** — if 4+ items in this topic already cover one sub-domain (e.g. 7 clothing items in a "shopping" topic), generate from a DIFFERENT sub-domain (accessories / payment / sizing / services / brands etc.).

**MANDATORY self-check before output**:
For each candidate word W you draft (5 total), mentally verify:
  (a) Does W share a stem/root with any avoided word?       → if YES, REGENERATE this slot.
  (b) Is W a synonym or near-synonym of any avoided word?   → if YES, REGENERATE this slot.
  (c) Does W belong to a sub-cluster that already has 4+ items in the avoided list? → if YES, pick another sub-cluster.

Only after all 5 candidates pass (a)(b)(c) do you output the JSON. If you cannot find 5 valid candidates, prioritize sub-cluster diversity over exact synonym distance.
`
        : '';

    const prompt = `You are a vocabulary teacher for language learners.

[Step 0: Detect Topic Input Language — DO THIS SILENTLY FIRST]
"${topicLabel || topic}" may be in ANY language (vi/ru/ko/ja/zh-CN/es/fr/
de/pt-BR/en). Internally detect its language (hint: sourceLang is
"${sourceLangName}"), interpret it NATIVELY in that language, and let the
vocabulary you generate reflect that specific cultural register.${isCustom ? `

⚠️ **CUSTOM INPUT MODE (isCustom=true)**: trust the topic text verbatim —
if the learner typed "Đi du lịch Đà Nẵng", generate Da Nang-specific
vocabulary (not generic "travel" words). If they typed "병원 방문", generate
Korean clinic vocabulary (접수/진료/처방전), not generic medical English.` : ''}

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
                generationConfig: { temperature: 1.5, topK: 64, topP: 0.95, responseMimeType: 'application/json' },
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
