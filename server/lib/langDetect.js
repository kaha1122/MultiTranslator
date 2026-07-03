// ── 언어 감지 공통 로직 (엔드포인트 /api/community/detect + 백필 스크립트 공유) ──
// 프롬프트가 두 곳에서 어긋나면 배지 정확도가 흔들리므로 반드시 단일 출처로 둔다.
// 텍스트의 "실제 언어"를 앱 지원 ISO 코드로 판별. 모호/미지원은 und → null.
const { LANG_NAMES } = require('../config/langGuide');

const DETECT_CODES = Object.keys(LANG_NAMES); // 번역 targetLang과 동일 키셋

// 언어 판정 스크립트 단서 — 단일 출처(SSOT). detect 엔드포인트와 번역 라우트의 same 판정이 공유해
// 두 곳의 판정이 어긋나지 않도록 한다. (CJK 혼동·"주제≠언어" 오탐 방지의 핵심.)
// 번역 라우트가 자체 부실 판정을 하던 버그(일본어 한줄평을 "이미 한국어"로 오판 → 번역 차단)를
// 여기 단서를 재사용하도록 통합해 해소한다.
const LANG_SCRIPT_CUES = [
    `[Decisive script cues — apply FIRST, they override everything else]`,
    `- Contains any Hangul (가–힣) → "ko" (Korean).`,
    `- Contains any Japanese kana, hiragana (ぁ–ゖ) or katakana (ァ–ヶ) → "ja" (Japanese), even if Han/Kanji characters are also present.`,
    `- Han/Chinese characters only, with NO kana and NO Hangul → "zh-CN" (Simplified) or "zh-TW" (Traditional).`,
    `- Judge by the SCRIPT and GRAMMAR, NOT by the topic. Text that is ABOUT a country/person is NOT necessarily written in that country's language (e.g. Japanese text mentioning "韓国"/Korea is still "ja").`,
].join('\n');

function buildDetectPrompt(text) {
    return [
        `You are a language identification engine. Identify the language the TEXT below is WRITTEN IN.`,
        ``,
        LANG_SCRIPT_CUES,
        ``,
        `[Rules]`,
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

module.exports = { DETECT_CODES, LANG_SCRIPT_CUES, buildDetectPrompt, parseDetected };
