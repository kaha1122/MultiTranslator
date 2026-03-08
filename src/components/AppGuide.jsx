import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import './AppGuide.css';

const SECTIONS = [
  {
    id: 'nav',
    emoji: '☰',
    color: '#6366f1',
    bgColor: '#eef2ff',
    title: '화면 이동 방법',
    steps: [
      {
        icon: '☰',
        label: '햄버거 메뉴',
        desc: '왼쪽 상단 ☰ 버튼을 탭하면 전체 메뉴가 열립니다. 메뉴 밖을 탭하거나 ✕ 버튼을 누르면 닫힙니다.',
      },
      {
        icon: '👆',
        label: '좌우 스와이프',
        desc: '화면을 좌우로 스와이프하면 탭이 순서대로 이동합니다.\n← 오른쪽 → 왼쪽 스와이프 = 다음 탭\n→ 왼쪽 → 오른쪽 스와이프 = 이전 탭',
      },
      {
        icon: '⬤',
        label: '하단 도트(●)',
        desc: '화면 맨 아래 ● ● ● ● ● ● 도트에서 현재 위치를 확인할 수 있습니다. 도트를 탭하면 해당 탭으로 바로 이동합니다. 현재 탭은 길쭉한 초록 캡슐(━) 모양으로 표시됩니다.',
      },
    ],
    tips: [],
  },
  {
    id: 'scene',
    emoji: '🎭',
    color: '#059669',
    bgColor: '#ecfdf5',
    title: 'Scene Practice',
    subtitle: '실전 상황을 골라 AI와 대화 연습',
    steps: [
      {
        icon: '📍',
        label: 'STEP 1 — 장소 / 상황 선택',
        desc: '상단 [📍 장소] 또는 [🌟 상황] 탭을 탭해 카테고리를 전환한 뒤 원하는 항목(예: 레스토랑, 병원)을 탭하세요.\n원하는 씬이 없으면 [✏️ 직접입력] 버튼을 탭하고 상황을 직접 타이핑하세요.',
      },
      {
        icon: '⚙️',
        label: 'STEP 2 — 난이도 & 말투 설정',
        desc: '난이도: [기초] [중급] [고급] 중 하나를 탭\n말투: [Casual] = 일상 대화 / [Formal] = 격식체\n선택된 버튼은 초록색 배경으로 강조됩니다.',
      },
      {
        icon: '✨',
        label: 'STEP 3 — 문장 생성',
        desc: '🟢 [질문 생성] → 그 상황에서 내가 물어볼 문장\n🟣 [답변 생성] → 그 상황에서 내가 답할 문장\nAI가 실제 원어민이 쓰는 자연스러운 표현을 즉시 만들어줍니다.',
      },
      {
        icon: '🎙️',
        label: 'STEP 4 — 발음 연습',
        desc: '생성된 카드 하단의 [🎙️ 마이크 버튼]을 탭하면 녹음이 시작됩니다. 문장을 따라 말하면 자동으로 분석되어 정확도·유창성·운율감 3가지 점수가 표시됩니다.',
      },
      {
        icon: '☆',
        label: 'STEP 5 — 단어장 저장',
        desc: '카드 우측 상단 [☆ 별표 버튼]을 탭 → [⭐ 채워진 별]로 바뀌면 단어장 저장 완료!\n발음 점수가 목표 점수 이상이면 오늘의 학습 카드로도 자동 카운트됩니다.',
      },
    ],
    tips: [
      '💡 같은 장소를 Casual → Formal 순으로 연습하면 상황별 뉘앙스를 체득할 수 있어요',
      '💡 고급 난이도는 네이티브급 표현이 나오므로 중급 이상에게 권장',
      '💡 직접입력에 "취업 면접" "첫 소개팅" 같은 구체적인 상황을 입력해보세요',
    ],
  },
  {
    id: 'translation',
    emoji: '🔤',
    color: '#2563eb',
    bgColor: '#eff6ff',
    title: '사전 (Translation)',
    subtitle: '단어·문장 번역 + AI 학습 팁',
    steps: [
      {
        icon: '⌨️',
        label: 'STEP 1 — 텍스트 입력',
        desc: '중앙 입력창을 탭해 번역할 단어나 문장을 타이핑하세요. 입력창 위 언어 버튼(예: [한국어] [English])으로 입력 언어를 선택할 수 있습니다.',
      },
      {
        icon: '🌐',
        label: 'STEP 2 — 번역하기',
        desc: '[🟢 번역하기] 버튼을 탭하면 설정된 최대 3개 언어로 동시 번역됩니다. 번역 언어는 ☰ 메뉴 → ⚙️ 설정에서 변경 가능합니다.',
      },
      {
        icon: '💡',
        label: 'STEP 3 — AI 학습 팁 보기',
        desc: '번역 카드 하단의 [💡 학습 팁 보기 ▼]를 탭하면 AI가 만든 문법 설명, 예문, 유사 표현, 뉘앙스 차이 등이 펼쳐집니다.',
      },
      {
        icon: '🔊',
        label: 'STEP 4 — 원어민 발음 듣기',
        desc: '카드 하단 [🔊 스피커 버튼]을 탭하면 원어민 TTS 발음으로 재생됩니다. 듣고 따라 말하는 연습에 활용하세요.',
      },
      {
        icon: '🎙️',
        label: 'STEP 5 — 발음 점수 받기',
        desc: '[🎙️ 마이크 버튼]을 탭 → 문장을 말하면 정확도·유창성·운율감 점수와 음소 단위 피드백을 받습니다. [🎧 내 목소리 다시 듣기]로 원어민과 비교해 보세요.',
      },
      {
        icon: '☆',
        label: 'STEP 6 — 단어장 저장',
        desc: '[☆ 별표 버튼] 탭 → ⭐로 바뀌면 저장 완료. 발음 점수가 포함된 상태로 저장되어 나중에 Library에서 복습할 수 있습니다.',
      },
    ],
    tips: [
      '💡 단어(W)와 문장(S)은 자동 구분되어 저장 → Library에서 따로 필터링 가능',
      '💡 중국어 번역 시 병음, 일본어 번역 시 히라가나 발음 가이드가 자동 제공됩니다',
      '💡 영어 사용자라면 source 언어를 English로 설정하고 한국어 학습에 활용하세요',
    ],
  },
  {
    id: 'pronunciation',
    emoji: '🎙️',
    color: '#dc2626',
    bgColor: '#fef2f2',
    title: '발음 평가 읽는 법',
    subtitle: '3가지 점수 & 발음 해부도 활용',
    steps: [
      {
        icon: '🎯',
        label: '정확도 (Accuracy)',
        desc: '각 단어를 얼마나 정확하게 발음했는지 측정합니다. 낮으면 → 단어 발음 자체를 교정해야 합니다.',
      },
      {
        icon: '🌊',
        label: '유창성 (Fluency)',
        desc: '문장을 얼마나 끊김 없이 자연스럽게 읽었는지 측정합니다. 낮으면 → 단어 사이 멈춤 없이 이어 읽는 연습이 필요합니다.',
      },
      {
        icon: '🎭',
        label: '운율감 (Prosody)',
        desc: '강세·억양·리듬이 원어민과 얼마나 비슷한지 측정합니다. 낮으면 → 강세(stress) 위치와 억양 패턴을 의식하며 연습하세요.',
      },
      {
        icon: '🔬',
        label: '발음 해부도 활용',
        desc: '점수 아래 [발음 해부도] 섹션을 펼치면 단어별 색상으로 결과를 확인할 수 있습니다.\n🟢 초록 = 잘됨  🟡 노랑 = 아쉬움  🔴 빨강 = 오발음\n🔴 빨간 단어만 골라 집중 반복 연습하는 것이 가장 효율적입니다.',
      },
      {
        icon: '🎧',
        label: '내 목소리 다시 듣기',
        desc: '[🎧 내 목소리 다시 듣기] 버튼으로 내 녹음을 재생해 원어민 TTS와 직접 비교할 수 있습니다.',
      },
    ],
    tips: [
      '💡 처음엔 정확도 70점 목표 → 익숙해지면 85점 이상으로 점차 높여가세요',
      '💡 운율감 점수는 언어별로 달리 평가됩니다 (한국어·베트남어 등은 지원 제한)',
    ],
  },
  {
    id: 'library',
    emoji: '⭐',
    color: '#d97706',
    bgColor: '#fffbeb',
    title: '단어장 (Library)',
    subtitle: '저장된 카드 복습 & 관리',
    steps: [
      {
        icon: '🔍',
        label: '검색',
        desc: '상단 검색창에 단어나 문장 일부를 입력하면 전체 저장 카드에서 실시간 검색됩니다.',
      },
      {
        icon: '🗂️',
        label: '필터 활용',
        desc: '언어 드롭다운: 특정 언어(영어·일어·중국어 등)만 모아보기\n[W] = 단어만 / [S] = 문장만 보기\n[🎯 목표 미달만]: 아직 목표 점수에 못 미친 카드만 필터링 → 약점 집중 복습에 최적',
      },
      {
        icon: '🔊',
        label: '카드 버튼 — 🔊 듣기',
        desc: '카드의 [🔊 스피커 버튼]을 탭하면 원어민 발음으로 TTS가 재생됩니다.',
      },
      {
        icon: '🎙️',
        label: '카드 버튼 — 🎙️ 발음 재연습',
        desc: '카드의 [🎙️ 마이크 버튼]을 탭해 언제든 다시 발음 연습할 수 있습니다. 점수가 갱신되어 저장됩니다.',
      },
      {
        icon: '📝',
        label: '카드 버튼 — 📝 메모',
        desc: '[📝 메모 버튼]을 탭하면 나만의 학습 포인트, 예문, 기억 팁 등을 직접 적을 수 있습니다.',
      },
      {
        icon: '🗑️',
        label: '카드 버튼 — 🗑️ 삭제',
        desc: '[🗑️ 삭제 버튼] → 확인 팝업에서 [삭제]를 탭하면 카드가 제거됩니다. 삭제 후 같은 문장을 다시 저장할 수 있습니다.',
      },
    ],
    tips: [
      '💡 매일 Library를 열어 "목표 미달 필터"로 부족한 카드만 골라 5분 집중 복습을 추천해요',
      '💡 메모에 "외울 때 힘든 포인트"를 적어두면 장기 기억에 도움이 됩니다',
    ],
  },
  {
    id: 'voa',
    emoji: '📰',
    color: '#0891b2',
    bgColor: '#ecfeff',
    title: 'VOA News',
    subtitle: '실제 영어 뉴스로 발음 훈련',
    steps: [
      {
        icon: '📊',
        label: 'STEP 1 — 레벨 선택',
        desc: '상단 [입문] [중급] [고급] 탭을 탭해 내 수준에 맞는 기사 목록을 불러옵니다.\n입문 = 짧고 쉬운 문장 / 고급 = 실제 뉴스 수준',
      },
      {
        icon: '📄',
        label: 'STEP 2 — 기사 선택',
        desc: '목록에서 관심 있는 기사 제목을 탭하면 기사 내용이 문장 단위로 분리되어 표시됩니다.',
      },
      {
        icon: '🔊',
        label: 'STEP 3 — 전체 오디오 듣기',
        desc: '기사 상단 [🔊 기사 전체 듣기] 버튼으로 전체 내용을 오디오로 먼저 청취하세요. 귀로 먼저 익힌 뒤 따라 말하면 효과가 배가됩니다.',
      },
      {
        icon: '🎙️',
        label: 'STEP 4 — 문장별 발음 연습',
        desc: '연습할 문장을 탭하면 선택(하이라이트)됩니다. 아래 [🎙️ 발음 연습] 버튼을 탭해 해당 문장만 발음 평가를 받으세요.',
      },
      {
        icon: '☆',
        label: 'STEP 5 — 문장 저장',
        desc: '점수가 나온 후 [☆ Library에 저장] 버튼을 탭하면 단어장에 추가됩니다.',
      },
    ],
    tips: [
      '💡 오디오 → 자신감 생기면 발음 연습 순서를 권장합니다',
      '💡 시사 어휘는 반복 등장하므로 Library 저장 후 주기적으로 복습하면 뉴스 청취력이 빠르게 향상됩니다',
    ],
  },
  {
    id: 'ted',
    emoji: '🎬',
    color: '#7c3aed',
    bgColor: '#f5f3ff',
    title: 'YouTube / TED',
    subtitle: '영상 보며 자연스러운 영어 습득',
    steps: [
      {
        icon: '🔗',
        label: 'STEP 1-A — YouTube URL 입력',
        desc: 'YouTube 앱에서 영상 공유 → URL 복사 → 앱 상단 입력창에 붙여넣고 [▶️ 재생] 버튼을 탭하세요.',
      },
      {
        icon: '📋',
        label: 'STEP 1-B — TED 강연 선택',
        desc: '아래 [📋 TED 최신 강연] 목록에서 관심 주제 영상을 탭하면 바로 재생됩니다. 기술·환경·심리 등 다양한 주제 강연이 매일 업데이트됩니다.',
      },
      {
        icon: '📝',
        label: 'STEP 2 — CC 자막 활용',
        desc: '영상 플레이어 우측 하단 [CC] 버튼을 탭하면 영어 자막이 표시됩니다. 처음엔 자막을 켜고 보다가, 익숙해지면 자막 없이 듣기에 도전하세요.',
      },
      {
        icon: '🗣️',
        label: 'STEP 3 — 섀도잉 연습',
        desc: '영상을 일시정지하고 방금 들은 문장을 바로 따라 말하는 "섀도잉" 연습이 가장 효과적입니다. 사전 탭에서 모르는 단어를 확인하며 병행하세요.',
      },
    ],
    tips: [
      '💡 TED 강연은 명확한 발음의 표준 영어라 발음 교정에 최적입니다',
      '💡 관심 있는 주제(기술, 환경, 심리 등) 영상을 선택하면 학습 지속력이 올라갑니다',
    ],
  },
  {
    id: 'goal',
    emoji: '🎯',
    color: '#db2777',
    bgColor: '#fdf2f8',
    title: '학습 목표 & 진도 관리',
    subtitle: '하루 목표 설정으로 꾸준한 학습',
    steps: [
      {
        icon: '⚙️',
        label: '목표 설정 방법',
        desc: '☰ 메뉴 → [⚙️ 설정] → [하루 학습 목표] 슬라이더를 좌우로 드래그해 하루에 달성할 카드 수를 1~20장 사이로 설정합니다.',
      },
      {
        icon: '📊',
        label: '진도 확인',
        desc: '앱 상단 헤더에 항상 표시됩니다.\n🎯 3/10  ██████░░░░\n숫자는 오늘 달성 카드 수 / 목표 카드 수입니다.',
      },
      {
        icon: '🎉',
        label: '목표 달성 & 주간 현황',
        desc: '발음 점수가 목표 점수 이상인 카드를 저장하면 오늘 카운트에 반영됩니다. 목표 달성 시 🎉 팝업이 뜨며 주간 달성 그래프를 확인할 수 있습니다.',
      },
      {
        icon: '🎯',
        label: '언어별 목표 점수 설정',
        desc: '☰ 메뉴 → [⚙️ 설정] → [Target Score Goals] 슬라이더에서 언어별로 다른 목표 점수를 설정할 수 있습니다. 기본값은 80점입니다.',
      },
    ],
    tips: [
      '💡 처음엔 하루 3~5장으로 시작해 습관이 생기면 늘려가는 방식을 권장합니다',
      '💡 목표 점수를 너무 높게 설정하면 저장이 어려워집니다. 처음엔 70점부터 시작하세요',
    ],
  },
];

export default function AppGuide({ onBack }) {
  const [openId, setOpenId] = useState('nav');
  const sectionRefs = useRef({});

  useEffect(() => {
    const handleKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Backspace' || e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onBack]);

  const handleToggle = (secId, isOpen) => {
    if (isOpen) {
      setOpenId(null);
    } else {
      setOpenId(secId);
      requestAnimationFrame(() => {
        sectionRefs.current[secId]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };

  return (
    <div className="guide-page">
      {/* 헤더 */}
      <div className="guide-header">
        <button className="guide-back-btn" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <h2 className="guide-title">앱 활용 가이드</h2>
        <div style={{ width: 36 }} />
      </div>

      <div className="guide-intro">
        PronunFit의 모든 기능을 200% 활용하는 방법을 안내합니다 🚀
      </div>

      {/* 섹션 목록 */}
      <div className="guide-sections">
        {SECTIONS.map((sec) => {
          const isOpen = openId === sec.id;
          return (
            <div
              key={sec.id}
              ref={el => sectionRefs.current[sec.id] = el}
              className={`guide-section ${isOpen ? 'open' : ''}`}
              style={{ '--sec-color': sec.color, '--sec-bg': sec.bgColor }}
            >
              {/* 섹션 헤더 */}
              <button
                className="guide-section-header"
                onClick={() => handleToggle(sec.id, isOpen)}
              >
                <div className="guide-section-header-left">
                  <span className="guide-section-emoji">{sec.emoji}</span>
                  <div>
                    <div className="guide-section-name">{sec.title}</div>
                    {sec.subtitle && (
                      <div className="guide-section-sub">{sec.subtitle}</div>
                    )}
                  </div>
                </div>
                {isOpen ? <ChevronUp size={18} color="#94a3b8" /> : <ChevronDown size={18} color="#94a3b8" />}
              </button>

              {/* 섹션 콘텐츠 */}
              {isOpen && (
                <div className="guide-section-body">
                  {sec.steps.map((step, i) => (
                    <div key={i} className="guide-step">
                      <div className="guide-step-icon">{step.icon}</div>
                      <div className="guide-step-content">
                        <div className="guide-step-label">{step.label}</div>
                        <div className="guide-step-desc">{step.desc}</div>
                      </div>
                    </div>
                  ))}

                  {sec.tips.length > 0 && (
                    <div className="guide-tips-box">
                      {sec.tips.map((tip, i) => (
                        <p key={i} className="guide-tip-item">{tip}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ height: 8 }} />
      <button className="guide-close-btn" onClick={onBack}>← 돌아가기</button>
      <div style={{ height: 32 }} />
    </div>
  );
}
