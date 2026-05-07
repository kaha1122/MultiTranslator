import { useT } from '../utils/i18n';
import { useAuth } from '../context/AuthContext';
import { X } from 'lucide-react';

const TrialLimitModal = ({ sourceLang, pronCount, freeTalkCount = 0, onClose, onUpgrade }) => {
    const t = useT(sourceLang);
    // 2026-05-07 v1.5.0: 카드 한도 폐기. 발음/FT 한도(+credits 영구)만 표시.
    const { TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, pronCredits, freeTalkCredits } = useAuth();
    // 네이티브 앱(Android/iOS)에서는 사이드바의 보상형 광고 버튼 안내, 웹에서는 기존 메시지
    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    const messageKey = isNative ? 'trial.seeSidebarReward' : 'trial.seeYouTomorrow';

    return (
        <div
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center',
                alignItems: 'center', zIndex: 2000,
                padding: '20px 20px calc(20px + max(env(safe-area-inset-bottom, 0px), var(--admob-bottom, 0px)))'
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'white', borderRadius: '24px', padding: '22px 24px',
                    width: '100%', maxWidth: '400px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
                    position: 'relative', maxHeight: '90vh', overflowY: 'auto'
                }}
            >
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}
                >
                    <X size={22} />
                </button>

                {/* 헤더 */}
                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '2.2rem', marginBottom: '4px' }}>🎯</div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem', color: '#1e293b', fontWeight: '800', lineHeight: 1.3 }}>
                        {t('trial.limitTitle')}
                    </h2>
                    <p style={{ margin: '0 0 2px', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.4 }}>
                        {t('trial.limitDesc')}
                    </p>
                    <p style={{
                        margin: '6px 0 0',
                        color: '#6366f1',
                        fontSize: isNative ? '0.82rem' : '0.9rem',
                        fontWeight: '700',
                        lineHeight: 1.45,
                        wordBreak: 'keep-all',
                    }}>
                        {t(messageKey)}
                    </p>
                    {/* 사용량 표시 — 2026-05-07 v1.5.0: 발음/FT 만 (카드 한도 폐기) */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                            🗣️ {freeTalkCount}/{TRIAL_FREETALK_DAILY_LIMIT + freeTalkCredits} /day
                        </span>
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                            🎤 {pronCount ?? 0}/{TRIAL_DAILY_PRON_LIMIT + pronCredits} /day
                        </span>
                    </div>
                </div>

                {/* 업그레이드 버튼 */}
                <button
                    onClick={onUpgrade}
                    style={{
                        width: '100%', padding: '13px', background: '#4338ca', color: 'white',
                        border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    ✨ {t('trial.upgradeBtn')}
                </button>
            </div>
        </div>
    );
};

export default TrialLimitModal;
