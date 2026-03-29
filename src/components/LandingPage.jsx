import { useEffect, useRef, useState } from 'react';
import { locales, useT } from '../utils/i18n';
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
  if (bl.startsWith('ru')) return 'ru';
  if (bl.startsWith('pt')) return 'pt-BR';
  return 'en';
};

// 로케일 → 이미지 파일명 언어코드 매핑 (6개 언어만 이미지 존재)
const IMG_LANG_MAP = {
  'ko': 'ko', 'ja': 'jp', 'es': 'es', 'ru': 'ru', 'vi': 'vn',
  'en': 'en', 'zh-CN': 'en', 'fr': 'en', 'de': 'en', 'pt-BR': 'en',
};

// 5장 카드 정의: 순서 Promo1→3→4→5→2
// Card5(발음)는 영어 스크린샷만 존재
const CARDS = [
  { id: 'card1', hasLangVariant: true },
  { id: 'card2', hasLangVariant: true },
  { id: 'card3', hasLangVariant: true },
  { id: 'card4', hasLangVariant: true },
  { id: 'card5', hasLangVariant: false },  // 영어 전용
];

const isNative = window.Capacitor?.isNativePlatform?.() || false;

const LandingPage = ({ onStartFree, onLogin, onInstall, showInstall, onPrivacy, onTerms, onContact }) => {
  const bottomRef = useRef(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);

  const langCode = detectLang();
  const t = useT(langCode);
  const c = (locales[langCode] || locales['en'])?.landing;
  const imgLang = IMG_LANG_MAP[langCode] || 'en';

  // 스크롤 끝 감지 → 설치 팝업
  useEffect(() => {
    if (!bottomRef.current) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setShowInstallPopup(true); },
      { threshold: 0.5 }
    );
    obs.observe(bottomRef.current);
    return () => obs.disconnect();
  }, []);

  if (!c) return null;

  const handleCta = isNative ? onLogin : onStartFree;
  const ctaLabel = isNative ? (c.loginWithAccount || 'Log In') : (c.startFree || 'Start Free');

  return (
    <div className="lp-root">
      {/* 배경 앰비언트 */}
      <div className="lp-ambient lp-ambient-1" />
      <div className="lp-ambient lp-ambient-2" />

      {/* Nav */}
      <nav className="lp-nav" style={{ justifyContent: 'center', gap: '16px' }}>
        <div className="lp-logo">PronunFit</div>
        {!isNative && <button className="lp-install-btn" onClick={onInstall}>📲 Download</button>}
        {onLogin && (
          <button onClick={onLogin} style={{
            padding: '8px 18px', borderRadius: '20px',
            border: '1.5px solid #00a884', background: 'transparent',
            color: '#00a884', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
          }}>
            {c.loginBtn || 'Log In'}
          </button>
        )}
      </nav>

      {/* 5장 프로모 카드 */}
      {CARDS.map((card, idx) => {
        const title = c[`${card.id}Title`] || '';
        const highlight = c[`${card.id}Highlight`] || '';
        const subtitle = c[`${card.id}Subtitle`] || '';
        const recommendTitle = c[`${card.id}RecommendTitle`] || '';
        const recommends = [1, 2, 3, 4].map(n => c[`${card.id}Recommend${n}`]).filter(Boolean);
        const screenshotLang = card.hasLangVariant ? imgLang : 'en';
        const imgSrc = `/landing/${card.id}_${screenshotLang}.png`;

        // 타이틀에서 highlight 부분을 강조
        const renderTitle = () => {
          const lines = title.split('\n');
          return lines.map((line, i) => {
            if (highlight && line.includes(highlight)) {
              const parts = line.split(highlight);
              return (
                <span key={i}>
                  {i > 0 && <br />}
                  {parts[0]}<span className="lp-card-highlight">{highlight}</span>{parts[1]}
                </span>
              );
            }
            return <span key={i}>{i > 0 && <br />}{line}</span>;
          });
        };

        return (
          <section key={card.id} className={`lp-promo-section ${idx === 0 ? 'first' : ''}`}>
            {/* 배경 장식 orb */}
            <div className="lp-promo-orb lp-promo-orb-1" />
            <div className="lp-promo-orb lp-promo-orb-2" />

            {/* 헤드카피 */}
            <h2 className="lp-promo-title">{renderTitle()}</h2>

            {/* 서브카피 */}
            <p className="lp-promo-subtitle">
              {subtitle.split('\n').map((line, i) => (
                <span key={i}>{i > 0 && <br />}{line}</span>
              ))}
            </p>

            {/* 폰 프레임 + 스크린샷 */}
            <div className="lp-phone-frame">
              <img
                src={imgSrc}
                alt={`PronunFit ${card.id}`}
                loading={idx === 0 ? 'eager' : 'lazy'}
                className="lp-phone-screenshot"
              />
            </div>

            {/* 추천 대상 */}
            <div className="lp-recommend">
              <p className="lp-recommend-title">{recommendTitle}</p>
              <div className="lp-recommend-list">
                {recommends.map((item, i) => (
                  <p key={i} className="lp-recommend-item">
                    <span className="lp-recommend-check">✅</span>
                    {item}
                  </p>
                ))}
              </div>
            </div>

            {/* CTA 버튼 */}
            <button className="lp-promo-cta" onClick={handleCta}>
              🚀 {ctaLabel}
            </button>
          </section>
        );
      })}

      {/* 계정 삭제 안내 */}
      <section id="delete-info" className="lp-delete-info">
        <h3 className="lp-delete-info-title">{c.accountDelTitle || '계정 삭제 및 데이터 파기 안내'}</h3>
        <p className="lp-delete-info-desc"
          dangerouslySetInnerHTML={{ __html: c.accountDelDesc || '' }}
        />
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-biz">
          <p className="lp-footer-biz-name">아리젬스 | 대표 하승우</p>
          <p>사업자번호 : 746-11-03230</p>
          <p>경기 김포시 걸포2로 83</p>
          <p>SystemAdmin@PronunFit.com | 050-6754-5465</p>
        </div>
        <div className="lp-footer-links">
          <a href="/privacy" onClick={(e) => { e.preventDefault(); onPrivacy(); }}>{t('nav.privacy')}</a>
          <span>·</span>
          <a href="/terms" onClick={(e) => { e.preventDefault(); onTerms(); }}>{t('nav.terms')}</a>
          <span>·</span>
          <a href="/contact" onClick={(e) => { e.preventDefault(); onContact(); }}>{t('nav.contact')}</a>
        </div>
        <p className="lp-footer-copy">{c.footerCopy}</p>
      </footer>

      {/* Login Modal */}
      <div ref={bottomRef} style={{ height: 1 }} />

      {/* Install Popup */}
      {!isNative && showInstallPopup && (
        <div className="lp-install-popup" style={{ position: 'fixed' }}>
          <button className="lp-popup-close" onClick={() => setShowInstallPopup(false)}>✕</button>
          <p className="lp-popup-msg">{c.installPopup?.split('\n').map((line, i) => (
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
