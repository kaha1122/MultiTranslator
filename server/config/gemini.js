/**
 * Gemini API 설정 상수
 * 모델 교체 시 GEMINI_MODEL 값만 변경하면 서버 전체에 적용됩니다.
 *
 * 2026-05-22 — Flash-Lite 503 outage 대응:
 *   PRIMARY_MODEL 1~3회 retry 후 fail 시 FALLBACK_MODEL 1회 escalate.
 *   평소 비용 ~1x (Flash-Lite), outage 시에만 ~5x (Flash) 일부 호출.
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ID || 'gemini-2.5-flash';
const GEMINI_MODEL = PRIMARY_MODEL;  // backward compat
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini generateContent 엔드포인트 URL 생성
 * @param {string} apiKey
 * @param {string} [model] — 명시하지 않으면 PRIMARY_MODEL 사용
 * @returns {string}
 */
const geminiUrl = (apiKey, model) =>
    `${GEMINI_API_BASE}/${model || PRIMARY_MODEL}:generateContent?key=${apiKey}`;

module.exports = { GEMINI_MODEL, PRIMARY_MODEL, FALLBACK_MODEL, GEMINI_API_BASE, geminiUrl };
