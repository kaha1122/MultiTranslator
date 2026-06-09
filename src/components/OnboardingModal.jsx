import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getT } from '../utils/i18n';
import { resolveFlag } from '../config/languageFlags';
import { useUserCountry } from '../hooks/useUserCountry';
import './OnboardingModal.css';

const LANGUAGES = [
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', name: '中文', flag: '🇨🇳' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'pt-BR', name: 'Português', flag: '🇧🇷' },
];

// 감지된 사용자 언어를 맨 앞으로 재정렬 (첫 화면에서 즉시 눈에 띄도록)
const reorderByDefault = (list, defaultCode) => {
  if (!defaultCode) return list;
  const idx = list.findIndex(l => l.code === defaultCode);
  if (idx <= 0) return list;
  const picked = list[idx];
  return [picked, ...list.slice(0, idx), ...list.slice(idx + 1)];
};

/**
 * 온보딩 팝업: 3단계 언어 선택
 * step 0: 모국어 선택
 * step 1: 학습 언어 선택
 * step 2+: 추가 학습 언어 선택 (최대 3개까지)
 */
const LEVELS = [
  { value: 'basic', icon: '🌱', color: '#059669' },
  { value: 'intermediate', icon: '📚', color: '#6366f1' },
  { value: 'advanced', icon: '🎓', color: '#dc2626' },
];

export default function OnboardingModal({ defaultSourceLang, onComplete }) {
  const userCountry = useUserCountry();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState(defaultSourceLang || 'ko');
  const [targets, setTargets] = useState([]);
  const [level, setLevel] = useState('basic');

  // 첫 화면(step 0)용: 감지된 기본 언어를 맨 위로 올려 "당신 언어" 즉시 인식
  const orderedForSource = useMemo(
    () => reorderByDefault(LANGUAGES, defaultSourceLang),
    [defaultSourceLang]
  );

  // 모국어로 선택된 언어를 제외한 목록
  const availableForTarget = LANGUAGES.filter(l => l.code !== source);
  // 이미 선택한 target을 제외한 목록
  const availableForMore = availableForTarget.filter(l => !targets.includes(l.code));

  const handleSourceSelect = (code) => {
    setSource(code);
  };

  const handleTargetSelect = (code) => {
    if (step === 1) {
      // 첫 번째 학습 언어
      setTargets([code]);
      if (availableForTarget.length > 1) {
        setStep(2); // 추가 언어 질문으로
      } else {
        setStep('level');
      }
    } else {
      // 추가 학습 언어
      const newTargets = [...targets, code];
      setTargets(newTargets);
      if (newTargets.length >= 3 || availableForMore.length <= 1) {
        setStep('level');
      } else {
        setStep(step + 1); // 다음 추가 언어 질문
      }
    }
  };

  const handleNoMore = () => {
    setStep('level');
  };

  const handleLevelSelect = (val) => {
    setLevel(val);
  };

  const handleLevelConfirm = () => {
    setStep('aiConsent');
  };

  const handleAiConsentAccept = () => {
    onComplete(source, targets, level, true); // 4번째 인자 = aiConsented
  };

  const handleNextFromSource = () => {
    setStep(1);
  };

  // i18n 헬퍼 — source 언어 기준으로 텍스트 가져오기
  const t = (key) => getT(source, key);

  const getTitle = () => {
    if (step === 0) return t('onboarding.nativeLang');
    if (step === 1) return t('onboarding.targetLang');
    return t('onboarding.moreLang');
  };

  return (
    <div className="onb-overlay">
      <motion.div
        className="onb-card"
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* 단계 인디케이터 */}
        <div className="onb-steps">
          {[0, 1, 2, 3, 4].map(i => {
            const stepIdx = step === 'aiConsent' ? 4 : step === 'level' ? 3 : (typeof step === 'number' ? step : 3);
            return <span key={i} className={`onb-step-dot ${stepIdx >= i ? 'active' : ''}`} />;
          })}
        </div>

        {/* 질문 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
            className="onb-body"
          >
            {step === 'level' ? (
              <>
                <h2 className="onb-title">{t('onboarding.levelTitle')}</h2>
                <div className="onb-level-grid">
                  {LEVELS.map(lv => (
                    <button
                      key={lv.value}
                      className={`onb-level-card ${level === lv.value ? 'selected' : ''}`}
                      style={{ '--lv-color': lv.color }}
                      onClick={() => handleLevelSelect(lv.value)}
                    >
                      <span className="onb-level-icon">{lv.icon}</span>
                      <span className="onb-level-name">{t(`onboarding.level_${lv.value}`)}</span>
                      <span className="onb-level-desc">{t(`onboarding.levelDesc_${lv.value}`)}</span>
                    </button>
                  ))}
                </div>
                <button className="onb-next-btn" onClick={handleLevelConfirm}>
                  {t('onboarding.next')} →
                </button>
              </>
            ) : step === 'aiConsent' ? (
              <>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%', background: '#eff6ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px', fontSize: '24px',
                }}>
                  🤖
                </div>
                <h2 className="onb-title">{t('aiConsent.title')}</h2>
                <p style={{
                  margin: '0 0 14px', fontSize: '0.85rem', color: '#64748b',
                  lineHeight: 1.6, textAlign: 'left',
                }}>
                  {t('aiConsent.body')}
                </p>
                <a
                  href="https://pronunfit.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.78rem', color: 'var(--brand-accent)', display: 'block', marginBottom: '16px' }}
                >
                  {t('aiConsent.privacyLink')}
                </a>
                <button className="onb-next-btn" onClick={handleAiConsentAccept}>
                  {t('aiConsent.accept')}
                </button>
              </>
            ) : (
              <>
                <h2 className="onb-title">{getTitle()}</h2>

                {/* 언어 버튼 그리드 */}
                <div className="onb-lang-grid">
                  {(step === 0 ? orderedForSource : (step === 1 ? availableForTarget : availableForMore)).map(lang => {
                    const isSelected = step === 0
                      ? source === lang.code
                      : targets.includes(lang.code);
                    return (
                      <button
                        key={lang.code}
                        className={`onb-lang-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => step === 0 ? handleSourceSelect(lang.code) : handleTargetSelect(lang.code)}
                      >
                        <span className="onb-lang-flag">{resolveFlag(lang.code, userCountry, lang.flag)}</span>
                        <span className="onb-lang-name">{lang.name}</span>
                        {isSelected && <span className="onb-lang-check" aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>

                {/* 하단 버튼 */}
                {step === 0 && (
                  <button className="onb-next-btn" onClick={handleNextFromSource}>
                    {t('onboarding.next')} →
                  </button>
                )}

                {step >= 2 && (
                  <button className="onb-skip-btn" onClick={handleNoMore}>
                    {t('onboarding.noMore')}
                  </button>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
