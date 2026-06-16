const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { callGeminiJson } = require('../utils/geminiCall');
const { stripAnnotations } = require('../utils/stripAnnotations');
const seedCache = require('../utils/seedCache');
const { getTier, isProTier } = require('../utils/userTier');
const customUnits = require('../utils/customUnits');

const router = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PSEED_COL = 'passageSeed';
const VSEED_COL = 'vocabSeed';

// Listening 의 angle 차원 — 같은 토픽 안에서도 서술 각도를 회전해 다양성 확보.
// 응답의 angle 필드는 반드시 이 5종 중 하나여야 함 (서버에서 화이트리스트 검증).
const LISTENING_ANGLES = ['first-person narrative', 'dialogue', 'how-to', 'cultural-explanation', 'opinion'];

router.post('/api/listening-passage', requireAuth, rateLimit('listening-passage', { perMinute: 10, perHour: 100 }), async (req, res) => {
    const {
        topic, topicLabel, category, isCustom, level, type, targetLang, sourceLang,
        byokGeminiKey, avoidTitles, passagesMeta, wordsToInclude,
    } = req.body;
    if (!topic || !targetLang) {
        return res.status(400).json({ error: 'Missing topic or targetLang' });
    }
    if (typeof topic === 'string' && topic.length > 300) {
        return res.status(413).json({ error: 'Topic too long (max 300 chars)' });
    }

    // 직접입력(custom)은 Pro 전용 — 서버 권위 차단(클라 잠금 우회 방지 + per-user 원가 보호).
    if (isCustom) {
        const tier = await getTier(req.uid);
        if (tier && !isProTier(tier)) {
            return res.status(403).json({ error: 'Custom input is a Pro feature', code: 'pro_required' });
        }
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
    const guide = LANG_SPECIFIC_GUIDE[targetLang] || LANG_SPECIFIC_GUIDE['en'];
    const unit = guide.unit || 'words';
    const contentType = type === 'dialogue' ? 'dialogue' : 'essay';

    // ── Phase 2: passageSeed (전역 공유·순차, 1개 단위) ──
    const hasOffset = req.body.offset !== undefined && req.body.offset !== null;
    const offset = Math.max(0, parseInt(req.body.offset, 10) || 0);
    const useSeed = !isCustom && hasOffset;
    const pseedKey = `${topic}--${contentType}--${level}--${sourceLang}--${targetLang}`;
    if (useSeed) {
        const passages = await seedCache.readItems(PSEED_COL, pseedKey, 'passages');
        if (passages.length >= offset + 1) {
            console.log(`[Seed] passage HIT ${pseedKey} offset=${offset} (Gemini 0)`);
            return res.json({ ...passages[offset], source: 'seed' });
        }
    }

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

    // [Phase 1 단계학습] 단어 단계에서 학습한 단어를 지문에 재등장시켜 문맥 학습 강화.
    // 빈 값이면 기존 동작과 동일(하위호환). 과도한 강제는 fluency 해치므로 "자연스럽게 최대한".
    // seed 경로: 학습단어는 vocabSeed(전역 공유)에서 도출 → 지문 결정적·공유 유지.
    // 비-seed(custom/구클라): 클라가 보낸 wordsToInclude(per-user).
    let includeWordsSource = Array.isArray(wordsToInclude) ? wordsToInclude : [];
    if (useSeed) {
        const vseedKey = `${topic}--${level}--${sourceLang}--${targetLang}`;
        const vwords = await seedCache.readItems(VSEED_COL, vseedKey, 'words');
        includeWordsSource = vwords.map(w => w?.word).filter(Boolean);
    }
    const includeWords = includeWordsSource
        .filter(w => typeof w === 'string' && w.trim())
        .map(w => w.trim().slice(0, 40)).slice(0, 12);
    const wordsBlock = includeWords.length > 0 ? `
=== STUDIED WORDS TO REUSE (IMPORTANT) ===
The learner just studied these ${targetLangName} words/phrases. Weave AS MANY as read naturally into the passage so they re-encounter them in context (aim for at least ${Math.min(includeWords.length, 5)}). Do NOT force every one if it harms fluency:
${includeWords.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}
When picking the 5 KEY WORDS (rule 6), prefer some of these studied words if they fit the level.
` : '';

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
${avoidBlock}${wordsBlock}
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

=== PASSAGE META (required for cross-session deduplication) ===
6. Output a "passageKeywords" field: exactly 3 SHORT English noun phrases (1-3 words each) that capture the
    most distinctive sub-domain concepts of THIS specific passage — a stable English fingerprint used to
    detect topic-cluster overlap across sessions.
    Examples for an "airport" topic:
       passage A → ["boarding pass", "security check", "duty-free"]
       passage B → ["lost luggage", "claim form", "compensation"]
       passage C → ["flight delay", "rebooking", "voucher"]
    Each passage's 3 keywords should be specific enough that two passages on the same topic produce LISTS
    that overlap in at most 1 entry. Pick the most distinctive 3 — not generic ones like "airport" / "travel".
7. Output an "angle" field: EXACTLY one of ${JSON.stringify(LISTENING_ANGLES)}. This must match the actual
    rhetorical mode of the passage you wrote. (If contentType is 'dialogue', angle is almost always 'dialogue';
    for 'essay' contentType you may pick from the other 4 angles, choosing one that hasn't been used recently
    per the rotation rules above.)

=== SENTENCE CARDS (per-sentence study cards) ===
8. Split the passage into its individual sentences (for dialogue: each turn line; strip "A:/B:" labels).
   For EACH sentence output an item in "sentences" with: the pure sentence text (${targetLangName}, no
   pronunciation annotations), its translation in ${sourceLangName}, its pronunciation
   (zh-CN pinyin / ja hiragana / ru accent marks / others empty), and a learning_tip in ${sourceLangName}
   (1-2 informative sentences: highlight a key word or grammar pattern in the sentence AND add a usage nuance or common mistake — specific, not generic).
   The "text" values concatenated must reconstruct the passage in order.

=== KEY VOCABULARY (extracted from the passage — for combined word+passage unit) ===
9. Also EXTRACT exactly 5 KEY vocabulary items that **VERBATIM APPEAR in the passage** (each "word" must be a substring actually present in the passage text), most worth studying at this level. Variety of form appropriate to level (not 5 plain nouns unless Beginner).
   - "word" = PURE word/phrase in ${targetLangName} — NO pronunciation/pinyin/hiragana/romanization/parenthetical readings.
   - "example" = the actual passage sentence that contains the word.
   - meaning, exampleTranslation, learningTip all in ${sourceLangName}. learningTip = array of 2-4 short substantive one-sentence tips (part of speech & meaning / collocations / usage note / a nuance or common mistake).
   - pronunciation/examplePronunciation: pinyin(zh-CN) / hiragana(ja) / accent(ru) / empty otherwise.

Return ONLY valid JSON (no markdown):
{
  "title": "<short title in ${targetLangName}>",
  "titleTranslation": "<title in ${sourceLangName}>",
  "passage": "<full passage text in ${targetLangName}>",
  "passagePronunciation": "<full pronunciation of passage — or empty string>",
  "passageTranslation": "<full passage translated in ${sourceLangName}>",
  "passageKeywords": ["<key1 in English, 1-3 words>", "<key2>", "<key3>"],
  "angle": "<exactly one of ${JSON.stringify(LISTENING_ANGLES)}>",
  "sentences": [
    { "text": "<pure sentence in ${targetLangName}>", "translation": "<in ${sourceLangName}>",
      "pronunciation": "<pinyin/hiragana/accent or empty>", "learning_tip": "<one tip in ${sourceLangName}>" }
  ],
  "words": [
    { "word": "<PURE word/phrase in ${targetLangName}, verbatim from passage>", "pronunciation": "<or empty>",
      "meaning": "<${sourceLangName}>", "example": "<the passage sentence containing the word>",
      "examplePronunciation": "<or empty>", "exampleTranslation": "<${sourceLangName}>", "learningTip": ["<tip1>", "<tip2>"] }
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
    // 문장 카드 정규화 (주석 제거 보험)
    if (Array.isArray(parsed.sentences)) {
        parsed.sentences = parsed.sentences
            .filter(s => s && typeof s.text === 'string' && s.text.trim())
            .map(s => ({
                text: stripAnnotations(s.text, targetLang),
                translation: s.translation || '',
                pronunciation: s.pronunciation || '',
                learning_tip: s.learning_tip || '',
            }));
    } else {
        parsed.sentences = [];
    }

    // [2026-06-16] 결합 unit — 지문에서 추출한 5단어 정규화 + verbatim example 정합(지문 문장으로 교체).
    const sentenceTexts = (parsed.sentences || []).map(s => s.text).filter(Boolean);
    const unitWords = (Array.isArray(parsed.words) ? parsed.words : []).map(w => ({
        word: stripAnnotations(w.word, targetLang),
        pronunciation: w.pronunciation || '',
        meaning: w.meaning || '',
        example: stripAnnotations(w.example || '', targetLang),
        examplePronunciation: w.examplePronunciation || '',
        exampleTranslation: w.exampleTranslation || '',
        learningTip: Array.isArray(w.learningTip) ? w.learningTip : (w.learningTip ? [w.learningTip] : []),
    })).filter(w => w.word);
    for (const w of unitWords) {
        const wn = seedCache.normalizeWord(w.word);
        if (!wn) continue;
        const hit = sentenceTexts.find(s => seedCache.normalizeWord(s).includes(wn));
        if (hit) w.example = hit;
    }
    parsed.words = unitWords; // 지문에 임베드(클라가 '이 지문의 핵심어' 표시 가능) + 응답 포함

    // seed 경로: canonical passage를 passageSeed에 append(경합 안전) + 추출 단어를 공유 vocabSeed 풀에 dedup append
    if (useSeed && typeof parsed.passage === 'string' && parsed.passage.length > 0) {
        const meta = { topicId: topic, type: contentType, level, sourceLang, targetLang };
        const slice = await seedCache.appendAndSlice(PSEED_COL, pseedKey, 'passages', meta, [parsed], offset, 1);
        if (unitWords.length) {
            // 결합 unit: 지문↔단어 결합 + 전역 단어 풀 누적(essay·dialogue 공통, 정규화 dedup으로 중복 0)
            const vseedKey = `${topic}--${level}--${sourceLang}--${targetLang}`;
            const vmeta = { topicId: topic, level, sourceLang, targetLang };
            try {
                await seedCache.appendItems(VSEED_COL, vseedKey, 'words', vmeta, unitWords,
                    { dedupeBy: w => seedCache.normalizeWord(w?.word) });
            } catch (e) { console.warn('[Seed] unit words store failed:', e.message); }
        }
        console.log(`[Seed] passage MISS ${pseedKey} offset=${offset} → 지문+단어 결합 저장`);
        return res.json({ ...(slice[0] || parsed), source: 'gemini' });
    }
    // custom(!useSeed, Pro 전용): 전역 seed와 분리해 per-user customUnits에 누적 저장(공유 X).
    if (isCustom && typeof parsed.passage === 'string' && parsed.passage.length > 0) {
        try {
            await customUnits.appendUnit(req.uid, { topicLabel: topicLabel || topic, level, sourceLang, targetLang }, { words: unitWords, passage: parsed });
        } catch (e) { console.warn('[custom] listening store failed:', e.message); }
        console.log(`[Custom] listening unit ${req.uid} "${topicLabel || topic}" (${contentType}) → 저장`);
    }
    res.json({ ...parsed, source: 'gemini' });
});

// [2026-06-09] Listening 문장 카드용 — 기존 문장 1개를 annotate(번역·발음기호·학습팁).
//   ListeningTab 문장 클릭 시 온디맨드 호출(클라 세션 캐시 + 1점 차감). ScenePracticeCard generated 스키마 호환.
router.post('/api/listening/annotate-sentence', requireAuth, rateLimit('annotate-sentence', { perMinute: 20, perHour: 200 }), async (req, res) => {
    const { sentence, langCode, sourceLang, byokGeminiKey } = req.body;
    if (!sentence || !langCode) {
        return res.status(400).json({ error: 'Missing sentence or langCode' });
    }
    if (typeof sentence === 'string' && sentence.length > 600) {
        return res.status(413).json({ error: 'Sentence too long (max 600 chars)' });
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
