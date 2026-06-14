import { useState, useEffect, useRef } from 'react';
import { Lock, Check, Play } from 'lucide-react';
import { getT } from '../utils/i18n';
import { getLangInfo } from '../config/languages';
import {
  UNITS,
  TOTAL_TOPICS,
  isTopicMastered,
  getCurrentTopicId,
  countMastered,
} from '../config/learningPath.js';
import './LearningPathHome.css';

// ── 학습 경로 홈 (계단 + 언어 pill + 70 미니그리드) ─────────────────────────
// 활성 언어 1개 기준으로 70토픽을 유닛별 지그재그 계단으로 표시(soft-lock: 전부 탭 가능).
// 멀티언어는 pill 전환(Phase 1: 아크 세그먼트 없음 — Phase 4). 발열: onSnapshot/무한애니 없음.
export default function LearningPathHome({
  sourceLang,
  targetLangs = [],
  getLangProgress,
  loaded,
  isActive = true,
  onOpenTopic,
}) {
  const t = (k) => getT(sourceLang, k);
  const langs = targetLangs.length > 0 ? targetLangs : ['en'];
  const [activeLang, setActiveLang] = useState(langs[0]);

  // targetLangs 변경 시 활성 언어 보정
  useEffect(() => {
    if (!langs.includes(activeLang)) setActiveLang(langs[0]);
  }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressMap = getLangProgress(activeLang);
  const currentTopicId = getCurrentTopicId(progressMap);
  const masteredCount = countMastered(progressMap);

  // 현재("지금 여기") 노드로 최초 1회 스크롤 — VocabTab 패턴(getBoundingClientRect + 안드로이드 height-0 retry)
  const currentNodeRef = useRef(null);
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (!isActive || didScrollRef.current || !loaded) return;
    didScrollRef.current = true;
    const tryScroll = (attempt = 0) => {
      const node = currentNodeRef.current;
      if (!node) return;
      const container = node.closest('.app-container');
      if (!container) { node.scrollIntoView({ block: 'center' }); return; }
      const nodeRect = node.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (nodeRect.height === 0 && attempt < 5) {
        setTimeout(() => tryScroll(attempt + 1), 100);
        return;
      }
      const target = container.scrollTop + (nodeRect.top - containerRect.top)
        - (containerRect.height / 2) + (nodeRect.height / 2);
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    };
    requestAnimationFrame(() => setTimeout(() => tryScroll(0), 150));
  }, [isActive, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeState = (topicId) => {
    const p = progressMap[topicId];
    if (isTopicMastered(p)) return 'mastered';
    if (topicId === currentTopicId) return 'current';
    if (p && ((p.wordMastered || 0) > 0 || (p.passageMastered || 0) > 0)) return 'inprogress';
    return 'locked';
  };

  return (
    <div className="lph">
      {/* 언어 pill 바 — 1개면 단일 헤더처럼, 2~3개면 전환 가능 */}
      <div className={`lph-langbar ${langs.length === 1 ? 'single' : ''}`}>
        {langs.map((code) => {
          const info = getLangInfo(code);
          const n = countMastered(getLangProgress(code));
          const active = code === activeLang;
          return (
            <button
              key={code}
              className={`lph-pill ${active ? 'active' : ''}`}
              onClick={() => setActiveLang(code)}
            >
              <span className="lph-pill-flag">{info?.flag || '🏳️'}</span>
              <span className="lph-pill-name">{getT(sourceLang, `langNames.${code}`) || info?.name || code}</span>
              <span className="lph-pill-count">{n}/{TOTAL_TOPICS}</span>
            </button>
          );
        })}
      </div>

      {/* 계단 — 유닛별 그룹 */}
      <div className="lph-stairs">
        {UNITS.map((unit) => {
          const unitMastered = unit.topicIds.filter((id) => isTopicMastered(progressMap[id])).length;
          return (
            <section key={unit.catId} className="lph-unit" style={{ '--unit-color': unit.color }}>
              <div className="lph-unit-banner">
                <span className="lph-unit-title">
                  {t('learningPath.unit')} {unit.unitIndex + 1} · {unit.icon} {t(`vocabCat.${unit.catId}`)}
                </span>
                <span className="lph-unit-count">{unitMastered}/{unit.topicIds.length}</span>
              </div>
              <div className="lph-nodes">
                {unit.topicIds.map((topicId, i) => {
                  const state = nodeState(topicId);
                  const isCurrent = state === 'current';
                  return (
                    <div key={topicId} className={`lph-node-wrap pos-${i % 3}`}>
                      <button
                        ref={isCurrent ? currentNodeRef : null}
                        className={`lph-node ${state}`}
                        onClick={() => onOpenTopic?.(topicId, activeLang)}
                        aria-label={t(`vocabTopic.${topicId}`)}
                      >
                        {state === 'mastered' ? <Check size={26} strokeWidth={3} />
                          : state === 'current' ? <Play size={24} fill="currentColor" />
                            : state === 'locked' ? <Lock size={18} />
                              : <span className="lph-node-dot" />}
                      </button>
                      {isCurrent && <span className="lph-here">{t('learningPath.here')}</span>}
                      <span className="lph-node-label">{t(`vocabTopic.${topicId}`)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* 70 미니그리드 — 활성 언어 마스터 색칠 */}
      <div className="lph-minimap">
        <div className="lph-minimap-head">
          <span className="lph-minimap-title">{t('learningPath.mapTitle')}</span>
          <span className="lph-minimap-legend">{t('learningPath.masteredLegend')}</span>
        </div>
        <div className="lph-minimap-rows">
          {UNITS.map((unit) => (
            <div key={unit.catId} className="lph-minimap-row" style={{ '--unit-color': unit.color }}>
              <span className="lph-minimap-cat">{unit.icon}</span>
              <div className="lph-minimap-dots">
                {unit.topicIds.map((topicId) => (
                  <span
                    key={topicId}
                    className={`lph-minidot ${isTopicMastered(progressMap[topicId]) ? 'on' : ''}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="lph-minimap-total">{masteredCount} / {TOTAL_TOPICS}</p>
      </div>
    </div>
  );
}
