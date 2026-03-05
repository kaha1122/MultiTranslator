import { useEffect, useRef } from 'react';
import './LandingPage.css';

const LandingPage = ({ onStart }) => {
  const titleRef = useRef(null);
  const subRef = useRef(null);

  // USP 자동 로테이터 (5초마다 히어로 타이틀·서브 페이드 전환)
  const usps = [
    {
      title: '원어민 발음을\n가장 빠르게 만드는 방법',
      sub: 'AI가 번역하고, 채점하고, 코치합니다. 8개 국어, 무료로.',
    },
    {
      title: '듣고, 따라하고,\n점수 받고 완벽해지다',
      sub: '정확도·유창성·운율까지 5가지 지표로 원어민과의 차이를 한눈에 확인하세요.',
    },
    {
      title: '저장하고 다시 연습하는\n나만의 스마트 단어장',
      sub: '별표 하나로 저장, 보관함에서 꺼내어 발음 연습까지 이어집니다.',
    },
    {
      title: 'VOA·NHK·국립어학원\n살아있는 언어로 연습',
      sub: '실제 뉴스와 공식 교육 콘텐츠로 각국 언어의 진짜 발음을 익히세요.',
    },
  ];

  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      if (!titleRef.current || !subRef.current) return;
      titleRef.current.style.opacity = '0';
      subRef.current.style.opacity = '0';
      setTimeout(() => {
        idx = (idx + 1) % usps.length;
        if (!titleRef.current || !subRef.current) return;
        titleRef.current.innerText = usps[idx].title;
        subRef.current.innerText = usps[idx].sub;
        titleRef.current.style.transition = 'opacity 0.5s ease';
        subRef.current.style.transition = 'opacity 0.5s ease';
        titleRef.current.style.opacity = '1';
        subRef.current.style.opacity = '1';
      }, 500);
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lp-root">
      {/* 배경 앰비언트 조명 */}
      <div className="lp-ambient lp-ambient-1" />
      <div className="lp-ambient lp-ambient-2" />

      {/* ── 네비게이션 ── */}
      <nav className="lp-nav">
        <div className="lp-logo">PronunFit.</div>
        <button className="lp-login-btn" onClick={onStart}>로그인</button>
      </nav>

      {/* ── HERO 섹션 ── */}
      <header className="lp-hero">
        <div className="lp-tagline">
          <span className="lp-tagline-dot" />
          8개 국어 AI 발음 코치 · 무료
        </div>

        <h1 className="lp-hero-title" ref={titleRef}>
          원어민 발음을{'\n'}가장 빠르게 만드는 방법
        </h1>

        <p className="lp-hero-subtitle" ref={subRef}>
          AI가 번역하고, 채점하고, 코치합니다.{' '}
          <span className="lp-hero-sub-em">8개 국어, 무료로.</span>
        </p>

        <div className="lp-cta-group">
          <button className="lp-btn lp-btn-primary" onClick={onStart}>
            무료로 시작하기
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onStart}>
            로그인
          </button>
        </div>

        {/* 신뢰 지표 */}
        <div className="lp-hero-stats">
          <div className="lp-stat">
            <span className="lp-stat-num">8</span>
            <span className="lp-stat-label">지원 언어</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-num">100</span>
            <span className="lp-stat-label">점 만점 채점</span>
          </div>
          <div className="lp-stat">
            <span className="lp-stat-num">0원</span>
            <span className="lp-stat-label">완전 무료</span>
          </div>
        </div>
      </header>

      {/* ── USP Feature Cards ── */}
      <section className="lp-usp-section">
        <p className="lp-section-label">핵심 기능</p>
        <h2 className="lp-section-title">왜 PronunFit인가요?</h2>

        <div className="lp-features-grid">
          {/* USP 1 */}
          <div className="lp-feature-card">
            <div className="lp-feature-icon-wrap">🆓</div>
            <span className="lp-feature-number">01 · 완전 무료</span>
            <h3 className="lp-feature-title">8개 국어 AI 발음 앱,<br />0원으로 시작</h3>
            <p className="lp-feature-desc">
              영어·한국어·일본어·중국어·베트남어·프랑스어·독일어·스페인어.
              광고 없이, 숨겨진 비용 없이 — 가입만 하면 모든 기능이 무료입니다.
            </p>
            <span className="lp-feature-tag">✓ 신용카드 불필요</span>
          </div>

          {/* USP 2 */}
          <div className="lp-feature-card">
            <div className="lp-feature-icon-wrap">🎙️</div>
            <span className="lp-feature-number">02 · AI 발음 코치</span>
            <h3 className="lp-feature-title">듣고 → 따라하고 →<br />점수 받고</h3>
            <p className="lp-feature-desc">
              AI가 문장을 읽어주면 따라 말하세요. 정확도·유창성·운율까지
              5가지 항목을 실시간으로 분석해 그래프로 보여드립니다.
              원어민과의 차이가 한눈에 보입니다.
            </p>
            <span className="lp-feature-tag">✓ Azure AI 음성 분석</span>
          </div>

          {/* USP 3 */}
          <div className="lp-feature-card">
            <div className="lp-feature-icon-wrap">📚</div>
            <span className="lp-feature-number">03 · 스마트 단어장</span>
            <h3 className="lp-feature-title">저장하고, 찾고,<br />다시 연습하는 단어장</h3>
            <p className="lp-feature-desc">
              번역한 문장을 별표 하나로 저장하면 끝. 보관함에서 꺼내어
              발음 연습까지 이어집니다. 반복이 완벽한 발음을 만듭니다.
            </p>
            <span className="lp-feature-tag">✓ 학습 기록 자동 저장</span>
          </div>

          {/* USP 4 */}
          <div className="lp-feature-card">
            <div className="lp-feature-icon-wrap">🌍</div>
            <span className="lp-feature-number">04 · 실제 콘텐츠 연습</span>
            <h3 className="lp-feature-title">VOA·NHK·국립어학원<br />살아있는 언어로</h3>
            <p className="lp-feature-desc">
              실제 뉴스와 공식 교육 기관 콘텐츠로 발음 연습합니다.
              영어는 VOA / Wall Street Journal, 일본어는 NHK,
              한국어는 국립어학원 기반 문장으로 진짜 언어를 배우세요.
            </p>
            <span className="lp-feature-tag">✓ 공식 인증 콘텐츠</span>
          </div>
        </div>
      </section>

      {/* ── 앱 스크린샷 섹션 ── */}
      <section className="lp-app-section">
        <p className="lp-section-label">앱 살펴보기</p>
        <h2 className="lp-section-title">이런 기능들이 기다리고 있어요</h2>

        <div className="lp-app-grid">
          {/* 발음 채점 결과 */}
          <div className="lp-app-card">
            <div className="lp-app-card-body">
              <span className="lp-app-card-badge">발음 분석 결과</span>
              <h3 className="lp-app-card-title">AI가 음소 단위까지<br />정밀하게 분석합니다</h3>
              <p className="lp-app-card-desc">
                말한 뒤 바로 점수가 나옵니다. 단어별·음소별 정확도를
                신호등 색상으로 직관적으로 확인하고, AI 코치의 맞춤 피드백까지 받아보세요.
              </p>
            </div>
            <img
              src="/mockup_pronunciation.png"
              alt="발음 분석 결과 화면"
              className="lp-app-card-img"
            />
          </div>

          {/* 다국어 설정 */}
          <div className="lp-app-card">
            <div className="lp-app-card-body">
              <span className="lp-app-card-badge">언어 &amp; 목표 설정</span>
              <h3 className="lp-app-card-title">내 상황에 맞게<br />언어와 목표를 설정하세요</h3>
              <p className="lp-app-card-desc">
                8개 언어 중 원하는 언어를 최대 3개까지 선택하고,
                목표 점수를 설정하면 AI가 그에 맞는 코칭을 제공합니다.
                언제든 자유롭게 변경할 수 있습니다.
              </p>
            </div>
            <img
              src="/mockup_multilang.png"
              alt="다국어 설정 화면"
              className="lp-app-card-img"
            />
          </div>
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className="lp-cta-section">
        <h2 className="lp-cta-title">
          지금 바로 시작하세요.<br />
          <span className="lp-highlight">무료로, 바로.</span>
        </h2>
        <p className="lp-cta-sub">
          회원가입 30초. 8개 국어 AI 발음 코치가 지금 여러분을 기다립니다.
        </p>
        <div className="lp-cta-btn-wrap">
          <button className="lp-btn lp-btn-primary" onClick={onStart}>
            무료로 시작하기
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onStart}>
            로그인
          </button>
        </div>
        <p className="lp-footer-note">PronunFit · AI Pronunciation Coach · 가입 즉시 무료 이용</p>
      </section>
    </div>
  );
};

export default LandingPage;
