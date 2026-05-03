import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getT } from '../utils/i18n';
import { setSubscriptionAlertPref } from '../utils/pushNotifications';

// Push opt-in 모달 — 학습 알림 + 구독 알림 통합 동의 (A1 카피)
// 2026-05-03 변경:
//   - "Later" 버튼 제거 → "Allow" 단독 + 우상단 X 닫기 아이콘 (Apple 심사용 escape hatch)
//   - onClose에 결과 인자 전달: 'registered' / 'denied' / 'dismissed'
//   - 영구 플래그 subscriptionAlertPromptShown는 더 이상 set 안 함
//     (재표시 가능 — App.jsx의 shouldShowSubscriptionPrompt가 fcmTokenUpdatedAt + lastShownAt 기반 판정)
export default function PushOptInModal({ sourceLang, uid, onClose }) {
    const t = (key) => getT(sourceLang, key);
    const isNative = Capacitor.isNativePlatform?.() === true;
    const [busy, setBusy] = useState(false);

    // 결과 인자와 함께 onClose 호출
    const finish = (result) => onClose?.({ result });

    const handleAccept = async () => {
        if (!isNative) { finish('registered'); return; }
        setBusy(true);
        try {
            const mod = await import('@capacitor/push-notifications');
            const plugin = mod.PushNotifications;

            let perm = await plugin.checkPermissions();
            if (perm.receive !== 'granted') {
                if (perm.receive !== 'denied') {
                    const result = await plugin.requestPermissions();
                    if (result.receive !== 'granted') {
                        setBusy(false); finish('denied'); return;
                    }
                } else {
                    // 시스템 차원에서 거부 상태 — register() 무의미. 사용자가 시스템 설정에서 켜야 함.
                    setBusy(false); finish('denied'); return;
                }
            }

            // 리스너는 App.jsx mount에서 이미 등록됨 — register()만 호출
            // 'registration' 이벤트가 fire되면 saveFcmTokenToFirestore가 fcmTokens + fcmTokenUpdatedAt set
            await plugin.register();
            if (uid) await setSubscriptionAlertPref(uid, true);
            setBusy(false);
            finish('registered');
        } catch (e) {
            console.warn('[PushOptIn] handleAccept failed:', e?.message);
            setBusy(false);
            finish('dismissed');
        }
    };

    const handleClose = () => finish('dismissed');

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10001, padding: '20px',
        }}>
            <div style={{
                position: 'relative',
                background: 'white', borderRadius: '20px', padding: '28px 24px',
                maxWidth: '360px', width: '100%', textAlign: 'center',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}>
                {/* X 닫기 아이콘 — escape hatch (시각적 우선순위 낮춤) */}
                <button
                    onClick={handleClose}
                    disabled={busy}
                    aria-label={t('common.close') || 'Close'}
                    style={{
                        position: 'absolute',
                        top: 10, right: 12,
                        background: 'none', border: 'none',
                        color: '#94a3b8',
                        fontSize: '1.5rem',
                        lineHeight: 1,
                        cursor: busy ? 'wait' : 'pointer',
                        padding: 6,
                    }}
                >
                    ×
                </button>

                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🔔</div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
                    {t('pushOptIn.title') || 'Get learning reminders?'}
                </h2>
                <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {t('pushOptIn.body') || "We'll send daily learning reminders and subscription/payment updates. No ads."}
                </p>
                <button
                    onClick={handleAccept}
                    disabled={busy}
                    style={{
                        width: '100%',
                        padding: '13px',
                        borderRadius: '12px',
                        border: 'none', background: '#7B2D8E', color: 'white',
                        fontWeight: 700, fontSize: '0.95rem',
                        cursor: busy ? 'wait' : 'pointer',
                    }}
                >
                    {busy ? '...' : (t('pushOptIn.allow') || 'Allow')}
                </button>
            </div>
        </div>
    );
}
