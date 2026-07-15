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

// 로케일 → 이미지 파일명 언어코드 매핑 (7개 언어 이미지 존재, fr/de/pt-BR은 en 폴백)
const IMG_LANG_MAP = {
  'ko': 'kr', 'ja': 'jp', 'zh-CN': 'cn', 'vi': 'vn',
  'es': 'es', 'ru': 'ru', 'en': 'en',
  'fr': 'en', 'de': 'en', 'pt-BR': 'en',
};

// 5장 프로모 카드: 헤드라인·폰 목업이 이미지에 포함된 완성형 카드 (promo1~5)
// cardN 순서 = promo_0N 순서 (①70토픽·3개국어 ②음소분석 ③38언어 ④포인트무료 ⑤듣기무한생성)
const CARDS = ['card1', 'card2', 'card3', 'card4', 'card5'];

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
      {CARDS.map((cardId, idx) => {
        const title = c[`${cardId}Title`] || '';
        const highlight = c[`${cardId}Highlight`] || '';
        const subtitle = c[`${cardId}Subtitle`] || '';
        const recommendTitle = c[`${cardId}RecommendTitle`] || '';
        const recommends = [1, 2, 3, 4].map(n => c[`${cardId}Recommend${n}`]).filter(Boolean);
        const imgSrc = `/landing/promo${idx + 1}_${imgLang}.webp`;
        // 헤드라인은 이미지에 박혀 있음 — 이미지가 en 폴백인 비영어 로케일(fr/de/pt-BR)에만 HTML 헤드카피 표시
        const showHtmlTitle = imgLang === 'en' && langCode !== 'en';

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
          <section key={cardId} id={cardId} className={`lp-promo-section ${idx === 0 ? 'first' : ''}`}>
            {/* 배경 장식 orb */}
            <div className="lp-promo-orb lp-promo-orb-1" />
            <div className="lp-promo-orb lp-promo-orb-2" />

            {/* 헤드카피 — en 이미지 폴백 로케일 전용 (이미지에 자국어 헤드라인 없음) */}
            {showHtmlTitle && <h2 className="lp-promo-title">{renderTitle()}</h2>}

            {/* 완성형 프로모 카드 이미지 (헤드라인 + 폰 목업 포함) */}
            <div className="lp-promo-img-wrap">
              <img
                src={imgSrc}
                alt={`PronunFit promo ${idx + 1}`}
                loading={idx === 0 ? 'eager' : 'lazy'}
                className="lp-promo-img"
              />
            </div>

            {/* 서브카피 */}
            <p className="lp-promo-subtitle">
              {subtitle.split('\n').map((line, i) => (
                <span key={i}>{i > 0 && <br />}{line}</span>
              ))}
            </p>

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
