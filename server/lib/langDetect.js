// ── 언어 감지 공통 로직 (엔드포인트 /api/community/detect + 백필 스크립트 공유) ──
// 프롬프트가 두 곳에서 어긋나면 배지 정확도가 흔들리므로 반드시 단일 출처로 둔다.
// 텍스트의 "실제 언어"를 앱 지원 ISO 코드로 판별. 모호/미지원은 und → null.
const { LANG_NAMES } = require('../config/langGuide');

const DETECT_CODES = Object.keys(LANG_NAMES); // 번역 targetLang과 동일 키셋

function buildDetectPrompt(text) {
    return [
        `You are a language identification engine. Identify the language the TEXT below is WRITTEN IN.`,
        ``,
        `[Decisive script cues — apply FIRST, they override everything else]`,
        `- Contains any Hangul (가–힣) → "ko" (Korean).`,
        `- Contains any Japanese kana, hiragana (ぁ–ゖ) or katakana (ァ–ヶ) → "ja" (Japanese), even if Han/Kanji characters are also present.`,
        `- Han/Chinese characters only, with NO kana and NO Hangul → "zh-CN" (Simplified) or "zh-TW" (Traditional).`,
        ``,
        `[Rules]`,
        `- Judge by the SCRIPT and GRAMMAR, NOT by the topic. Text that is ABOUT a country/person is NOT necessarily written in that country's language (e.g. Japanese text mentioning "韓国"/Korea is still "ja").`,
        `- Respond with the ISO code, chosen EXACTLY from this allowed list: ${DETECT_CODES.join(', ')}.`,
        `- For Portuguese use "pt-BR".`,
        `- Ignore emoji, numbers, URLs and symbols when judging.`,
        `- If the text is too short, ambiguous, only emoji/numbers/symbols, or its language is NOT in the list, respond with "und".`,
        ``,
        `Respond with ONLY one JSON object, no markdown: {"lang":"<code or und>"}`,
        ``,
        `TEXT:`,
        text,
    ].join('\n');
}

// 첫 완결 JSON 객체 추출 (flash-lite 중복 블록 글리치 방어)
function parseFirstJsonObject(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
        else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { if (--depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
    }
    return null;
}

// Gemini 원문 응답 → 유효 앱 코드 or null(und·오탐)
function parseDetected(rawText) {
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch { parsed = parseFirstJsonObject(rawText); }
    const code = parsed && typeof parsed.lang === 'string' ? parsed.lang.trim() : 'und';
    return DETECT_CODES.includes(code) ? code : null;
}

module.exports = { DETECT_CODES, buildDetectPrompt, parseDetected };
