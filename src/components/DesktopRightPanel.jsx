// ── 데스크톱 웹 우측 패널 (2026-09-28) ─────────────────────────────────────────
// html.desktop-web + 폭 1280px 이상에서만 보인다(CSS). 네이티브에서는 마운트되지 않는다.
//   A. 학습 현황 — streak / 오늘 목표 / 이번 주 (App이 이미 가진 값, 추가 조회 없음)
//   B. 발음 다시 연습 — savedCards 중 목표 점수 미달 문장 최근 5개 (getDocs 1회, 60초 캐시)
//   전원: 모바일 앱 다운로드 카드 (익명 유저 계정 만들기 CTA는 고정 사이드바 상단에 이미 있음)
// onSnapshot 대신 getDocs — 우측 패널은 보조 정보라 실시간 구독 비용을 들이지 않는다.
import { useEffect, useRef, useState } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { Gem, Target, Mic, ChevronRight } from 'lucide-react';
import { db } from '../firebase/config';
import { getT } from '../utils/i18n';
import { getToday } from '../hooks/useDailyProgress';
import StoreBadges from './StoreBadges';
import './DesktopRightPanel.css';

const REVIEW_FETCH_LIMIT = 30;
const REVIEW_SHOW = 5;
const REFETCH_MS = 60 * 1000;

export default function DesktopRightPanel({
  user, sourceLang, viewMode,
  streakCurrent, streakLongest, todayCount, dailyGoal, weeklyData,
  languageGoals, onOpenCard,
}) {
  const tr = (key, fallback) => getT(sourceLang, key) || fallback;
  const [reviewCards, setReviewCards] = useState(null); // null = 로딩 전
  const lastFetchRef = useRef(0);

  // 탭 이동 시 재조회하되 60초 이내 중복 조회는 건너뛴다.
  useEffect(() => {
    if (!user) return undefined;
    if (Date.now() - lastFetchRef.current < REFETCH_MS) return undefined;
    let cancelled = false;
    lastFetchRef.current = Date.now();
    const q = query(
      collection(db, 'savedCards'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(REVIEW_FETCH_LIMIT),
    );
    getDocs(q).then((snap) => {
      if (cancelled) return;
      const missed = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((c) => !c.isDeleted && c.pronunciationScore != null
          && c.pronunciationScore < (languageGoals?.[c.langCode] || 60))
        .slice(0, REVIEW_SHOW);
      setReviewCards(missed);
    }).catch((e) => {
      console.warn('[DesktopRightPanel] review load failed', e);
      if (!cancelled) setReviewCards([]);
    });
    return () => { cancelled = true; };
  }, [user, viewMode, languageGoals]);

  const today = getToday();
  const dayLabels = (getT(sourceLang, 'daily.daysShort') || '').split(',');
  const daysUnit = tr('streak.daysUnit', '일');
  const goalRatio = dailyGoal ? Math.min((todayCount / dailyGoal) * 100, 100) : 0;

  return (
    <aside className="desktop-right-panel" aria-label="side panel">
      {/* A. 학습 현황 */}
      <section className="drp-card">
        <h3 className="drp-title">{tr('desktop.progressTitle', 'My progress')}</h3>
        <div className="drp-streak">
          <Gem size={22} strokeWidth={2.25} className="drp-streak-icon" aria-hidden />
          <span className="drp-streak-num">{streakCurrent}</span>
          <span className="drp-streak-unit">{daysUnit}</span>
          <span className="drp-streak-best">
            {tr('desktop.bestStreak', 'Best: {n}').replace('{n}', streakLongest)}
          </span>
        </div>

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

      {/* B. 발음 다시 연습 */}
      <section className="drp-card">
        <h3 className="drp-title">{tr('desktop.reviewTitle', 'Practice again')}</h3>
        <p className="drp-sub">{tr('desktop.reviewSub', 'Sentences below your target score')}</p>
        {reviewCards === null ? (
          <p className="drp-empty">…</p>
        ) : reviewCards.length === 0 ? (
          <p className="drp-empty">{tr('desktop.reviewEmpty', 'Nothing to review right now.')}</p>
        ) : (
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
        )}
      </section>

      {/* 모바일 앱 */}
      <section className="drp-card">
        <h3 className="drp-title">{tr('desktop.getAppTitle', 'Keep learning on mobile')}</h3>
        <p className="drp-sub">{tr('desktop.getAppBody', 'Sign in with the same account and your progress carries over.')}</p>
        <StoreBadges />
      </section>
    </aside>
  );
}
