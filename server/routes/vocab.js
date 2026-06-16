const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { callGeminiJson } = require('../utils/geminiCall');

const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { stripAnnotations } = require('../utils/stripAnnotations');
const seedCache = require('../utils/seedCache');
const { generateUnit } = require('../utils/generateUnit');
const { getTier, isProTier } = require('../utils/userTier');
const customUnits = require('../utils/customUnits');

const SEED_COL = 'vocabSeed';
const PSEED_COL = 'passageSeed';
const SEED_PAGE = 5;

router.post('/api/vocab-words', requireAuth, rateLimit('vocab-words', { perMinute: 10, perHour: 100 }), async (req, res) => {
    const { topic, topicLabel, category, isCustom, level, targetLang, sourceLang, byokGeminiKey, avoidWords } = req.body;
    if (!topic || !targetLang) {
        return res.status(400).json({ error: 'Missing topic or targetLang' });
    }
    if (typeof topic === 'string' && topic.length > 300) {
        return res.status(413).json({ error: 'Topic too long (max 300 chars)' });
    }

    // 직접입력(custom)은 Pro 전용 — 서버 권위 차단(클라 잠금 우회 방지 + per-user 원가 보호).
    // tier 판정 불가(로컬/읽기실패=null)면 통과(요청 흐름 보존, 보안 자원 아님).
    if (isCustom) {
        const tier = await getTier(req.uid);
        if (tier && !isProTier(tier)) {
            return res.status(403).json({ error: 'Custom input is a Pro feature', code: 'pro_required' });
        }
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    // ── Phase 2: write-through seed (전역 공유·순차) ──────────────────────────
    // offset이 오면(신규 클라) seed 경로. isCustom/구버전 클라(offset 없음)는 기존 개인 생성.
    const hasOffset = req.body.offset !== undefined && req.body.offset !== null;
    const offset = Math.max(0, parseInt(req.body.offset, 10) || 0);
    const useSeed = !isCustom && hasOffset;
    const seedKey = `${topic}--${level}--${sourceLang}--${targetLang}`;
    let seedItems = [];
    if (useSeed) {
        seedItems = await seedCache.readItems(SEED_COL, seedKey, 'words');
        if (seedItems.length >= offset + SEED_PAGE) {
            console.log(`[Seed] vocab HIT ${seedKey} offset=${offset} (Gemini 0)`);
            return res.json({ words: seedItems.slice(offset, offset + SEED_PAGE), source: 'seed' });
        }
    }

    // 2026-06-15: seed MISS(신규 frontier) → "지문 먼저 → 단어 추출" 결합 생성.
    //   단어·지문을 한 번에 만들어 vocabSeed + passageSeed(essay) 정렬 저장 → 단어/지문 정합 + Listening 무생성(HIT).
    //   기존 seed 는 위 HIT 로 그대로 서빙(보존). pseed 가 이미 있으면 appendAndSlice 가 덮어쓰지 않음.
    if (useSeed) {
        const pseedKey = `${topic}--essay--${level}--${sourceLang}--${targetLang}`;
        const existingPassages = await seedCache.readItems(PSEED_COL, pseedKey, 'passages');
        const unitRes = await generateUnit({
            topic, topicLabel, category, level, targetLang, sourceLang, geminiKey,
            avoidWords: seedItems.map(w => w?.word).filter(Boolean),
            avoidTitles: existingPassages.map(p => p?.title).filter(Boolean),
        });
        if (unitRes.error) {
            return res.status(unitRes.status || 502).json({ error: unitRes.userMsg || 'Failed to generate vocabulary' });
        }
        const vmeta = { topicId: topic, level, sourceLang, targetLang };
        // 하드 dedup: 정규화 단어 기준 기존 시퀀스 중복 제외(소프트 anti-dup 누수 차단).
        const wslice = await seedCache.appendAndSlice(SEED_COL, seedKey, 'words', vmeta, unitRes.words, offset, SEED_PAGE,
            { dedupeBy: w => seedCache.normalizeWord(w?.word) });
        // 지문(essay)을 정렬 offset(=단어offset/SEED_PAGE)에 저장. 이미 존재하면 보존(append race-guard).
        if (unitRes.passage && unitRes.passage.passage) {
            const pOffset = Math.floor(offset / SEED_PAGE);
            const pmeta = { topicId: topic, type: 'essay', level, sourceLang, targetLang };
            unitRes.passage.words = unitRes.words; // 지문 자기완결화('이 지문의 핵심어') — listening 경로와 일치
            try {
                await seedCache.appendAndSlice(PSEED_COL, pseedKey, 'passages', pmeta, [unitRes.passage], pOffset, 1);
            } catch (e) { console.warn('[Seed] unit passage store failed:', e.message); }
        }
        console.log(`[Seed] UNIT MISS ${seedKey} offset=${offset} → 지문우선 결합생성 → 단어+지문 저장`);
        return res.json({ words: wslice, source: 'gemini-unit' });
    }

    // ── 직접입력(custom, Pro 전용) — 전역 seed와 분리. generateUnit으로 지문+5단어 결합 생성 후
    //   per-user customUnits에 누적 저장(공유 X). dedup은 클라 avoidWords + 저장 시 정규화.
    if (isCustom) {
        const unitRes = await generateUnit({
            topic, topicLabel, category, level, targetLang, sourceLang, geminiKey,
            avoidWords: Array.isArray(avoidWords) ? avoidWords : [], type: 'essay',
        });
        if (unitRes.error) {
            return res.status(unitRes.status || 502).json({ error: unitRes.userMsg || 'Failed to generate vocabulary' });
        }
        unitRes.passage.words = unitRes.words; // 지문 자기완결(이 지문의 핵심어)
        try {
            await customUnits.appendUnit(req.uid, { topicLabel, level, sourceLang, targetLang }, unitRes);
        } catch (e) { console.warn('[custom] vocab store failed:', e.message); }
        console.log(`[Custom] vocab unit ${req.uid} "${topicLabel}" → 단어+지문 결합 생성·저장`);
        // 2026-06-17: 결합 unit 지문도 함께 반환 → 클라가 들고 Listening 단계에서 같은 unit 지문 표시(단어↔지문 정합).
        //   (custom 은 passageSeed 공유 불가 = customUnits write-only → 클라 cross-tab 전달로 해결)
        return res.json({ words: (unitRes.words || []).slice(0, SEED_PAGE), passage: unitRes.passage, source: 'gemini-unit-custom' });
    }

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
    // seed 경로(frontier 생성)에선 기존 seed 단어 전체를 회피 소스로(전역 일관 시퀀스 유지).
    // 비-seed(custom/구클라)는 기존대로 클라가 보낸 avoidWords.
    const avoidSource = useSeed
        ? seedItems.map(w => w?.word).filter(Boolean)
        : (Array.isArray(avoidWords) ? avoidWords : []);
    const recent = avoidSource.slice(-30);
    const olderCount = Math.max(0, avoidSource.length - recent.length);
    const avoidBlock = recent.length > 0
        ? `
=== ANTI-DUPLICATION (CRITICAL — read carefully) ===
The learner has already learned ${avoidSource.length} word(s) under this exact (topic + level + lang) combo.
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
8. For each word, provide 3-4 substantive learning tips in ${sourceLangName}: (1) Part of speech & core meaning (2) Synonyms/antonyms or common collocations (3) Usage note, register, or cultural context (4) A vivid nuance, a common mistake learners make, or a memory hook. Make EACH tip genuinely informative and specific to this word — NOT generic filler. One full sentence each.
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

    const result = await callGeminiJson(prompt, geminiKey, {
        genConfig: { temperature: 1.5, topK: 64, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => Array.isArray(p?.words) && p.words.length > 0,
        label: 'VocabWords',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || 'Failed to generate vocabulary' });
    }
    const parsed = result.parsed;
    // Gemini가 rule을 무시하고 주입한 furigana/핀인 주석 제거 (보험)
    if (Array.isArray(parsed.words)) {
        parsed.words.forEach(w => {
            w.word = stripAnnotations(w.word, targetLang);
            w.example = stripAnnotations(w.example, targetLang);
        });
    }
    // seed 경로: frontier 생성물을 canonical 시퀀스에 append(경합 안전) 후 해당 페이지 slice 반환
    if (useSeed && Array.isArray(parsed.words) && parsed.words.length > 0) {
        const meta = { topicId: topic, level, sourceLang, targetLang };
        const slice = await seedCache.appendAndSlice(SEED_COL, seedKey, 'words', meta, parsed.words, offset, SEED_PAGE);
        console.log(`[Seed] vocab MISS ${seedKey} offset=${offset} → Gemini 생성·저장`);
        return res.json({ words: slice, source: 'gemini' });
    }
    res.json({ ...parsed, source: 'gemini' });
});

module.exports = router;
