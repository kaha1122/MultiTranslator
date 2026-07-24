// ── Dari's Lounge — 일일 자유 수다방(FFA) 발행 코어 (DECISIONS.md §9) ──────────
// 라운지는 Dari 콘텐츠 중 유일하게 Gemini·TMDB가 필요 없는 결정적(deterministic) 발행:
// 테마명·오늘의 질문·인사는 클라 i18n 고정 로테이션(lounge.theme_*·q_*)이라 서버는
// "오늘 날짜 문서 1개"만 만든다 → 검수 불필요, cron 전자동에 적합(Dari 첫 전자동 에이전트).
// 멱등: doc id = YYYYMMDD(UTC) — 재실행/중복 cron에도 안전.
const { kcultureDb } = require('../config/firebaseKculture');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // Date.getUTCDay() 순서

// date: 'YYYY-MM-DD'(UTC) 또는 미지정 시 오늘(UTC).
async function openDailyLounge(date) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const iso = date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`date 형식 오류: ${iso} (YYYY-MM-DD)`);
    const id = iso.replace(/-/g, '');
    const themeKey = DAY_KEYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

    const ref = kcultureDb.doc(`lounge_threads/${id}`);
    const existing = await ref.get();
    if (existing.exists) {
        console.log(`[Dari/Lounge] 이미 개설됨 → skip: lounge_threads/${id}`);
        return { skipped: true, id, ...existing.data() };
    }
    const doc = { date: iso, themeKey, messageCount: 0, createdAt: new Date() };
    await ref.set(doc);
    console.log(`[Dari/Lounge] 개설: lounge_threads/${id} (theme=${themeKey})`);
    return { id, ...doc };
}

module.exports = { openDailyLounge };
