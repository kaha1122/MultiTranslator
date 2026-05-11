// 통계 탭 최상단 Streak Hero 섹션 — 큰 숫자 + 3-stats + 마일스톤 progress + 4단계 milestone
import { MILESTONES, MILESTONE_REWARDS } from '../hooks/useStreak';
import { useT } from '../utils/i18n';
import './StreakHero.css';

const StreakHero = ({ sourceLang, streakCurrent, streakLongest, totalAchievedDays, monthRate, nextMilestone, nextReward, daysToNext, earnedMilestones }) => {
    const t = useT(sourceLang);
    const progressRatio = nextMilestone ? Math.min((streakCurrent / nextMilestone) * 100, 100) : 100;

    return (
        <div className="streak-hero">
            <div className="streak-hero-top">
                <div className="streak-hero-icon">💎</div>
                <div className="streak-hero-num">{streakCurrent}</div>
                <div className="streak-hero-label">{t('streak.currentLabel')}</div>
            </div>

            <div className="streak-hero-stats">
                <div className="streak-hero-stat">
                    <span className="streak-hero-stat-num">{streakLongest}</span>
                    <span className="streak-hero-stat-label">{t('streak.longest')}</span>
                </div>
                <div className="streak-hero-stat-divider" />
                <div className="streak-hero-stat">
                    <span className="streak-hero-stat-num">{monthRate}%</span>
                    <span className="streak-hero-stat-label">{t('streak.monthRate')}</span>
                </div>
                <div className="streak-hero-stat-divider" />
                <div className="streak-hero-stat">
                    <span className="streak-hero-stat-num">{totalAchievedDays}</span>
                    <span className="streak-hero-stat-label">{t('streak.totalDays')}</span>
                </div>
            </div>

            {nextMilestone && (
                <div className="streak-hero-next">
                    <div className="streak-hero-next-row">
                        <span className="streak-hero-next-label">
                            {t('streak.nextMilestone')}: <strong>{nextMilestone}{t('streak.daysUnit')}</strong> → 🎁 +{nextReward}pt
                        </span>
                        <span className="streak-hero-next-remain">
                            {daysToNext}{t('streak.daysLeftUnit')}
                        </span>
                    </div>
                    <div className="streak-hero-progress">
                        <div className="streak-hero-progress-fill" style={{ width: `${progressRatio}%` }} />
                    </div>
                </div>
            )}

            <div className="streak-hero-milestones">
                <div className="streak-hero-milestones-label">{t('streak.milestones')}</div>
                <div className="streak-hero-milestones-row">
                    {MILESTONES.map(m => {
                        const claimed = earnedMilestones.includes(`streak${m}`);
                        const isCurrent = streakCurrent >= m;
                        return (
                            <div key={m} className={`streak-hero-milestone${claimed ? ' claimed' : ''}${isCurrent ? ' reached' : ''}`}>
                                <span className="streak-hero-milestone-icon">{claimed ? '✅' : '⬜'}</span>
                                <span className="streak-hero-milestone-day">{m}{t('streak.daysUnit')}</span>
                                <span className="streak-hero-milestone-reward">+{MILESTONE_REWARDS[m]}pt</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default StreakHero;
