import { useEffect, useRef, useState } from 'react';
import './LandingPage.css';

const CONTENT = {
  ko: {
    login: '로그인',
    usps: [
      { title: '무료로 원어민 발음을\n가장 빠르게 향상시키는 방법', sub: 'AI가 번역하고, 채점하고, 코치하고. 8개국 어학학습을 무료로.' },
      { title: 'AI와 듣고, 따라하고,\n점수 받고 완벽해지다', sub: '정확도·유창성·운율까지 5가지 지표로 원어민과의 차이를 한눈에 확인하세요.' },
      { title: '저장하고 다시 연습하는\n나만의 스마트 단어장', sub: '별표 하나로 저장, 보관함에서 꺼내어 발음 연습까지 이어집니다.' },
      { title: '풍부한 교육 컨텐츠\n살아있는 언어로 연습', sub: '실제 뉴스와 공식 교육 콘텐츠로 각국 언어의 진짜 발음을 익히세요.' },
    ],
    tagline: '8개 국어 AI 발음 코치 · 무료',
    heroTitle: '원어민 발음을\n가장 빠르게 만드는 방법',
    heroSub: 'AI가 번역하고, 채점하고, 코치합니다. ',
    heroSubEm: '8개 국어, 무료로.',
    ctaStart: '무료로 시작하기',
    stats: [{ num: '8', label: '지원 언어' }, { num: '100', label: '점 만점 채점' }, { num: '0원', label: '완전 무료' }],
    sectionLabel: '핵심 기능',
    sectionTitle: '왜 PronunFit인가요?',
    features: [
      { icon: '🆓', num: '01 · 완전 무료', title: '8개 국어 AI 발음 앱,<br />0원으로 시작', desc: '영어·한국어·일본어·중국어·베트남어·프랑스어·독일어·스페인어. 광고 없이, 숨겨진 비용 없이 — 가입만 하면 모든 기능이 무료입니다.', tag: '✓ 신용카드 불필요' },
      { icon: '🎙️', num: '02 · AI 발음 코치', title: '듣고 → 따라하고 →<br />점수 받고', desc: 'AI가 문장을 읽어주면 따라 말하세요. 정확도·유창성·운율까지 5가지 항목을 실시간으로 분석해 그래프로 보여드립니다.', tag: '✓ Azure AI 음성 분석' },
      { icon: '📚', num: '03 · 스마트 단어장', title: '저장하고, 찾고,<br />다시 연습하는 단어장', desc: '번역한 문장을 별표 하나로 저장하면 끝. 보관함에서 꺼내어 발음 연습까지 이어집니다.', tag: '✓ 학습 기록 자동 저장' },
      { icon: '🌍', num: '04 · 실제 콘텐츠 연습', title: 'VOA·NHK·국립어학원<br />살아있는 언어로', desc: '실제 뉴스와 공식 교육 기관 콘텐츠로 발음 연습합니다. 영어는 VOA, 일본어는 NHK 기반 문장으로 진짜 언어를 배우세요.', tag: '✓ 공식 인증 콘텐츠' },
    ],
    appLabel: '앱 살펴보기',
    appTitle: '이런 기능들이 기다리고 있어요',
    appCards: [
      { badge: '발음 분석 결과', title: 'AI가 음소 단위까지<br />정밀하게 분석합니다', desc: '말한 뒤 바로 점수가 나옵니다. 단어별·음소별 정확도를 신호등 색상으로 직관적으로 확인하고, AI 코치의 맞춤 피드백까지 받아보세요.', img: '/mockup_pronunciation.png', imgAlt: '발음 분석 결과 화면' },
      { badge: '언어 & 목표 설정', title: '내 상황에 맞게<br />언어와 목표를 설정하세요', desc: '8개 언어 중 원하는 언어를 최대 3개까지 선택하고, 목표 점수를 설정하면 AI가 그에 맞는 코칭을 제공합니다.', img: '/mockup_multilang.png', imgAlt: '다국어 설정 화면' },
    ],
    ctaTitle: '지금 바로 시작하세요.',
    ctaHighlight: '무료로, 바로.',
    ctaSub: '회원가입 30초. 8개 국어 AI 발음 코치가 지금 여러분을 기다립니다.',
    footerNote: 'PronunFit · AI Pronunciation Coach · 가입 즉시 무료 이용',
    installPopup: '📲 앱을 설치 하시면,\n바로 접속 가능합니다',
  },
  en: {
    login: 'Log In',
    usps: [
      { title: 'The fastest way to master\nnative-level pronunciation — free', sub: 'AI translates, scores, and coaches you. 8 languages, completely free.' },
      { title: 'Listen · Repeat · Get scored\nand perfect your accent', sub: 'See accuracy, fluency, and prosody across 5 metrics to pinpoint the gap with native speakers.' },
      { title: 'Your smart vocabulary vault —\nsave and practice again', sub: 'One tap to save, then pull it back for pronunciation drills anytime.' },
      { title: 'Rich authentic content\nfor real-world practice', sub: 'Practice with real news and official educational content to pick up genuine pronunciation.' },
    ],
    tagline: 'AI Pronunciation Coach · 8 Languages · Free',
    heroTitle: 'The fastest way to master\nnative-level pronunciation',
    heroSub: 'AI translates, scores, and coaches you. ',
    heroSubEm: '8 languages, completely free.',
    ctaStart: 'Start for Free',
    stats: [{ num: '8', label: 'Languages' }, { num: '100', label: 'Point scoring' }, { num: 'Free', label: 'Always free' }],
    sectionLabel: 'Key Features',
    sectionTitle: 'Why PronunFit?',
    features: [
      { icon: '🆓', num: '01 · Completely Free', title: 'AI pronunciation in 8 languages,<br />zero cost', desc: 'English · Korean · Japanese · Chinese · Vietnamese · French · German · Spanish. No ads, no hidden fees — sign up and unlock everything for free.', tag: '✓ No credit card required' },
      { icon: '🎙️', num: '02 · AI Pronunciation Coach', title: 'Listen → Repeat →<br />Get your score', desc: 'AI reads the sentence aloud — you repeat it. Get real-time analysis of accuracy, fluency, and prosody across 5 dimensions, visualized in a graph.', tag: '✓ Powered by Azure AI Speech' },
      { icon: '📚', num: '03 · Smart Vocabulary Vault', title: 'Save, review,<br />and drill again', desc: 'Star any translated sentence to save it instantly. Open your library anytime and jump straight into pronunciation practice.', tag: '✓ Auto-saved learning history' },
      { icon: '🌍', num: '04 · Authentic Content Practice', title: 'VOA · NHK · Official sources<br />Real language, real context', desc: 'Practice pronunciation with actual news and accredited educational content. VOA for English, NHK for Japanese — learn the language as it\'s really spoken.', tag: '✓ Verified official content' },
    ],
    appLabel: 'Explore the App',
    appTitle: 'Here\'s what\'s waiting for you',
    appCards: [
      { badge: 'Pronunciation Analysis', title: 'AI scores you down to<br />individual phonemes', desc: 'Get your score instantly after speaking. See per-word and per-phoneme accuracy color-coded like a traffic light, plus personalized coaching tips from AI.', img: '/mockup_pronunciation.png', imgAlt: 'Pronunciation analysis screen' },
      { badge: 'Language & Goal Setup', title: 'Set your languages<br />and target score', desc: 'Pick up to 3 of 8 languages and set your target score — AI tailors its coaching to match. Change your settings anytime.', img: '/mockup_multilang.png', imgAlt: 'Multi-language settings screen' },
    ],
    ctaTitle: 'Start right now.',
    ctaHighlight: 'Free. Instant.',
    ctaSub: '30 seconds to sign up. Your AI pronunciation coach in 8 languages is ready.',
    footerNote: 'PronunFit · AI Pronunciation Coach · Free from day one',
    installPopup: '📲 Install the app\nfor instant access',
  },
};

const LandingPage = ({ onStart, onInstall, showInstall }) => {
  const titleRef = useRef(null);
  const subRef = useRef(null);
  const bottomRef = useRef(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);

  const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  const c = browserLang.startsWith('ko') ? CONTENT.ko : CONTENT.en;

  const usps = c.usps;

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

  // 스크롤 끝 감지 → 설치 팝업
  useEffect(() => {
    if (!showInstall || !bottomRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setShowInstallPopup(true); },
      { threshold: 0.5 }
    );
    observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [showInstall]);

  return (
    <div className="lp-root">
      {/* 배경 앰비언트 조명 */}
      <div className="lp-ambient lp-ambient-1" />
      <div className="lp-ambient lp-ambient-2" />

      {/* ── 네비게이션 ── */}
      <nav className="lp-nav">
        <div className="lp-logo">PronunFit.</div>
        <div className="lp-nav-actions">
          {showInstall && (
            <button className="lp-install-btn" onClick={onInstall}>📲 Download</button>
          )}
          <button className="lp-login-btn" onClick={onStart}>{c.login}</button>
        </div>
      </nav>

      {/* ── HERO 섹션 ── */}
      <header className="lp-hero">
        <div className="lp-tagline">
          <span className="lp-tagline-dot" />
          {c.tagline}
        </div>

        <h1 className="lp-hero-title" ref={titleRef}>
          {c.heroTitle}
        </h1>

        <p className="lp-hero-subtitle" ref={subRef}>
          {c.heroSub}
          <span className="lp-hero-sub-em">{c.heroSubEm}</span>
        </p>

        <div className="lp-cta-group">
          <button className="lp-btn lp-btn-primary" onClick={onStart}>
            {c.ctaStart}
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onStart}>
            {c.login}
          </button>
        </div>

        {/* 신뢰 지표 */}
        <div className="lp-hero-stats">
          {c.stats.map((s, i) => (
            <div className="lp-stat" key={i}>
              <span className="lp-stat-num">{s.num}</span>
              <span className="lp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── USP Feature Cards ── */}
      <section className="lp-usp-section">
        <p className="lp-section-label">{c.sectionLabel}</p>
        <h2 className="lp-section-title">{c.sectionTitle}</h2>

        <div className="lp-features-grid">
          {c.features.map((f, i) => (
            <div className="lp-feature-card" key={i}>
              <div className="lp-feature-icon-wrap">{f.icon}</div>
              <span className="lp-feature-number">{f.num}</span>
              <h3 className="lp-feature-title" dangerouslySetInnerHTML={{ __html: f.title }} />
              <p className="lp-feature-desc">{f.desc}</p>
              <span className="lp-feature-tag">{f.tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 앱 스크린샷 섹션 ── */}
      <section className="lp-app-section">
        <p className="lp-section-label">{c.appLabel}</p>
        <h2 className="lp-section-title">{c.appTitle}</h2>

        <div className="lp-app-grid">
          {c.appCards.map((card, i) => (
            <div className="lp-app-card" key={i}>
              <div className="lp-app-card-body">
                <span className="lp-app-card-badge">{card.badge}</span>
                <h3 className="lp-app-card-title" dangerouslySetInnerHTML={{ __html: card.title }} />
                <p className="lp-app-card-desc">{card.desc}</p>
              </div>
              <img src={card.img} alt={card.imgAlt} className="lp-app-card-img" />
            </div>
          ))}
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className="lp-cta-section">
        <h2 className="lp-cta-title">
          {c.ctaTitle}<br />
          <span className="lp-highlight">{c.ctaHighlight}</span>
        </h2>
        <p className="lp-cta-sub">{c.ctaSub}</p>
        <div className="lp-cta-btn-wrap">
          <button className="lp-btn lp-btn-primary" onClick={onStart}>
            {c.ctaStart}
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onStart}>
            {c.login}
          </button>
        </div>
        <p className="lp-footer-note">{c.footerNote}</p>
        {/* 스크롤 감지 sentinel */}
        <div ref={bottomRef} style={{ height: 1 }} />
      </section>

      {/* ── 설치 팝업 ── */}
      {showInstall && showInstallPopup && (
        <div className="lp-install-popup" style={{ position: 'fixed' }}>
          <button className="lp-popup-close" onClick={() => setShowInstallPopup(false)}>✕</button>
          <p className="lp-popup-msg">{c.installPopup.split('\n').map((line, i) => (
            <span key={i}>{line}{i === 0 && <br />}</span>
          ))}</p>
          <button className="lp-popup-install-btn" onClick={() => { onInstall(); setShowInstallPopup(false); }}>
            Download
          </button>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
