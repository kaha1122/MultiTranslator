import { useState, useEffect, useRef } from 'react';
import { Lock, Check, Play, ChevronDown } from 'lucide-react';
import { getT } from '../utils/i18n';
import { getLangInfo } from '../config/languages';
import {
  UNITS,
  TOPIC_INDEX,
  TOTAL_TOPICS,
  LANG_SLOT_COLORS,
  W_TARGET,
  P_TARGET,
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

  // targetLangs 변경 시 활성 언어 보정 (prop 변화 동기화 — 조건부 1회성)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!langs.includes(activeLang)) setActiveLang(langs[0]);
  }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressMap = getLangProgress(activeLang);
  const currentTopicId = getCurrentTopicId(progressMap);

  // 멀티언어 미니맵 — 활성 언어 최대 3개를 dot 안의 색상 아크로 표시
  const dotLangs = langs.slice(0, 3);
  const langMaps = dotLangs.map((l) => getLangProgress(l));
  // 단계 원(.lph-node) 테마색 = 활성 언어의 슬롯 색. 하단 범례/grid dot과 동일 source(LANG_SLOT_COLORS)에서
  //   공급받아 "단계 원 색 = 그 언어의 dot 색"이 항상 일치. (4개+ 선택 시 미니맵 비표시 언어는 slot0 폴백)
  const activeSlot = dotLangs.indexOf(activeLang);
  const activeLangColor = LANG_SLOT_COLORS[activeSlot] ?? LANG_SLOT_COLORS[0];
  // 토픽 dot 배경: 언어별 마스터 여부를 슬롯 색(아크)로. 미마스터=연회색.
  const dotBackground = (topicId) => {
    const segs = dotLangs.map((l, i) => (isTopicMastered(langMaps[i][topicId]) ? LANG_SLOT_COLORS[i] : '#e5e7eb'));
    if (segs.length <= 1) return segs[0] || '#e5e7eb';
    const slice = 360 / segs.length;
    return `conic-gradient(${segs.map((c, i) => `${c} ${slice * i}deg ${slice * (i + 1)}deg`).join(', ')})`;
  };

  // 유닛 접기/펼치기 — 처음엔 유닛1만 열림(나머지 폴더·하단 70dot 미니맵 존재를 인지하도록)
  //   + 현재 토픽이 속한 유닛은 로드 후 자동 오픈
  const [openUnits, setOpenUnits] = useState({ 0: true });
  const didInitUnitsRef = useRef(false);
  useEffect(() => {
    if (didInitUnitsRef.current || !loaded) return;
    didInitUnitsRef.current = true;
    const cu = TOPIC_INDEX[currentTopicId]?.unitIndex;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cu != null) setOpenUnits((prev) => (prev[cu] ? prev : { ...prev, [cu]: true }));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleUnit = (idx) => setOpenUnits((prev) => ({ ...prev, [idx]: !prev[idx] }));

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

  // 절반 채움(마스터 전 단계 완료 시각화): 단어 단계 완료=왼쪽 절반, 지문 단계 완료=오른쪽 절반.
  //   둘 다면 mastered(꽉참)라 여기 도달 안 함. 단어만 학습 시 모든 토픽이 "왼쪽 반" 채워진 모습이 됨.
  const nodeHalf = (topicId) => {
    const p = progressMap[topicId];
    if (!p || isTopicMastered(p)) return null;
    if ((p.wordMastered || 0) >= W_TARGET) return 'word';      // 왼쪽
    if ((p.passageMastered || 0) >= P_TARGET) return 'passage'; // 오른쪽
    return null;
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

      {/* 계단 — 유닛별 그룹(접기/펼치기). --lph-lang-color: 활성 언어 색(노드 원이 dot과 색 일치) */}
      <div className="lph-stairs" style={{ '--lph-lang-color': activeLangColor }}>
        {UNITS.map((unit) => {
          const unitMastered = unit.topicIds.filter((id) => isTopicMastered(progressMap[id])).length;
          const open = !!openUnits[unit.unitIndex];
          return (
            <section key={unit.catId} className="lph-unit" style={{ '--unit-color': unit.color }}>
              <button
                type="button"
                className="lph-unit-banner"
                onClick={() => toggleUnit(unit.unitIndex)}
                aria-expanded={open}
              >
                <span className="lph-unit-title">
                  {t('learningPath.unit')} {unit.unitIndex + 1} · {unit.icon} {t(`vocabCat.${unit.catId}`)}
                </span>
                <span className="lph-unit-right">
                  <span className="lph-unit-count">{unitMastered}/{unit.topicIds.length}</span>
                  <ChevronDown size={16} className={`lph-unit-chevron ${open ? 'open' : ''}`} />
                </span>
              </button>
              {open && (
                <div className="lph-nodes">
                  {unit.topicIds.map((topicId, i) => {
                    const state = nodeState(topicId);
                    const half = nodeHalf(topicId); // 'word'(왼쪽)|'passage'(오른쪽)|null
                    const isCurrent = state === 'current';
                    const side = i % 2 === 0 ? 'left' : 'right';
                    return (
                      <div key={topicId} className={`lph-row ${side}`}>
                        <button
                          ref={isCurrent ? currentNodeRef : null}
                          className={`lph-node ${state}${half ? ` half-${half}` : ''}`}
                          onClick={() => onOpenTopic?.(topicId, activeLang)}
                          aria-label={t(`vocabTopic.${topicId}`)}
                        >
                          {/* 절반 채움이면 아이콘 없이 색으로만 진행 표시(꽉참=Check). */}
                          {state === 'mastered' ? <Check size={31} strokeWidth={3} />
                            : half ? null
                              : state === 'current' ? <Play size={29} fill="currentColor" />
                                : state === 'locked' ? <Lock size={23} />
                                  : <span className="lph-node-dot" />}
                        </button>
                        {isCurrent && <span className="lph-here">{t('learningPath.here')}</span>}
                        <span className="lph-node-label">{t(`vocabTopic.${topicId}`)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 70-dot 멀티언어 보드 — 활성 언어(최대 3) 마스터를 색상 아크로 */}
      <div className="lph-minimap">
        <div className="lph-minimap-head">
          <span className="lph-minimap-title">{t('learningPath.mapTitle')}</span>
        </div>
        {/* 언어 색상 범례 + 언어별 N/70 */}
        <div className="lph-minimap-legend">
          {dotLangs.map((lang, i) => (
            <span key={lang} className="lph-legend-item">
              <span className="lph-legend-swatch" style={{ background: LANG_SLOT_COLORS[i] }} />
              {getT(sourceLang, `langNames.${lang}`) || getLangInfo(lang)?.name || lang}
              <strong className="lph-legend-count">{countMastered(langMaps[i])}/{TOTAL_TOPICS}</strong>
            </span>
          ))}
        </div>
        <div className="lph-minimap-rows">
          {UNITS.map((unit) => (
            <div key={unit.catId} className="lph-minimap-row">
              <span className="lph-minimap-cat">{unit.icon}</span>
              <div className="lph-minimap-dots">
                {unit.topicIds.map((topicId) => (
                  <button
                    key={topicId}
                    type="button"
                    className="lph-minidot"
                    style={{ background: dotBackground(topicId) }}
                    onClick={() => onOpenTopic?.(topicId, activeLang)}
                    aria-label={t(`vocabTopic.${topicId}`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
