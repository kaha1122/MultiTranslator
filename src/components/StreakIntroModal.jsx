// Streak 출시 안내 Full-screen 모달
// - 온보딩 직후 다음 세션부터 표시
// - 친구초대(BonusCampaign) / 리뷰 보너스 모달보다 먼저 노출
// - "다시 보지 않음" 체크 시에만 streakIntroDismissed=true 영구 종료, 미체크 닫기는 다음 세션 재노출
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';
import { MILESTONES, MILESTONE_REWARDS } from '../hooks/useStreak';
import './StreakIntroModal.css';

const StreakIntroModal = ({ open, onClose, onPermanentDismiss, onCta, sourceLang }) => {
    const t = useT(sourceLang);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    const handleClose = () => {
        if (dontShowAgain) onPermanentDismiss();
        else onClose();
    };

    const handleCta = () => {
        if (dontShowAgain) onPermanentDismiss();
        if (onCta) onCta();
        else onClose();
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className="streak-intro-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <motion.div
                        className="streak-intro-scroll"
                        initial={{ scale: 0.94, opacity: 0, y: 12 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 12 }}
                        transition={{ type: 'spring', damping: 22, stiffness: 240 }}
                    >
                        {/* 헤더 영역 — 큰 💎 + 타이틀 */}
                        <div className="streak-intro-hero">
                            {/* 표준 닫기 버튼 — 우상단 lucide <X> (.modal-close 공통 클래스).
                                hero가 position:relative라 카드 기준으로 anchor됨 */}
                            <button
                                type="button"
                                className="modal-close"
                                onClick={handleClose}
                                aria-label={t('streak.intro.later') || 'Close'}
                                style={{ zIndex: 2 }}
                            >
                                <X size={20} />
                            </button>
                            <div className="streak-intro-confetti">
                                {Array.from({ length: 12 }, (_, i) => (
                                    <span
                                        key={i}
                                        className="streak-intro-piece"
                                        style={{
                                            left: `${(i * 8.7) % 100}%`,
                                            animationDelay: `${(i * 0.15) % 1.5}s`,
                                        }}
                                    >
                                        {['✨', '💎', '⭐', '🌟'][i % 4]}
                                    </span>
                                ))}
                            </div>
                            <div className="streak-intro-icon">💎</div>
                            <div className="streak-intro-badge">{t('streak.intro.badge')}</div>
                            <h2 className="streak-intro-title">{t('streak.intro.title')}</h2>
                            <p className="streak-intro-subtitle">{t('streak.intro.subtitle')}</p>
                        </div>

                        {/* 본문 — 하루 목표 (헤드라인 + 수식 시각화) */}
                        <div className="streak-intro-section">
                            <div className="streak-intro-section-label">{t('streak.intro.dailyGoalTitle')}</div>
                            <div className="streak-intro-goal-card">
                                <div className="streak-intro-goal-headline">
                                    <span className="streak-intro-goal-headline-icon">🎯</span>
                                    <span className="streak-intro-goal-headline-text">{t('streak.intro.dailyGoalHeadline')}</span>
                                </div>
                                <div className="streak-intro-goal-divider" />
                                {/* 1단계: 발음 통과 + 저장 = 카드 1장 */}
                                <div className="streak-intro-eq">
                                    <div className="streak-intro-eq-item">
                                        <span className="streak-intro-eq-icon">🎙️</span>
                                        <span className="streak-intro-eq-label">{t('streak.intro.dailyGoalStepPron')}</span>
                                    </div>
                                    <span className="streak-intro-eq-op">+</span>
                                    <div className="streak-intro-eq-item">
                                        <span className="streak-intro-eq-icon">📇</span>
                                        <span className="streak-intro-eq-label">{t('streak.intro.dailyGoalStepSave')}</span>
                                    </div>
                                    <span className="streak-intro-eq-op">=</span>
                                    <div className="streak-intro-eq-item streak-intro-eq-result">
                                        <span className="streak-intro-eq-icon">📇</span>
                                        <span className="streak-intro-eq-label">{t('streak.intro.dailyGoalStepResult')}</span>
                                    </div>
                                </div>
                                {/* 2단계: 카드 1장 × 3 = 하루 목표 달성 */}
                                <div className="streak-intro-eq streak-intro-eq-final">
                                    <div className="streak-intro-eq-cards">
                                        <span className="streak-intro-eq-icon">📇</span>
                                        <span className="streak-intro-eq-icon">📇</span>
                                        <span className="streak-intro-eq-icon">📇</span>
                                    </div>
                                    <span className="streak-intro-eq-op">→</span>
                                    <div className="streak-intro-eq-success">
                                        <span className="streak-intro-eq-icon">✅</span>
                                        <span className="streak-intro-eq-label">{t('streak.intro.dailyGoalSuccess')}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 본문 — 마일스톤 보상 */}
                        <div className="streak-intro-section">
                            <div className="streak-intro-section-label">{t('streak.intro.milestonesTitle')}</div>
                            <div className="streak-intro-milestones">
                                {MILESTONES.map(m => (
                                    <div key={m} className="streak-intro-milestone">
                                        <div className="streak-intro-milestone-day">
                                            <span className="streak-intro-milestone-num">{m}</span>
                                            <span className="streak-intro-milestone-unit">{t('streak.daysUnit')}</span>
                                        </div>
                                        <div className="streak-intro-milestone-reward">
                                            🎁 +{MILESTONE_REWARDS[m]}pt
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="streak-intro-milestone-hint">{t('streak.intro.milestoneHint')}</div>
                        </div>

                        {/* 다시 보지 않음 체크박스 */}
                        <label className="streak-intro-dont-show">
                            <input
                                type="checkbox"
                                checked={dontShowAgain}
                                onChange={(evt) => setDontShowAgain(evt.target.checked)}
                            />
                            <span>{t('streak.intro.dontShowAgain')}</span>
                        </label>

                        {/* CTA 버튼 2개 */}
                        <div className="streak-intro-actions">
                            <button className="streak-intro-btn-secondary" onClick={handleClose}>
                                {t('streak.intro.later')}
                            </button>
                            <button className="streak-intro-btn-primary" onClick={handleCta}>
                                {t('streak.intro.cta')}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default StreakIntroModal;
