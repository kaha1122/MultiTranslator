import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

  // 단계별 제목/설명
  const stepConfig = {
    0: {
      // 모국어 (각 언어로 질문)
      title: {
        ko: '모국어는 어떤 언어인가요?',
        en: 'What is your native language?',
        ja: '母国語は何ですか？',
        'zh-CN': '您的母语是什么？',
        vi: 'Tiếng mẹ đẻ của bạn là gì?',
        fr: 'Quelle est votre langue maternelle ?',
        de: 'Was ist Ihre Muttersprache?',
        es: '¿Cuál es su idioma nativo?',
      },
    },
    1: {
      title: {
        ko: '학습하고자 하는 언어는\n어떤 언어인가요?',
        en: 'Which language would you\nlike to learn?',
        ja: '学びたい言語は何ですか？',
        'zh-CN': '您想学习哪种语言？',
        vi: 'Bạn muốn học ngôn ngữ nào?',
        fr: 'Quelle langue souhaitez-vous\napprendre ?',
        de: 'Welche Sprache möchten Sie\nlernen?',
        es: '¿Qué idioma le gustaría\naprender?',
      },
    },
    extra: {
      title: {
        ko: '함께 학습할 또 다른\n언어가 있나요?',
        en: 'Any other language you\nwould like to learn?',
        ja: '他に学びたい言語は\nありますか？',
        'zh-CN': '还有其他想学的语言吗？',
        vi: 'Bạn có muốn học thêm\nngôn ngữ nào không?',
        fr: 'Une autre langue à\napprendre ?',
        de: 'Noch eine weitere Sprache\nlernen?',
        es: '¿Algún otro idioma que\nquiera aprender?',
      },
      no: {
        ko: '아니오, 충분합니다',
        en: 'No, that\'s enough',
        ja: 'いいえ、十分です',
        'zh-CN': '不了，够了',
        vi: 'Không, đủ rồi',
        fr: 'Non, ça suffit',
        de: 'Nein, das reicht',
        es: 'No, es suficiente',
      },
    },
  };

  const getTitle = () => {
    if (step === 0) return stepConfig[0].title[source] || stepConfig[0].title.en;
    if (step === 1) return stepConfig[1].title[source] || stepConfig[1].title.en;
    return stepConfig.extra.title[source] || stepConfig.extra.title.en;
  };

  const getNoText = () => stepConfig.extra.no[source] || stepConfig.extra.no.en;

  const nextText = {
    ko: '다음', en: 'Next', ja: '次へ', 'zh-CN': '下一步',
    vi: 'Tiếp', fr: 'Suivant', de: 'Weiter', es: 'Siguiente',
  };

  const doneConfig = {
    title: {
      ko: '언어가 설정되었습니다.',
      en: 'Languages have been set.',
      ja: '言語が設定されました。',
      'zh-CN': '语言已设置。',
      vi: 'Ngôn ngữ đã được thiết lập.',
      fr: 'Les langues ont été configurées.',
      de: 'Sprachen wurden eingestellt.',
      es: 'Los idiomas han sido configurados.',
    },
    desc: {
      ko: '변경하시려면, 설정에서 변경하실 수 있습니다.',
      en: 'You can change them in Settings.',
      ja: '変更は設定から行えます。',
      'zh-CN': '如需更改，请在设置中修改。',
      vi: 'Bạn có thể thay đổi trong Cài đặt.',
      fr: 'Vous pouvez les modifier dans les paramètres.',
      de: 'Sie können dies in den Einstellungen ändern.',
      es: 'Puede cambiarlos en Configuración.',
    },
    btn: {
      ko: '확인', en: 'OK', ja: 'OK', 'zh-CN': '确认',
      vi: 'OK', fr: 'OK', de: 'OK', es: 'OK',
    },
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
                <h2 className="onb-title">{doneConfig.title[source] || doneConfig.title.en}</h2>
                <p style={{
                  color: '#64748b', fontSize: '0.85rem', margin: '8px 0 24px',
                  lineHeight: 1.6,
                }}>
                  {doneConfig.desc[source] || doneConfig.desc.en}
                </p>
                <button className="onb-next-btn" onClick={handleDone}>
                  {doneConfig.btn[source] || doneConfig.btn.en}
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
                    {nextText[source] || nextText.en} →
                  </button>
                )}

                {step >= 2 && (
                  <button className="onb-skip-btn" onClick={handleNoMore}>
                    {getNoText()}
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
