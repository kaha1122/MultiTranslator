// Streak 리마인더 메시지 풀 — streakCurrent 기반 구간 + 요일 rotate
// 클라이언트 LocalNotifications에서 매일 12:30 발화. 같은 구간 안에서도 본문 2개를
// 요일 mod 2로 rotate하여 fatigue 감소 (Phase 2 옵션 B).

const BUCKETS = [
    { max: 0,   key: 'start' },   // 0일: 시작 안내
    { max: 2,   key: 'early' },   // 1~2일: 막 시작
    { max: 6,   key: 'forming' }, // 3~6일: 흐름 형성
    { max: 13,  key: 'week1' },   // 7~13일: 1주 돌파
    { max: 29,  key: 'week2' },   // 14~29일: 2주 넘김
    { max: 99,  key: 'month' },   // 30~99일: 한 달 습관
];
// 100+ → 'legend'

export function pickBucket(streakCurrent) {
    const n = Math.max(0, Math.floor(streakCurrent || 0));
    for (const b of BUCKETS) {
        if (n <= b.max) return b.key;
    }
    return 'legend';
}

// streakCurrent + sourceLang → { title, body } 로컬 리마인더 메시지 1쌍 반환.
// getT: (lang, key) => string — utils/i18n.js의 getT 그대로 받음.
// 본문은 요일 mod 2 rotate (월/수/금/일 vs 화/목/토).
export function pickReminderMessage({ streakCurrent, sourceLang, getT }) {
    const bucket = pickBucket(streakCurrent);
    const variantIdx = new Date().getDay() % 2; // 0 or 1
    const n = Math.max(0, Math.floor(streakCurrent || 0));

    const titleKey = `streak.reminder.${bucket}Title`;
    const bodyKey = `streak.reminder.${bucket}Body${variantIdx}`;

    const rawTitle = getT(sourceLang, titleKey) || '';
    const rawBody = getT(sourceLang, bodyKey) || '';

    return {
        title: rawTitle.replace(/\{n\}/g, String(n)),
        body: rawBody.replace(/\{n\}/g, String(n)),
        bucket,
    };
}

