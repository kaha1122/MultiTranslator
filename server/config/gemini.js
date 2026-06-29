/**
 * Gemini API 설정 상수
 *
 * 2026-05-22 — Flash-Lite 503 outage 대응:
 *   PRIMARY_MODEL 1~3회 retry 후 fail 시 FALLBACK_MODEL 1회 escalate.
 *
 * 2026-06-29 — FALLBACK_MODEL 기본값을 'gemini-2.5-flash'(비용 ~5x) → 'gemini-3.1-flash-lite' 로 변경.
 *   3.1-flash-lite 는 2.5-flash-lite 와 동급 가격대의 신형 lite 모델로, 2.5-flash-lite outage 시
 *   비용 부담 없이 escalate 가능. 평소 ~1x, outage 시에도 ~1x 유지(기존 5x 대비 대폭 절감).
 *   Render env GEMINI_FALLBACK_MODEL_ID 로 언제든 오버라이드(예: 비상 시 'gemini-2.5-flash').
 *
 * 2026-05-22 — 운영자 토글 GEMINI_MODE (Render env 로 즉시 변경 가능):
 *   'auto'  (기본) : Flash-Lite(2.5) 3회 + FALLBACK escalate   ← 평소 운영
 *   'fast'         : Flash-Lite(2.5) 1회만 + 즉시 FALLBACK       ← 2.5 불안정 + 빠른 응답
 *   'flash'        : FALLBACK 만 사용 (2.5 Flash-Lite 건너뜀)   ← 완전 outage 시 비상
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ID || 'gemini-3.1-flash-lite';
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
