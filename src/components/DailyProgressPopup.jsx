import { useEffect } from 'react';
import { getToday } from '../hooks/useDailyProgress';
import { useT } from '../utils/i18n';
import './DailyProgressPopup.css';

// Calculate current streak from weekly data (counting backwards from today)
const calcStreak = (weeklyData, today) => {
    if (!weeklyData || weeklyData.length === 0) return 0;
    const todayIdx = weeklyData.findIndex(d => d.date === today);
    if (todayIdx < 0) return 0;
    let count = 0;
    for (let i = todayIdx; i >= 0; i--) {
        if (weeklyData[i].achieved) count++;
        else break;
    }
    return count;
};

const DailyProgressPopup = ({ todayCount, dailyGoal, weeklyData = [], onClose, sourceLang }) => {
    const t = useT(sourceLang);
    const today = getToday();
    const days = t('daily.days').split(',');
    const progress = Math.min((todayCount / dailyGoal) * 100, 100);
    const isComplete = todayCount >= dailyGoal;
    const streak = calcStreak(weeklyData, today);

    // Auto-close after 6 seconds
    useEffect(() => {
        const timer = setTimeout(onClose, 6000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="dpop-overlay" onClick={onClose}>
            <div className="dpop-card" onClick={e => e.stopPropagation()}>
                <button className="dpop-close" onClick={onClose}>×</button>

                {isComplete ? (
                    <div className="dpop-celebration">
                        <div className="dpop-fireworks">🎉</div>
                        <h3 className="dpop-title complete">{t('daily.goalComplete')}</h3>
                    </div>
                ) : (
                    <h3 className="dpop-title">{t('daily.keepGoing')}</h3>
                )}

                {/* Today Progress */}
                <div className="dpop-today">
                    <div className="dpop-count-row">
                        <span className="dpop-num">{todayCount}</span>
                        <span className="dpop-slash"> / </span>
                        <span className="dpop-total">{dailyGoal}</span>
                        <span className="dpop-label">{t('daily.cardsToday')}</span>
                    </div>
                    <div className="dpop-bar-track">
                        <div
                            className={`dpop-bar-fill ${isComplete ? 'complete' : ''}`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Streak badge */}
                {streak > 0 && (
                    <div className="dpop-streak">🔥 {streak} {t('daily.streakSuffix')}</div>
                )}

                {/* Weekly Calendar */}
                <div className="dpop-week">
                    {weeklyData.map((d, i) => {
                        const isToday = d.date === today;
                        const isFuture = d.date > today;
                        let icon = '○';
                        if (d.achieved) icon = '✅';
                        else if (!isFuture && d.date < today) icon = '🌙';
                        return (
                            <div
                                key={d.date}
                                className={`dpop-day${isToday ? ' today' : ''}${isFuture ? ' future' : ''}`}
                            >
                                <span className="dpop-day-name">{days[i] || ''}</span>
                                <span className="dpop-day-icon">{icon}</span>
                                {!isFuture && (
                                    <span className="dpop-day-count">{d.count || 0}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default DailyProgressPopup;
