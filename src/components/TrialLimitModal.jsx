import { useT } from '../utils/i18n';
import { useAuth } from '../context/AuthContext';
import { X } from 'lucide-react';

const TrialLimitModal = ({ sourceLang, onClose, onSetupByok }) => {
    const t = useT(sourceLang);
    const { trialCardCount, trialPronCount, TRIAL_CARD_LIMIT, TRIAL_PRON_LIMIT } = useAuth();

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
                    background: 'white', borderRadius: '24px', padding: '28px 24px',
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
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🎯</div>
                    <h2 style={{ margin: '0 0 8px', fontSize: '1.3rem', color: '#1e293b', fontWeight: '800' }}>
                        {t('trial.limitTitle')}
                    </h2>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                        {t('trial.limitDesc')}
                    </p>
                    {/* 사용량 표시 */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '12px' }}>
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                            🃏 {trialCardCount}/{TRIAL_CARD_LIMIT}
                        </span>
                        <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                            🎤 {trialPronCount}/{TRIAL_PRON_LIMIT}
                        </span>
                    </div>
                </div>

                {/* 옵션 1: Pro */}
                <div style={{
                    border: '2px solid #e0e7ff', borderRadius: '16px', padding: '16px',
                    marginBottom: '12px', background: '#fafafa'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontWeight: '800', color: '#4338ca', fontSize: '1rem' }}>
                            {t('trial.optionProTitle')}
                        </span>
                        <span style={{ fontWeight: '800', color: '#4338ca', fontSize: '1rem' }}>
                            {t('trial.optionProPrice')}
                        </span>
                    </div>
                    <ul style={{ margin: '0 0 12px', padding: '0 0 0 18px', color: '#475569', fontSize: '0.875rem' }}>
                        <li>{t('trial.optionProFeature1')}</li>
                        <li>{t('trial.optionProFeature2')}</li>
                    </ul>
                    <button
                        onClick={() => alert('Coming soon! 🚧')}
                        style={{
                            width: '100%', padding: '12px', background: '#4338ca', color: 'white',
                            border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer',
                            fontSize: '0.95rem'
                        }}
                    >
                        {t('trial.optionProBtn')}
                    </button>
                </div>

                {/* 옵션 2: BYOK */}
                <div style={{
                    border: '2px solid #d1fae5', borderRadius: '16px', padding: '16px',
                    background: '#f0fdf4'
                }}>
                    <div style={{ marginBottom: '8px' }}>
                        <span style={{ fontWeight: '800', color: '#059669', fontSize: '1rem' }}>
                            {t('trial.optionByokTitle')}
                        </span>
                    </div>
                    <p style={{ margin: '0 0 6px', color: '#475569', fontSize: '0.875rem' }}>
                        {t('trial.optionByokDesc')}
                    </p>
                    <p style={{ margin: '0 0 12px', color: '#059669', fontSize: '0.8rem', fontWeight: '600' }}>
                        ✅ {t('trial.optionByokFeature')}
                    </p>
                    <button
                        onClick={onSetupByok}
                        style={{
                            width: '100%', padding: '12px', background: '#059669', color: 'white',
                            border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer',
                            fontSize: '0.95rem'
                        }}
                    >
                        {t('trial.optionByokBtn')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TrialLimitModal;
