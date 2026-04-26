import { useEffect, useRef, useState } from 'react';
import { locales, useT } from '../utils/i18n';
import IOSInstallSlideshow from './IOSInstallSlideshow';
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
// 별표 Y비율 (Card4 - 가성비, 각 메뉴 항목 옆)
const STAR_POSITIONS = [0.34, 0.44, 0.54, 0.64, 0.74, 0.83];

const CARDS = [
  { id: 'card1', hasLangVariant: true },
  { id: 'card2', hasLangVariant: true },
  { id: 'card3', hasLangVariant: true, magnifier: true },   // 돋보기
  { id: 'card4', hasLangVariant: true, stars: true },        // 별표
  { id: 'card5', hasLangVariant: false },  // 영어 전용
];

const isNative = window.Capacitor?.isNativePlatform?.() || false;

// iPhone/iPad/Mac 등 Apple 플랫폼 웹 사용자에겐 Download 버튼 비노출.
// (Capacitor 네이티브 앱은 어차피 Apple이지만 isNative 분기에서 별도 처리됨)
const isAppleWeb = !isNative && /iPhone|iPad|iPod|Mac/i.test(navigator.userAgent || '');

// iPhone(+iPad)만 슬라이드 가이드 자동 표시 — Mac은 데스크탑 PWA 경로가 다르므로 제외
const isIOSWeb = !isNative && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

const LandingPage = ({ onStartFree, onLogin, onInstall, showInstall, onPrivacy, onTerms, onContact }) => {
  const bottomRef = useRef(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);
  const [showIOSSlideshow, setShowIOSSlideshow] = useState(false);

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

  // iPhone 사용자에게 진입 1.5초 후 자동으로 설치 가이드 슬라이드 표시.
  // 이미 standalone PWA로 실행 중이거나, 한 번 본 사용자에겐 띄우지 않음.
  useEffect(() => {
    if (!isIOSWeb) return;
    const isStandalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (isStandalone) return;
    try {
      if (localStorage.getItem('iosInstallSlideshowSeen')) return;
    } catch {}
    const timer = setTimeout(() => setShowIOSSlideshow(true), 1500);
    return () => clearTimeout(timer);
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
        {!isNative && !isAppleWeb && <button className="lp-install-btn" onClick={onInstall}>📲 Download</button>}
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
          <section key={card.id} id={card.id} className={`lp-promo-section ${idx === 0 ? 'first' : ''}`}>
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

            {/* 폰 프레임 + 스크린샷 + 장식 */}
            <div className="lp-phone-wrap">
              {/* 돋보기 (Card3 - 다국어 동시학습) */}
              {card.magnifier && (
                <div className="lp-magnifier">
                  <img
                    src={imgSrc}
                    alt="zoom"
                    className="lp-magnifier-img"
                  />
                  <div className="lp-magnifier-handle" />
                </div>
              )}

              <div className="lp-phone-frame">
                <div className="lp-phone-inner">
                  <img
                    src={imgSrc}
                    alt={`PronunFit ${card.id}`}
                    loading={idx === 0 ? 'eager' : 'lazy'}
                    className="lp-phone-screenshot"
                  />
                </div>

                {/* 별표 (Card4 - 가성비) — phone-frame 기준 절대 배치 */}
                {card.stars && STAR_POSITIONS.map((yRatio, i) => (
                  <span
                    key={i}
                    className="lp-star"
                    style={{ top: `${yRatio * 100}%` }}
                  >
                    ⭐
                  </span>
                ))}
              </div>
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

      {/* iOS 설치 가이드 자동 슬라이드 — iPhone 전용 */}
      <IOSInstallSlideshow
        open={showIOSSlideshow}
        onClose={() => setShowIOSSlideshow(false)}
        sourceLang={langCode}
      />

      {/* Install Popup (Apple 플랫폼 제외 — iPhone은 위 슬라이드쇼로 대체) */}
      {!isNative && !isAppleWeb && showInstallPopup && (
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
