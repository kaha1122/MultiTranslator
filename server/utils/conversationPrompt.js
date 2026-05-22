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
 * @param {string}  args.scene            — i18n scene 키 또는 customInput (예: 'hotel', 'airport')
 * @param {string}  args.category         — 'locations' | 'situations' (i18n 카드 선택 시 의미; isCustom=true 면 단순 hint)
 * @param {boolean} args.isCustom         — true면 사용자가 customInput을 입력한 경우. category 강제 매핑 우회.
 * @param {string}  args.targetLang       — 학습 대상 언어 코드
 * @param {string}  args.sourceLang       — 학습자 모국어 코드
 * @param {string}  args.difficulty       — 'basic' | 'intermediate' | 'advanced'
 * @param {string}  args.speechStyle      — 'casual' | 'formal'
 * @param {Array}   args.avoidSituations  — 같은 (scene,difficulty,style,lang) 키로 이전 세션에서 누적된
 *                                          상황 메타. shape: [{ summary, dimensions: {emotion, action_type,
 *                                          responder_role, topic_focus}, createdAt? }]. 최근 30개까지 권고.
 */
function buildStartPrompt({ scene, category, isCustom = false, targetLang, sourceLang, difficulty, speechStyle, avoidSituations = [] }) {
  const targetLangName = LANG_NAMES[targetLang] || 'English';
  const sourceLangName = LANG_NAMES[sourceLang] || 'Korean';
  const diffDesc = getDifficultyDesc(difficulty, targetLang);
  const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

  // ── Anti-Duplication 블록 — 차원 회전(Dimension Rotation) + 구조화 JSON 방식 ──
  // 단순 문장 나열 대신 차원별 set 으로 압축해 LLM 의 lost-in-the-middle 한계 우회.
  // 같은 카테고리(scene+difficulty+style+lang) 키 안에서만 누적되므로 카테고리 간섭 없음.
  let avoidBlock = '';
  if (Array.isArray(avoidSituations) && avoidSituations.length > 0) {
    const recent = avoidSituations.slice(-30);
    const olderCount = avoidSituations.length - recent.length;
    const dims = {
      emotions: new Set(),
      action_types: new Set(),
      responder_roles: new Set(),
      topic_focuses: new Set(),
    };
    const lines = recent.map((s, i) => {
      const d = s.dimensions || {};
      if (d.emotion) dims.emotions.add(d.emotion);
      if (d.action_type) dims.action_types.add(d.action_type);
      if (d.responder_role) dims.responder_roles.add(d.responder_role);
      if (d.topic_focus) dims.topic_focuses.add(d.topic_focus);
      const summary = (s.summary || '').replace(/"/g, "'").slice(0, 120);
      return `  ${String(i + 1).padStart(2, ' ')}. "${summary}" — ${d.emotion || '?'}/${d.action_type || '?'}/${d.responder_role || '?'}`;
    }).join('\n');
    const dimSummary = JSON.stringify({
      emotions: [...dims.emotions],
      action_types: [...dims.action_types],
      responder_roles: [...dims.responder_roles],
      topic_focuses: [...dims.topic_focuses],
    });
    avoidBlock = `

---

### [Anti-Duplication via Dimension Rotation — MANDATORY]
The learner has already played ${avoidSituations.length} Free-Talking session(s) for this exact scene+difficulty+style+lang combo.
${olderCount > 0 ? `(${olderCount} older sessions omitted; ${recent.length} most recent shown.)\n` : ''}Recent situations (oldest → newest):
${lines}

Already-covered dimensions (DO NOT repeat the same combination):
${dimSummary}

Rotation rules — apply ALL:
1. Pick an **emotion** for firstUserTurn that is NOT in covered.emotions if any unused emotion exists in the level-allowed set.
2. Pick an **action_type** that is NOT in covered.action_types if any unused type exists.
3. Pick a **responder_role** different from the most recent 3 in the list above.
4. Pick a **topic_focus** (the specific sub-situation: "seat change", "lost luggage", "menu recommendation", etc.) that is NOT in covered.topic_focuses.
5. If ALL of the above dimensions are exhausted in a single dimension, prioritize topic_focus novelty + responder_role rotation over emotion/action repeat.
6. The resulting situation MUST feel meaningfully different from each of the recent ${recent.length} listed above — not a paraphrase.`;
  }

  return `### [Role]
You are a Language Learning Content Architect generating a SCRIPTED 3-MESSAGE conversation OPENER for a learner about to enter "${scene}".

**CRITICAL framing — read first:** These 3 messages play out automatically BEFORE
the learner takes over. After firstAiReply, the learner free-talks with the
responder for **5~15+ more turns**. Your 3 messages are therefore a true
OPENING that hands the floor to the learner — NOT a self-contained two-turn
micro-dialogue that resolves everything. If a real bystander could read all 3
messages and say "well, that conversation is done, nothing more to say," you
have FAILED the task.

The 3 messages should feel like the first ~20 seconds of a real interaction:
  (1) intro          — short scene narration in ${sourceLangName}, sets the situation
  (2) firstUserTurn  — what the learner says FIRST to initiate the interaction (in ${targetLangName})
  (3) firstAiReply   — the other person's natural reply that INVITES the learner to continue (in ${targetLangName})

---

### [Step 0: Detect Scene Input Language — DO THIS SILENTLY FIRST]
"${scene}" is free-form text that may be in ANY language (vi/ru/ko/ja/zh-CN/
es/fr/de/pt-BR/en). Internally detect its language (hint: learner's native
is "${sourceLangName}"), interpret it NATIVELY in that language (do NOT
mentally translate to English before classifying), and carry that native
meaning into Phase 0's WHERE/WHO/WHY reasoning below. This governs INPUT
INTERPRETATION only — output field languages still follow the rules later.

---

### [Phase 0: Scene Coherence — MANDATORY FIRST STEP, BEFORE any other phase]
Before drafting any field, internally plan ONE specific micro-situation that ties
intro, firstUserTurn, and firstAiReply into a SINGLE coherent moment.

**🔴 Category-aware interpretation — APPLY BEFORE step ① below**:
${isCustom ? `
⚠️ **CUSTOM INPUT MODE (isCustom=true) — IGNORE the stated category="${category}"**:
The learner typed "${scene}" as FREE-FORM custom input. The category value
above is just a UI default and may NOT match the actual input. **Trust the
scene TEXT itself**, interpreted per Step 0 in its native language:
  - If "${scene}" is clearly a PLACE (e.g. "Starbucks", "공항 라운지",
    "사우나", "kafe gần nhà") → treat as locations, use it as the setting.
  - If "${scene}" is clearly a SITUATION / ACTION / CONVERSATION TYPE
    (e.g. "자기소개", "Giới thiệu với người bạn mới", "Запись к врачу",
    "complain about delivery") → treat as situations: pick a realistic
    setting where this exchange naturally occurs (do NOT force-fit into
    a random unrelated location like airport/hotel/restaurant).
  - If "${scene}" is abstract/poetic/fantastical (e.g. "dưới biển" /
    "under the sea", "in a dream", "우주에서") → interpret as a CREATIVE
    SCENE: pick a plausible realistic adaptation (e.g. snorkeling tour
    guide on a Vietnam beach for "dưới biển") and proceed.
  - If ambiguous, lean toward the most natural everyday interpretation
    of the text in the learner's native language ("${sourceLangName}").
Use your decision as the source of truth and proceed to step ① below.
(The i18n-key locations/situations subsections below DO NOT apply in
custom mode.)
` : `
The string "${scene}" means different things depending on category="${category}":

  • category = "locations" → "${scene}" IS the physical place itself
    (airport, hotel, restaurant, gym, etc.). Skip directly to step ① below
    using "${scene}" as the location.

  • category = "situations" → "${scene}" IS a CONVERSATION TYPE / interaction
    pattern, NOT a place. The learner wants to practice this kind of exchange,
    and the specific setting is YOUR choice. Before step ①:
      - Pick ONE realistic, concrete setting where "${scene}" naturally occurs.
      - That chosen setting becomes the WHERE for step ① below.
      - Pick a DIFFERENT realistic setting each session for variety (see
        Anti-Duplication block if present).
    Examples of natural settings per situation scene:
      - "smalltalk"   → office coffee break / gym locker room / dog park /
                         neighborhood elevator / café next to someone reading
      - "lost"         → subway station info booth / mall lost-and-found /
                         airport help desk / hotel front desk (lost key)
      - "reservation"  → restaurant phone call / hotel front desk / dental
                         clinic counter / hair salon
      - "disagree"     → meeting room / customer service desk / friend chat
                         over coffee / family dinner
      - "problem"      → IT support call / restaurant kitchen issue with staff /
                         apartment maintenance / appliance return counter
      - "directions"   → street corner with passerby / hotel concierge /
                         tourist info center / subway exit map
      - "intro"        → first day at new office / networking event / club
                         orientation / new neighbor at the door
      - "compliment"   → workplace recognition / friend's new haircut / chef
                         after good meal / colleague's presentation
      - "decline"      → party invite from coworker / sales pitch / extra
                         drink offer / overtime request
      - "advice"       → friend's home over tea / mentor's office hours /
                         older sibling chat / pharmacist consult
    The chosen setting determines responder_role for step ②.
`}

Now fill in your private mental scratchpad (using the location decided above):

  ① WHERE: a specific spot (not generic).
       For locations category: a specific spot inside "${scene}".
         Bad : "at the airport"          Good: "at the airline check-in counter"
       For situations category: the concrete setting you chose above.
         Bad : "somewhere people meet"   Good: "office break room, Monday morning"

  ② WHO is the responder: a specific person the learner can speak to RIGHT NOW.
       This person becomes the responder_role. Examples:
       "the check-in agent at the counter", "a barista behind the bar",
       "a tourist guide standing near the temple gate"

  ③ WHY the learner needs to speak: a specific information gap or request.
       Bad : "ask something"
       Good: "doesn't know which gate her flight leaves from"

  ④ INTERACTION ARC — what it would take for ③ to be FULLY handled.
       This MUST be a multi-step exchange, not a single fact.
       List **3~5 attributes/decisions** the responder typically needs from
       (or gives to) the learner before ③ is fully resolved.
       Examples:
         - airline check-in counter → {passport, flight number, seat preference, baggage count, special meal}
         - restaurant host          → {party size, indoor/outdoor, reservation name, time, allergy info}
         - clothing shop staff      → {item category, size, color, budget, gift wrap, payment method}
         - pharmacy counter         → {symptoms, duration, allergies, current medication, dosage form}

  ⑤ FIRST STEP ONLY — pick EXACTLY ONE attribute from ④ that firstAiReply
       will surface. The remaining 2~4 attributes are deliberately left
       UNADDRESSED so the learner has clear, concrete things to say next
       during Free Talking. firstAiReply must NOT resolve ③ in a single move.

Then ALL three fields MUST reflect this exact plan:
  - intro.text         → describes ① and the situation that creates ③.
                          May implicitly or explicitly hint at ②.
                          MUST NOT contradict the dialogue (e.g. don't write
                          "a sign explains everything" if the learner is about
                          to ask the responder for that info).
  - firstUserTurn      → the learner's first words to ② that OPEN ③.
                          A natural opener stating intent / context, NOT a
                          fully-loaded one-shot question that could be closed
                          by a single AI reply.
                          MUST refer to something NOT already given in intro
                          (e.g. signs/screens already mentioned).
  - firstAiReply       → ② acknowledges the learner briefly, then BEGINS ③ by
                          asking for / confirming the ONE attribute chosen in ⑤.
                          The remaining attributes from ④ stay open for the
                          learner to handle in subsequent Free Talking turns.

Coherence checklist (mentally verify before output):
  [ ] Does intro location match where firstUserTurn would naturally happen?
  [ ] Does firstUserTurn ask about something NOT already given in intro?
  [ ] Does firstAiReply come from the SAME person implied in intro?
  [ ] Would a real bystander reading all 3 messages feel one continuous moment?
  [ ] Does firstAiReply end by HANDING THE FLOOR back to the learner (question /
      offered choice / info request) — and leave ≥2 attributes from ④ STILL
      UNADDRESSED for the learner to bring up next?
  [ ] Could a learner naturally produce 5+ more turns of free conversation
      from this opener? If only "OK / Thanks" remains, the opener has failed.

If any check fails, redesign before writing JSON.

---

### [Phase 1A: User Initiation Design] — applies to firstUserTurn
The learner's level is **${difficulty || 'basic'}**. Design the initiation complexity accordingly:
- **Basic**: ${difficulty === 'basic' ? 'Do NOT apply any strong emotion. Keep the tone completely neutral, predictable, and straightforward (e.g., checking in, ordering food). Prefer action types: Greeting, Inquiry, Request, Social.' : 'Pick from simpler emotions (Grateful, Curious, Excited, Relieved, Surprised). Design predictable, routine situations (e.g., checking in, ordering food, asking for directions). Prefer action types: Greeting, Inquiry, Request, Social.'}
- **Intermediate**: Use the full emotion range. Introduce mild complications or unexpected elements. All action types are available.
- **Advanced**: Favor nuanced emotions (Hesitant, Frustrated, Dissatisfied, Apologetic, Nervous). Design layered situations with social tension or cultural sensitivity. Prefer action types: Problem, Complaint, Opinion, Observation.

Then for firstUserTurn:
1. Select ONE emotion for the learner ${difficulty === 'basic' ? '(for Basic, just use "Neutral" or "Calm")' : 'from: Grateful, Frustrated, Confused, Excited, Hesitant, Urgent, Curious, Dissatisfied, Relieved, Apologetic, Surprised, Nervous.'}
2. Design a specific, realistic micro-situation for "${scene}" — avoid generic phrases like "Where is the restroom?".
3. Choose ONE Action Type: Inquiry / Request / Observation / Opinion / Problem / Complaint / Social / Greeting.
4. **Opener shape — CRITICAL**: firstUserTurn is a CONVERSATION OPENER. State
   intent or context, NOT a tight one-shot question.
     Good opener pattern (invites continuation):
       ✓ "Hi, I'd like to check in for my flight to Paris."
       ✓ "Excuse me, I'm looking for something for my mom's birthday."
       ✓ "I think I'm coming down with a cold and need something for it."
     Bad pattern (one-shot question, AI can close in one reply):
       ✗ "Which gate is flight KE072 from?"
       ✗ "How much is the red silk scarf?"
       ✗ "What time do you close today?"
   Save tight single-fact questions for LATER turns; this is the very first
   thing the learner says.

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
- **Acknowledge briefly, then drive forward**: open with a short acknowledgement
  of the learner's opener, then move the interaction one step forward — NOT a
  closing reply.
- **Stay in character**: voice and content match the responder's role.

- **MANDATORY continuation hook** — firstAiReply MUST end by HANDING THE FLOOR
  back to the learner. Choose ONE of these patterns:
    (a) Ask a follow-up question targeting the ONE attribute chosen in Phase 0 ⑤.
        e.g. "Welcome! May I see your passport, please?"
    (b) Present 2~3 explicit options for the learner to choose between.
        e.g. "We have indoor and outdoor seating — which would you prefer?"
    (c) Request the next required piece of information.
        e.g. "Sure, what name should I put the reservation under?"

- **AVOID terminal/closing patterns** in firstAiReply:
    ✗ Full resolution of firstUserTurn ("Gate 7 is upstairs, turn right." → done)
    ✗ Generic well-wishes that close the exchange ("Have a nice day!", "Enjoy your stay!")
    ✗ Dumping all attributes at once ("It comes in red/blue/green, $25, ships same-day, …")
    ✗ A yes/no answer the learner can only acknowledge with "OK / Thanks"
    ✗ Addressing more than ONE attribute from Phase 0 ④ in a single reply

- **Headroom requirement**: at least 2 attributes from Phase 0 ④ MUST remain
  unaddressed after firstAiReply, so the learner has concrete material to talk
  about during Free Talking.

- **Length**: ${difficulty === 'basic' ? 'EXACTLY 1 sentence, maximum 8 words. Use the simplest possible response pattern (e.g., "Sure! What size?"). Immediate understanding is the goal.' : '1~2 sentences. Real-time conversation pacing, not a paragraph.'}

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
    ▸ "locations" → Scene is a PLACE (use it as the WHERE directly).
    ▸ "situations" → Scene is a CONVERSATION TYPE (choose a realistic
      setting yourself — see Phase 0 Category-aware interpretation above).
- Target Language: ${targetLangName}
- Learner's Native Language: ${sourceLangName}
${avoidBlock}

---

### [Strict Rules]
1. **Speaker Identity**: firstUserTurn = the LEARNER speaking (initiation). firstAiReply = the OTHER PERSON answering. Never swap.
2. **Coherence**: firstAiReply MUST logically and naturally respond to firstUserTurn (same micro-situation, same emotional register, direct answer/follow-up).
3. **Variety**: ${difficulty === 'basic' ? 'Textbook-style standard phrases are PREFERRED. The learner needs predictable, recognizable patterns. Do NOT use slang or colloquialisms.' : 'Avoid generic textbook phrases. Reflect 2026 native everyday speech.'}
4. **Grammar & Length**: Strictly follow the Difficulty Guidelines for both turns.
5. **No reading aids — CRITICAL**: NEVER insert parenthetical readings such as 脚（あし）, 筋肉（きんにく）, 鍛（きた）える for Japanese, or pinyin annotations for Chinese. Plain script only — no glosses, no furigana, no ruby text, no tone marks inline. Violations make the output unusable.
6. **Intro consistency — CRITICAL**: intro.text MUST set up the EXACT micro-situation
   from Phase 0, so firstUserTurn arises naturally. Specifically:
   - Mention WHERE the learner is (specific) and WHY they need to speak (information gap).
   - Imply or mention WHO they will talk to (the responder), if natural for this scene.
   - DO NOT introduce facts that would make firstUserTurn redundant (e.g. "a sign
     shows the gate number" when learner is about to ask for the gate).
   - DO NOT describe unrelated background that distracts from the upcoming dialogue
     (e.g. "tourists are taking photos nearby" when the dialogue is about directions).
   - intro.text in ${sourceLangName} ONLY. 1~2 sentences. Don't reveal the chosen
     emotion or the User's exact words.
7. **No emoji** in intro/sentence fields.
8. **No placeholder markers — CRITICAL**: NEVER output placeholder symbols
   intended to be filled in later. Always commit to CONCRETE, realistic,
   scene-appropriate values. Banned in EVERY user-facing field (intro.text,
   firstUserTurn.sentence, firstAiReply.sentence, translation, scene_hint,
   learning_tip):
     ✗ Bad (universal):  ○○ / ×× / ＿＿ / ___ / XXX / [city] / [number]
     ✗ Bad (Japanese):   ○○行き / ○○号車 / 某地行き / ××便
     ✗ Bad (Korean):     ㅇㅇ역 / 어디어디 / 모처
     ✗ Bad (Chinese):    某某 / 某地 / ××路
     ✗ Bad (English):    "going to [destination]" / "Flight XX" / "to ___"
   These are unusable in real conversation — the learner cannot say "○○行き"
   out loud, and TTS produces awkward output. Pick a specific realistic value
   every time:
     ✓ Good (Japanese): "新宿行き" / "東京行き" / "3号車" / "NH123便"
     ✓ Good (Korean):   "강남역" / "부산행" / "5호선"
     ✓ Good (Chinese):  "去北京" / "10路公交"
     ✓ Good (English):  "going to Boston" / "Flight KE072" / "Platform 5"
   This rule binds Phase 0 (Scene Coherence) — when choosing the
   micro-situation, COMMIT to one concrete destination/number/name/time
   and use it consistently across all 3 messages.
9. **Opener, not full exchange — CRITICAL**: firstAiReply MUST end with an OPEN
   prompt (question / offered choice / info request) and MUST leave ≥2 attributes
   from Phase 0 ④ unresolved. The 3 messages are the starting point for Free
   Talking, NOT a self-contained micro-dialogue. If firstAiReply could be
   naturally followed by "OK, thanks" with nothing more to say, the output has
   failed — redesign before writing JSON.

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
    "pronunciation": "For zh-CN/zh: pinyin with tone marks (REQUIRED, non-empty). For ja: hiragana reading (REQUIRED, non-empty). For ru: full sentence with stress accent marks (´) on stressed vowels of multi-syllable words (REQUIRED, non-empty; use accuracy of standard Russian dictionary; ё/single-syllable words need no accent). For all others: empty string ''. **CRITICAL: an empty string for zh-CN/zh/ja/ru makes the response invalid.**",
    "scene_hint": "In ${sourceLangName}: vivid micro-situation description WITHOUT emotion tags.",
    "learning_tip": "In ${sourceLangName}: vocab/grammar/pronunciation tip explaining how the chosen emotion and ${speechStyle} style shape this expression."
  },
  "firstAiReply": {
    "selected_emotion": "The responder's emotion (e.g., Helpful, Apologetic, Reassuring).",
    "interaction_type": "Exactly one of the 8 action types.",
    "internal_scenario_summary": "English summary: who is responding, their emotion, which ONE attribute from Phase 0 ④ they ask for / confirm in this reply, AND a comma-separated list of the remaining 2+ attributes from ④ still LEFT UNADDRESSED for the learner to bring up in subsequent Free Talking turns. Format: 'role + emotion + asks_attr=X | remaining=Y, Z, W'.",
    "sentence": "The response in ${targetLangName}.",
    "translation": "Natural translation in ${sourceLangName}.",
    "pronunciation": "Same rules as firstUserTurn.pronunciation — REQUIRED non-empty for zh-CN/zh/ja/ru.",
    "scene_hint": "In ${sourceLangName}: who is speaking (role) and what they say, WITHOUT emotion tags.",
    "learning_tip": "In ${sourceLangName}: tip about the response — vocab/grammar/expression and how emotion + role shape this."
  },
  "scenarioMeta": {
    "responder_role": "e.g., 'hotel receptionist', 'flight attendant', 'waiter', 'taxi driver', 'pharmacist'.",
    "scene_summary_en": "One-line English summary of the whole scene for downstream prompts."
  },
  "situationSummary": "ONE concise line in ${sourceLangName} (max ~25 chars / ~8 words) capturing THIS specific micro-situation. Used to dedupe future Free-Talking sessions for the same scene. Example (sourceLang=Korean): '공항 체크인에서 좌석 변경 요청'. Example (sourceLang=English): 'Asking to change seat at airport check-in'. Be specific — don't echo the scene name only.",
  "dimensions": {
    "emotion": "Same as firstUserTurn.selected_emotion (echo it here as a flat string for downstream dedup).",
    "action_type": "Same as firstUserTurn.interaction_type (echo it here as a flat string).",
    "responder_role": "Same as scenarioMeta.responder_role (echo it here as a flat string).",
    "topic_focus": "Short English phrase (2~4 words) naming the sub-situation handled in this session. Examples: 'seat change', 'lost luggage', 'menu recommendation', 'late checkout'. This is the most important field for cross-session deduplication — make it specific and distinguishable from the previously-covered topic_focuses listed above."
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

  // history → 텍스트 블록 (최근 8턴까지 보존 — 컨텍스트 일관성용)
  // 12 → 8 감축(2026-05-21): buildReplyPrompt 31KB → 28KB(-10%) + Gemini Flash-Lite
  // 32K input limit 여유 확보. 8턴(약 4 user + 4 AI)이면 직전 ~4 단계의 대화 흐름
  // 충분히 잡힘. 더 옛 맥락은 scenarioMeta.scene_summary_en으로 보강.
  // user turn에 coachingTip(이전 턴에서 튜터가 학습자에게 준 모국어 코칭)이 있으면
  // 별도 라인으로 inject — AI가 학습자의 누적 학습 맥락을 인지하며 자연스럽게 상호작용.
  const recent = history.slice(-8);
  const historyBlock = recent.length > 0
    ? recent.map(h => {
      const speaker = h.role === 'ai' ? 'PARTNER' : 'LEARNER';
      let line = `${speaker}: ${h.text || ''}`;
      if (h.role !== 'ai' && h.coachingTip) {
        line += `\n    [tutor's prior note to learner in ${sourceLangName}: "${h.coachingTip}"]`;
      }
      return line;
    }).join('\n')
    : '(no prior turns — this is the first free utterance)';

  const responderRole = scenarioMeta.responder_role || 'the other person';
  const sceneSummary = scenarioMeta.scene_summary_en || '(unspecified scene)';

  return `### [Role]
You are running a real-time language-learning conversation. The learner just spoke; speech-to-text returned a possibly imperfect transcript. You will (A) recover the learner's INTENDED sentence, (B) generate a natural reply that ADVANCES the conversation, and (C) produce a private tutor coaching note for the learner.

---

### [GOLDEN RULE — Conversational Coherence Above All Else]
**This is the SINGLE most important rule. Every other rule is subordinate to it.**

The learner is in the MIDDLE of an ongoing role-play. They have already said
things, you (the responder) have already said things, and a specific micro-
situation is unfolding. Your job is to make the NEXT turn feel like a natural
continuation — NOT a fresh start, NOT a topic switch, NOT a memory lapse.

What "ridiculous / broken conversation" looks like (you MUST avoid ALL of these):

  ❌ **Identity drift**: The responder role suddenly changes (was a check-in
     agent, now answers like a barista). The responder role is FIXED for the
     whole session — stay in character as ${responderRole}.

  ❌ **Memory loss**: Asking for info the learner already provided
     ("What's your name?" when the learner already said their name 2 turns ago).
     Re-asking an attribute you already asked about, even with different wording.

  ❌ **Fact contradiction**: Stating something that contradicts what was
     established earlier in the conversation (e.g., learner chose window seat
     → AI later says "your aisle seat is confirmed").

  ❌ **Non-sequitur replies**: A reply that doesn't relate to what the learner
     just said. If the learner asks about price, don't suddenly start talking
     about delivery time without first answering price.

  ❌ **Scene reset**: Treating the current turn as if the conversation just
     started. Re-introducing yourself, re-explaining the scene, re-greeting.

  ❌ **Topic abandonment**: Dropping the thread the learner was on. If learner
     is in the middle of ordering food, don't pivot to weather chitchat unless
     the learner themselves opened that door.

  ❌ **Register/tone whiplash**: Switching between formal and casual mid-conversation
     without learner cue. Maintain the speechStyle (${speechStyle}) consistently.

  ❌ **Coaching mismatch**: userCoachingTip discussing grammar/vocab unrelated
     to the current scene or the learner's actual utterance — generic textbook
     lecture instead of in-context tutoring.

**Before drafting any field, mentally answer:**
  (1) What is the CURRENT THREAD? (what was the last unresolved beat?)
  (2) What did the learner JUST say in this turn, and how does it move the thread?
  (3) What facts/attributes have been ESTABLISHED so far (don't re-ask them)?
  (4) What is the next natural micro-step that keeps the thread alive?

If the conversation history is empty (first free utterance after the opener),
treat the firstUserTurn ↔ firstAiReply scaffold as the established context.

This rule OVERRIDES variety/novelty preferences. A coherent, slightly less varied
reply is FAR better than a varied reply that breaks the conversation.

---

### [Conversation Context — read carefully and use in BOTH Phase 0 and Phase 1]
Scene: ${sceneSummary}
Responder role: ${responderRole}
Target language: ${targetLangName}

Conversation so far (oldest → newest, last ${recent.length} turn(s)):
${historyBlock}

What the learner just spoke (may contain mishears from speech recognition):
  SpokenInput: "${rawSttText}"

(Note: "SpokenInput" is an INTERNAL label for your reference only. Never quote
this label or words like "STT", "transcript", "intent recovery", "the system"
in any user-facing field — see Strict Rules.)

**Established facts** — Before generating any field, mentally extract what the
learner has ALREADY stated/chosen in the turns above (e.g., account type chosen,
name given, dates set, preferences expressed, items requested). These facts MUST
NOT be re-asked in aiReply.

---

### [Phase 0: Intent Recovery — produces intentText]
Use the Conversation Context above. Recovery rules:
1. If SpokenInput is grammatically reasonable AND fits the conversation context, return it AS-IS as intentText.
2. If SpokenInput contains likely STT mishears (homophones, dropped words, wrong tense) given the context, correct ONLY those minimal misrecognitions to produce a fluent ${targetLangName} sentence the learner most likely intended. Examples:
   - "I boat a new car" → "I bought a new car" (homophone bought↔boat)
   - "where is bath room" → "Where is the bathroom?" (article + capitalization + punctuation)
3. Do NOT rewrite the learner's vocabulary level or change the meaning. Stay close to SpokenInput — only fix obvious STT artifacts.
4. Preserve the learner's likely tone (casual/formal) — do not over-polish.
5. If SpokenInput is too garbled or empty to recover (less than 2 plausible words), set intentText to SpokenInput verbatim and aiReply.sentence to a polite request to repeat (in ${targetLangName}, in role ${responderRole}).

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
9. Keep it short: ${difficulty === 'basic' ? 'EXACTLY 1 sentence, maximum 8 words. Use the simplest possible response pattern (e.g., "Sure! What size?"). The response should be immediately understandable by a beginner.' : '1~2 sentences. This is real-time conversation practice, not a monologue.'}

---

### [Phase 2: Difficulty Guidelines — apply to aiReply.sentence]
${diffDesc}

---

### [Phase 3: Speech Style — apply to aiReply.sentence]
${styleDesc}

---

### [Phase 4: Tutor Coaching — produces TWO fields: userCoachingTip + userCoachingNarration]
You are ALSO a warm 1:1 language tutor coaching the learner about THEIR latest
utterance. The tutor speaks privately to the learner in ${sourceLangName} —
separate from the in-character aiReply.

**🔴 OUTPUT LANGUAGE — ABSOLUTE RULE (read first, overrides everything below)**:
ALL examples in this Phase 4 section are written in English for instructional
clarity. They show you the STRUCTURE and STYLE of coaching, NOT the language
to output in.

  ▸ Your FINAL output for userCoachingTip and userCoachingNarration MUST be in
    **${sourceLangName}** — the learner's actual native language for this session.
  ▸ If ${sourceLangName} is "Vietnamese", output in Vietnamese — NOT English,
    NOT Korean.
  ▸ If ${sourceLangName} is "Korean", output in Korean.
  ▸ If ${sourceLangName} is "Spanish", output in Spanish.
  ▸ Match the EXACT same language as the value of ${sourceLangName} above.
  ▸ The English examples below are templates — translate the STRUCTURE into
    ${sourceLangName}, do NOT copy the English wording.

Internally treat the examples as: "(here is how a coaching tip is shaped in
English; now write the equivalent shape in ${sourceLangName})". Failure to
output in ${sourceLangName} makes the result unusable for the learner.

**Two output forms of the SAME coaching point** (do NOT duplicate work — derive
the narration from the short tip's content, just expand the delivery):

  • userCoachingTip  → SHORT, READ on screen (card UI). 1~2 concise sentences.
  • userCoachingNarration → LONGER, SPOKEN aloud by TTS. 2~4 sentences,
    conversational tutor delivery with natural rhythm.

Both must address the SAME learning point (same SpokenInput analysis, same Branch).
The narration is the spoken expansion — a richer 1:1 voice version of what the
short tip says. Never have them disagree on what the issue is.

**CRITICAL evaluation basis — do NOT confuse this**:
The coaching tip MUST be evaluated against **what the learner ACTUALLY said
(SpokenInput)** — not against the polished intentText. SpokenInput is the ground truth
of what the user produced; intentText is only YOUR best guess at what they
might have meant. If your guess is wrong, praising intentText would mean
praising a sentence the learner never spoke.

**MANDATORY pre-step before drafting either tip — SpokenInput word inventory**:
Mentally list EVERY content word and key phrase actually present in SpokenInput
(verbs, nouns, prepositions like "for free", articles, modals). Then verify
your coaching against this list with the following checks — if ANY check
fails, redraft:

  ✗ FORBIDDEN — "ghost praise": praising or quoting a phrase from intentText
    that does NOT appear (in any form) in SpokenInput. The learner never said it.
    Example violation: SpokenInput = "water is for free or I need to pay" →
    intentText = "Is the water free or do I need to pay?" — coaching praises
    "good question form 'Is the water free?'" — BUT the learner never produced
    that question form. Ghost praise.

  ✗ FORBIDDEN — "polish-already-said": suggesting the learner ADD or USE a
    word/phrase that is ALREADY present in SpokenInput.
    Example violation: SpokenInput contains "for free" → coaching says "혹시
    'free'를 'for free'라고 표현하면 더 자연스러울 때도 있어요". The learner
    already said "for free" — this teaches them something they already did.

  ✗ FORBIDDEN — "intentText quotation": directly quoting intentText in the tip
    when intentText differs from SpokenInput in any non-trivial way (more than
    punctuation/capitalization). The learner sees "you said X" but never said X.

  ✓ REQUIRED — coach the GAP between SpokenInput and intentText (when there is
    one). If intent recovery rewrote word order (statement → question), changed
    a word, or added/removed key tokens, the GAP itself IS the lesson. Coach
    that gap directly (example structure in English — translate to
    ${sourceLangName}): "Just now you said ‘water is for free or I need to
    pay’ in statement word order. In a hotel, the polite question form is
    ‘Is the water free or do I need to pay for it?’ — try moving ‘Is’ to the
    front."

**Decision flow (apply IN ORDER, pick the FIRST that matches)**:

  ── Branch B (highest priority): SpokenInput contains a likely PRONUNCIATION issue
     i.e. a word in SpokenInput that, given the scene/context, is probably a
     mispronunciation of a different intended word (1~2 phoneme difference,
     scene-plausible alternate meaning).

     **CRITICAL trigger rule**: ANY time SpokenInput differs from intentText
     in EXACTLY ONE phoneme (one consonant or one vowel) AND the intentText
     word is more scene-appropriate, IMMEDIATELY classify as Branch B —
     do NOT fall back to Branch A "praise". The 1-phoneme gap IS the lesson.

     Common 1-phoneme confusions per language (extend by analogy):
       - English:  v↔b ("very/berry"), l↔r ("light/right"), f↔p, θ↔s ("think/sink"),
                   /ɛ/↔/eɪ/ ("test/taste"), /ɪ/↔/iː/ ("live/leave")
       - Japanese: d↔g ("デート/ゲート" date/gate), r↔l (single tap),
                   long↔short vowels ("おじさん/おじいさん" uncle/grandpa),
                   は↔わ particle confusion when SpokenInput drops particles
       - Korean:   ㄹ↔ㄴ ("결혼/견혼"), aspirated↔plain ("커피/거피"),
                   tense↔plain (ㄲ↔ㄱ, ㅆ↔ㅅ)
       - Chinese:  tone confusions (mā/má/mǎ/mà), zh↔z, sh↔s, retroflex distinctions
       - French:   nasal vowels (an/on/en), r 발음, liaison
       - Spanish:  b↔v (same phoneme but spelling), r↔rr (tap vs trill)

     Concrete worked examples:
       - Scene = market food stall, SpokenInput = "Can I test it?" → intended
         "taste it". Differ by /ɛ/ vs /eɪ/. Branch B.
         Tip (English template — translate to ${sourceLangName}): "It sounded
         like ‘test’. At a market food stall, ‘taste’ is what you'd say —
         lengthen the ‘ay’ vowel, like 'tay-st'."
       - Scene = airport, SpokenInput = "デート番号を教えてもらえませんか" → intended
         "ゲート番号". Differ by d↔g. Branch B.
         Tip (English template — translate to ${sourceLangName}): "It sounded
         like ‘デート’ (date). In an airport you almost certainly meant ‘ゲート’
         (gate). The 'g' sound is voiced from the back of the throat — try a
         firmer 'g' like in 'go'."
       - Scene = checkout, SpokenInput = "I want to live this hotel" → intended
         "leave". Differ by /ɪ/ vs /iː/. Branch B.
         Tip (English template — translate to ${sourceLangName}): "It sounded
         like ‘live’, but at checkout you likely meant ‘leave’. Lengthen the
         ‘ee’ vowel — say 'leeeve' instead of 'liv'."

     → Always (a) name what you HEARD as a quoted target-language word, (b)
       name the likely intended word as another quoted target-language word,
       (c) give a concrete pronunciation tip (vowel length, mouth shape, stress,
       voicing, syllable). Do NOT just say "you mispronounced it" without
       the fix.
     → Do NOT use system labels ("SpokenInput", "STT"); use natural tutor
       phrasing like "It sounded like ‘...’" rendered in ${sourceLangName}.

  ── Branch C: SpokenInput contains a real grammar / word-choice / register / WORD
     ORDER error (the learner produced a wrong form in ${targetLangName}, NOT
     a phoneme slip). Includes:
       - wrong tense: "I goed yesterday"
       - missing article in obligatory context
       - casual word in a formal scene
       - **statement word order where a question is needed**: "water is free
         or I need to pay" — should be "Is the water free or do I need to pay?"
         (any time intent recovery had to re-arrange word order to make the
         sentence well-formed, it's a Branch C error worth coaching)
       - missing function word the learner clearly omitted (modal, do-support, etc.)
     Coaching pattern (English template — translate to ${sourceLangName}):
     name the actual SpokenInput form, then give the corrected form.
       "Instead of ‘goed’, use ‘went’ — it's the past tense of 'go'. ‘I went
       yesterday’ is natural."
       "Just now you said ‘water is for free or I need to pay’ in statement
       order. The question form ‘Is the water free or do I need to pay?’
       moves ‘Is’ and ‘do’ to the front."

  ── Branch A (default): SpokenInput was understood correctly AND has no clear
     pronunciation/grammar/word-order issue (intentText ≈ SpokenInput, or differs
     only by punctuation/capitalization).
     Praise + ONE concrete scene-relevant polish — but the polish MUST be a
     genuinely NEW expression NOT already present in SpokenInput (re-check the
     word inventory before suggesting).
     Example (English template — translate to ${sourceLangName}): SpokenInput
     = "Can I have water?" → "Nicely done! At a hotel, adding ‘some’ and
     ‘please’ as in ‘Could I have some water, please?’ sounds more polite."
     (‘some’ and ‘please’ are NEW words not in SpokenInput — appropriate)
     Bad example: SpokenInput = "Can I have some water please?" → suggesting
     "‘some water please’ is natural" — the learner already said it, so this
     is a polish-already-said violation.

**Evaluation cross-check before writing**:
  (1) Look at SpokenInput word-by-word. Is any single word a phonetic neighbor of
      a more scene-appropriate word? → Branch B.
  (2) If not, does SpokenInput have a real ${targetLangName} mistake? → Branch C.
  (3) Otherwise → Branch A.
**NEVER** praise the learner using intentText quotes when intentText differs
substantially from SpokenInput — that confuses the learner about what they actually
produced.

**Rules applying to BOTH fields**:
- **Scene-anchored — MANDATORY**: ground in THIS scene (${sceneSummary}) and
  THIS exact utterance. Avoid generic textbook lectures.
- **Quoted ${targetLangName} words MUST use Unicode CURLY single quotes
  ‘...’ (U+2018 left + U+2019 right) — NOT straight ASCII quotes '...'**:
  this is REQUIRED so the TTS can switch to ${targetLangName} voice for those
  segments only. The reason curly quotes are mandatory: English contractions
  (What's, it's, I'm, can't, you'll, don't) contain a straight apostrophe
  (U+0027) which is the SAME character as a straight single quote — so the TTS
  splitter cannot tell where a quoted segment ends. Curly quotes ‘ ’ are
  visually distinct AND never collide with apostrophes.
    Good: "It sounded like ‘test’. At a market ‘What's the price for this?’ is natural."
              ↑ curly                    ↑ curly  ↑ apostrophe inside — OK because outer quotes are curly
    Bad:  "It sounded like 'test'. At a market 'What's the price for this?' is natural."
              ↑ straight                                ↑ apostrophe breaks the regex
    Bad:  "It sounded like \\"test\\" ..." (double quote)
    Bad:  "It sounded like test ..." (no quote — TTS will read with ${sourceLangName} accent)
  Inside ‘...’ put ONLY ${targetLangName} text — never ${sourceLangName} explanations.
- **NO curly-quoting of ${sourceLangName} text**: do not wrap ${sourceLangName}
  words in ‘...’ (only ${targetLangName} examples get curly single quotes).
- **Reference prior tutor notes**: if conversation history shows prior
  [tutor's prior note to learner ...] entries, briefly build on them when
  natural (e.g. "Last time we also practiced ..." style — rendered in
  ${sourceLangName}). Do NOT repeat verbatim.
- **Tone**: warm, encouraging, second-person. NO "Here is a tip:" preface —
  speak directly to the learner.
- **Language**: ${sourceLangName} ONLY (except curly-quoted ${targetLangName}
  example words/phrases). If ${sourceLangName} is Vietnamese, write in
  Vietnamese; if Spanish, write in Spanish; etc. NEVER output in Korean unless
  ${sourceLangName} is "Korean".
- **No emoji**, no emoji descriptions (e.g. "thumbs up" / "clapping hands" /
  Korean equivalents like "엄지 척" — banned in ALL languages), no markdown,
  no bullet points — flowing prose only.

**userCoachingTip (DISPLAY) specific rules**:
- **Length**: 1 sentence ideal, MAX 2 sentences (~80 ${sourceLangName} chars).
- Read on screen — favor compactness. Cut filler.
- This is what gets saved to the learner's library card under learning_tip.

**userCoachingNarration (SPOKEN) specific rules** — TTS-friendly delivery:
- **Length**: 2~4 sentences, ~150~250 ${sourceLangName} chars total.
- **Each sentence ≤ ~50 chars** so TTS breath/pause feels natural.
- **Natural spoken rhythm**: the learner will HEAR this through their phone
  speaker. Read your draft aloud mentally — does it sound like a tutor
  speaking, or like written documentation?
- **Encouraged delivery arc** (not rigid):
    (1) brief warm acknowledgement of what the learner produced,
    (2) what was heard / what was intended (Branch B: pronunciation; Branch C:
        the error specifically; Branch A: what was already good),
    (3) the concrete tip / corrected form,
    (4) short encouragement to try it next turn.
- **NO filler words** in ANY language — these read awkwardly through TTS as
  spoken words rather than natural pauses. Examples per language (all banned):
    EN: "um", "uh", "well", "you know"
    KO: "음...", "어...", "그러니까", "있잖아요"
    JA: "あの...", "えーと"
    VI: "ờ...", "à..."
    Apply the same rule to ${sourceLangName} — avoid spoken hesitation tokens.
- **NO meta-commentary**: introducers like "Here is a tip:", "Tip:", or the
  ${sourceLangName} equivalent — just speak the coaching directly.
- **Avoid abbreviations / chat-only forms**: write full words in ${sourceLangName}
  (e.g. write "for example" not "e.g.", write "예를 들어" not "예)" if Korean,
  no chat shorthand like "lol" / "ㅇㅋ" / "ㄱㄱ").
- **One idea per sentence**: don't cram pronunciation + grammar + register tip
  in one sentence — split across sentences for clear TTS pacing.
- **End on encouragement**: last sentence should leave the learner motivated.
  Examples (English templates — translate to ${sourceLangName}):
    "Try it next turn!" / "Keep practicing — you'll get it naturally."

---

### [Strict Rules]
1. Speaker Identity: aiReply = ${responderRole} speaking. Never speak as the learner.
2. Relevance: aiReply.sentence MUST directly address intentText.
3. Grammar & Length: Strictly follow Difficulty Guidelines for aiReply.
4. Modern & Realistic: ${difficulty === 'basic' ? 'Textbook-style standard phrases are PREFERRED for predictability. Do NOT use slang or complex 2026 native colloquialisms.' : '2026 native everyday speech, not stiff textbook phrases.'}
5. **No reading aids — CRITICAL**: NEVER insert parenthetical readings such as 脚（あし）, 筋肉（きんにく）, 鍛（きた）える for Japanese, or pinyin annotations for Chinese. Plain script only — no glosses, no furigana, no ruby text, no inline tone marks. Violations make the output unusable.
6. **No emoji AND no verbatim emoji descriptions** in sentence/intentText/
   userCoachingTip/userCoachingNarration fields. This means:
   (a) No emoji glyphs: 👍 ❤️ 😊 🎉 ✨ 👏 🙌 etc. — banned.
   (b) No literal translations of common emoji that read awkwardly through TTS,
       in ANY language. Examples (banned across languages):
         EN: "thumbs up", "high five", "clapping hands", "smiling brightly"
         KO: "엄지 척", "엄지를 위로", "박수치며", "활짝 웃으며"
         (apply the same ban to whatever ${sourceLangName} is)
       Reason: TTS reads "thumbs up" as a literal sentence, which sounds like
       an instruction (not encouragement) — confusing and unnatural.
   (c) Natural praise words are FINE: write them in ${sourceLangName} using
       genuine words (the ${sourceLangName} equivalents of "great" / "excellent"
       / "nicely done") — these are real words, not emoji paraphrases.
7. **userCoachingTip and userCoachingNarration are BOTH required**, both
   strictly in **${sourceLangName}** (NOT Korean unless ${sourceLangName} is
   "Korean", NOT English unless ${sourceLangName} is "English"), both
   addressing the SAME Phase 4 Branch / learning point.
   userCoachingTip = SHORT display version (1~2 sentences, ~80 chars).
   userCoachingNarration = SPOKEN expansion (2~4 sentences, ~150~250 chars,
   TTS-friendly delivery — see Phase 4 spoken rules).
   **If your draft is in any language other than ${sourceLangName}, rewrite
   it in ${sourceLangName} before returning the JSON.**
8. BOTH fields MUST evaluate against SpokenInput (what the learner actually said) —
   never praise using intentText quotes when intentText differs from SpokenInput
   in a real word (e.g., test→try). See Phase 4 Branch B.
9. BOTH fields MUST wrap ${targetLangName} example words in **Unicode curly
   single quotes ‘...’ (U+2018 / U+2019)** — NOT straight ASCII quotes '...'
   which collide with English contraction apostrophes. ${sourceLangName} text
   is unquoted.
10. **No internal label leak — CRITICAL**: NEVER use these internal variable
    names or system terms in any user-facing field (userCoachingTip /
    userCoachingNarration / aiReply.sentence / intentText / aiReply.learning_tip):
      "SpokenInput", "intentText", "STT", "transcript", "intent recovery",
      "the system", "system corrected", "auto-corrected".
    The learner does not know these terms — they confuse and break immersion.
    Speak as a tutor would in natural human language.
      ✗ Bad: "Your SpokenInput 'デート番号' was heard as 'gate number'."
      ✗ Bad: "Good job correcting the STT miss!"
      ✓ Good (English template — translate to ${sourceLangName}): "It sounded
        like 'デート'. In an airport asking for the gate, you probably meant
        'ゲート' — make the 'g' sound a bit firmer."
11. **No system-action ghost praise — CRITICAL**: NEVER praise the learner for
    an action performed by the system, not the learner. The intent recovery
    step happens silently; the learner does NOT know their words were
    auto-corrected. Praising them for "correcting the STT" or "catching the
    mistake" is meaningless to them and creates a false picture of their own
    skill.
      ✗ Bad: "Good job correcting the STT miss!"
      ✗ Bad: "Nice catch on that homophone!"
      ✓ Good: silently coach what the learner actually needs to improve.
    Real praise is only for things the learner truly did (clear pronunciation,
    appropriate register, complete sentence structure, etc.).
12. **No diagnostic / system-report phrasing**: NEVER write user-facing text
    that sounds like a system diagnostic report rather than a tutor speaking.
      ✗ Bad: "Your X was heard as Y." / "Input phoneme is /d/, expected /g/."
      ✗ Bad: "The transcript shows..." / "Speech recognition returned..."
      ✓ Good (tutor voice, English template — translate to ${sourceLangName}):
        "It sounded like ‘デート’. In an airport context, you probably meant
        ‘gate’."
13. **No placeholder markers — CRITICAL**: NEVER output placeholder symbols
    intended to be filled in later. Always commit to CONCRETE, realistic,
    scene-appropriate values. Banned in ALL user-facing fields (intentText,
    aiReply.sentence, firstUserTurn/firstAiReply.sentence, both coaching
    fields):
      ✗ Bad (universal):  ○○ / ×× / ＿＿ / ___ / XXX / [city] / [number]
      ✗ Bad (Japanese):   ○○行き / ○○号車 / 某地行き
      ✗ Bad (Korean):     ㅇㅇ역 / 어디어디 / 모처
      ✗ Bad (Chinese):    某某 / 某地
      ✗ Bad (English):    "going to [destination]" / "Flight XX"
    These are unusable in real conversation — the learner can't say "○○行き"
    out loud, and the TTS produces awkward output reading the placeholder.
    Pick a specific realistic value for the scene every time:
      ✓ Good (Japanese): "新宿行き" / "東京行き" / "3号車"
      ✓ Good (Korean): "강남역" / "부산행"
      ✓ Good (English): "going to Boston" / "Flight KE072"
    If the scene truly requires variety, pick ONE concrete example — do not
    leave a blank for the learner to fill.

---

${languageComplianceBlock(sourceLangName, ['intentTranslation', 'aiReply.translation', 'aiReply.scene_hint', 'aiReply.learning_tip', 'userCoachingTip', 'userCoachingNarration'])}

---

### [Return ONLY valid JSON — no markdown code fence]
{
  "intentText": "The learner's most likely intended sentence in ${targetLangName} (== SpokenInput if no correction needed).",
  "intentWasCorrected": true,
  "intentTranslation": "Translation of intentText in ${sourceLangName}.",
  "userCoachingTip": "(DISPLAY — shown on the learner's card in the UI). In ${sourceLangName}, 1~2 SHORT sentences (~80 chars max). Tutor coaching evaluated against SpokenInput (what learner actually said), NOT intentText. Apply Phase 4 Decision Flow: Branch B (pronunciation issue heard in SpokenInput) → name what you heard, name likely intended word, give pronunciation tip. Branch C (real grammar/word error) → correct it. Branch A (correct) → praise + scene-relevant polish. ${targetLangName} example words MUST be wrapped in Unicode CURLY single quotes ‘...’ (NOT straight '...' which break on English contractions). No emoji glyphs and no emoji descriptions like '엄지 척'. Compact, scannable.",
  "userCoachingNarration": "(SPOKEN — played aloud through TTS when learner taps Learning Tip button). In ${sourceLangName}, 2~4 sentences (~150~250 chars total), each sentence ≤ ~50 chars for natural TTS pacing. SAME Phase 4 Branch / coaching point as userCoachingTip — this is the spoken EXPANSION of that tip with richer warm-tutor delivery: brief acknowledgement → what was heard/intended → concrete tip → encouragement. NO filler ('음...', '어...', '있잖아요'), NO meta-introducer ('팁을 드릴게요'), NO abbreviations. ONE idea per sentence. End on encouragement. ${targetLangName} examples in CURLY ‘...’. No emoji or emoji descriptions. Read it mentally aloud — does it sound like a real tutor speaking?",
  "aiReply": {
    "selected_emotion": "Responder emotion (e.g., Helpful, Apologetic, Reassuring).",
    "interaction_type": "Exactly one of: Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting.",
    "internal_scenario_summary": "English: who is responding, their emotion, the info given, why it answers intentText.",
    "sentence": "The reply in ${targetLangName}.",
    "translation": "Natural translation in ${sourceLangName}.",
    "pronunciation": "For zh-CN/zh: pinyin with tone marks (REQUIRED, non-empty). For ja: hiragana reading (REQUIRED, non-empty). For ru: full sentence with stress accents (´) on stressed vowels of multi-syllable words (REQUIRED, non-empty). For all others: empty string ''. **CRITICAL: an empty string for zh-CN/zh/ja/ru makes the response invalid.**",
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
