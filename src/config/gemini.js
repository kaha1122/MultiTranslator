/**
 * Gemini API 설정 상수 (클라이언트)
 * 모델 교체 시 GEMINI_MODEL 값만 변경하면 클라이언트 전체에 적용됩니다.
 * 환경변수 VITE_GEMINI_MODEL 로 오버라이드 가능합니다.
 */
export const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini generateContent 엔드포인트 URL 생성
 * @param {string} apiKey
 * @returns {string}
 */
export const geminiUrl = (apiKey) =>
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
