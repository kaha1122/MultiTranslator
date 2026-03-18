import { useT } from '../utils/i18n';
import { useAuth } from '../context/AuthContext';
import { X } from 'lucide-react';

const TrialLimitModal = ({ sourceLang, cardCount, pronCount, onClose, onUpgrade }) => {
    const t = useT(sourceLang);
    const { TRIAL_DAILY_CARD_LIMIT, TRIAL_DAILY_PRON_LIMIT } = useAuth();

    return (
        <div
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center',
                alignItems: 'center', zIndex: 2000, padding: '20px'
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
                    <p style={{ margin: 0, color: '#6366f1', fontSize: '0.9rem', fontWeight: '700', lineHeight: 1.4 }}>
                        {t('trial.seeYouTomorrow')}
                    </p>
                    {/* 사용량 표시 */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '10px' }}>
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                            🃏 {cardCount}/{TRIAL_DAILY_CARD_LIMIT} /day
                        </span>
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                            🎤 {pronCount ?? 0}/{TRIAL_DAILY_PRON_LIMIT} /day
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
