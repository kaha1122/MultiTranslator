// ── 데스크톱 웹 우측 패널 (2026-09-28) ─────────────────────────────────────────
// html.desktop-web + 폭 1280px 이상에서만 보인다(CSS). 네이티브에서는 마운트되지 않는다.
// 순서(staging 검토 반영):
//   1. StreakHero + 주간/월간 달성률 — 통계 탭과 같은 UI. 월간 수치는 이번 달 dailyProgress만 1회 조회(60초 캐시)
//   2. 주간 활동 — 오늘 목표 / 이번 주 (App이 가진 weeklyData, 추가 조회 없음)
//   3. 발음 다시 연습 — savedCards 목표 미달 최근 5개. **있을 때만** 표시(비면 앱 카드가 밀려나므로)
//   4. 모바일 앱 다운로드
// onSnapshot 대신 getDocs — 보조 정보라 실시간 구독 비용을 들이지 않는다.
import { useEffect, useRef, useState } from 'react';
import { collection, query, where, orderBy, limit, getDocs, documentId } from 'firebase/firestore';
import { Target, Mic, ChevronRight } from 'lucide-react';
import { db } from '../firebase/config';
import { getT } from '../utils/i18n';
import { getToday } from '../hooks/useDailyProgress';
import StreakHero from './StreakHero';
import StoreBadges from './StoreBadges';
import './StatsPage.css';
import './DesktopRightPanel.css';

const REVIEW_FETCH_LIMIT = 30;
const REVIEW_SHOW = 5;
const REFETCH_MS = 60 * 1000;

export default function DesktopRightPanel({
  user, sourceLang, viewMode,
  streakCurrent, streakLongest, totalAchievedDays, nextMilestone, nextReward, daysToNext, earnedMilestones,
  todayCount, dailyGoal, weeklyData,
  languageGoals, onOpenCard,
}) {
  const tr = (key, fallback) => getT(sourceLang, key) || fallback;
  const today = getToday();
  const monthStart = `${today.slice(0, 8)}01`;

  const [reviewCards, setReviewCards] = useState([]);
  const [monthAchieved, setMonthAchieved] = useState(0);
  const lastFetchRef = useRef(0);

  // 탭 이동 시 재조회하되 60초 이내 중복 조회는 건너뛴다.
  useEffect(() => {
    if (!user) return undefined;
    if (Date.now() - lastFetchRef.current < REFETCH_MS) return undefined;
    let cancelled = false;
    lastFetchRef.current = Date.now();

    const reviewQ = query(
      collection(db, 'savedCards'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(REVIEW_FETCH_LIMIT),
    );
    getDocs(reviewQ).then((snap) => {
      if (cancelled) return;
      setReviewCards(snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => !c.isDeleted && c.pronunciationScore != null
          && c.pronunciationScore < (languageGoals?.[c.langCode] || 60))
        .slice(0, REVIEW_SHOW));
    }).catch((e) => console.warn('[DesktopRightPanel] review load failed', e));

    // dailyProgress 문서 id = 로컬 날짜(YYYY-MM-DD) — 이번 달 범위만. 달성 기준은 통계 탭과 동일(topicProgressToday).
    const monthQ = query(
      collection(db, 'users', user.uid, 'dailyProgress'),
      where(documentId(), '>=', monthStart),
      where(documentId(), '<=', today),
    );
    getDocs(monthQ).then((snap) => {
      if (cancelled) return;
      setMonthAchieved(snap.docs.filter((d) => d.data()?.topicProgressToday === true).length);
    }).catch((e) => console.warn('[DesktopRightPanel] month stats load failed', e));

    return () => { cancelled = true; };
  }, [user, viewMode, languageGoals, monthStart, today]);

  const monthDaysSoFar = Number(today.slice(8, 10));
  const monthRate = monthDaysSoFar ? Math.round((monthAchieved / monthDaysSoFar) * 100) : 0;
  const weekPast = (weeklyData || []).filter((d) => d.date <= today);
  const weekRate = weekPast.length
    ? Math.round((weekPast.filter((d) => d.topicProgress).length / weekPast.length) * 100) : 0;

  const dayLabels = (getT(sourceLang, 'daily.daysShort') || '').split(',');
  const goalRatio = dailyGoal ? Math.min((todayCount / dailyGoal) * 100, 100) : 0;

  return (
    <aside className="desktop-right-panel" aria-label="side panel">
      {/* 1. 스트릭 + 달성률 (통계 탭과 동일 UI) */}
      <section className="drp-stats">
        <StreakHero
          sourceLang={sourceLang}
          streakCurrent={streakCurrent}
          streakLongest={streakLongest}
          totalAchievedDays={totalAchievedDays}
          monthRate={monthRate}
          nextMilestone={nextMilestone}
          nextReward={nextReward}
          daysToNext={daysToNext}
          earnedMilestones={earnedMilestones}
        />
        <div className="stats-summary">
          <div className="stats-card">
            <span className="stats-card-num">{weekRate}%</span>
            <span className="stats-card-label">{tr('stats.weekRate', 'Weekly rate')}</span>
          </div>
          <div className="stats-card">
            <span className="stats-card-num">{monthAchieved}<small>/{monthDaysSoFar}</small></span>
            <span className="stats-card-label">{tr('stats.monthDays', 'Days this month')}</span>
          </div>
          <div className="stats-card">
            <span className="stats-card-num">{monthRate}%</span>
            <span className="stats-card-label">{tr('stats.monthRate', 'Monthly rate')}</span>
          </div>
        </div>
      </section>

      {/* 2. 주간 활동 */}
      <section className="drp-card">
        <h3 className="drp-title">{tr('desktop.weekActivity', 'This week')}</h3>
        <div className="drp-goal">
          <div className="drp-goal-head">
            <Target size={14} strokeWidth={2.25} aria-hidden />
            <span>{tr('desktop.todayGoal', "Today's goal")}</span>
            <span className="drp-goal-num">{todayCount}/{dailyGoal}</span>
          </div>
          <div className="drp-goal-bar"><div className="drp-goal-fill" style={{ width: `${goalRatio}%` }} /></div>
        </div>
        <div className="drp-week">
          {(weeklyData || []).map((d, i) => {
            const cls = ['drp-week-day'];
            if (d.topicProgress) cls.push('is-done');
            if (d.date === today) cls.push('is-today');
            if (d.date > today) cls.push('is-future');
            return (
              <div key={d.date} className={cls.join(' ')}>
                <span className="drp-week-dow">{dayLabels[i] || ''}</span>
                <span className="drp-week-dot" aria-hidden />
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. 발음 다시 연습 — 목표 미달 문장이 있을 때만 */}
      {reviewCards.length > 0 && (
        <section className="drp-card">
          <h3 className="drp-title">{tr('desktop.reviewTitle', 'Practice again')}</h3>
          <p className="drp-sub">{tr('desktop.reviewSub', 'Sentences below your target score')}</p>
          <ul className="drp-review-list">
            {reviewCards.map((c, i) => (
              <li key={c.id}>
                <button type="button" className="drp-review-item" onClick={() => onOpenCard(c.id)}>
                  <span className="drp-review-rank">{i + 1}</span>
                  <span className="drp-review-body">
                    <span className="drp-review-text">{c.translatedText || c.sourceText}</span>
                    {c.translatedText && c.sourceText && (
                      <span className="drp-review-src">{c.sourceText}</span>
                    )}
                  </span>
                  <span className="drp-review-score">
                    <Mic size={11} strokeWidth={2.25} aria-hidden />{c.pronunciationScore}
                  </span>
                  <ChevronRight size={14} className="drp-review-chev" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4. 모바일 앱 */}
      <section className="drp-card">
        <h3 className="drp-title">{tr('desktop.getAppTitle', 'Keep learning on mobile')}</h3>
        <p className="drp-sub">{tr('desktop.getAppBody', 'Sign in with the same account and your progress carries over.')}</p>
        <StoreBadges />
      </section>
    </aside>
  );
}
