const express = require('express');
const axios = require('axios');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { geminiUrl } = require('../config/gemini');

const { LANG_NAMES, LANG_SPECIFIC_GUIDE, getDifficultyDesc } = require('../config/langGuide');
const { stripAnnotations } = require('../utils/stripAnnotations');
// scene.js에서 기존 LANG_NAMES_FOR_SCENE → LANG_NAMES로 통일
const LANG_NAMES_FOR_SCENE = LANG_NAMES;

// ── 어투별 상세 가이드라인 ────────────────────────────────────────────────────
const STYLE_DESC = {
    casual: `Casual (Informal)
  - Focus on **Natural Fluency**. Use the language's common everyday forms, contractions, and relaxed sentence endings.
  - Reflect the chosen emotion **openly and directly** as if speaking to a close friend or peer.`,
    formal: `Formal (Polite)
  - Focus on **Social Distance & Respect**. Use standard grammatical structures and appropriate honorifics/polite forms.
  - Reflect the chosen emotion **gracefully and indirectly**. Ensure the tone remains professional or respectful toward strangers or service staff.`,
};

router.post('/api/scene-sentence', optionalAuth, async (req, res) => {
    const { scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey, avoidSentences } = req.body;
    if (!scene || !targetLang) {
        return res.status(400).json({ error: 'Missing scene or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc = getDifficultyDesc(difficulty, targetLang);
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    let avoidBlock = '';
    if (avoidSentences && avoidSentences.length > 0) {
        const recent = avoidSentences.slice(-10);
        const olderCount = avoidSentences.length - recent.length;
        avoidBlock = `\n### [Previous Sentences — STRICT EXCLUSION]
The learner has already practiced ${avoidSentences.length} sentences. Do NOT reuse the same core verb, topic, or sentence structure as ANY of them.
${olderCount > 0 ? `(${olderCount} older sentences omitted for brevity)\n` : ''}Recent sentences to explicitly avoid:
${recent.map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n`;
    }

    const prompt = `### [Role]
You are a highly creative Language Learning Content Architect. Your mission is to generate a realistic sentence (Question, Statement, or Request) that a learner uses to **INITIATE** a conversation in a specific micro-situation.

---

### [Phase 1: AI-Driven Scenario & Emotion Design]
The learner's level is **${difficulty || 'basic'}**. Design the scenario complexity accordingly:
- **Basic**: Pick from simpler emotions (Grateful, Curious, Excited, Relieved, Surprised). Design predictable, routine situations (e.g., checking in, ordering food, asking for directions). Prefer action types: Greeting, Inquiry, Request, Social.
- **Intermediate**: Use the full emotion range. Introduce mild complications or unexpected elements (e.g., a reservation mix-up, a schedule change). All action types are available.
- **Advanced**: Favor nuanced emotions (Hesitant, Frustrated, Dissatisfied, Apologetic, Nervous). Design layered situations with social tension, negotiation, or cultural sensitivity (e.g., disputing a charge diplomatically, navigating an awkward misunderstanding). Prefer action types: Problem, Complaint, Opinion, Observation.

Then:
1. **Select an Emotion**: Choose ONE emotion for "${scene}" from: Grateful, Frustrated, Confused, Excited, Hesitant, Urgent, Curious, Dissatisfied, Relieved, Apologetic, Surprised, Nervous. **Vary your choice each time**, respecting the level guideline above.
2. **Design the Micro-Situation**: Create a specific, realistic moment for "${scene}" matched to the ${difficulty || 'basic'} level guidelines above. Avoid generic scenarios like "Where is the restroom?" — instead think of compelling, scene-specific moments.
3. **Choose an Action Type** (exactly one of these 8), respecting the level preference above:
   - **Inquiry**: Asking a question to get information.
   - **Request**: Asking someone to do something for you.
   - **Observation**: Commenting on or describing the situation.
   - **Opinion**: Sharing a personal thought or judgment.
   - **Problem**: Reporting or explaining an issue.
   - **Complaint**: Expressing dissatisfaction about something.
   - **Social**: Making small talk or casual conversation.
   - **Greeting**: Opening with a polite or friendly remark.

---

### [Phase 2: Difficulty Guidelines]
${diffDesc}

---

### [Phase 3: Speech Style & Politeness]
${styleDesc}
- **Emotion Integration**: Let the chosen emotion naturally color the tone. If 'Urgent', the phrasing should feel pressing. If 'Hesitant', use softer openers. If 'Frustrated', let mild impatience show through word choice.

---

### [Input Variables]
- Scene: ${scene}
- Target Language: ${targetLangName}
- Learner's Native Language: ${sourceLangName}
${avoidBlock}
---

### [Strict Rules]
1. **Proactive Initiation**: The learner is always the one speaking FIRST. No passive "Yes/No" answers.
2. **Scenario Alignment**: Generate the most suitable sentence based on the scenario and emotion selected in Phase 1.
3. **AI Emotion Choice**: You must pick a varied emotion that fits the scene to ensure diversity.
4. **Anti-Duplication**: Do NOT use the same core verb, topic, or sentence structure as any Previous Sentence.
5. **Modern & Realistic**: Reflect 2026 native speech, not stiff textbook phrases.
6. **Grammar & Length**: Strictly adhere to the Difficulty Guidelines above.
7. **No reading aids — CRITICAL**: NEVER insert parenthetical readings such as 脚（あし）, 筋肉（きんにく）, 鍛（きた）える for Japanese, or pinyin annotations for Chinese. Write the sentence exactly as a native would type it in a text message — plain script only, no glosses, no furigana, no ruby text, no tone marks. Violations of this rule make the output unusable.

---

### [Return ONLY valid JSON (no markdown)]
{
  "selected_emotion": "The emotion you chose (e.g., Frustrated, Curious, Hesitant).",
  "interaction_type": "The action type you chose: exactly one of 'Inquiry', 'Request', 'Observation', 'Opinion', 'Problem', 'Complaint', 'Social', or 'Greeting'.",
  "internal_scenario_summary": "English description of the chosen emotion, action type, and the specific micro-situation.",
  "sentence": "The generated opening sentence in ${targetLangName}.",
  "translation": "Natural translation in ${sourceLangName}.",
  "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading. For ru: the full sentence rewritten with accent marks (´) on the stressed vowel of each multi-syllable word. ACCURACY IS CRITICAL — place the accent on the EXACT stressed vowel per standard Russian dictionary pronunciation. Words with ё (always stressed) and single-syllable words (в, на, он, да, где) need no accent. Example: 'Извини́те, где нахо́дится метро́?' — NOT 'Извинúте' or 'нахóдится'. For all others: empty string ''.",
  "scene_hint": "In ${sourceLangName}: a vivid description of the micro-situation WITHOUT emotion tags (e.g., '비행기가 너무 추워서 담요를 요청하려는 상황').",
  "learning_tip": "In ${sourceLangName}: a vocabulary, grammar, or pronunciation tip. Explain how the chosen emotion and ${styleDesc.split('\\n')[0].trim()} style shape this expression."
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
        parsed.sentence = stripAnnotations(parsed.sentence, targetLang);
        res.json(parsed);
    } catch (e) {
        console.error('[SceneSentence] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate sentence' });
    }
});

router.post('/api/scene-answer', requireAuth, async (req, res) => {
    const { question, scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey, avoidSentences } = req.body;
    if (!question || !targetLang) {
        return res.status(400).json({ error: 'Missing initiation sentence or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc = getDifficultyDesc(difficulty, targetLang);
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    let avoidBlock = '';
    if (avoidSentences && avoidSentences.length > 0) {
        const recent = avoidSentences.slice(-10);
        const olderCount = avoidSentences.length - recent.length;
        avoidBlock = `\n### [Previous Reply Sentences — STRICT EXCLUSION]
The learner has already practiced ${avoidSentences.length} reply sentences. Do NOT reuse the same core verb, topic, or sentence structure as ANY of them.
${olderCount > 0 ? `(${olderCount} older sentences omitted for brevity)\n` : ''}Recent replies to explicitly avoid:
${recent.map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n`;
    }

    const prompt = `### [Role]
You are a highly creative Language Learning Content Architect. The learner just practiced saying an opening sentence (a question, statement, request, or observation). Now generate the most natural, context-appropriate RESPONSE that the other person would give.

---

### [Phase 1: Response Situation Design]
The learner said: "${question}" in the scene "${scene}".
- **Identify the Initiation Type**: Is the learner asking a question? Making a complaint? Sharing an observation? Greeting someone? Your response must match the type.
- **Choose a Response Action Type** (exactly one of these 8):
   - **Inquiry**: Asking a follow-up question.
   - **Request**: Asking the learner to do something.
   - **Observation**: Commenting on or describing the situation.
   - **Opinion**: Sharing a personal thought or judgment.
   - **Problem**: Pointing out an issue or limitation.
   - **Complaint**: Expressing dissatisfaction.
   - **Social**: Making small talk or casual conversation.
   - **Greeting**: Responding with a polite or friendly remark.
- **Think about WHO is responding**: a waiter? a flight attendant? a friend? a receptionist? a stranger? The response must match that person's role, knowledge, and emotional tone.
- **Select a Response Emotion**: Choose an appropriate emotion for the responder (e.g., Helpful, Sympathetic, Apologetic, Cheerful, Professional, Reassuring, Surprised). This should naturally complement the learner's tone.
- **Be Specific & Informative**: Don't give a generic "Sure!" or "Yes, of course." — give a response that contains USEFUL INFORMATION (directions, explanations, alternatives, empathy, confirmations with details).
- **Stay in Character**: The responding person should sound authentic to their role in this scene.

---

### [Phase 2: Difficulty Guidelines — Apply to the RESPONSE]
${diffDesc}

---

### [Phase 3: Speech Style & Politeness — Apply to the RESPONSE]
The response should match the same register as the learner's initiation:
${styleDesc}
- **Emotion Integration**: Let the responder's emotion naturally shape the tone. A Helpful flight attendant sounds different from an Apologetic waiter.

---

### [Input Variables]
- Scene: ${scene}
- Learner's initiation sentence: "${question}"
- Target Language: ${targetLangName}
- Learner's Native Language: ${sourceLangName}
${avoidBlock}
---

### [Strict Rules]
1. **Speaker Identity**: The OTHER PERSON is speaking — NOT the learner. This is the response to the learner's initiation.
2. **Relevance**: The response must DIRECTLY address the learner's sentence. If it was a question, answer it. If a complaint, acknowledge it. If a greeting, respond warmly.
3. **Grammar & Length**: Strictly adhere to the Difficulty Guidelines above.
4. **Anti-Duplication**: Do NOT reuse the same core verb, topic, or sentence structure as any Previous Reply Sentence.
5. **Modern & Realistic**: Reflect 2026 native speech, not stiff textbook phrases.
6. **Informative**: Include useful details — a location, a time, a price, a suggestion, empathy — not just "yes" or "no".
7. **No reading aids — CRITICAL**: NEVER insert parenthetical readings such as 脚（あし）, 筋肉（きんにく）, 鍛（きた）える for Japanese, or pinyin annotations for Chinese. Write the sentence exactly as a native would type it in a text message — plain script only, no glosses, no furigana, no ruby text, no tone marks. Violations of this rule make the output unusable.
---

### [Return ONLY valid JSON (no markdown)]
{
  "selected_emotion": "The responder's emotion (e.g., Helpful, Apologetic, Reassuring).",
  "interaction_type": "The action type you chose: exactly one of 'Inquiry', 'Request', 'Observation', 'Opinion', 'Problem', 'Complaint', 'Social', or 'Greeting'.",
  "internal_scenario_summary": "English description: who is responding, their emotion, what information they are giving, and why this is a natural response.",
  "sentence": "The generated response in ${targetLangName}.",
  "translation": "Natural translation in ${sourceLangName}.",
  "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading. For ru: the full sentence rewritten with accent marks (´) on the stressed vowel of each multi-syllable word. ACCURACY IS CRITICAL — place the accent on the EXACT stressed vowel per standard Russian dictionary pronunciation. Words with ё (always stressed) and single-syllable words (в, на, он, да, где) need no accent. Example: 'Извини́те, где нахо́дится метро́?' — NOT 'Извинúте' or 'нахóдится'. For all others: empty string ''.",
  "scene_hint": "In ${sourceLangName}: describe who is speaking (role) and what they are telling the learner, WITHOUT emotion tags (e.g., '승무원이 담요를 가져다주겠다고 안내하는 상황').",
  "learning_tip": "In ${sourceLangName}: a vocabulary, grammar, or expression tip from this response. Explain how the responder's emotion and role shape this expression."
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
        parsed.sentence = stripAnnotations(parsed.sentence, targetLang);
        res.json(parsed);
    } catch (e) {
        console.error('[SceneAnswer] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate answer' });
    }
});

module.exports = router;
