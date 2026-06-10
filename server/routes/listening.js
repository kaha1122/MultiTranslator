const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { callGeminiJson } = require('../utils/geminiCall');
const { stripAnnotations } = require('../utils/stripAnnotations');

const router = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Listening 의 angle 차원 — 같은 토픽 안에서도 서술 각도를 회전해 다양성 확보.
// 응답의 angle 필드는 반드시 이 5종 중 하나여야 함 (서버에서 화이트리스트 검증).
const LISTENING_ANGLES = ['first-person narrative', 'dialogue', 'how-to', 'cultural-explanation', 'opinion'];

router.post('/api/listening-passage', requireAuth, async (req, res) => {
    const {
        topic, topicLabel, category, isCustom, level, type, targetLang, sourceLang,
        byokGeminiKey, avoidTitles, passagesMeta,
    } = req.body;
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

    // Anti-Duplication 블록 — title 단독 회피로는 본문 유사도 못 잡아서 keywords + angle 차원 추가.
    // 클라가 passagesMeta 를 함께 보내면 keywords cluster + angle rotation 까지 강제, 없으면 title-only fallback.
    const recentTitles = Array.isArray(avoidTitles) ? avoidTitles.slice(-20) : [];
    const olderTitleCount = Array.isArray(avoidTitles) ? Math.max(0, avoidTitles.length - recentTitles.length) : 0;
    const recentMeta = Array.isArray(passagesMeta) ? passagesMeta.slice(-20) : [];
    const usedAngles = new Set(recentMeta.slice(-5).map(m => m?.angle).filter(Boolean));
    let avoidBlock = '';
    if (recentMeta.length > 0) {
        const lines = recentMeta.map((m, i) => {
            const title = (m?.title || '').replace(/"/g, "'").slice(0, 80);
            const keys = Array.isArray(m?.keywords) ? m.keywords.slice(0, 3).join(', ') : '';
            const ang = m?.angle || '?';
            return `  ${String(i + 1).padStart(2, ' ')}. "${title}"  keywords=[${keys}]  angle=${ang}`;
        }).join('\n');
        const usedAnglesArr = [...usedAngles];
        avoidBlock = `
=== ANTI-DUPLICATION (CRITICAL) ===
The learner has read ${avoidTitles?.length || recentMeta.length} passage(s) on this topic.
${olderTitleCount > 0 ? `(${olderTitleCount} older entries omitted; ${recentMeta.length} most recent shown.)\n` : ''}Recent passages:
${lines}

Rotation rules — ALL mandatory:
1. New title MUST differ from all ${recentMeta.length} above (not a paraphrase, not a rearrangement).
2. New passage MUST avoid using 2+ keywords from any single previous passage's keyword list above.
3. Pick an **angle** from this list: ${JSON.stringify(LISTENING_ANGLES)}, but NOT in the most-recent-5 angle set ${JSON.stringify(usedAnglesArr)} unless every angle has been used (then pick the least-recent one).
4. The new passage's keywords (3 items, see KEY WORDS RULES) should target a sub-domain of the topic that has minimal overlap with the previous passages' keyword clusters.
`;
    } else if (recentTitles.length > 0) {
        avoidBlock = `\nIMPORTANT — The learner has already read these passages. Generate a completely different passage (different title AND different sub-topic angle):\n${recentTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}\n`;
    }

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

[Step 0: Detect Topic Input Language — DO THIS SILENTLY FIRST]
"${topicLabel || topic}" is free-form text that may be in ANY language
(vi/ru/ko/ja/zh-CN/es/fr/de/pt-BR/en). Internally detect its language
(hint: sourceLang is "${sourceLangName}"), interpret it NATIVELY in that
language, and reflect that culture/context in the passage you write. NOTE:
passageKeywords (rule 14) must still stay English for cross-session dedup
keys — this Step 0 only governs how you UNDERSTAND the input topic.${isCustom ? `

⚠️ **CUSTOM INPUT MODE (isCustom=true)**: the learner typed
"${topicLabel || topic}" freely. Trust the text verbatim — if it names a
specific place ("Đà Nẵng"), local custom, or situation, build the passage
around THAT exact subject, not a generic version. Do not substitute a
generic topic just because the text isn't a pre-defined category.` : ''}

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

=== PASSAGE META (NEW — required for cross-session deduplication) ===
14. Output a "passageKeywords" field: exactly 3 SHORT English noun phrases (1-3 words each) that capture the
    most distinctive sub-domain concepts of THIS specific passage. These are DIFFERENT from the user-facing
    "words" list — they are a stable English fingerprint used to detect topic-cluster overlap across sessions.
    Examples for an "airport" topic:
       passage A → ["boarding pass", "security check", "duty-free"]
       passage B → ["lost luggage", "claim form", "compensation"]
       passage C → ["flight delay", "rebooking", "voucher"]
    Each passage's 3 keywords should be specific enough that two passages on the same topic produce LISTS
    that overlap in at most 1 entry. Pick the most distinctive 3 — not generic ones like "airport" / "travel".
15. Output an "angle" field: EXACTLY one of ${JSON.stringify(LISTENING_ANGLES)}. This must match the actual
    rhetorical mode of the passage you wrote. (If contentType is 'dialogue', angle is almost always 'dialogue';
    for 'essay' contentType you may pick from the other 4 angles, choosing one that hasn't been used recently
    per the rotation rules above.)

Return ONLY valid JSON (no markdown):
{
  "title": "<short title in ${targetLangName}>",
  "titleTranslation": "<title in ${sourceLangName}>",
  "passage": "<full passage text in ${targetLangName}>",
  "passagePronunciation": "<full pronunciation of passage — or empty string>",
  "passageTranslation": "<full passage translated in ${sourceLangName}>",
  "passageKeywords": ["<key1 in English, 1-3 words>", "<key2>", "<key3>"],
  "angle": "<exactly one of ${JSON.stringify(LISTENING_ANGLES)}>",
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

    const result = await callGeminiJson(prompt, geminiKey, {
        genConfig: { temperature: 1.3, topK: 64, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => typeof p?.passage === 'string' && p.passage.length > 0,
        label: 'ListeningPassage',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || 'Failed to generate listening passage' });
    }
    const parsed = result.parsed;
    // Gemini가 rule을 무시하고 주입한 furigana/핀인 주석 제거 (보험)
    parsed.passage = stripAnnotations(parsed.passage, targetLang);
    if (Array.isArray(parsed.words)) {
        parsed.words.forEach(w => {
            w.word = stripAnnotations(w.word, targetLang);
            w.example = stripAnnotations(w.example, targetLang);
        });
    }
    // angle 화이트리스트 검증 + keywords 정규화 (LLM 가 임의 값 줄 가능성 차단)
    if (!LISTENING_ANGLES.includes(parsed.angle)) {
        parsed.angle = (contentType === 'dialogue') ? 'dialogue' : 'first-person narrative';
    }
    if (!Array.isArray(parsed.passageKeywords)) {
        parsed.passageKeywords = [];
    } else {
        parsed.passageKeywords = parsed.passageKeywords
            .filter(k => typeof k === 'string' && k.trim().length > 0)
            .map(k => k.trim().slice(0, 40))
            .slice(0, 3);
    }
    res.json(parsed);
});

// [2026-06-09] Listening 문장 카드용 — 기존 문장 1개를 annotate(번역·발음기호·학습팁).
//   ListeningTab 문장 클릭 시 온디맨드 호출(클라 세션 캐시 + 1점 차감). ScenePracticeCard generated 스키마 호환.
router.post('/api/listening/annotate-sentence', requireAuth, async (req, res) => {
    const { sentence, langCode, sourceLang, byokGeminiKey } = req.body;
    if (!sentence || !langCode) {
        return res.status(400).json({ error: 'Missing sentence or langCode' });
    }
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES[langCode] || langCode;
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';

    const prompt = `You are a language learning assistant. Annotate the following ${targetLangName} sentence for a learner whose native language is ${sourceLangName}.

Sentence: "${sentence}"

### [CRITICAL LANGUAGE RULE]
"translation" and "learning_tip" MUST be written ENTIRELY in ${sourceLangName} (the learner's native language).
NEVER write them in ${targetLangName} or in English (unless ${sourceLangName} itself is English).

### [Return ONLY valid JSON (no markdown)]
{
  "translation": "Natural translation of the sentence, written in ${sourceLangName}.",
  "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: full hiragana reading. For ru: the sentence rewritten with accent marks (´) on the stressed vowel of each multi-syllable word. For all others (incl. Latin-script languages): empty string ''.",
  "learning_tip": "One concise vocabulary, grammar, or pronunciation tip drawn from THIS sentence, written in ${sourceLangName}."
}

Rules: Do NOT insert parenthetical readings/furigana/pinyin INTO the sentence itself — readings go ONLY in the pronunciation field. Keep the tip short and practical.`;

    const result = await callGeminiJson(prompt, geminiKey, {
        genConfig: { temperature: 0.7, topK: 40, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => typeof p?.translation === 'string',
        label: 'ListeningAnnotate',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || 'Failed to annotate sentence' });
    }
    const p = result.parsed;
    res.json({
        translation: p.translation || '',
        pronunciation: p.pronunciation || '',
        learning_tip: p.learning_tip || '',
    });
});

module.exports = router;
