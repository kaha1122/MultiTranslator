import React from 'react';
import { getT } from '../utils/i18n';

// 구독 이벤트 팝업 — 4가지 type 통합
// - renewal: 정보성, 확인 버튼만
// - expiration: 정보성 + 액션(갱신하기 → UpgradeModal)
// - billingIssue: 정보성 + 액션(재결제 → 설정 탭 스크롤)
// - cancellation: 정보성, 확인 버튼만
export default function SubscriptionEventModal({ type, sourceLang, onClose, onAction }) {
    const t = (key) => getT(sourceLang, key);

    // type별 설정
    const config = {
        renewal: {
            icon: '✅',
            title: t('notifications.subEvent.renewalTitle') || 'Subscription Renewed',
            body: t('notifications.subEvent.renewalBody') || 'Your subscription has been renewed. Thank you.',
            primary: { label: t('notifications.subEvent.btnConfirm') || 'OK', action: 'close' },
            secondary: null,
        },
        expiration: {
            icon: '⚠️',
            title: t('notifications.subEvent.expirationTitle') || 'Subscription Expired',
            body: t('notifications.subEvent.expirationBody') || 'Your subscription has expired.',
            primary: { label: t('notifications.subEvent.btnRenew') || 'Renew', action: 'renew' },
            secondary: { label: t('notifications.subEvent.btnLater') || 'Later', action: 'close' },
        },
        billingIssue: {
            icon: '❗',
            title: t('notifications.subEvent.billingIssueTitle') || 'Payment Issue',
            body: t('notifications.subEvent.billingIssueBody') || 'Payment failed. Please try again.',
            primary: { label: t('notifications.subEvent.btnRetry') || 'Try again', action: 'retry' },
            secondary: { label: t('notifications.subEvent.btnLater') || 'Later', action: 'close' },
        },
        cancellation: {
            icon: 'ℹ️',
            title: t('notifications.subEvent.cancellationTitle') || 'Auto-renew Cancelled',
            body: t('notifications.subEvent.cancellationBody') || 'You can keep using until expiration.',
            primary: { label: t('notifications.subEvent.btnConfirm') || 'OK', action: 'close' },
            secondary: null,
        },
    };

    const cfg = config[type];
    if (!cfg) return null;

    const handleClick = (actionName) => {
        if (actionName === 'close') { onClose?.(); return; }
        onAction?.(actionName);
    };

    // type별 색상 — primary 버튼 색
    const primaryBg = {
        renewal: '#16a34a',
        expiration: '#7B2D8E',
        billingIssue: '#dc2626',
        cancellation: '#64748b',
    }[type] || '#7B2D8E';

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10002, padding: '20px',
        }}>
            <div style={{
                background: 'white', borderRadius: '20px', padding: '28px 24px',
                maxWidth: '360px', width: '100%', textAlign: 'center',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}>
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>{cfg.icon}</div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
                    {cfg.title}
                </h2>
                <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {cfg.body}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {cfg.secondary && (
                        <button onClick={() => handleClick(cfg.secondary.action)} style={{
                            flex: 1, padding: '13px', borderRadius: '12px',
                            border: '1px solid #e2e8f0', background: 'white',
                            fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer',
                        }}>
                            {cfg.secondary.label}
                        </button>
                    )}
                    <button onClick={() => handleClick(cfg.primary.action)} style={{
                        flex: 1, padding: '13px', borderRadius: '12px',
                        border: 'none', background: primaryBg, color: 'white',
                        fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer',
                    }}>
                        {cfg.primary.label}
                    </button>
                </div>
            </div>
        </div>
    );
}
