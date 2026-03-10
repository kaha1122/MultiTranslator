import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Play, RotateCcw, Award } from 'lucide-react';
import { locales, useT, getT } from '../utils/i18n';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
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

const getServerUrl = () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) return import.meta.env.VITE_API_URL;
  } catch {}
  if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
  return 'http://localhost:5000';
};

/* ── Scene 데이터 (custom 제외) ── */
const SCENES = {
  locations: [
    { id: 'airport', icon: '✈️' }, { id: 'hotel', icon: '🏨' },
    { id: 'restaurant', icon: '🍽️' }, { id: 'transport', icon: '🚌' },
    { id: 'shopping', icon: '🛍️' }, { id: 'hospital', icon: '🏥' },
    { id: 'tourist', icon: '🗺️' }, { id: 'office', icon: '💼' },
    { id: 'bank', icon: '🏦' }, { id: 'gym', icon: '💪' },
  ],
  situations: [
    { id: 'smalltalk', icon: '💬' }, { id: 'lost', icon: '🆘' },
    { id: 'reservation', icon: '📅' }, { id: 'disagree', icon: '🤝' },
    { id: 'problem', icon: '🔧' }, { id: 'directions', icon: '🧭' },
    { id: 'intro', icon: '🎤' }, { id: 'compliment', icon: '🙏' },
    { id: 'decline', icon: '🚫' }, { id: 'advice', icon: '💡' },
  ],
};

const ALL_LANGS = [
  { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' },
  { code: 'zh-CN', name: '中文' }, { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' }, { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' }, { code: 'es', name: 'Español' },
];

/* ── Guide 섹션 메타 (AppGuide.jsx와 동일) ── */
const GUIDE_SECTIONS = [
  { id: 'nav', emoji: '☰', color: '#6366f1', stepIcons: ['☰','👆','⬤'], stepCount: 3, tipCount: 0 },
  { id: 'scene', emoji: '🎭', color: '#059669', stepIcons: ['📍','⚙️','✨','🎙️','☆'], stepCount: 5, tipCount: 3 },
  { id: 'translation', emoji: '🔤', color: '#2563eb', stepIcons: ['⌨️','🌐','💡','🔊','🎙️','☆'], stepCount: 6, tipCount: 3 },
  { id: 'pronunciation', emoji: '🎙️', color: '#dc2626', stepIcons: ['🎯','🌊','🎭','🔬','🎧'], stepCount: 5, tipCount: 2 },
  { id: 'library', emoji: '⭐', color: '#d97706', stepIcons: ['🔍','🗂️','🔊','🎙️','📝','🗑️'], stepCount: 6, tipCount: 2 },
  { id: 'vocab', emoji: '📖', color: '#8b5cf6', stepIcons: ['🗂️','⚙️','✨','📇','☆'], stepCount: 5, tipCount: 3 },
  { id: 'video', emoji: '🎬', color: '#0891b2', stepIcons: ['🌐','▶️','📝','🌐'], stepCount: 4, tipCount: 3 },
  { id: 'goal', emoji: '🎯', color: '#db2777', stepIcons: ['⚙️','📊','🎉','🎯'], stepCount: 4, tipCount: 2 },
];

/* ── Demo Card (발음 평가 포함) ── */
function DemoCard({ generated, langCode, sourceLang, onSpeak }) {
  const t = useT(sourceLang);
  const {
    isRecording, isAnalyzing, assessmentResult, coachTip,
    startRecording, stopRecording, errorMsg,
  } = useAudioRecorder(generated.sentence, langCode, sourceLang, null);

  return (
    <div className="lp-demo-card">
      {/* 카드 헤더 */}
      <div className="lp-demo-card-header">
        <div className="lp-demo-card-hint">
          <span>🎬</span>
          <p>{generated.scene_hint}</p>
        </div>
        <button className="lp-demo-tts-btn" onClick={() => onSpeak(generated.sentence, langCode)}>
          <Play size={20} fill="white" stroke="white" />
        </button>
      </div>

      {/* 문장 */}
      <div className="lp-demo-card-sentence">{generated.sentence}</div>

      {/* 발음 표기 (CJK) */}
      {generated.pronunciation && !assessmentResult && (
        <p className="lp-demo-card-pronunciation">{generated.pronunciation}</p>
      )}

      {/* 번역 */}
      <div className="lp-demo-card-translation">{generated.translation}</div>

      {/* 학습 팁 */}
      {generated.learning_tip && (
        <div className="lp-demo-card-tip">
          <span>💡</span>
          <p>{generated.learning_tip}</p>
        </div>
      )}

      {/* 발음 평가 결과 */}
      {assessmentResult && (
        <>
          <div className="lp-demo-score-badge">
            <Award size={12} /> {assessmentResult.pronunciationScore}Pt
          </div>
          <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />
        </>
      )}

      {/* AI 코치 팁 */}
      {coachTip && (
        <div className="lp-demo-coach-tip">
          <span>🤖</span>
          <p>{coachTip}</p>
        </div>
      )}

      {errorMsg && <p className="lp-demo-error">{errorMsg}</p>}

      {/* 녹음 버튼 */}
      <div className="lp-demo-record-wrap">
        {isRecording && <p className="lp-demo-status recording">{t('card.recording')}</p>}
        {isAnalyzing && <p className="lp-demo-status analyzing">{t('card.analyzing')}</p>}
        <button
          className={`lp-demo-record-btn ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
          onClick={() => isRecording ? stopRecording() : startRecording()}
          disabled={isAnalyzing}
        >
          {isAnalyzing
            ? <RotateCcw size={22} className="spin" />
            : isRecording
              ? <MicOff size={22} />
              : <Mic size={22} />
          }
        </button>
      </div>
    </div>
  );
}

/* ── LandingPage 메인 ── */
const LandingPage = ({ onGoogleLogin, onLogin, onSignup, onInstall, showInstall, onSpeak, onPrivacy, onTerms, onContact }) => {
  const bottomRef = useRef(null);
  const demoRef = useRef(null);
  const demoCountRef = useRef(0);

  const [showInstallPopup, setShowInstallPopup] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Scene demo state
  const [category, setCategory] = useState('locations');
  const [selectedScene, setSelectedScene] = useState({ id: 'restaurant', icon: '🍽️' });
  const [selectedLang, setSelectedLang] = useState('en');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [speechStyle, setSpeechStyle] = useState('formal');
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Guide accordion
  const [openGuide, setOpenGuide] = useState('scene');

  const langCode = detectLang();
  const t = useT(langCode);
  const c = (locales[langCode] || locales['en'])?.landing;

  // 스크롤 끝 감지 → 설치 팝업
  useEffect(() => {
    if (!showInstall || !bottomRef.current) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setShowInstallPopup(true); },
      { threshold: 0.5 }
    );
    obs.observe(bottomRef.current);
    return () => obs.disconnect();
  }, [showInstall]);


  const handleScrollToDemo = () => {
    demoRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleGenerate = async () => {
    if (!selectedScene) return;

    if (demoCountRef.current >= 1) {
      setShowLoginModal(true);
      return;
    }

    setLoading(true);
    setError(null);
    setGenerated(null);

    try {
      const scenePrefix = category === 'locations' ? 'sceneLoc' : 'sceneSit';
      const sceneText = getT('en', `${scenePrefix}.${selectedScene.id}`);
      const res = await fetch(`${getServerUrl()}/api/scene-sentence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene: sceneText,
          category,
          targetLang: selectedLang,
          sourceLang: langCode,
          difficulty,
          speechStyle,
        }),
      });
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      setGenerated(data);
      demoCountRef.current += 1;
    } catch {
      setError(t('scene.loadError') || 'Failed to generate. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuideToggle = (secId) => {
    setOpenGuide(openGuide === secId ? null : secId);
  };

  if (!c) return null;

  const scenePrefix = category === 'locations' ? 'sceneLoc' : 'sceneSit';

  return (
    <div className="lp-root">
      {/* 배경 앰비언트 */}
      <div className="lp-ambient lp-ambient-1" />
      <div className="lp-ambient lp-ambient-2" />

      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-logo">PronunFit</div>
        <div className="lp-nav-actions">
          <button className="lp-install-btn" onClick={onInstall}>📲 Download</button>
          <button className="lp-login-btn" onClick={onSignup}>{c.signUp}</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-block">
          <p className="lp-hero-text">{c.hero1}</p>
        </div>
        <div className="lp-hero-divider" />
        <div className="lp-hero-block">
          <p className="lp-hero-text">{c.hero2}</p>
        </div>
        <button className="lp-hero-cta" onClick={handleScrollToDemo}>
          {c.heroCta}
        </button>
      </section>

      {/* ── Scene Demo ── */}
      <section className="lp-demo" ref={demoRef}>
        <h2 className="lp-demo-title">{c.demoTitle}</h2>
        <p className="lp-demo-sub">{c.demoSub}</p>

        {/* 카테고리 토글 */}
        <div className="lp-demo-toggle">
          <button
            className={category === 'locations' ? 'active' : ''}
            onClick={() => { setCategory('locations'); setSelectedScene(null); setGenerated(null); }}
          >
            📍 {t('scene.locations')}
          </button>
          <button
            className={category === 'situations' ? 'active' : ''}
            onClick={() => { setCategory('situations'); setSelectedScene(null); setGenerated(null); }}
          >
            🎭 {t('scene.situations')}
          </button>
        </div>

        {/* 씬 칩 */}
        <div className="lp-demo-chips">
          {SCENES[category].map(scene => (
            <button
              key={scene.id}
              className={`lp-demo-chip ${selectedScene?.id === scene.id ? 'active' : ''}`}
              onClick={() => { setSelectedScene(scene); setGenerated(null); }}
            >
              <span>{scene.icon}</span>
              <span>{t(`${scenePrefix}.${scene.id}`)}</span>
            </button>
          ))}
        </div>

        {/* 난이도 + 말투 */}
        <div className="lp-demo-options">
          <div className="lp-demo-option-row">
            <span className="lp-demo-option-label">{t('scene.diffTitle')}</span>
            <div className="lp-demo-pills">
              {['basic', 'intermediate', 'high'].map(d => (
                <button
                  key={d}
                  className={`lp-demo-pill ${difficulty === d ? 'active' : ''}`}
                  onClick={() => setDifficulty(d)}
                >
                  {t(`scene.diff${d.charAt(0).toUpperCase() + d.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="lp-demo-option-row">
            <span className="lp-demo-option-label">{t('scene.styleTitle')}</span>
            <div className="lp-demo-pills">
              {['casual', 'formal'].map(s => (
                <button
                  key={s}
                  className={`lp-demo-pill ${speechStyle === s ? 'active' : ''}`}
                  onClick={() => setSpeechStyle(s)}
                >
                  {t(`scene.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 언어 선택 */}
        <div className="lp-demo-langs">
          {ALL_LANGS.map(l => (
            <button
              key={l.code}
              className={`lp-demo-lang ${selectedLang === l.code ? 'active' : ''}`}
              onClick={() => { setSelectedLang(l.code); setGenerated(null); }}
            >
              {l.name}
            </button>
          ))}
        </div>

        {/* 생성 버튼 */}
        <button
          className="lp-demo-generate"
          onClick={handleGenerate}
          disabled={loading || !selectedScene}
        >
          {loading ? <RotateCcw size={18} className="spin" /> : c.demoGenerate}
        </button>

        {error && <p className="lp-demo-error-msg">{error}</p>}

        {/* 생성된 카드 */}
        {generated && (
          <DemoCard
            generated={generated}
            langCode={selectedLang}
            sourceLang={langCode}
            onSpeak={onSpeak}
          />
        )}
      </section>

      {/* ── Guide Accordion ── */}
      <section className="lp-guide">
        <h2 className="lp-guide-title">{c.guideTitle}</h2>
        <div className="lp-guide-list">
          {GUIDE_SECTIONS.map((sec) => {
            const prefix = `guide.${sec.id}`;
            const isOpen = openGuide === sec.id;
            return (
              <div
                key={sec.id}
                className={`lp-guide-card ${isOpen ? 'open' : ''}`}
                style={{ '--gc-color': sec.color }}
              >
                <button className="lp-guide-card-header" onClick={() => handleGuideToggle(sec.id)}>
                  <div className="lp-guide-card-header-left">
                    <span className="lp-guide-card-emoji">{sec.emoji}</span>
                    <div>
                      <div className="lp-guide-card-name">{t(`${prefix}.title`)}</div>
                      {t(`${prefix}.subtitle`) !== `${prefix}.subtitle` && (
                        <div className="lp-guide-card-sub">{t(`${prefix}.subtitle`)}</div>
                      )}
                    </div>
                  </div>
                  <span className="lp-guide-chevron">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="lp-guide-card-body">
                    <div className="lp-guide-card-steps">
                      {Array.from({ length: sec.stepCount }, (_, i) => (
                        <div key={i} className="lp-guide-step">
                          <span className="lp-guide-step-icon">{sec.stepIcons[i]}</span>
                          <div>
                            <div className="lp-guide-step-label" style={{ color: sec.color }}>{t(`${prefix}.s${i + 1}Label`)}</div>
                            <div className="lp-guide-step-desc">{t(`${prefix}.s${i + 1}Desc`)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {sec.tipCount > 0 && (
                      <div className="lp-guide-tips" style={{ borderColor: sec.color, background: `${sec.color}15` }}>
                        {Array.from({ length: sec.tipCount }, (_, i) => (
                          <p key={i} className="lp-guide-tip">{t(`${prefix}.tip${i + 1}`)}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="lp-cta-section">
        <h2 className="lp-cta-title">
          {c.ctaTitle}<br />
          <span className="lp-highlight">{c.ctaHighlight}</span>
        </h2>
        <p className="lp-cta-sub">{c.ctaSub}</p>
        <div className="lp-cta-btn-wrap">
          <button className="lp-btn lp-btn-primary" onClick={onGoogleLogin}>{c.ctaStart}</button>
          <button className="lp-btn lp-btn-secondary" onClick={onLogin}>{c.otherLogin}</button>
        </div>
        <div ref={bottomRef} style={{ height: 1 }} />
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-links">
          <button onClick={onPrivacy}>{t('nav.privacy')}</button>
          <span>·</span>
          <button onClick={onTerms}>{t('nav.terms')}</button>
          <span>·</span>
          <button onClick={onContact}>{t('nav.contact')}</button>
        </div>
        <p className="lp-footer-copy">{c.footerCopy}</p>
      </footer>

      {/* ── Login Modal ── */}
      {showLoginModal && (
        <div className="lp-modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="lp-modal" onClick={e => e.stopPropagation()}>
            <button className="lp-modal-close" onClick={() => setShowLoginModal(false)}>✕</button>
            <div className="lp-modal-emoji">🎯</div>
            <h3 className="lp-modal-title">{c.demoLoginTitle}</h3>
            <p className="lp-modal-msg">{c.demoLoginMsg}</p>
            <button className="lp-modal-google" onClick={onGoogleLogin}>{c.demoLoginGoogle}</button>
            <button className="lp-modal-other" onClick={onLogin}>{c.demoLoginOther}</button>
          </div>
        </div>
      )}

      {/* ── Install Popup ── */}
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
