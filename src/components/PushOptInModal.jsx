import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getT } from '../utils/i18n';
import { setSubscriptionAlertPref } from '../utils/pushNotifications';

// 구독 성공 직후 띄우는 opt-in 모달 (D)
// 인라인 플러그인 호출 패턴 (v1.4.37) — 래퍼 hang 회피
export default function PushOptInModal({ sourceLang, uid, onClose }) {
    const t = (key) => getT(sourceLang, key);
    const isNative = Capacitor.isNativePlatform?.() === true;
    const [busy, setBusy] = useState(false);

    const handleAccept = async () => {
        if (!isNative) { onClose?.(); return; }
        setBusy(true);
        try {
            const mod = await import('@capacitor/push-notifications');
            const plugin = mod.PushNotifications;

            let perm = await plugin.checkPermissions();
            if (perm.receive !== 'granted') {
                if (perm.receive !== 'denied') {
                    const result = await plugin.requestPermissions();
                    if (result.receive !== 'granted') {
                        setBusy(false); onClose?.(); return;
                    }
                } else {
                    setBusy(false); onClose?.(); return;
                }
            }

            // 리스너는 App.jsx mount에서 이미 등록됨 — register()만 호출
            await plugin.register();
            if (uid) await setSubscriptionAlertPref(uid, true);
        } catch (e) {
            console.warn('[PushOptIn] handleAccept failed:', e?.message);
        }
        setBusy(false);
        onClose?.();
    };

    const handleLater = () => {
        try { localStorage.setItem('pronunfit.pushOptIn.snoozedAt', String(Date.now())); } catch {}
        onClose?.();
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10001, padding: '20px',
        }}>
            <div style={{
                background: 'white', borderRadius: '20px', padding: '28px 24px',
                maxWidth: '360px', width: '100%', textAlign: 'center',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}>
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🔔</div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
                    {t('pushOptIn.title') || 'Stay informed about your subscription'}
                </h2>
                <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {t('pushOptIn.body') || "We'll only notify you about renewals, payment issues, and expirations — no marketing."}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleLater} disabled={busy} style={{
                        flex: 1, padding: '13px', borderRadius: '12px',
                        border: '1px solid #e2e8f0', background: 'white',
                        fontWeight: 600, fontSize: '0.92rem', cursor: busy ? 'wait' : 'pointer',
                    }}>
                        {t('pushOptIn.later') || 'Later'}
                    </button>
                    <button onClick={handleAccept} disabled={busy} style={{
                        flex: 1, padding: '13px', borderRadius: '12px',
                        border: 'none', background: '#7B2D8E', color: 'white',
                        fontWeight: 700, fontSize: '0.92rem', cursor: busy ? 'wait' : 'pointer',
                    }}>
                        {busy ? '...' : (t('pushOptIn.allow') || 'Allow')}
                    </button>
                </div>
            </div>
        </div>
    );
}
