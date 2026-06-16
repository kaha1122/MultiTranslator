// generateUnit — "지문 먼저 → 핵심 단어 추출" 결합 생성 (2026-06-15).
//   기존: 단어 단독 생성 → 지문이 단어를 끼워넣음(forced 위험). 변경: 한 호출로 자연스러운 지문을
//   먼저 작성하고 그 지문에서 핵심 단어 5개를 추출 → 단어·지문이 100% 정합 + 단어 Generate 1회로 둘 다 확보.
//   반환: { words:[5], passage:{...essay 스키마...} } 또는 { error, status, userMsg }.
const { LANG_NAMES, LANG_SPECIFIC_GUIDE } = require('../config/langGuide');
const { callGeminiJson } = require('../utils/geminiCall');
const { stripAnnotations } = require('../utils/stripAnnotations');
const { normalizeWord } = require('./seedCache');

const ANGLES = ['first-person narrative', 'dialogue', 'how-to', 'cultural-explanation', 'opinion'];

// type: 'essay'(기본) | 'dialogue' — 지문 형식. 둘 다 "지문 먼저 → 단어 추출" 결합생성 동일 적용.
async function generateUnit({ topic, topicLabel, category, level, targetLang, sourceLang, geminiKey, avoidWords = [], avoidTitles = [], type = 'essay' }) {
    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
    const guide = LANG_SPECIFIC_GUIDE[targetLang] || LANG_SPECIFIC_GUIDE['en'];
    const unit = guide.unit || 'words';
    const contentType = type === 'dialogue' ? 'dialogue' : 'essay';
    const passageDirective = contentType === 'dialogue'
        ? `write a natural DIALOGUE between 2 people (Speaker A and Speaker B) about the topic — format each line "A: ..." / "B: ...", 6-10 turns, with greetings, reactions, and natural turn-taking`
        : `write a natural, coherent essay/article about the topic — as if written by a native speaker for a blog or textbook`;

    const levelDesc = {
        basic: `Beginner (A1/A2)
  - Passage: 5-6 sentences, 30-50 ${unit}. Simple structure, top 800 high-frequency words.
  - ${guide.basic}
  - Key words: single words or 2-word phrases, concrete and high-frequency.`,
        intermediate: `Intermediate (B1–B2)
  - Passage: 7-8 sentences, 50-80 ${unit}. 1-2 clauses per sentence with connectors.
  - ${guide.inter}
  - Key words: common collocations and practical expressions; avoid rare idioms.`,
        advanced: `Advanced (C1/C2)
  - Passage: 9-10 sentences, 80-120 ${unit}. Complex multi-clause sentences.
  - ${guide.adv}
  - Key words: nuanced expressions, idioms, domain terms, culturally rich vocabulary.`,
    }[level] || 'intermediate level';

    const recentWords = (Array.isArray(avoidWords) ? avoidWords : []).filter(Boolean).slice(-30);
    const recentTitles = (Array.isArray(avoidTitles) ? avoidTitles : []).filter(Boolean).slice(-15);
    const avoidBlock = (recentWords.length || recentTitles.length) ? `
=== ANTI-DUPLICATION (CRITICAL — read carefully) ===
${recentTitles.length ? `Previously generated passages on this topic — make THIS passage clearly different (different sub-angle, title, key concepts):
${recentTitles.map((t, i) => `  ${i + 1}. "${String(t).replace(/"/g, "'").slice(0, 80)}"`).join('\n')}
` : ''}${recentWords.length ? `The learner already studied these ${recentWords.length} word(s) under this exact (topic+level+lang). Your 5 KEY words MUST avoid ALL overlap types below — not just exact matches:
${recentWords.map((w, i) => `  ${i + 1}. "${w}"`).join('\n')}

You MUST avoid:
1. **Same root/stem/family** — if "run" is listed, no running/runner/runs; if "旅行", no 旅遊/旅館.
2. **Synonyms/near-synonyms** — if "happy" is listed, no joyful/glad/cheerful.
3. **Same semantic micro-cluster** — if 4+ avoided items cover one sub-domain, draw THIS unit's key words from a DIFFERENT sub-domain.
MANDATORY self-check: for each of the 5 key words W, verify (a) no shared stem with any avoided word (b) not a synonym of any avoided word (c) not in an over-covered sub-cluster — if any fails, pick another word from the passage (write the passage so it naturally contains fresh, non-overlapping vocabulary).
` : ''}` : '';

    const prompt = `You are a language teacher creating ONE integrated lesson — a reading passage PLUS the key vocabulary drawn from it — for a learner.

[Step 0: Detect Topic Input Language — DO THIS SILENTLY FIRST]
"${topicLabel || topic}" may be in ANY language (vi/ru/ko/ja/zh-CN/es/fr/de/pt-BR/en). Internally detect its language (hint: sourceLang is "${sourceLangName}"), interpret it NATIVELY, and reflect that culture/context in what you write.

Context:
- Topic: ${topicLabel || topic} (Category: ${category || ''})
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- CRITICAL: ALL translations, meanings, and tips MUST be in ${sourceLangName}. NEVER use ${targetLangName} for translations.
- Level: ${levelDesc}
${avoidBlock}
=== GENERATION ORDER (MANDATORY — this guarantees coherence) ===
STEP A. FIRST ${passageDirective} at the level. Do NOT think about vocabulary lists yet; just write the best passage.
STEP B. THEN read your own passage and EXTRACT exactly 5 KEY vocabulary items that **VERBATIM APPEAR in the passage** (each "word" must be a substring actually present in the passage text) and are most worth studying at this level. Because the words come FROM the passage, they are perfectly coherent with it. Do NOT invent words that are not in the passage.

=== PASSAGE RULES ===
1. 5-10 sentences forming a coherent passage. Variety of sentence types.
2. Strictly follow the level grammar/vocabulary constraints above.
3. Give a short descriptive title in ${targetLangName}.
4. pronunciation: zh-CN → full pinyin w/ tone marks; ja → full hiragana; ru → full passage rewritten with acute accent (´) on stressed vowels (accuracy mandatory: "привéт" ✓, "извини́те" ✓, "молокó" ✓; combining U+0301 on the vowel; ё/single-syllable need none); others → empty string.
5. "passageKeywords": exactly 3 SHORT English noun phrases (1-3 words) — a stable English fingerprint of this passage's distinctive sub-domain (e.g. ["boarding pass","security check","duty-free"]). Not generic.
6. "angle": EXACTLY one of ${JSON.stringify(ANGLES)} matching the passage's rhetorical mode.
7. "sentences": split the passage into individual sentences. For EACH: pure sentence text (${targetLangName}, no annotations), translation (${sourceLangName}), pronunciation (pinyin/hiragana/accent or empty), learning_tip (${sourceLangName}, 1-2 informative sentences: a key word/grammar pattern in the sentence PLUS a usage nuance or common mistake — specific, not generic). The "text" values concatenated must reconstruct the passage in order.

=== KEY VOCABULARY RULES (extracted from the passage) ===
8. Exactly 5 items. Each MUST be a word/phrase that appears in (or is essential to) the passage you wrote.
9. Variety of form appropriate to level (not 5 plain nouns unless Beginner).
10. "word" = PURE word/phrase in ${targetLangName} — NO pronunciation/pinyin/hiragana/romanization/parenthetical readings. (Good: "音楽","咖啡". Bad: "おんがく (音楽)","咖啡 (kāfēi)".)
11. "example" should PREFER the actual sentence from the passage that contains the word (so example = real context); if none fits, write a natural one. PURE ${targetLangName}, no annotations.
12. pronunciation/examplePronunciation: pinyin (zh-CN) / hiragana (ja) / accent marks (ru) / empty otherwise.
13. meaning, exampleTranslation, learningTip all in ${sourceLangName}. learningTip = 3-4 substantive one-sentence tips: (1) part of speech & core meaning (2) synonyms/antonyms or collocations (3) usage/register/cultural note (4) a vivid nuance, common mistake, or memory hook. Each tip genuinely informative & specific — NOT generic filler.

Return ONLY valid JSON (no markdown):
{
  "title": "<short title in ${targetLangName}>",
  "titleTranslation": "<title in ${sourceLangName}>",
  "passage": "<full passage in ${targetLangName}>",
  "passagePronunciation": "<full pronunciation or empty>",
  "passageTranslation": "<full passage in ${sourceLangName}>",
  "passageKeywords": ["<en1>", "<en2>", "<en3>"],
  "angle": "<one of ${JSON.stringify(ANGLES)}>",
  "sentences": [
    { "text": "<sentence>", "translation": "<${sourceLangName}>", "pronunciation": "<or empty>", "learning_tip": "<${sourceLangName}>" }
  ],
  "words": [
    { "word": "<pure word/phrase>", "pronunciation": "<or empty>", "meaning": "<${sourceLangName}>",
      "example": "<sentence from passage or natural>", "examplePronunciation": "<or empty>",
      "exampleTranslation": "<${sourceLangName}>", "learningTip": ["<tip1>", "<tip2>"] }
  ]
}`;

    const result = await callGeminiJson(prompt, geminiKey, {
        genConfig: { temperature: 1.3, topK: 64, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => typeof p?.passage === 'string' && p.passage.length > 0 && Array.isArray(p?.words) && p.words.length > 0,
        label: 'GenerateUnit',
    });
    if (result.error) {
        return { error: true, status: result.status, userMsg: result.userMsg };
    }
    const p = result.parsed;

    // 정규화 — 주석 제거 보험 + angle/keywords 화이트리스트
    p.passage = stripAnnotations(p.passage, targetLang);
    if (!ANGLES.includes(p.angle)) p.angle = (contentType === 'dialogue') ? 'dialogue' : 'first-person narrative';
    p.passageKeywords = Array.isArray(p.passageKeywords)
        ? p.passageKeywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim().slice(0, 40)).slice(0, 3)
        : [];
    p.sentences = Array.isArray(p.sentences)
        ? p.sentences.filter(s => s && typeof s.text === 'string' && s.text.trim()).map(s => ({
            text: stripAnnotations(s.text, targetLang),
            translation: s.translation || '',
            pronunciation: s.pronunciation || '',
            learning_tip: s.learning_tip || '',
        }))
        : [];
    const words = (Array.isArray(p.words) ? p.words : []).map(w => ({
        word: stripAnnotations(w.word, targetLang),
        pronunciation: w.pronunciation || '',
        meaning: w.meaning || '',
        example: stripAnnotations(w.example || '', targetLang),
        examplePronunciation: w.examplePronunciation || '',
        exampleTranslation: w.exampleTranslation || '',
        learningTip: Array.isArray(w.learningTip) ? w.learningTip : (w.learningTip ? [w.learningTip] : []),
    })).filter(w => w.word);

    // verbatim 검증 — 추출 단어가 지문에 실제 등장하는지 확인.
    //   등장하면 example을 그 단어를 포함한 지문 문장으로 교체(단어↔지문 문맥 정합 강화).
    //   미등장 단어는 카운트만(결합생성 취지상 드묾) — 로그로 가시화해 품질 모니터링.
    const sentenceTexts = p.sentences.map(s => s.text).filter(Boolean);
    const passageNorm = normalizeWord(p.passage);
    let nonVerbatim = 0;
    for (const w of words) {
        const wn = normalizeWord(w.word);
        if (!wn) continue;
        const hit = sentenceTexts.find(s => normalizeWord(s).includes(wn));
        if (hit) w.example = hit;                       // 지문 문장으로 example 교체(정합)
        else if (!passageNorm.includes(wn)) nonVerbatim++; // 지문 어디에도 없음(환각 가능)
    }
    if (nonVerbatim) console.log(`[generateUnit] ${nonVerbatim}/${words.length} key word(s) NOT verbatim in passage (${targetLang}/${topic}/${contentType})`);

    const passage = {
        title: p.title || '',
        titleTranslation: p.titleTranslation || '',
        passage: p.passage,
        passagePronunciation: p.passagePronunciation || '',
        passageTranslation: p.passageTranslation || '',
        passageKeywords: p.passageKeywords,
        angle: p.angle,
        type: contentType,        // unit 지문 형식(essay|dialogue) 자기기술 — passageSeed 저장 시 보존
        sentences: p.sentences,
    };

    return { words, passage };
}

module.exports = { generateUnit };
