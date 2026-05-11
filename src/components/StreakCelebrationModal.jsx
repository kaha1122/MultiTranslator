// Streak 마일스톤 달성 축하 모달 (7/14/30/100일) — 폭죽 + 보너스 지급 표시
import { useEffect } from 'react';
import { useT } from '../utils/i18n';
import './StreakCelebrationModal.css';

const CONFETTI = ['🎉', '✨', '💎', '🎊', '⭐', '🌟', '💫', '🎁'];

const StreakCelebrationModal = ({ milestone, reward, sourceLang, onClose }) => {
    const t = useT(sourceLang);

    useEffect(() => {
        const timer = setTimeout(onClose, 7000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="streak-celeb-overlay" onClick={onClose}>
            <div className="streak-celeb-confetti">
                {Array.from({ length: 24 }, (_, i) => (
                    <span
                        key={i}
                        className="streak-celeb-piece"
                        style={{
                            left: `${(i * 4.3) % 100}%`,
                            animationDelay: `${(i * 0.08) % 1.5}s`,
                            animationDuration: `${2.5 + (i % 4) * 0.4}s`,
                        }}
                    >
                        {CONFETTI[i % CONFETTI.length]}
                    </span>
                ))}
            </div>

            <div className="streak-celeb-card" onClick={evt => evt.stopPropagation()}>
                <button className="streak-celeb-close" onClick={onClose}>×</button>

                <div className="streak-celeb-icon">💎</div>
                <div className="streak-celeb-milestone">{milestone}{t('streak.daysUnit')}</div>
                <h2 className="streak-celeb-title">{t('streak.celebration.title')}</h2>
                <p className="streak-celeb-subtitle">{t('streak.celebration.subtitle')}</p>

                {reward > 0 && (
                    <div className="streak-celeb-reward">
                        <span className="streak-celeb-reward-icon">🎁</span>
                        <span className="streak-celeb-reward-amount">+{reward}</span>
                        <span className="streak-celeb-reward-unit">pt</span>
                    </div>
                )}

                <button className="streak-celeb-cta" onClick={onClose}>
                    {t('streak.celebration.cta')}
                </button>
            </div>
        </div>
    );
};

export default StreakCelebrationModal;
