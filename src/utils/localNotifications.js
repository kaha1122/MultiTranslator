// 로컬 알림 설정 저장소 (Phase 2) — 프리퍼런스만 담당
// 스케줄링은 NotificationSettings.jsx에서 플러그인을 직접 호출하여 처리함
// (과거 래퍼 경로에서 hang 현상 발견 후 인라인 패턴으로 전환, 이 파일은 단순화됨)
const STORAGE_KEY_ENABLED = 'pronunfit.localReminder.enabled';
const STORAGE_KEY_HOUR = 'pronunfit.localReminder.hour';
const STORAGE_KEY_MINUTE = 'pronunfit.localReminder.minute';

export function loadReminderPrefs() {
    try {
        // Phase 2: default 시각 20:00 → 12:30 (점심 후 여유 시간대 / Streak 리마인더 톤)
        const enabled = localStorage.getItem(STORAGE_KEY_ENABLED) === 'true';
        const hour = parseInt(localStorage.getItem(STORAGE_KEY_HOUR) ?? '12', 10);
        const minute = parseInt(localStorage.getItem(STORAGE_KEY_MINUTE) ?? '30', 10);
        return {
            enabled,
            hour: isNaN(hour) ? 12 : Math.max(0, Math.min(23, hour)),
            minute: isNaN(minute) ? 30 : Math.max(0, Math.min(59, minute)),
        };
    } catch {
        return { enabled: false, hour: 12, minute: 30 };
    }
}

export function saveReminderPrefs({ enabled, hour, minute }) {
    try {
        localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false');
        localStorage.setItem(STORAGE_KEY_HOUR, String(hour));
        localStorage.setItem(STORAGE_KEY_MINUTE, String(minute));
    } catch {}
}
