const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');
const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { geminiUrl } = require('../config/gemini');
const { stripAnnotations } = require('../utils/stripAnnotations');

const router = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

router.post('/api/listening-passage', requireAuth, async (req, res) => {
    const { topic, topicLabel, category, level, type, targetLang, sourceLang, byokGeminiKey, avoidTitles } = req.body;
    if (!topic || !targetLang) {
        return res.status(400).json({ error: 'Missing topic or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
    const guide = LANG_SPECIFIC_GUIDE[targetLang] || LANG_SPECIFIC_GUIDE['en'];
    const unit = guide.unit || 'words';
    const contentType = type === 'dialogue' ? 'dialogue' : 'essay';

    const levelDesc = {
        basic: `Beginner (A1/A2)
  - Passage: 5-6 sentences, 30-50 ${unit}. Simple structure.
  - ${guide.basic}
  - Use only top 800 high-frequency words.`,
        intermediate: `Intermediate (B1–B2)
  - Passage: 7-8 sentences, 50-80 ${unit}. 1-2 clauses per sentence with connectors.
  - ${guide.inter}
  - Include common collocations and practical expressions natural to ${targetLangName}. Avoid rare idioms.`,
        advanced: `Advanced (C1/C2)
  - Passage: 9-10 sentences, 80-120 ${unit}. Complex multi-clause sentences.
  - ${guide.adv}
  - Include nuanced expressions, proverbs, and culturally rich vocabulary.`,
    }[level] || 'intermediate level';

    const avoidBlock = (avoidTitles && avoidTitles.length > 0)
        ? `\nIMPORTANT — The learner has already read these passages. Generate a completely different passage:\n${avoidTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}\n`
        : '';

    const passageInstruction = contentType === 'dialogue'
        ? `Write a natural dialogue between 2 people (Speaker A and Speaker B) about this topic.
  - 6-10 turns total (each turn = one speaker's line).
  - Format each line as "A: ..." or "B: ..."
  - Include greetings, reactions, filler words, and natural turn-taking appropriate for ${targetLangName}.
  - Include a variety of speech acts: questions, answers, opinions, agreements, suggestions.`
        : `Write a short essay/article about this topic for language learners.
  - 5-10 sentences forming a coherent, engaging passage.
  - Include a mix of declarative, interrogative, and descriptive sentences for variety.
  - The passage should read naturally — as if written by a native speaker for a blog or textbook.`;

    const prompt = `You are a listening comprehension teacher creating ${contentType} materials for language learners.

Context:
- Topic: ${topicLabel || topic} (Category: ${category || ''})
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- CRITICAL: ALL translations, meanings, and tips MUST be written in ${sourceLangName}. NEVER use ${targetLangName} for translations.
- Content type: ${contentType === 'dialogue' ? 'Dialogue (2-person conversation)' : 'Essay (monologue/narrative)'}
- Level: ${levelDesc}
${avoidBlock}
=== PASSAGE RULES ===
1. ${passageInstruction}
2. Level compliance — strictly follow the grammar and vocabulary constraints defined above.
3. Each sentence should introduce or reinforce useful vocabulary and grammar patterns.
4. Give the passage a short, descriptive title in ${targetLangName}.

=== PRONUNCIATION RULES ===
5. For zh-CN: provide full pinyin with tone marks in passagePronunciation.
   For ja: provide full hiragana reading in passagePronunciation.
   For ru: rewrite the full passage with accent marks (´) on stressed vowels in passagePronunciation.
   - Russian stress accuracy is MANDATORY. Common errors to AVOID: "прívет" ✗ → "привéт" ✓, "извинúте" ✗ → "извини́те" ✓, "мóлоко" ✗ → "молокó" ✓.
   - Use combining acute U+0301 directly on the vowel. Words with ё need no accent. Single-syllable words need no accent.
   For other languages: leave passagePronunciation as empty string.

=== KEY WORDS RULES ===
6. From the passage, select exactly 5 KEY WORDS/PHRASES that are most valuable for the learner at this level.
7. Choose words that: (a) appear in the passage, (b) match the level, (c) are high-utility for the topic.
8. For each keyword, provide a realistic example sentence DIFFERENT from the passage — showing the word in another context.
9. All meanings, tips, and translations must be in ${sourceLangName}.
10. Learning tips: 2 concise tips per word in ${sourceLangName}.
11. **CRITICAL — "word" field must contain ONLY the pure word/phrase in ${targetLangName}. NEVER include pronunciation, pinyin, hiragana, romanization, or any annotation.** Bad: "咖啡 (kāfēi)", "食べる（たべる）". Good: "咖啡", "食べる".
12. **"example" field must also contain ONLY the pure sentence in ${targetLangName} — no pronunciation annotations.**
13. For zh-CN: include pinyin in pronunciation/examplePronunciation. For ja: include hiragana. For ru: include stressed form with ´ marks. For others: empty string.

Return ONLY valid JSON (no markdown):
{
  "title": "<short title in ${targetLangName}>",
  "titleTranslation": "<title in ${sourceLangName}>",
  "passage": "<full passage text in ${targetLangName}>",
  "passagePronunciation": "<full pronunciation of passage — or empty string>",
  "passageTranslation": "<full passage translated in ${sourceLangName}>",
  "words": [
    {
      "word": "<pure word/phrase>",
      "pronunciation": "<pronunciation or empty>",
      "meaning": "<meaning in ${sourceLangName}>",
      "example": "<example sentence different from passage>",
      "examplePronunciation": "<pronunciation or empty>",
      "exampleTranslation": "<translation in ${sourceLangName}>",
      "learningTip": ["<tip1>", "<tip2>"]
    }
  ]
}`;

    try {
        const response = await axios.post(
            geminiUrl(geminiKey),
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.3, topK: 64, topP: 0.95 },
            }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        // Gemini가 rule을 무시하고 주입한 furigana/핀인 주석 제거 (보험)
        parsed.passage = stripAnnotations(parsed.passage, targetLang);
        if (Array.isArray(parsed.words)) {
            parsed.words.forEach(w => {
                w.word = stripAnnotations(w.word, targetLang);
                w.example = stripAnnotations(w.example, targetLang);
            });
        }
        res.json(parsed);
    } catch (e) {
        console.error('[ListeningPassage] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate listening passage' });
    }
});

module.exports = router;
