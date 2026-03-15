import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getT } from '../utils/i18n';
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

/**
 * 온보딩 팝업: 3단계 언어 선택
 * step 0: 모국어 선택
 * step 1: 학습 언어 선택
 * step 2+: 추가 학습 언어 선택 (최대 3개까지)
 */
export default function OnboardingModal({ defaultSourceLang, onComplete }) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState(defaultSourceLang || 'ko');
  const [targets, setTargets] = useState([]);

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
        setStep('done');
      }
    } else {
      // 추가 학습 언어
      const newTargets = [...targets, code];
      setTargets(newTargets);
      if (newTargets.length >= 3 || availableForMore.length <= 1) {
        setStep('done');
      } else {
        setStep(step + 1); // 다음 추가 언어 질문
      }
    }
  };

  const handleNoMore = () => {
    setStep('done');
  };

  const handleDone = () => {
    onComplete(source, targets);
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
          {[0, 1, 2].map(i => (
            <span key={i} className={`onb-step-dot ${step >= i ? 'active' : ''}`} />
          ))}
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
            {step === 'done' ? (
              <>
                <div style={{ fontSize: '2.2rem', marginBottom: '12px' }}>✅</div>
                <h2 className="onb-title">{t('onboarding.doneTitle')}</h2>
                <p style={{
                  color: '#64748b', fontSize: '0.85rem', margin: '8px 0 24px',
                  lineHeight: 1.6,
                }}>
                  {t('onboarding.doneDesc')}
                </p>
                <button className="onb-next-btn" onClick={handleDone}>
                  {t('onboarding.doneBtn')}
                </button>
              </>
            ) : (
              <>
                <h2 className="onb-title">{getTitle()}</h2>

                {/* 언어 버튼 그리드 */}
                <div className="onb-lang-grid">
                  {(step === 0 ? LANGUAGES : (step === 1 ? availableForTarget : availableForMore)).map(lang => {
                    const isSelected = step === 0
                      ? source === lang.code
                      : targets.includes(lang.code);
                    return (
                      <button
                        key={lang.code}
                        className={`onb-lang-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => step === 0 ? handleSourceSelect(lang.code) : handleTargetSelect(lang.code)}
                      >
                        <span className="onb-lang-flag">{lang.flag}</span>
                        <span className="onb-lang-name">{lang.name}</span>
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
