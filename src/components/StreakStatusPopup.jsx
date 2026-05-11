// 일일 Streak 상태 안내 팝업 — Streak 출시 모달 영구 dismiss 이후 매일 첫 접속 1회 노출
// 다른 일일 팝업이 모두 닫힌 뒤 마지막 순서로 표시
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../utils/i18n';
import './StreakStatusPopup.css';

const StreakStatusPopup = ({ open, streakCurrent, nextMilestone, daysToNext, nextReward, sourceLang, onClose }) => {
    const t = useT(sourceLang);
    const isStart = !streakCurrent || streakCurrent === 0;

    // 자동 닫힘 (6초)
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(onClose, 6000);
        return () => clearTimeout(timer);
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="streak-status-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    {/* mini confetti — streak >= 7일 때만 */}
                    {streakCurrent >= 7 && (
                        <div className="streak-status-confetti" aria-hidden>
                            {Array.from({ length: 10 }, (_, i) => (
                                <span
                                    key={i}
                                    className="streak-status-piece"
                                    style={{
                                        left: `${(i * 11) % 100}%`,
                                        animationDelay: `${(i * 0.18) % 1.2}s`,
                                    }}
                                >
                                    {['💎', '✨', '⭐'][i % 3]}
                                </span>
                            ))}
                        </div>
                    )}

                    <motion.div
                        className="streak-status-card"
                        initial={{ scale: 0.85, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.85, opacity: 0, y: 16 }}
                        transition={{ type: 'spring', damping: 18, stiffness: 260 }}
                        onClick={(evt) => evt.stopPropagation()}
                    >
                        <button className="streak-status-close" onClick={onClose} aria-label="close">×</button>

                        <div className={`streak-status-icon${isStart ? ' grayscale' : ''}`}>💎</div>

                        {isStart ? (
                            <>
                                <div className="streak-status-headline-start">{t('streak.status.startTitle')}</div>
                                <p className="streak-status-message">{t('streak.status.startMessage')}</p>
                            </>
                        ) : (
                            <>
                                <motion.div
                                    className="streak-status-num"
                                    initial={{ scale: 0.4, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: 0.18, type: 'spring', damping: 11, stiffness: 220 }}
                                >
                                    {streakCurrent}
                                </motion.div>
                                <div className="streak-status-label">Streak</div>
                                <p className="streak-status-message">
                                    {t('streak.status.inProgress').replace('{n}', streakCurrent)}
                                </p>
                            </>
                        )}

                        {!isStart && nextMilestone && (
                            <div className="streak-status-next">
                                <span className="streak-status-next-icon">🎁</span>
                                <span className="streak-status-next-text">
                                    {t('streak.status.nextHint')}
                                </span>
                                <span className="streak-status-next-strong">
                                    {daysToNext}{t('streak.daysUnit')} · +{nextReward}pt
                                </span>
                            </div>
                        )}

                        <button className="streak-status-cta" onClick={onClose}>
                            {isStart ? t('streak.status.startCta') : t('streak.status.cta')}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default StreakStatusPopup;
