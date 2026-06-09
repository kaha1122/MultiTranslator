// 첫 generate 직후 1회 발화 — "별표 → 발음 통과 → Streak" 행동 가이드
// "다시 보지 않음" 미체크 시 다음 세션 재노출 (영구 dismiss는 localStorage starGuideDismissedV2='1')
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, X } from 'lucide-react';
import { useT } from '../utils/i18n';
import './StarGuideModal.css';

const StarGuideModal = ({ open, onClose, onPermanentDismiss, sourceLang }) => {
    const t = useT(sourceLang);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    const finalize = () => {
        if (dontShowAgain) onPermanentDismiss();
        else onClose();
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="star-guide-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={finalize}
                >
                    <motion.div
                        className="star-guide-card"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ scale: 0.94, opacity: 0, y: 12 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 12 }}
                        transition={{ type: 'spring', damping: 22, stiffness: 240 }}
                    >
                        <button className="modal-close" onClick={finalize} aria-label="Close">
                            <X size={20} />
                        </button>

                        <div className="star-guide-hero">
                            <div className="star-guide-badge">
                                <Star size={36} strokeWidth={2.4} />
                            </div>
                        </div>

                        <h3 className="star-guide-title">{t('daily.starGuideTitle')}</h3>

                        <ol className="star-guide-steps">
                            <li className="star-guide-step">
                                <span className="star-guide-step-num">1</span>
                                <span className="star-guide-step-text">{t('daily.starGuideStep1')}</span>
                            </li>
                            <li className="star-guide-step">
                                <span className="star-guide-step-num">2</span>
                                <span className="star-guide-step-text">{t('daily.starGuideStep2')}</span>
                            </li>
                            <li className="star-guide-step">
                                <span className="star-guide-step-num">3</span>
                                <span className="star-guide-step-text">{t('daily.starGuideStep3')}</span>
                            </li>
                        </ol>

                        <label className="star-guide-dontshow">
                            <input
                                type="checkbox"
                                checked={dontShowAgain}
                                onChange={(e) => setDontShowAgain(e.target.checked)}
                            />
                            <span>{t('daily.dontShowAgain')}</span>
                        </label>

                        <button className="star-guide-cta" onClick={finalize}>
                            {t('daily.starGuideCta')}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default StarGuideModal;
