/**
 * Gemini API 설정 상수
 * 모델 교체 시 GEMINI_MODEL 값만 변경하면 서버 전체에 적용됩니다.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini generateContent 엔드포인트 URL 생성
 * @param {string} apiKey
 * @returns {string}
 */
const geminiUrl = (apiKey) =>
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

module.exports = { GEMINI_MODEL, GEMINI_API_BASE, geminiUrl };
