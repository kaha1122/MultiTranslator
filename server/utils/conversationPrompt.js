/**
 * Free Talking 시작 prompt 빌더 — scene-sentence + scene-answer 의 Phase 블록을
 * 단일 호출로 묶어 3-메시지(narration / firstUserTurn / firstAiReply)를 1회 생성.
 *
 * 재활용 포인트:
 *   ① LANG_NAMES, getDifficultyDesc            ← server/config/langGuide.js
 *   ② STYLE_DESC                                ← server/routes/scene.js (export 추가됨)
 *   ③ Phase 1A 블록 (User initiation)           ← scene-sentence prompt 49~71행
 *   ④ Phase 1B 블록 (AI response)               ← scene-answer prompt 165~181행
 *   ⑤ Strict Rules (No reading aids 등)         ← 양쪽 공통
 *   ⑥ JSON 스키마 필드 (selected_emotion 등)    ← 7개 필드 × 2 turn + intro
 *
 * 새로 추가:
 *   - intro 필드 (narration in sourceLang)
 *   - firstUserTurn ↔ firstAiReply 감정 호응 강제
 *   - User 발화 → AI 응답 논리 일관성 강제
 */

const { LANG_NAMES, getDifficultyDesc } = require('../config/langGuide');
const { STYLE_DESC } = require('../routes/scene');

/**
 * Language Compliance 블록 — 모든 sourceLang 출력 필드가 정확히 sourceLangName 으로
 * 출력되도록 강제. 영어 prompt 본문 압력에 LLM 이 영어 fallback 하던 문제 차단.
 *
 * @param {string} sourceLangName  — LANG_NAMES 매핑된 학습자 모국어 이름 (예: 'Korean')
 * @param {string[]} fields        — sourceLang 출력 필드 목록 (예: ['translation', 'why_useful'])
 * @returns {string} prompt 블록
 */
function languageComplianceBlock(sourceLangName, fields) {
    const fieldList = fields.map(f => `  - "${f}"`).join('\n');
    return `### [Language Compliance — CRITICAL, OVERRIDES ANY OTHER INSTRUCTION]
This rule is MANDATORY. The following fields MUST be written in ${sourceLangName}:
${fieldList}

Supported sourceLangName values and their required output language:
  - "Korean"                 → output in Korean
  - "English"                → output in English
  - "Japanese"               → output in Japanese
  - "Chinese (Simplified)"   → output in Chinese (Simplified)
  - "Vietnamese"             → output in Vietnamese
  - "French"                 → output in French
  - "German"                 → output in German
  - "Spanish"                → output in Spanish
  - "Russian"                → output in Russian
  - "Portuguese (Brazilian)" → output in Portuguese (Brazilian)

The current sourceLangName is "${sourceLangName}". Every listed field MUST be in
"${sourceLangName}" — never default to English unless sourceLangName IS "English".
Violating this rule (e.g. writing translation in English when sourceLang is
Vietnamese) makes the output unusable.`;
}

/**
 * @param {object} args
 * @param {string} args.scene             — i18n scene 키 또는 customInput (예: 'hotel', 'airport')
 * @param {string} args.category          — 'locations' | 'situations'
 * @param {string} args.targetLang        — 학습 대상 언어 코드
 * @param {string} args.sourceLang        — 학습자 모국어 코드
 * @param {string} args.difficulty        — 'basic' | 'intermediate' | 'advanced'
 * @param {string} args.speechStyle       — 'casual' | 'formal'
 */
function buildStartPrompt({ scene, category, targetLang, sourceLang, difficulty, speechStyle }) {
    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
    const diffDesc = getDifficultyDesc(difficulty, targetLang);
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    return `### [Role]
You are a Language Learning Content Architect generating a SCRIPTED 3-MESSAGE conversation OPENER for a learner about to enter "${scene}".
The 3 messages play out automatically before the learner speaks. Together they should feel like a natural beginning of a real interaction:
  (1) intro          — short scene narration in ${sourceLangName}, sets the situation
  (2) firstUserTurn  — what the learner says FIRST to initiate the interaction (in ${targetLangName})
  (3) firstAiReply   — the other person's natural reply (in ${targetLangName})

---

### [Phase 1A: User Initiation Design] — applies to firstUserTurn
The learner's level is **${difficulty || 'basic'}**. Design the initiation complexity accordingly:
- **Basic**: Pick from simpler emotions (Grateful, Curious, Excited, Relieved, Surprised). Design predictable, routine situations (e.g., checking in, ordering food, asking for directions). Prefer action types: Greeting, Inquiry, Request, Social.
- **Intermediate**: Use the full emotion range. Introduce mild complications or unexpected elements. All action types are available.
- **Advanced**: Favor nuanced emotions (Hesitant, Frustrated, Dissatisfied, Apologetic, Nervous). Design layered situations with social tension or cultural sensitivity. Prefer action types: Problem, Complaint, Opinion, Observation.

Then for firstUserTurn:
1. Select ONE emotion for the learner from: Grateful, Frustrated, Confused, Excited, Hesitant, Urgent, Curious, Dissatisfied, Relieved, Apologetic, Surprised, Nervous.
2. Design a specific, realistic micro-situation for "${scene}" — avoid generic phrases like "Where is the restroom?".
3. Choose ONE Action Type: Inquiry / Request / Observation / Opinion / Problem / Complaint / Social / Greeting.

---

### [Phase 1B: AI Response Design] — applies to firstAiReply
- **Identify the responder role**: who naturally replies in this scene (waiter, receptionist, flight attendant, friend, stranger, etc.)?
- **Choose a Response Action Type** from the same 8 types.
- **Select a Response Emotion** that NATURALLY COMPLEMENTS the learner's emotion in 1A. Examples:
    User Hesitant   → AI Reassuring/Patient
    User Frustrated → AI Apologetic/Understanding
    User Curious    → AI Helpful/Informative
    User Grateful   → AI Warm/Friendly
    User Urgent     → AI Quick/Calm
- **Be Specific & Informative**: not "Sure!" or "Yes" — give a response with USEFUL INFO (a follow-up question, a confirmation with detail, an instruction, empathy).
- **Stay in character**: voice and content match the responder's role.

---

### [Phase 2: Difficulty Guidelines — apply to BOTH firstUserTurn and firstAiReply]
${diffDesc}

---

### [Phase 3: Speech Style & Politeness — apply to BOTH turns]
${styleDesc}
- **Emotion Integration**: Let each speaker's emotion shape their tone. The two turns should feel like a coherent emotional exchange.

---

### [Input Variables]
- Scene: ${scene}
- Category: ${category}
- Target Language: ${targetLangName}
- Learner's Native Language: ${sourceLangName}

---

### [Strict Rules]
1. **Speaker Identity**: firstUserTurn = the LEARNER speaking (initiation). firstAiReply = the OTHER PERSON answering. Never swap.
2. **Coherence**: firstAiReply MUST logically and naturally respond to firstUserTurn (same micro-situation, same emotional register, direct answer/follow-up).
3. **Variety**: Avoid generic textbook phrases. Reflect 2026 native everyday speech.
4. **Grammar & Length**: Strictly follow the Difficulty Guidelines for both turns.
5. **No reading aids — CRITICAL**: NEVER insert parenthetical readings such as 脚（あし）, 筋肉（きんにく）, 鍛（きた）える for Japanese, or pinyin annotations for Chinese. Plain script only — no glosses, no furigana, no ruby text, no tone marks inline. Violations make the output unusable.
6. **Intro language**: write intro.text ONLY in ${sourceLangName}. 1~2 sentences. Set the scene; do NOT spoil the chosen emotion or the User's exact words.
7. **No emoji** in intro/sentence fields.

---

${languageComplianceBlock(sourceLangName, ['intro.text', 'firstUserTurn.translation', 'firstUserTurn.scene_hint', 'firstUserTurn.learning_tip', 'firstAiReply.translation', 'firstAiReply.scene_hint', 'firstAiReply.learning_tip'])}

---

### [Return ONLY valid JSON — no markdown code fence]
{
  "intro": {
    "text": "Scene narration in ${sourceLangName}, 1~2 sentences."
  },
  "firstUserTurn": {
    "selected_emotion": "The learner's emotion (e.g., Frustrated, Curious, Hesitant).",
    "interaction_type": "Exactly one of: Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting.",
    "internal_scenario_summary": "English summary: chosen emotion, action type, micro-situation.",
    "sentence": "The learner's opening sentence in ${targetLangName}.",
    "translation": "Natural translation in ${sourceLangName}.",
    "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading. For ru: full sentence with stress accent marks (´) on stressed vowels of multi-syllable words (use accuracy of standard Russian dictionary; ё/single-syllable words need no accent). For all others: empty string ''.",
    "scene_hint": "In ${sourceLangName}: vivid micro-situation description WITHOUT emotion tags.",
    "learning_tip": "In ${sourceLangName}: vocab/grammar/pronunciation tip explaining how the chosen emotion and ${speechStyle} style shape this expression."
  },
  "firstAiReply": {
    "selected_emotion": "The responder's emotion (e.g., Helpful, Apologetic, Reassuring).",
    "interaction_type": "Exactly one of the 8 action types.",
    "internal_scenario_summary": "English summary: who is responding, their emotion, what info they give, and why this naturally answers firstUserTurn.",
    "sentence": "The response in ${targetLangName}.",
    "translation": "Natural translation in ${sourceLangName}.",
    "pronunciation": "Same rules as firstUserTurn.pronunciation.",
    "scene_hint": "In ${sourceLangName}: who is speaking (role) and what they say, WITHOUT emotion tags.",
    "learning_tip": "In ${sourceLangName}: tip about the response — vocab/grammar/expression and how emotion + role shape this."
  },
  "scenarioMeta": {
    "responder_role": "e.g., 'hotel receptionist', 'flight attendant', 'waiter', 'taxi driver', 'pharmacist'.",
    "scene_summary_en": "One-line English summary of the whole scene for downstream prompts."
  }
}`;
}

/**
 * Free Talking 자유 발화 후 AI 응답 prompt 빌더.
 *
 * 이 prompt는 단일 LLM 호출로 두 작업을 동시에 수행:
 *   (A) Intent Recovery — STT 원본(rawSttText)이 사용자 의도와 다를 수 있어, 대화 컨텍스트
 *       기반으로 학습자가 의도한 문장(intentText)을 보정.
 *       예: STT="I boat a new car" + 컨텍스트 → intentText="I bought a new car"
 *       오인식이 없으면 rawSttText를 그대로 intentText로 반환.
 *   (B) AI Reply — intentText에 대한 자연스러운 응답을 scene-answer prompt 95% 그대로 활용.
 *
 * 재활용 포인트:
 *   - scene-answer prompt(server/routes/scene.js 161~224행)의 [Phase 1: Response Situation Design]
 *   - getDifficultyDesc, STYLE_DESC, LANG_NAMES
 *   - Strict Rules + JSON 스키마(7 fields)
 *
 * 추가:
 *   - Phase 0: Intent Recovery (신규)
 *   - history (최근 12턴) 컨텍스트
 *   - Phase 1: "Established facts 재질문 금지" + "다음 단계로 advance" 강제
 */
function buildReplyPrompt({
    rawSttText,
    history = [],
    scenarioMeta = {},
    targetLang,
    sourceLang,
    difficulty,
    speechStyle,
}) {
    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
    const diffDesc = getDifficultyDesc(difficulty, targetLang);
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    // history → 텍스트 블록 (최근 12턴까지 보존 — 컨텍스트 일관성용)
    const recent = history.slice(-12);
    const historyBlock = recent.length > 0
        ? recent.map(h => {
            const speaker = h.role === 'ai' ? 'PARTNER' : 'LEARNER';
            return `${speaker}: ${h.text || ''}`;
        }).join('\n')
        : '(no prior turns — this is the first free utterance)';

    const responderRole = scenarioMeta.responder_role || 'the other person';
    const sceneSummary = scenarioMeta.scene_summary_en || '(unspecified scene)';

    return `### [Role]
You are running a real-time language-learning conversation. The learner just spoke; speech-to-text returned a possibly imperfect transcript. You will (A) recover the learner's INTENDED sentence and (B) generate a natural reply that ADVANCES the conversation.

---

### [Conversation Context — read carefully and use in BOTH Phase 0 and Phase 1]
Scene: ${sceneSummary}
Responder role: ${responderRole}
Target language: ${targetLangName}

Conversation so far (oldest → newest, last ${recent.length} turn(s)):
${historyBlock}

Current learner utterance (raw STT, may have mishears):
  RAW_STT: "${rawSttText}"

**Established facts** — Before generating any field, mentally extract what the
learner has ALREADY stated/chosen in the turns above (e.g., account type chosen,
name given, dates set, preferences expressed, items requested). These facts MUST
NOT be re-asked in aiReply.

---

### [Phase 0: Intent Recovery — produces intentText]
Use the Conversation Context above. Recovery rules:
1. If RAW_STT is grammatically reasonable AND fits the conversation context, return it AS-IS as intentText.
2. If RAW_STT contains likely STT mishears (homophones, dropped words, wrong tense) given the context, correct ONLY those minimal misrecognitions to produce a fluent ${targetLangName} sentence the learner most likely intended. Examples:
   - "I boat a new car" → "I bought a new car" (homophone bought↔boat)
   - "where is bath room" → "Where is the bathroom?" (article + capitalization + punctuation)
3. Do NOT rewrite the learner's vocabulary level or change the meaning. Stay close to RAW_STT — only fix obvious STT artifacts.
4. Preserve the learner's likely tone (casual/formal) — do not over-polish.
5. If RAW_STT is too garbled or empty to recover (less than 2 plausible words), set intentText to RAW_STT verbatim and aiReply.sentence to a polite request to repeat (in ${targetLangName}, in role ${responderRole}).

---

### [Phase 1: Response Situation Design — produces aiReply]
Reply as ${responderRole} would, naturally CONTINUING the conversation above.

**MANDATORY pre-step: Attribute classification**
Before drafting aiReply, mentally tag every prior turn (yours and the learner's)
with the ATTRIBUTE/DIMENSION it covered. Examples of attributes:
  - identity (name, ID, account number)
  - preference type (style, color, pattern, material, brand)
  - constraints (price/budget, size, quantity, time/duration)
  - logistics (location, delivery, payment method, contact)
  - status (problem report, request type, urgency)

Then list:
  ① ALREADY-COVERED attributes (info the learner has provided OR you have asked at all)
  ② NOT-YET-COVERED attributes that are natural for this scene
  ③ The next logical step toward closing the scene (payment, confirmation, hand-off)

**aiReply HARD RULES (follow strictly — no exceptions):**

1. **NO REDUNDANT ASKING about a covered attribute**.
   Example violation: AI asked "what style?" → learner answered ANYTHING about
   price/size (e.g. "small and cheap one") → AI must NOT ask about style again,
   even with different wording ("style or color?", "any specific style?", etc.).
   Once learner has answered an attribute OR you've asked it once and they
   responded — that attribute is **closed**.

2. **Acknowledge the learner's latest answer** in your reply (one short clause)
   if their answer addressed any attribute, then move on.
   Example: User says "small and cheap one" → "Got it, something compact and
   affordable. Would red work, or do you prefer a neutral color?"

3. **Pick ONE different attribute from list ② OR advance to ③**.
   If list ② is empty (everything is covered), advance to step ③:
   payment → confirmation → thank-you / next-action close.

4. **NEVER ask about price+size+style in a single reply** — that's the AI
   dumping the workload back on the learner. Pick one attribute, drive the
   conversation forward in small steps.

5. Choose a Response Action Type (exactly one of): Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting.
6. Select a Response Emotion that complements the learner's tone.
7. Be Specific & Informative: not "Sure!" or "Yes" — give a response with USEFUL INFO.
8. Stay in character as ${responderRole}.
9. Keep it short: 1~2 sentences. This is real-time conversation practice, not a monologue.

---

### [Phase 2: Difficulty Guidelines — apply to aiReply.sentence]
${diffDesc}

---

### [Phase 3: Speech Style — apply to aiReply.sentence]
${styleDesc}

---

### [Strict Rules]
1. Speaker Identity: aiReply = ${responderRole} speaking. Never speak as the learner.
2. Relevance: aiReply.sentence MUST directly address intentText.
3. Grammar & Length: Strictly follow Difficulty Guidelines for aiReply.
4. Modern & Realistic: 2026 native everyday speech, not stiff textbook phrases.
5. **No reading aids — CRITICAL**: NEVER insert parenthetical readings such as 脚（あし）, 筋肉（きんにく）, 鍛（きた）える for Japanese, or pinyin annotations for Chinese. Plain script only — no glosses, no furigana, no ruby text, no inline tone marks. Violations make the output unusable.
6. No emoji in sentence/intentText fields.

---

${languageComplianceBlock(sourceLangName, ['intentTranslation', 'aiReply.translation', 'aiReply.scene_hint', 'aiReply.learning_tip'])}

---

### [Return ONLY valid JSON — no markdown code fence]
{
  "intentText": "The learner's most likely intended sentence in ${targetLangName} (== RAW_STT if no correction needed).",
  "intentWasCorrected": true,
  "intentTranslation": "Translation of intentText in ${sourceLangName}.",
  "aiReply": {
    "selected_emotion": "Responder emotion (e.g., Helpful, Apologetic, Reassuring).",
    "interaction_type": "Exactly one of: Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting.",
    "internal_scenario_summary": "English: who is responding, their emotion, the info given, why it answers intentText.",
    "sentence": "The reply in ${targetLangName}.",
    "translation": "Natural translation in ${sourceLangName}.",
    "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading. For ru: full sentence with stress accents (´) on stressed vowels of multi-syllable words. For all others: empty string ''.",
    "scene_hint": "In ${sourceLangName}: who is speaking (role) and what they say, WITHOUT emotion tags.",
    "learning_tip": "In ${sourceLangName}: vocab/grammar/expression tip about this reply."
  }
}`;
}

/**
 * Free Talking 세션 종료 시 핵심 표현 3~5개를 추출하는 prompt 빌더.
 *
 * 입력: 세션 전체 history (user_auto / user_free / ai 메시지들), 시나리오 메타.
 * 출력: 학습자가 Library에 저장할 가치가 있는 표현 3~5개.
 *   - 너무 generic한 인사/동의/감사 표현은 제외
 *   - 전문 용어 / 자주 쓰는 패턴 / 어려운 문법 / 상황 특화 표현 우선
 *   - 사용자(user_auto / user_free)와 상대(ai) 양쪽에서 모두 추출 가능
 */
function buildSummarizePrompt({
    history = [],
    scenarioMeta = {},
    targetLang,
    sourceLang,
    difficulty,
}) {
    const targetLangName = LANG_NAMES[targetLang] || 'English';
    const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
    const responderRole = scenarioMeta.responder_role || 'the other person';
    const sceneSummary = scenarioMeta.scene_summary_en || '(unspecified scene)';
    const diffDesc = getDifficultyDesc(difficulty, targetLang);

    const historyBlock = history.length > 0
        ? history.map(h => {
            const speaker = h.role === 'ai' ? 'PARTNER' : 'LEARNER';
            return `${speaker}: ${h.text || ''}`;
        }).join('\n')
        : '(empty conversation)';

    return `### [Role]
You are a Language Learning Curator. After a learner finished a Free Talking
practice session, your job is to extract 3~5 key expressions worth saving to
the learner's Library — phrases that gave concrete learning value in this
specific scene, calibrated to the learner's level.

---

### [Conversation Context]
Scene: ${sceneSummary}
Responder role: ${responderRole}
Target language: ${targetLangName}

Full conversation (oldest → newest):
${historyBlock}

---

### [Level-aware Extraction Priority]
The learner's level is **${difficulty || 'basic'}**.
${diffDesc}

Match extraction priority to this level:
- **basic**: Prefer single words and 2~3-word phrases / common collocations.
  AVOID idiomatic expressions and complex multi-clause sentences. Pick phrases
  the learner can reuse in everyday simple exchanges.
- **intermediate**: Prefer common collocations, practical phrasal verbs, polite
  fixed expressions (e.g., "Could you...?", "I'd like to ___", "Would it be
  possible to...?"). Avoid rare idioms and textbook-only phrases.
- **advanced**: Prefer nuanced idioms, register-shifting phrases (formal/informal
  pairs), domain-specific terminology, and culturally rich expressions. Single
  common words rarely qualify.

---

### [Selection Rules]
1. Pick **3 to 5 phrases**, in ${targetLangName}, from the conversation above.
2. Each phrase MUST be either:
   - A complete sentence said by either speaker, OR
   - A useful chunk (4+ words) embedded in a longer sentence.
3. Prefer phrases that meet ANY of these criteria (and match the level priority above):
   - Scene-specific vocabulary (e.g., 'open a savings account', 'window seat')
   - Common functional patterns (e.g., 'Could you tell me where...?', 'I'd like to ___')
   - Polite/formal register useful for the same situation type
   - Idiomatic expressions or phrasal verbs (intermediate+/advanced only)
4. AVOID:
   - Generic single-word fillers ('yes', 'okay', 'thanks', 'hello', 'goodbye')
   - Trivial greetings without scene context
   - Phrases the learner is unlikely to reuse outside this exact dialogue
   - For basic learners: any idiom or 3+ clause sentence
5. **Distribute** between LEARNER (what the user said or could say) and PARTNER (what the responder said) — at least 1 from each side if possible.
6. Preserve the EXACT wording from the conversation. Do NOT rephrase, translate, or "improve" the original phrase.

---

${languageComplianceBlock(sourceLangName, ['translation', 'why_useful'])}

Field-by-field language summary (combined):
  - "phrase"          → ${targetLangName} (target)
  - "translation"     → ${sourceLangName} (source)
  - "why_useful"      → ${sourceLangName} (source)
  - "source_role"     → literal English token 'learner' or 'partner'
  - "pronunciation"   → follows lang-specific rules above

---

### [Phrase field cleanliness — CRITICAL]
The "phrase" field MUST contain ONLY the pure word/phrase in ${targetLangName}.
NEVER include pronunciation, pinyin, hiragana, romanization, hanja, parenthetical
readings, or any annotation in the "phrase" field. Pronunciation goes ONLY in
the "pronunciation" field.

  Bad examples (rejected):
    "咖啡 (kāfēi)"           ← pinyin annotation in phrase
    "食べる（たべる）"       ← furigana annotation
    "おんがく (音楽)"        ← reverse-direction annotation
    "커피 (coffee)"          ← cross-language gloss
    "I'd like (저는) to..."  ← native-language gloss in target phrase

  Good examples:
    "咖啡"                   ← pure Chinese
    "食べる"                 ← kanji form (standard written)
    "音楽"                   ← kanji form, NOT "おんがく"
    "커피"                   ← pure Korean
    "I'd like to ___"        ← pure English

For Japanese: the "phrase" field MUST use the standard written form (kanji where
natural, e.g. "音楽" not "おんがく"). Hiragana reading goes ONLY in "pronunciation".

For Russian "pronunciation": rewrite the phrase with acute accent (´) on the
stressed vowel of each multi-syllable word (use standard Russian dictionary
accuracy; ё / single-syllable words need no accent).

---

### [Return ONLY valid JSON — no markdown code fence]
{
  "keyPhrases": [
    {
      "phrase": "The exact phrase or sentence in ${targetLangName} as it appeared in the conversation — PURE form, no annotations.",
      "translation": "Natural translation in ${sourceLangName}.",
      "why_useful": "In ${sourceLangName}, 1 short line: why this phrase is worth remembering for ${sceneSummary}, calibrated to ${difficulty || 'basic'} level.",
      "source_role": "Either 'learner' (LEARNER spoke it) or 'partner' (PARTNER spoke it).",
      "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading of the kanji-form phrase. For ru: stress-accent form. For all others: empty string ''."
    }
  ]
}`;
}

module.exports = { buildStartPrompt, buildReplyPrompt, buildSummarizePrompt };
