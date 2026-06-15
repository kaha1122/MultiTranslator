// ── 학습 경로(Learning Path) 중앙 설정 ────────────────────────────────────
// VOCAB_CATEGORIES(7 카테고리 × 2 서브 × 5 토픽 = 70토픽)에서 코스 순서를 파생한다.
// 토픽 마스터 임계값·유닛 색상·현재 추천 토픽 계산을 한 곳에서 관리(튜닝 용이).
//
// Phase 1 진행 모델: users/{uid}/topicProgress/{topicId}--{lang} (서브컬렉션)
//   - 마스터 = wordMastered >= W_TARGET AND passageMastered >= P_TARGET
//   - users 본문에는 절대 기록하지 않음 (iOS 발열 규칙)

import VOCAB_CATEGORIES from '../data/vocabCategories.js';

// 마스터 임계값 (post-launch 튜닝 대상)
// 2026-06-14: 완료 부담 완화 — 단어 1개 + 지문 문장 1개 통과 시 토픽 마스터.
//   (학습 카드는 여전히 5장 제공/study, 마스터·Listening 잠금해제는 1통과면 충분)
export const W_TARGET = 2; // 단어 발음 통과 목표(마스터·Listening 잠금해제) — 2026-06-16 1→2
export const P_TARGET = 2; // 지문 문장 통과 목표(마스터) — 2026-06-16 1→2

// 유닛(=카테고리) 색상 — V2 스펙: teal/blue/purple/amber/pink/coral/green
export const UNIT_COLORS = {
  daily: '#0d9488',     // teal
  travel: '#2563eb',    // blue
  business: '#7c3aed',  // purple
  education: '#d97706',  // amber
  social: '#db2777',    // pink
  tech: '#ea580c',      // coral
  culture: '#16a34a',   // green
};

const DEFAULT_COLOR = '#6366f1';

// 멀티언어 미니맵 — 활성 언어 슬롯(최대 3)별 색상 (slot0 teal / slot1 blue / slot2 pink)
export const LANG_SLOT_COLORS = ['#0d9488', '#2563eb', '#db2777'];

// 유닛 목록 — VOCAB_CATEGORIES 배열 순서 유지. topics = subs.flatMap(s => s.topics)
export const UNITS = VOCAB_CATEGORIES.map((cat, unitIndex) => ({
  unitIndex,
  catId: cat.id,
  icon: cat.icon,
  color: UNIT_COLORS[cat.id] || DEFAULT_COLOR,
  subIds: cat.subs.map((s) => s.id),
  topicIds: cat.subs.flatMap((s) => s.topics.map((t) => t.id)),
}));

// 코스 순서 — 모든 유닛을 펼친 평면 토픽 디스크립터 배열(soft-lock "현재" 계산 기준)
export const COURSE_ORDER = [];
VOCAB_CATEGORIES.forEach((cat, unitIndex) => {
  cat.subs.forEach((sub) => {
    sub.topics.forEach((topic) => {
      COURSE_ORDER.push({
        topicId: topic.id,
        catId: cat.id,
        subId: sub.id,
        unitIndex,
        color: UNIT_COLORS[cat.id] || DEFAULT_COLOR,
        icon: cat.icon,
      });
    });
  });
});

export const TOTAL_TOPICS = COURSE_ORDER.length; // 70

// topicId → { topicId, catId, subId, unitIndex, color, icon, orderIndex }
// preset 진입(catId/subId 필요)과 정렬 위치 조회에 사용
export const TOPIC_INDEX = COURSE_ORDER.reduce((acc, entry, orderIndex) => {
  acc[entry.topicId] = { ...entry, orderIndex };
  return acc;
}, {});

// 빈 진행 객체 생성기 (Firestore 문서 부재 시 로컬 기본값)
export const makeEmptyProgress = (topicId, lang) => ({
  topicId,
  lang,
  wordMastered: 0,
  passageMastered: 0,
  status: 'locked',
  byLevel: {
    basic: { word: 0, passage: 0 },
    intermediate: { word: 0, passage: 0 },
    advanced: { word: 0, passage: 0 },
  },
});

// ── 진행 판정 헬퍼 (progress = topicProgress 문서 객체 또는 undefined) ──────
export const isTopicMastered = (p) =>
  !!p && (p.wordMastered || 0) >= W_TARGET && (p.passageMastered || 0) >= P_TARGET;

// 단어 단계 완료 여부 — 지문(Listening) 잠금 해제 조건
export const isWordPhaseComplete = (p) => !!p && (p.wordMastered || 0) >= W_TARGET;

// 카운트에서 상태 파생 (locked는 위치 기반이라 호출부에서 결정; 여기선 진행/마스터만)
export const deriveStatus = (p) => {
  if (isTopicMastered(p)) return 'mastered';
  if (p && ((p.wordMastered || 0) > 0 || (p.passageMastered || 0) > 0)) return 'in_progress';
  return 'locked';
};

// 추천("지금 여기") 토픽 = 코스 순서상 아직 마스터되지 않은 첫 토픽
// progressMap: { [topicId]: progress } (특정 언어 기준)
export const getCurrentTopicId = (progressMap) => {
  for (const entry of COURSE_ORDER) {
    if (!isTopicMastered(progressMap?.[entry.topicId])) return entry.topicId;
  }
  return COURSE_ORDER[COURSE_ORDER.length - 1].topicId; // 전부 마스터 → 마지막
};

// 특정 언어의 마스터 토픽 수 (언어 pill의 N/70 표시용)
export const countMastered = (progressMap) =>
  COURSE_ORDER.reduce(
    (n, e) => n + (isTopicMastered(progressMap?.[e.topicId]) ? 1 : 0),
    0,
  );
