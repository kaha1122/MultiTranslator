/**
 * Gemini API 설정 상수
 *
 * 2026-05-22 — Flash-Lite 503 outage 대응:
 *   PRIMARY_MODEL 1~3회 retry 후 fail 시 FALLBACK_MODEL 1회 escalate.
 *   평소 비용 ~1x (Flash-Lite), outage 시에만 ~5x (Flash) 일부 호출.
 *
 * 2026-05-22 — 운영자 토글 GEMINI_MODE (Render env 로 즉시 변경 가능):
 *   'auto'  (기본) : Flash-Lite 3회 + Flash fallback   ← 평소 운영
 *   'fast'         : Flash-Lite 1회만 + 즉시 Flash       ← Flash-Lite 불안정 + 빠른 응답
 *   'flash'        : Flash 만 사용 (Flash-Lite 건너뜀)  ← 완전 outage 시 비상
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ID || 'gemini-2.5-flash';
const GEMINI_MODEL = PRIMARY_MODEL;  // backward compat

const RAW_MODE = (process.env.GEMINI_MODE || 'auto').toLowerCase();
const ALLOWED_MODES = ['auto', 'fast', 'flash'];
const GEMINI_MODE = ALLOWED_MODES.includes(RAW_MODE) ? RAW_MODE : 'auto';

// 시작 시 한 번 운영 모드 출력 — auto 가 아니면 warn 으로 강조 (운영자가 토글 사실 인지)
if (GEMINI_MODE !== 'auto') {
    console.warn(`[Gemini] ⚠️  Override mode active: GEMINI_MODE=${GEMINI_MODE} (primary=${PRIMARY_MODEL}, fallback=${FALLBACK_MODEL})`);
} else {
    console.log(`[Gemini] mode=auto (primary=${PRIMARY_MODEL} → fallback=${FALLBACK_MODEL})`);
}
if (RAW_MODE !== GEMINI_MODE) {
    console.warn(`[Gemini] Unknown GEMINI_MODE='${RAW_MODE}' — fell back to 'auto'. Allowed: ${ALLOWED_MODES.join('/')}`);
}

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini generateContent 엔드포인트 URL 생성
 * @param {string} apiKey
 * @param {string} [model] — 명시하지 않으면 PRIMARY_MODEL 사용
 * @returns {string}
 */
const geminiUrl = (apiKey, model) =>
    `${GEMINI_API_BASE}/${model || PRIMARY_MODEL}:generateContent?key=${apiKey}`;

module.exports = { GEMINI_MODEL, PRIMARY_MODEL, FALLBACK_MODEL, GEMINI_MODE, GEMINI_API_BASE, geminiUrl };
