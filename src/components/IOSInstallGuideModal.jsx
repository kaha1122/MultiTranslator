import { motion, AnimatePresence } from 'framer-motion';
import { X, Share, Plus, Check } from 'lucide-react';
import { useT } from '../utils/i18n';

// iOS Safari "홈 화면에 추가" 가이드 모달.
// iOS WebKit에는 beforeinstallprompt가 없어 PWA 설치 prompt를 띄울 수 없으므로,
// 사용자에게 수동 절차를 시각적으로 안내. (영상 자산 추가 시 SVG 영역을 video로 교체)
export default function IOSInstallGuideModal({ open, onClose, sourceLang }) {
    const t = useT(sourceLang);
    if (!open) return null;

    const handleDontShowAgain = () => {
        try { localStorage.setItem('iosInstallGuideSeen', '1'); } catch {}
        onClose();
    };

    const stepBoxStyle = {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px', borderRadius: '12px', background: '#f8fafc',
        border: '1px solid #e2e8f0', marginBottom: '8px',
    };
    const stepIconStyle = {
        flexShrink: 0, width: '36px', height: '36px',
        borderRadius: '10px', background: '#1d4ed8', color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    };
    const stepTextStyle = { fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.4 };
    const stepNumStyle = {
        fontSize: '0.7rem', color: '#64748b', fontWeight: 700, letterSpacing: '0.05em',
        marginBottom: '2px',
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '16px',
                    }}
                >
                    <motion.div
                        initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'white', borderRadius: '18px', padding: '20px',
                            maxWidth: '420px', width: '100%', maxHeight: '90vh', overflow: 'auto',
                            boxShadow: '0 12px 48px rgba(0,0,0,0.25)',
                        }}
                    >
                        {/* 헤더 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1d4ed8' }}>
                                {t('install.iosGuideTitle')}
                            </h3>
                            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                <X size={22} color="#64748b" />
                            </button>
                        </div>

                        {/* 인트로 */}
                        <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 14px', lineHeight: 1.5 }}>
                            {t('install.iosGuideIntro')}
                        </p>

                        {/* 3 스텝 */}
                        <div>
                            {/* Step 1 */}
                            <div style={stepBoxStyle}>
                                <div style={stepIconStyle}>
                                    <Share size={18} />
                                </div>
                                <div>
                                    <div style={stepNumStyle}>STEP 1</div>
                                    <div style={stepTextStyle}>{t('install.iosStep1')}</div>
                                </div>
                            </div>
                            {/* Step 2 */}
                            <div style={stepBoxStyle}>
                                <div style={stepIconStyle}>
                                    <Plus size={20} />
                                </div>
                                <div>
                                    <div style={stepNumStyle}>STEP 2</div>
                                    <div style={stepTextStyle}>{t('install.iosStep2')}</div>
                                </div>
                            </div>
                            {/* Step 3 */}
                            <div style={stepBoxStyle}>
                                <div style={stepIconStyle}>
                                    <Check size={20} />
                                </div>
                                <div>
                                    <div style={stepNumStyle}>STEP 3</div>
                                    <div style={stepTextStyle}>{t('install.iosStep3')}</div>
                                </div>
                            </div>
                        </div>

                        {/* Chrome 사용자 안내 */}
                        <div style={{
                            marginTop: '10px', padding: '10px 12px',
                            background: '#fef3c7', borderRadius: '10px',
                            fontSize: '0.78rem', color: '#92400e', lineHeight: 1.45,
                        }}>
                            ⚠️ {t('install.iosChromeNote')}
                        </div>

                        {/* 액션 버튼 */}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                            <button
                                onClick={handleDontShowAgain}
                                style={{
                                    flex: 1, padding: '11px', borderRadius: '10px',
                                    background: 'white', border: '1px solid #cbd5e1',
                                    color: '#64748b', fontSize: '0.85rem', fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >
                                {t('install.iosDontShowAgain')}
                            </button>
                            <button
                                onClick={onClose}
                                style={{
                                    flex: 1, padding: '11px', borderRadius: '10px',
                                    background: '#1d4ed8', border: 'none',
                                    color: 'white', fontSize: '0.85rem', fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                {t('install.iosGotIt')}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
