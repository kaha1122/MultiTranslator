import React, { useState, useEffect, useRef } from 'react';
import { Bell, Clock } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { getT } from '../utils/i18n';
import { loadReminderPrefs, saveReminderPrefs } from '../utils/localNotifications';
import {
    loadSubscriptionAlertPref,
    setSubscriptionAlertPref,
} from '../utils/pushNotifications';
import { useFeatureSeen } from '../utils/featureSeen';

const REMINDER_ID = 1001;
const STATUS_AUTO_DISMISS_MS = 3000;

// Phase 1+2 통합 설정 패널
// - 로컬 매일 연습 리마인더 (Phase 2) — 플러그인 직접 호출로 통합
// - 구독 이벤트 푸시 (Phase 1)
// 웹 환경에서는 "네이티브 앱 필요" 안내만 표시
export default function NotificationSettings({ sourceLang, uid, profile, active }) {
    const t = (key) => getT(sourceLang, key);
    const isNative = Capacitor.isNativePlatform?.() === true;

    const [reminder, setReminder] = useState(() => loadReminderPrefs());
    const [subAlert, setSubAlert] = useState(() => loadSubscriptionAlertPref());
    const [prePrompt, setPrePrompt] = useState(null); // 'local' | 'push' | null
    const [status, setStatus] = useState('');
    const [needsSystemSettings, setNeedsSystemSettings] = useState(false);
    const statusTimerRef = useRef(null);

    // 신규 기능 "NEW" 뱃지 + 자동 스크롤
    const { seen, markSeen } = useFeatureSeen(uid, 'notifications', profile);
    const sectionRef = useRef(null);
    const autoScrolledRef = useRef(false);

    // 성공 메시지는 3초 뒤 자동 소거, 에러는 계속 유지
    const showStatus = (msg, { isError = false } = {}) => {
        if (statusTimerRef.current) { clearTimeout(statusTimerRef.current); statusTimerRef.current = null; }
        setStatus(msg);
        setNeedsSystemSettings(isError);
        if (!isError) {
            statusTimerRef.current = setTimeout(() => setStatus(''), STATUS_AUTO_DISMISS_MS);
        }
    };

    // "매일 HH:MM에 알림을 보냅니다" 포맷 — i18n에 {time} placeholder 치환
    const formatReminderOnAt = (hour, minute) => {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const tpl = t('notifications.reminderOnAt') || '⏰ Daily reminder set for {time}.';
        return tpl.replace('{time}', timeStr);
    };

    const openSystemSettings = () => {
        const msg = Capacitor.getPlatform() === 'android'
            ? (t('notifications.openSettingsManual') || '휴대폰 설정 → 앱 → PronunFit → 알림 에서 활성화해 주세요.')
            : (t('notifications.openSettingsManual') || 'Go to Settings → PronunFit → Notifications');
        showStatus(msg, { isError: true });
    };

    // 설정 화면 진입 + 미확인 시 이 섹션으로 부드럽게 스크롤 (1회만)
    // VocabTab 패턴 참조: scrollIntoView는 중첩 스크롤 컨테이너 + Android WebView에서 불안정
    // → .app-container (실제 scroll host)를 직접 찾아서 scrollTop 계산
    // → sticky .app-header 높이 빼서 알림 섹션이 헤더 뒤에 가려지지 않도록
    // → 레이아웃 완료 대기를 위한 retry 로직 (display:none→block 직후 height=0 케이스 방어)
    useEffect(() => {
        if (!active || seen || autoScrolledRef.current) return;
        autoScrolledRef.current = true;

        const tryScroll = (attempt = 0) => {
            const target = sectionRef.current;
            if (!target) return;
            const container = target.closest('.app-container');
            if (!container) {
                // 컨테이너 못 찾으면 fallback
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            const targetRect = target.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            // 레이아웃 아직 안 잡혔으면 (height 0) 재시도 (최대 5회, 100ms 간격)
            if (targetRect.height === 0 && attempt < 5) {
                setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            const header = document.querySelector('.app-header');
            const headerHeight = header?.getBoundingClientRect().height ?? 140;
            // container.scrollTop + (target 상대 offset) - sticky 헤더 높이 - 12px 여유
            const newTop = container.scrollTop
                + (targetRect.top - containerRect.top)
                - headerHeight
                - 12;
            container.scrollTo({ top: Math.max(0, newTop), behavior: 'smooth' });
        };

        requestAnimationFrame(() => {
            setTimeout(() => tryScroll(0), 150);
        });
    }, [active, seen]);

    useEffect(() => { setReminder(loadReminderPrefs()); }, []);

    useEffect(() => () => {
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    }, []);

    // 로컬 리마인더 토글
    const handleReminderToggle = async (next) => {
        markSeen();
        if (!isNative) {
            showStatus(t('notifications.webOnly') || 'Notifications require the mobile app.', { isError: true });
            return;
        }
        if (next) {
            setPrePrompt('local');
            return;
        }
        // OFF
        const updated = { ...reminder, enabled: false };
        setReminder(updated);
        saveReminderPrefs(updated);
        try {
            const mod = await import('@capacitor/local-notifications');
            await mod.LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
        } catch {}
        showStatus(t('notifications.reminderOff') || 'Daily reminder turned off.');
    };

    // v1.4.34 전면 리팩토링: 래퍼 우회하고 플러그인 직접 호출 (모달 경로 hang 회피)
    const confirmLocalPermission = async () => {
        setPrePrompt(null);
        setNeedsSystemSettings(false);
        setStatus('');
        try {
            if (!Capacitor.isNativePlatform()) {
                showStatus(t('notifications.webOnly') || 'Notifications require the mobile app.', { isError: true });
                return;
            }
            const mod = await import('@capacitor/local-notifications');
            const plugin = mod.LocalNotifications;

            let perm = await plugin.checkPermissions();
            if (perm.display !== 'granted') {
                if (perm.display === 'denied') {
                    showStatus(
                        t('notifications.permissionDeniedPersistent') || '시스템 설정에서 알림을 수동으로 허용해 주세요.',
                        { isError: true }
                    );
                    return;
                }
                const result = await plugin.requestPermissions();
                if (result.display !== 'granted') {
                    showStatus(
                        `${t('notifications.permissionDenied') || 'Permission denied.'} [${result.display}]`,
                        { isError: true }
                    );
                    return;
                }
            }

            const updated = { ...reminder, enabled: true };
            setReminder(updated);
            saveReminderPrefs(updated);

            try {
                await plugin.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
                await plugin.schedule({
                    notifications: [{
                        id: REMINDER_ID,
                        title: t('notifications.reminderTitle') || 'Time to practice!',
                        body: t('notifications.reminderBody') || "Keep your streak alive — just a few minutes today.",
                        schedule: {
                            on: { hour: updated.hour, minute: updated.minute },
                            allowWhileIdle: true,
                            repeats: true,
                        },
                        smallIcon: 'ic_stat_icon_config_sample',
                    }],
                });
                showStatus(formatReminderOnAt(updated.hour, updated.minute));

                // Android 13+: POST_NOTIFICATIONS는 로컬/푸시 공유 권한 — 이 시점에 FCM도 자동 등록
                // (구독 알림 기본 ON이지만 UI 트리거 없이 토큰이 안 저장되는 갭 해결)
                // iOS는 로컬/푸시 권한이 분리되어 있어 별도 다이얼로그 발생 → Android 한정
                if (Capacitor.getPlatform() === 'android') {
                    try {
                        const pushMod = await import('@capacitor/push-notifications');
                        await pushMod.PushNotifications.register();
                    } catch (e) {
                        console.warn('[Push] auto-register after local grant failed:', e?.message);
                    }
                }
            } catch (schedErr) {
                setReminder({ ...reminder, enabled: false });
                saveReminderPrefs({ ...reminder, enabled: false });
                showStatus(
                    `${t('notifications.scheduleFailed') || 'Failed to schedule.'} [${schedErr?.message}]`,
                    { isError: true }
                );
            }
        } catch (e) {
            showStatus(`${t('notifications.scheduleFailed') || 'Failed to schedule.'} [${e?.message || String(e)}]`, { isError: true });
        }
    };

    // 시간 변경 시 즉시 재스케줄
    const handleTimeChange = async (hour, minute) => {
        const updated = { ...reminder, hour, minute };
        setReminder(updated);
        saveReminderPrefs(updated);
        if (!updated.enabled || !isNative) return;
        try {
            const mod = await import('@capacitor/local-notifications');
            const plugin = mod.LocalNotifications;
            await plugin.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
            await plugin.schedule({
                notifications: [{
                    id: REMINDER_ID,
                    title: t('notifications.reminderTitle') || 'Time to practice!',
                    body: t('notifications.reminderBody') || "Keep your streak alive — just a few minutes today.",
                    schedule: {
                        on: { hour, minute },
                        allowWhileIdle: true,
                        repeats: true,
                    },
                    smallIcon: 'ic_stat_icon_config_sample',
                }],
            });
            showStatus(formatReminderOnAt(hour, minute));
        } catch (e) {
            showStatus(
                `${t('notifications.scheduleFailed') || 'Failed to schedule.'} [${e?.message}]`,
                { isError: true }
            );
        }
    };

    // 구독 알림 토글
    const handleSubAlertToggle = async (next) => {
        markSeen();
        if (!isNative) {
            showStatus(t('notifications.webOnly') || 'Notifications require the mobile app.', { isError: true });
            return;
        }
        if (next) { setPrePrompt('push'); return; }
        setSubAlert(false);
        await setSubscriptionAlertPref(uid, false);
        showStatus(t('notifications.subAlertOff') || 'Subscription alerts turned off.');
    };

    // v1.4.37: 래퍼 우회, 플러그인 직접 호출 (로컬 알림과 동일한 패턴)
    const confirmPushPermission = async () => {
        setPrePrompt(null);
        setNeedsSystemSettings(false);
        setStatus('');
        try {
            if (!Capacitor.isNativePlatform()) {
                showStatus(t('notifications.webOnly') || 'Notifications require the mobile app.', { isError: true });
                return;
            }
            const mod = await import('@capacitor/push-notifications');
            const plugin = mod.PushNotifications;

            let perm = await plugin.checkPermissions();
            if (perm.receive !== 'granted') {
                if (perm.receive === 'denied') {
                    showStatus(
                        t('notifications.permissionDeniedPersistent') || '시스템 설정에서 알림을 수동으로 허용해 주세요.',
                        { isError: true }
                    );
                    return;
                }
                const result = await plugin.requestPermissions();
                if (result.receive !== 'granted') {
                    showStatus(
                        `${t('notifications.permissionDenied') || 'Permission denied.'} [${result.receive}]`,
                        { isError: true }
                    );
                    return;
                }
            }

            // 리스너는 App.jsx mount에서 이미 등록됨 — register()만 호출
            await plugin.register();
            setSubAlert(true);
            await setSubscriptionAlertPref(uid, true);
            showStatus(t('notifications.subAlertOn') || 'Subscription alerts enabled.');
        } catch (e) {
            showStatus(
                `${t('notifications.permissionDenied') || 'Permission denied.'} [${e?.message || String(e)}]`,
                { isError: true }
            );
        }
    };

    return (
        <div className="settings-group" ref={sectionRef}>
            <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bell size={16} /> {t('notifications.sectionTitle') || 'Notifications'}
                {!seen && (
                    <span className="feature-new-badge" aria-label="New feature">
                        {t('common.newBadge') || 'NEW'}
                    </span>
                )}
            </label>

            {!isNative && (
                <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '8px' }}>
                    {t('notifications.webOnly') || 'Notifications require the mobile app.'}
                </p>
            )}

            {/* 카드들을 flex column + gap 4px로 묶어 간격 일정하게 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {/* 매일 연습 리마인더 (로컬) */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#f8fafc', borderRadius: '12px', padding: '10px 14px',
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                            <Clock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                            {t('notifications.dailyReminder') || 'Daily Practice Reminder'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                            {t('notifications.dailyReminderDesc') || 'Get a gentle nudge to practice every day.'}
                        </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={reminder.enabled && isNative}
                            disabled={!isNative}
                            onChange={(e) => handleReminderToggle(e.target.checked)}
                            style={{ width: 18, height: 18, cursor: isNative ? 'pointer' : 'not-allowed' }}
                        />
                    </label>
                </div>

                {reminder.enabled && isNative && (
                    <div style={{
                        background: '#f8fafc', borderRadius: '12px', padding: '8px 14px',
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            {t('notifications.reminderTime') || 'Time'}:
                        </span>
                        <input
                            type="time"
                            value={`${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}`}
                            onChange={(e) => {
                                const [h, m] = e.target.value.split(':').map(Number);
                                handleTimeChange(h, m);
                            }}
                            style={{
                                padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                fontSize: '0.9rem',
                            }}
                        />
                    </div>
                )}

                {/* 구독 이벤트 푸시 (FCM) */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#f8fafc', borderRadius: '12px', padding: '10px 14px',
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                            {t('notifications.subAlerts') || 'Subscription Alerts'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                            {t('notifications.subAlertsDesc') || 'Payment issues, renewals, and expirations.'}
                        </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            // Option B: 실제 FCM 토큰이 있을 때만 "켜짐"으로 표시 (체크박스 = 진짜 상태)
                            checked={subAlert && isNative && Array.isArray(profile?.fcmTokens) && profile.fcmTokens.length > 0}
                            disabled={!isNative}
                            onChange={(e) => handleSubAlertToggle(e.target.checked)}
                            style={{ width: 18, height: 18, cursor: isNative ? 'pointer' : 'not-allowed' }}
                        />
                    </label>
                </div>
            </div>

            {status && (
                <div style={{
                    marginTop: 10, padding: '10px 12px', borderRadius: 10,
                    background: needsSystemSettings ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${needsSystemSettings ? '#fecaca' : '#bbf7d0'}`,
                    transition: 'opacity 0.3s',
                }}>
                    <p style={{
                        fontSize: '0.82rem',
                        color: needsSystemSettings ? '#991b1b' : '#065f46',
                        margin: 0, lineHeight: 1.5,
                    }}>
                        {status}
                    </p>
                    {needsSystemSettings && (
                        <button
                            onClick={openSystemSettings}
                            style={{
                                marginTop: 8, padding: '8px 14px', borderRadius: 8,
                                border: 'none', background: '#dc2626', color: 'white',
                                fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                            }}
                        >
                            📱 {t('notifications.openSettingsBtn') || '시스템 설정 열기 방법 보기'}
                        </button>
                    )}
                </div>
            )}

            {/* Pre-prompt 모달 — Apple 심사 안전 패턴 */}
            {prePrompt && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 10000, padding: '20px',
                }}>
                    <div style={{
                        background: 'white', borderRadius: '16px', padding: '24px',
                        maxWidth: '360px', width: '100%',
                    }}>
                        <div style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '12px' }}>🔔</div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>
                            {prePrompt === 'local'
                                ? (t('notifications.prePromptReminderTitle') || 'Enable practice reminders?')
                                : (t('notifications.prePromptPushTitle') || 'Enable subscription alerts?')}
                        </h3>
                        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 16px', textAlign: 'center' }}>
                            {prePrompt === 'local'
                                ? (t('notifications.prePromptReminderDesc') || 'We will send one gentle reminder per day at your chosen time.')
                                : (t('notifications.prePromptPushDesc') || 'We will notify you only about subscription renewals and payment issues.')}
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setPrePrompt(null)} style={{
                                flex: 1, padding: '10px', borderRadius: '10px',
                                border: '1px solid #e2e8f0', background: 'white',
                                fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                            }}>
                                {t('common.cancel') || 'Cancel'}
                            </button>
                            <button onClick={prePrompt === 'local' ? confirmLocalPermission : confirmPushPermission} style={{
                                flex: 1, padding: '10px', borderRadius: '10px',
                                border: 'none', background: '#7B2D8E', color: 'white',
                                fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
                            }}>
                                {t('common.continue') || 'Continue'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
