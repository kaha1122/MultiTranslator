import './TabTutorial.css';

// 탭별 첫 방문 튜토리얼 — 탭당 2개 팁
export const TAB_TUTORIALS = {
  scene: [
    {
      icon: '📍',
      title: '장소 / 상황을 선택하세요',
      desc: '상단 카테고리(공항, 레스토랑 등)를 탭하거나 ✏️ 직접입력으로 원하는 씬을 만들고, 🟢 질문 생성 / 🟣 답변 생성 버튼을 탭해 AI 문장을 받아보세요.',
    },
    {
      icon: '🎙️',
      title: '발음 연습하고 ☆ 별표로 저장',
      desc: '카드 하단 🎙️ 마이크 버튼을 탭해 발음 점수를 받고, 우측 ☆ 별표로 단어장에 저장하세요. 저장된 카드는 나중에 ⭐ 단어장에서 복습할 수 있어요.',
    },
  ],
  translation: [
    {
      icon: '🔤',
      title: '번역 + AI 학습 팁까지 한번에',
      desc: '단어나 문장을 입력 후 🟢 번역하기 버튼을 탭하세요. 카드 하단 💡 학습 팁 보기를 탭하면 AI가 만든 문법 설명·예문·뉘앙스 차이도 확인할 수 있어요.',
    },
    {
      icon: '🎯',
      title: '발음 점수 받고 ☆ 저장',
      desc: '각 번역 카드의 🎙️ 마이크 버튼으로 발음 점수를 받으세요. 목표 점수 이상이면 오늘의 학습 카드로 카운트됩니다. ☆ 버튼으로 단어장에 저장하세요.',
    },
  ],
  library: [
    {
      icon: '🗂️',
      title: '필터로 원하는 카드만 보기',
      desc: '상단 언어 드롭다운과 [W] 단어 / [S] 문장 버튼으로 카드를 분류해 볼 수 있어요. 검색창에 키워드를 입력하면 전체 저장 카드를 검색할 수 있습니다.',
    },
    {
      icon: '🎯',
      title: '약점 카드만 골라 집중 복습',
      desc: '[🎯 목표 미달만] 버튼을 탭하면 아직 목표 점수에 못 미친 카드만 필터링됩니다. 카드의 🎙️ 버튼으로 다시 연습하고 점수를 업데이트해보세요.',
    },
  ],
  voa: [
    {
      icon: '📰',
      title: '레벨 선택 후 오디오 먼저 듣기',
      desc: '[입문] [중급] [고급] 중 내 수준에 맞는 탭을 고르고, 기사를 탭하세요. 🔊 기사 전체 듣기 버튼으로 오디오를 먼저 들은 후 발음 연습하면 효과가 2배예요.',
    },
    {
      icon: '🎙️',
      title: '문장 탭 → 발음 연습 → 저장',
      desc: '기사 본문에서 연습할 문장을 탭해 선택한 뒤, 🎙️ 발음 연습 버튼을 탭하세요. 점수를 받은 후 ☆ Library에 저장 버튼으로 단어장에 추가할 수 있어요.',
    },
  ],
  ted: [
    {
      icon: '🎬',
      title: 'YouTube URL 또는 TED 강연 선택',
      desc: 'YouTube에서 영상 URL을 복사해 붙여넣고 ▶️ 재생을 탭하거나, 아래 TED 최신 강연 목록에서 관심 주제를 골라 바로 시청하세요.',
    },
    {
      icon: '💡',
      title: 'CC 자막 켜고 섀도잉 연습',
      desc: '영상 플레이어의 CC 버튼을 탭해 영어 자막을 켜세요. 영상을 잠깐 멈추고 방금 들은 표현을 바로 따라 말하는 섀도잉이 가장 효과적인 학습법이에요.',
    },
  ],
  settings: [
    {
      icon: '🌍',
      title: '학습 언어 설정',
      desc: 'Source Language(모국어)와 Target Language(학습 언어, 최대 3개)를 설정하세요. 영어를 배운다면 Source=한국어, Target=English로 설정하면 됩니다.',
    },
    {
      icon: '🎯',
      title: '목표 점수 & 하루 학습 목표',
      desc: 'Target Score Goals 슬라이더로 언어별 목표 점수를 설정하세요. 하루 학습 목표 카드 수도 설정하면 진도 바에서 실시간으로 확인할 수 있어요.',
    },
  ],
};

export default function TabTutorial({ tab, step, total, onNext, onSkip }) {
  const tutorials = TAB_TUTORIALS[tab];
  if (!tutorials) return null;
  const current = tutorials[step];
  if (!current) return null;

  const isLast = step === total - 1;

  return (
    <>
    <div className="tutorial-backdrop" onClick={onSkip} />
    <div className="tutorial-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="tutorial-card">
        {/* 상단: 아이콘 + 닫기 */}
        <div className="tutorial-card-top">
          <span className="tutorial-card-icon">{current.icon}</span>
          <button className="tutorial-skip-btn" onClick={onSkip}>건너뛰기</button>
        </div>

        {/* 제목 & 설명 */}
        <div className="tutorial-card-title">{current.title}</div>
        <div className="tutorial-card-desc">{current.desc}</div>

        {/* 하단: 도트 스텝 + 버튼 */}
        <div className="tutorial-card-bottom">
          <div className="tutorial-step-dots">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`tutorial-step-dot ${i === step ? 'active' : ''}`}
              />
            ))}
          </div>
          <button className="tutorial-next-btn" onClick={onNext}>
            {isLast ? '시작하기! 🚀' : '다음 팁 →'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
