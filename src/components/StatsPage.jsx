import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { collection, query, getDocsFromServer } from 'firebase/firestore';
import { useT } from '../utils/i18n';
import LearningGauge from './LearningGauge';
import './StatsPage.css';

// ── 유틸 ──
const getMonday = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
};

// 로컬 타임존 기준 — Firestore dailyProgress 문서 키(로컬 기준)와 일치시킴
const formatDate = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const getMonthDates = (year, month) => {
    const dates = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
        dates.push(formatDate(d));
        d.setDate(d.getDate() + 1);
    }
    return dates;
};

const StatsPage = ({ user, dailyGoal, sourceLang, isActive }) => {
    const t = useT(sourceLang);
    const [allData, setAllData] = useState({}); // { 'YYYY-MM-DD': { count, dailyGoal, achieved } }
    const [isLoading, setIsLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    });

    // Firestore에서 모든 dailyProgress 문서 로드 (탭 진입 시마다 갱신)
    useEffect(() => {
        if (!user?.uid || !isActive) return;
        const loadAll = async () => {
            try {
                const snap = await getDocsFromServer(
                    query(collection(db, 'users', user.uid, 'dailyProgress'))
                );
                const map = {};
                snap.forEach(doc => {
                    const d = doc.data();
                    const cnt = d.count || 0;
                    const goal = d.dailyGoal || dailyGoal;
                    map[doc.id] = { count: cnt, dailyGoal: goal, achieved: cnt >= goal };
                });
                setAllData(map);
            } catch (e) {
                console.error('[StatsPage] Load failed:', e);
            } finally {
                setIsLoading(false);
            }
        };
        loadAll();
    }, [user?.uid, isActive]);

    const { year, month } = currentMonth;
    const today = formatDate(new Date());
    const monthDates = getMonthDates(year, month);
    const dayLabels = t('daily.days').split(',');

    // 월의 첫째날 요일 (월=0 ~ 일=6)
    const firstDayOfWeek = (() => {
        const d = new Date(year, month, 1).getDay();
        return d === 0 ? 6 : d - 1;
    })();

    // 월간 통계 계산
    const monthStats = (() => {
        let totalDays = 0;
        let achievedDays = 0;
        let totalCount = 0;
        monthDates.forEach(date => {
            if (date > today) return;
            totalDays++;
            const d = allData[date];
            if (d) {
                totalCount += d.count;
                if (d.achieved) achievedDays++;
            }
        });
        const achieveRate = totalDays > 0 ? Math.round((achievedDays / totalDays) * 100) : 0;
        return { totalDays, achievedDays, totalCount, achieveRate };
    })();

    // 이번주 통계
    const weekStats = (() => {
        const monday = getMonday(new Date());
        let totalDays = 0;
        let achievedDays = 0;
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const dateStr = formatDate(d);
            if (dateStr > today) break;
            totalDays++;
            if (allData[dateStr]?.achieved) achievedDays++;
        }
        const rate = totalDays > 0 ? Math.round((achievedDays / totalDays) * 100) : 0;
        return { totalDays, achievedDays, rate };
    })();

    const prevMonth = () => {
        setCurrentMonth(prev => {
            const m = prev.month - 1;
            return m < 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: m };
        });
    };
    const nextMonth = () => {
        const now = new Date();
        const next = month + 1 > 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
        if (next.year > now.getFullYear() || (next.year === now.getFullYear() && next.month > now.getMonth())) return;
        setCurrentMonth(next);
    };

    const monthLabel = new Date(year, month).toLocaleDateString(sourceLang === 'ko' ? 'ko-KR' : sourceLang === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'long' });

    if (isLoading) {
        return <div className="stats-loading">{t('library.loading')}</div>;
    }

    return (
        <div className="stats-page">
            {/* 요약 카드들 */}
            <div className="stats-summary">
                <div className="stats-card">
                    <span className="stats-card-num">{weekStats.rate}%</span>
                    <span className="stats-card-label">{t('stats.weekRate')}</span>
                </div>
                <div className="stats-card">
                    <span className="stats-card-num">{monthStats.achievedDays}<small>/{monthStats.totalDays}</small></span>
                    <span className="stats-card-label">{t('stats.monthDays')}</span>
                </div>
                <div className="stats-card">
                    <span className="stats-card-num">{monthStats.achieveRate}%</span>
                    <span className="stats-card-label">{t('stats.monthRate')}</span>
                </div>
            </div>

            {/* 월간 캘린더 */}
            <div className="stats-cal-box">
                <div className="stats-cal-nav">
                    <button className="stats-cal-arrow" onClick={prevMonth}>‹</button>
                    <span className="stats-cal-month">{monthLabel}</span>
                    <button className="stats-cal-arrow" onClick={nextMonth}>›</button>
                </div>

                {/* 요일 헤더 */}
                <div className="stats-cal-grid stats-cal-header">
                    {dayLabels.map((d, i) => (
                        <span key={i} className="stats-cal-day-label">{d}</span>
                    ))}
                </div>

                {/* 날짜 셀 */}
                <div className="stats-cal-grid">
                    {/* 빈 칸 (월초 시작 전) */}
                    {Array.from({ length: firstDayOfWeek }, (_, i) => (
                        <div key={`empty-${i}`} className="stats-cal-cell empty" />
                    ))}
                    {monthDates.map(date => {
                        const dayNum = parseInt(date.slice(8), 10);
                        const data = allData[date];
                        const isFuture = date > today;
                        const isToday = date === today;
                        const achieved = data?.achieved;
                        const missed = !isFuture && !achieved && date < today;
                        const count = data?.count || 0;

                        let cellClass = 'stats-cal-cell';
                        if (isToday) cellClass += ' today';
                        if (isFuture) cellClass += ' future';
                        if (achieved) cellClass += ' achieved';
                        if (missed && count > 0) cellClass += ' partial';

                        return (
                            <div key={date} className={cellClass}>
                                <span className="stats-cal-num">{dayNum}</span>
                                {!isFuture && (
                                    <span className="stats-cal-icon">
                                        {achieved ? '✅' : (date < today ? (count > 0 ? '🌙' : '·') : '○')}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 범례 */}
            <div className="stats-legend">
                <span className="stats-legend-item">✅ {t('stats.achieved')}</span>
                <span className="stats-legend-item">🌙 {t('stats.partial')}</span>
                <span className="stats-legend-item">· {t('stats.noActivity')}</span>
            </div>

            {/* 학습 게이지 */}
            <LearningGauge user={user} sourceLang={sourceLang} isActive={isActive} />
        </div>
    );
};

export default StatsPage;
