import { useEffect, useRef, useState } from 'react';
import { locales } from '../utils/i18n';
import './LandingPage.css';

// 브라우저 언어 → 로케일 코드 매핑
const detectLang = () => {
  const bl = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  if (bl.startsWith('ko')) return 'ko';
  if (bl.startsWith('ja')) return 'ja';
  if (bl.startsWith('zh')) return 'zh-CN';
  if (bl.startsWith('vi')) return 'vi';
  if (bl.startsWith('fr')) return 'fr';
  if (bl.startsWith('de')) return 'de';
  if (bl.startsWith('es')) return 'es';
  return 'en';
};

const LandingPage = ({ onGoogleLogin, onLogin, onSignup, onInstall, showInstall }) => {
  const bottomRef = useRef(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);

  const langCode = detectLang();
  const c = (locales[langCode] || locales['en'])?.landing;

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

  if (!c) return null;

  return (
    <div className="lp-root">
      {/* 배경 앰비언트 조명 */}
      <div className="lp-ambient lp-ambient-1" />
      <div className="lp-ambient lp-ambient-2" />

      {/* ── 네비게이션 ── */}
      <nav className="lp-nav">
        <div className="lp-logo">PronunFit</div>
        <div className="lp-nav-actions">
          <button className="lp-install-btn" onClick={onInstall}>📲 Download</button>
          <button className="lp-login-btn" onClick={onSignup}>{c.signUp}</button>
        </div>
      </nav>

      {/* ── HERO 섹션 ── */}
      <header className="lp-hero">
        <div className="lp-tagline-wrap">
          <div className="lp-hero-free-badge">FREE</div>
          <div className="lp-tagline">
            <span className="lp-tagline-dot" />
            {c.tagline}
          </div>
        </div>

        <h1 className="lp-hero-title">{c.heroTitle}</h1>

        <p className="lp-hero-subtitle">
          {c.heroSub}
          <span className="lp-hero-sub-em">{c.heroSubEm}</span>
        </p>

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

      {/* ── USP 카드 섹션 (각 카드 개별 스크롤 진입 애니메이션) ── */}
      <section className="lp-usp-section">
        {c.usps.map((usp, i) => (
          <div
            className="lp-usp-card"
            key={i}
          >
            <span className="lp-usp-num">0{i + 1}</span>
            <h3 className="lp-usp-title">{usp.title}</h3>
            <p className="lp-usp-sub">{usp.sub}</p>
          </div>
        ))}
      </section>

      {/* ── Feature Cards ── */}
      <section className="lp-features-section">
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
          <button className="lp-btn lp-btn-primary" onClick={onGoogleLogin}>
            {c.ctaStart}
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onLogin}>
            {c.otherLogin}
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
