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
 *   - history (최근 6턴) 컨텍스트
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

    // history → 텍스트 블록
    const recent = history.slice(-6);
    const historyBlock = recent.length > 0
        ? recent.map(h => {
            const speaker = h.role === 'ai' ? 'PARTNER' : 'LEARNER';
            return `${speaker}: ${h.text || ''}`;
        }).join('\n')
        : '(no prior turns — this is the first free utterance)';

    const responderRole = scenarioMeta.responder_role || 'the other person';
    const sceneSummary = scenarioMeta.scene_summary_en || '(unspecified scene)';

    return `### [Role]
You are running a real-time language-learning conversation. The learner just spoke; speech-to-text returned a possibly imperfect transcript. You will (A) recover the learner's INTENDED sentence and (B) generate a natural reply.

---

### [Phase 0: Intent Recovery — produces intentText]
The STT (speech recognition) result for the learner's latest utterance is:
  RAW_STT: "${rawSttText}"

Conversation so far (most recent ${recent.length} turns):
${historyBlock}

Scene: ${sceneSummary}
Responder role: ${responderRole}
Target language: ${targetLangName}

Recovery rules:
1. If RAW_STT is grammatically reasonable AND fits the conversation context, return it AS-IS as intentText.
2. If RAW_STT contains likely STT mishears (homophones, dropped words, wrong tense) given the context, correct ONLY those minimal misrecognitions to produce a fluent ${targetLangName} sentence the learner most likely intended. Examples:
   - "I boat a new car" → "I bought a new car" (homophone bought↔boat)
   - "where is bath room" → "Where is the bathroom?" (article + capitalization + punctuation)
3. Do NOT rewrite the learner's vocabulary level or change the meaning. Stay close to RAW_STT — only fix obvious STT artifacts.
4. Preserve the learner's likely tone (casual/formal) — do not over-polish.
5. If RAW_STT is too garbled or empty to recover (less than 2 plausible words), set intentText to RAW_STT verbatim and aiReply.sentence to a polite request to repeat (in ${targetLangName}, in role ${responderRole}).

---

### [Phase 1: Response Situation Design — produces aiReply]
Reply as ${responderRole} would, naturally answering intentText (NOT RAW_STT).
- **Choose a Response Action Type** (exactly one of): Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting.
- **Select a Response Emotion** that naturally complements the learner's tone (e.g., User Hesitant → AI Reassuring; User Frustrated → AI Apologetic).
- **Be Specific & Informative**: not "Sure!" or "Yes" — give a response with USEFUL INFO (a follow-up question, a confirmation with detail, an instruction, empathy).
- **Stay in character** as ${responderRole}.
- **Keep it short**: 1~2 sentences. This is real-time conversation practice, not a monologue.

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

module.exports = { buildStartPrompt, buildReplyPrompt };
