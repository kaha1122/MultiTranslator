import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getT } from '../utils/i18n';
import { resolveFlag } from '../config/languageFlags';
import { useUserCountry } from '../hooks/useUserCountry';

const LANGS = [
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'zh-CN', name: '中文', flag: '🇨🇳' },
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'pt-BR', name: 'Português', flag: '🇧🇷' },
];

// 브라우저 언어 기반 기본값 추측
const detectNativeLang = () => {
    const bl = (navigator.language || 'en').toLowerCase();
    if (bl.startsWith('ko')) return 'ko';
    if (bl.startsWith('ja')) return 'ja';
    if (bl.startsWith('zh')) return 'zh-CN';
    if (bl.startsWith('vi')) return 'vi';
    if (bl.startsWith('fr')) return 'fr';
    if (bl.startsWith('de')) return 'de';
    if (bl.startsWith('es')) return 'es';
    if (bl.startsWith('ru')) return 'ru';
    if (bl.startsWith('pt')) return 'pt-BR';
    return 'en';
};

const getDefaultTarget = (src) => src === 'en' ? 'ko' : 'en';

const LanguageSetupPopup = ({ onComplete }) => {
    const { updateUserProfile } = useAuth();
    const userCountry = useUserCountry();
    const [step, setStep] = useState(1); // 1: 모국어, 2: 학습언어
    const [sourceLang, setSourceLang] = useState(detectNativeLang());
    const [targetLang, setTargetLang] = useState('');
    const [saving, setSaving] = useState(false);

    const t = (key) => getT(sourceLang, key);

    const handleSourceSelect = (code) => {
        setSourceLang(code);
        setTargetLang(getDefaultTarget(code));
        setStep(2);
    };

    const handleFinish = async () => {
        if (!targetLang) return;
        setSaving(true);
        try {
            await updateUserProfile({
                sourceLang,
                targetLang,
                targetLangs: [targetLang],
                updatedAt: new Date(),
            });
            onComplete({ sourceLang, targetLang });
        } catch (e) {
            console.error('Language setup save failed:', e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'linear-gradient(135deg, #00a884 0%, #059669 100%)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '24px',
        }}>
            {/* 로고 */}
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <div style={{ fontSize: '3rem', marginBottom: '8px' }}>🎙️</div>
                <h1 style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 800, margin: 0 }}>PronunFit</h1>
                <p style={{ color: 'rgba(255,255,255,0.85)', margin: '6px 0 0', fontSize: '0.95rem' }}>
                    {t('langSetup.welcome')}
                </p>
            </div>

            {/* 카드 */}
            <div style={{
                background: '#fff', borderRadius: '24px',
                width: '100%', maxWidth: '400px',
                padding: '28px 24px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
            }}>
                {/* 단계 표시 */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                    {[1, 2].map(s => (
                        <div key={s} style={{
                            flex: 1, height: '4px', borderRadius: '2px',
                            background: s <= step ? '#00a884' : '#e2e8f0',
                            transition: 'background 0.3s',
                        }} />
                    ))}
                </div>

                {step === 1 && (
                    <>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>
                            {t('langSetup.step1Title')}
                        </h2>
                        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 16px' }}>
                            {t('langSetup.step1Sub')}
                        </p>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr',
                            gap: '8px', maxHeight: '320px', overflowY: 'auto',
                        }}>
                            {LANGS.map(l => (
                                <button
                                    key={l.code}
                                    onClick={() => handleSourceSelect(l.code)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '11px 12px', borderRadius: '12px',
                                        border: '2px solid',
                                        borderColor: sourceLang === l.code ? '#00a884' : '#e2e8f0',
                                        background: sourceLang === l.code ? '#f0fdf4' : '#fff',
                                        cursor: 'pointer', textAlign: 'left',
                                        fontSize: '0.88rem', fontWeight: 600, color: '#1e293b',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <span style={{ fontSize: '1.3rem' }}>{resolveFlag(l.code, userCountry, l.flag)}</span>
                                    {l.name}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {step === 2 && (
                    <>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: '0 0 6px' }}>
                            {t('langSetup.step2Title')}
                        </h2>
                        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 16px' }}>
                            {t('langSetup.step2Sub')}
                        </p>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr',
                            gap: '8px', maxHeight: '280px', overflowY: 'auto',
                        }}>
                            {LANGS.filter(l => l.code !== sourceLang).map(l => (
                                <button
                                    key={l.code}
                                    onClick={() => setTargetLang(l.code)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '11px 12px', borderRadius: '12px',
                                        border: '2px solid',
                                        borderColor: targetLang === l.code ? '#00a884' : '#e2e8f0',
                                        background: targetLang === l.code ? '#f0fdf4' : '#fff',
                                        cursor: 'pointer', textAlign: 'left',
                                        fontSize: '0.88rem', fontWeight: 600, color: '#1e293b',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <span style={{ fontSize: '1.3rem' }}>{resolveFlag(l.code, userCountry, l.flag)}</span>
                                    {l.name}
                                </button>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                            <button
                                onClick={() => setStep(1)}
                                style={{
                                    flex: 1, padding: '12px', borderRadius: '12px',
                                    border: '1.5px solid #e2e8f0', background: '#f8fafc',
                                    cursor: 'pointer', fontWeight: 600, color: '#64748b', fontSize: '0.9rem',
                                }}
                            >
                                ← {t('upgrade.back')}
                            </button>
                            <button
                                onClick={handleFinish}
                                disabled={!targetLang || saving}
                                style={{
                                    flex: 2, padding: '12px', borderRadius: '12px',
                                    background: targetLang ? '#00a884' : '#94a3b8',
                                    border: 'none', color: '#fff',
                                    cursor: targetLang ? 'pointer' : 'not-allowed',
                                    fontWeight: 700, fontSize: '0.95rem',
                                }}
                            >
                                {saving ? '...' : t('langSetup.startBtn')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default LanguageSetupPopup;
