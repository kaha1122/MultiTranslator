import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { X } from 'lucide-react';
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
        // Web 경로 — registerWebFCM (권한 + 토큰 + Firestore 저장 통합)
        if (!isNative) {
            setBusy(true);
            try {
                const { registerWebFCM } = await import('../utils/pushNotifications');
                const res = await registerWebFCM(uid);
                if (res.ok) {
                    if (uid) await setSubscriptionAlertPref(uid, true);
                    setBusy(false); finish('registered'); return;
                }
                setBusy(false);
                // 브라우저 미지원 / 거부 → escape (dismissed로 분류해서 재발화 가능하도록)
                finish(res.reason === 'denied' ? 'denied' : 'dismissed');
            } catch (e) {
                console.warn('[PushOptIn-Web] failed:', e?.message);
                setBusy(false);
                finish('dismissed');
            }
            return;
        }
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
        } catch (err) {
            console.warn('[PushOptIn] handleAccept failed:', err?.message);
            setBusy(false);
            finish('dismissed');
        }
    };

    const handleClose = () => finish('dismissed');

    // 2026-06-09 모달 통일 Phase 1: 공통 클래스/토큰 적용.
    //   - 오버레이/카드/버튼 → .modal-overlay / .modal-card / .modal-btn-primary
    //   - 닫기 아이콘 '×' 문자 → lucide <X> + .modal-close (표준 닫기 UX)
    //   - Allow 버튼 색 #7B2D8E(보라) → --brand-primary(teal) (1차 액션 규칙)
    //   - z-index: 권한 프롬프트라 최상위 유지 → var(--z-critical)
    return (
        <div className="modal-overlay" style={{ zIndex: 'var(--z-critical)' }}>
            <div className="modal-card" style={{ textAlign: 'center' }}>
                {/* X 닫기 아이콘 — escape hatch (시각적 우선순위 낮춤) */}
                <button
                    type="button"
                    className="modal-close"
                    onClick={handleClose}
                    disabled={busy}
                    aria-label={t('common.close') || 'Close'}
                >
                    <X size={20} />
                </button>

                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🔔</div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
                    {t('pushOptIn.title') || 'Get learning reminders?'}
                </h2>
                <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {t('pushOptIn.body') || "We'll send daily learning reminders and subscription/payment updates. No ads."}
                </p>
                <button
                    type="button"
                    className="modal-btn-primary"
                    onClick={handleAccept}
                    disabled={busy}
                >
                    {busy ? '...' : (t('pushOptIn.allow') || 'Allow')}
                </button>
            </div>
        </div>
    );
}
