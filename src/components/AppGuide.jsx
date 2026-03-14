import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '../utils/i18n';
import './AppGuide.css';

/* ── 섹션 메타 (emoji, 색상, step icon, step/tip 개수) ── */
const SECTION_META = [
  {
    id: 'nav', emoji: '☰', color: '#6366f1', bgColor: '#eef2ff',
    stepIcons: ['☰', '👆', '⬤'],
    stepCount: 3, tipCount: 0,
  },
  {
    id: 'scene', emoji: '🎭', color: '#059669', bgColor: '#ecfdf5',
    stepIcons: ['📍', '⚙️', '✨', '🎙️', '☆'],
    stepCount: 5, tipCount: 3,
  },
  {
    id: 'translation', emoji: '🔤', color: '#2563eb', bgColor: '#eff6ff',
    stepIcons: ['⌨️', '🌐', '💡', '🔊', '🎙️', '☆'],
    stepCount: 6, tipCount: 3,
  },
  {
    id: 'pronunciation', emoji: '🎙️', color: '#dc2626', bgColor: '#fef2f2',
    stepIcons: ['🎯', '🌊', '🎭', '🔬', '🎧'],
    stepCount: 5, tipCount: 2,
  },
  {
    id: 'library', emoji: '⭐', color: '#d97706', bgColor: '#fffbeb',
    stepIcons: ['🔍', '🗂️', '🔊', '🎙️', '📝', '🗑️'],
    stepCount: 6, tipCount: 2,
  },
  {
    id: 'vocab', emoji: '📖', color: '#8b5cf6', bgColor: '#f5f3ff',
    stepIcons: ['🗂️', '⚙️', '✨', '📇', '☆'],
    stepCount: 5, tipCount: 3,
  },
  {
    id: 'video', emoji: '🎬', color: '#0891b2', bgColor: '#ecfeff',
    stepIcons: ['🌐', '▶️', '📝', '🌐'],
    stepCount: 4, tipCount: 3,
  },
  {
    id: 'goal', emoji: '🎯', color: '#db2777', bgColor: '#fdf2f8',
    stepIcons: ['⚙️', '📊', '🎉', '🎯'],
    stepCount: 4, tipCount: 2,
  },
];

export default function AppGuide({ onBack, sourceLang }) {
  const [openId, setOpenId] = useState('nav');
  const sectionRefs = useRef({});
  const t = useT(sourceLang);

  useEffect(() => {
    const handleKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { e.preventDefault(); onBack(); }
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
        <h2 className="guide-title">{t('guide.pageTitle')}</h2>
        <div style={{ width: 36 }} />
      </div>

      <div className="guide-intro">
        {t('guide.intro')}
      </div>

      {/* 섹션 목록 */}
      <div className="guide-sections">
        {SECTION_META.map((sec) => {
          const isOpen = openId === sec.id;
          const prefix = `guide.${sec.id}`;
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
                    <div className="guide-section-name">{t(`${prefix}.title`)}</div>
                    {t(`${prefix}.subtitle`) !== `${prefix}.subtitle` && (
                      <div className="guide-section-sub">{t(`${prefix}.subtitle`)}</div>
                    )}
                  </div>
                </div>
                {isOpen ? <ChevronUp size={18} color="#94a3b8" /> : <ChevronDown size={18} color="#94a3b8" />}
              </button>

              {/* 섹션 콘텐츠 */}
              {isOpen && (
                <div className="guide-section-body">
                  {Array.from({ length: sec.stepCount }, (_, i) => {
                    const idx = i + 1;
                    return (
                      <div key={i} className="guide-step">
                        <div className="guide-step-icon">{sec.stepIcons[i]}</div>
                        <div className="guide-step-content">
                          <div className="guide-step-label">{t(`${prefix}.s${idx}Label`)}</div>
                          <div className="guide-step-desc">{t(`${prefix}.s${idx}Desc`)}</div>
                        </div>
                      </div>
                    );
                  })}

                  {sec.tipCount > 0 && (
                    <div className="guide-tips-box">
                      {Array.from({ length: sec.tipCount }, (_, i) => (
                        <p key={i} className="guide-tip-item">{t(`${prefix}.tip${i + 1}`)}</p>
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
      <button className="guide-close-btn" onClick={onBack}>{t('guide.backBtn')}</button>
      <div style={{ height: 32 }} />
    </div>
  );
}
