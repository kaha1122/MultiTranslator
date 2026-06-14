import { useState, useEffect } from 'react';
import { Volume2, Mic, Square } from 'lucide-react';
import { getT } from '../utils/i18n';
import { getOnboardingPhrase } from '../config/onboardingPhrases';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
import { resetIOSViewport } from '../utils/resetIOSViewport';

// ── 온보딩 첫 발음 챌린지 (무과금) ────────────────────────────────────────
// 흐름: 5-A 먼저 들어보기 → 5-B 따라 말하기 → 5-C 결과(+따뜻한 카피)
// useAudioRecorder({ skipCount:true })로 한도/일일 카운트 무차감.
// TTS도 onSpeak(..., { _skipGate:true })로 무과금. "나중에 할게요" 항상 노출.
export default function OnboardingPronChallenge({ sourceLang, targetLang, onSpeak, onSkip, onContinue }) {
  const t = (k) => getT(sourceLang, k);
  const phrase = getOnboardingPhrase(targetLang);
  const [phase, setPhase] = useState('intro'); // 'intro' | 'listen' | 'speak'
  const [hasListened, setHasListened] = useState(false);

  const {
    isRecording, isAnalyzing, assessmentResult,
    errorMsg, micDenied, openAppSettings,
    startRecording, stopRecording, resetAssessment,
  } = useAudioRecorder(phrase, targetLang, sourceLang, undefined, undefined, { skipCount: true });

  // 결과 단계는 state가 아니라 채점 결과 유무에서 파생 (setState-in-effect 회피)
  const effectivePhase = assessmentResult ? 'result' : phase;

  // 채점 결과 도착 시 iOS viewport 복구만 수행(마이크 권한 팝업 후 stuck 방지) — side-effect only
  useEffect(() => {
    if (assessmentResult) resetIOSViewport();
  }, [assessmentResult]);

  const handleListen = () => {
    // 무과금(_skipGate) + 영속 캐시(durable): 고정 온보딩 문장은 전역 1회 합성 후 모든 유저 재사용
    onSpeak?.(phrase, targetLang, undefined, { _skipGate: true, durable: true });
    setHasListened(true);
  };

  const handleRetry = () => {
    resetAssessment();
    setPhase('speak');
  };

  // 결과 화면의 단어 TTS도 무과금으로 래핑
  const speakFree = (text, lang, emotion, o) =>
    onSpeak?.(text, lang, emotion, { ...(o || {}), _skipGate: true });

  if (effectivePhase === 'result') {
    return (
      <div className="onb-pron">
        <h2 className="onb-title">{t('onboarding.firstPron.resultTitle')}</h2>
        <PronunciationAssessment
          data={assessmentResult}
          sourceLangCode={sourceLang}
          langCode={targetLang}
          onSpeak={speakFree}
          ttsSource="onboarding"
        />
        <p style={{ margin: '14px 0', fontSize: '0.9rem', color: '#475569', textAlign: 'center', lineHeight: 1.6 }}>
          {t('onboarding.firstPron.resultDesc')}
        </p>
        <button className="onb-next-btn" onClick={onContinue}>
          {t('onboarding.firstPron.continue')}
        </button>
        <button className="onb-skip-btn" onClick={handleRetry}>
          {t('onboarding.firstPron.retry')}
        </button>
      </div>
    );
  }

  // 0단계: 앱 의미/목적 안내 — 발음 연습이 무엇인지 먼저 설명
  if (phase === 'intro') {
    return (
      <div className="onb-pron">
        <div style={{
          width: '56px', height: '56px', borderRadius: '50%', background: '#f0fdfa',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: '28px',
        }}>🎤</div>
        <h2 className="onb-title">{t('onboarding.firstPron.introTitle')}</h2>
        <p style={{ margin: '0 0 10px', fontSize: '0.92rem', color: '#334155', lineHeight: 1.6, textAlign: 'center' }}>
          {t('onboarding.firstPron.introLine1')}
        </p>
        <p style={{ margin: '0 0 18px', fontSize: '0.92rem', color: '#334155', lineHeight: 1.6, textAlign: 'center' }}>
          {t('onboarding.firstPron.introLine2')}
        </p>
        <button className="onb-next-btn" onClick={() => setPhase('listen')}>
          {t('onboarding.firstPron.introStart')} →
        </button>
        <button className="onb-skip-btn" onClick={onSkip}>
          {t('onboarding.firstPron.later')}
        </button>
      </div>
    );
  }

  return (
    <div className="onb-pron">
      <h2 className="onb-title">
        {phase === 'listen' ? t('onboarding.firstPron.listenTitle') : t('onboarding.firstPron.speakTitle')}
      </h2>

      {/* 학습어 문장 카드 */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px',
        padding: '20px 16px', margin: '0 0 18px', textAlign: 'center',
      }}>
        <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>
          {phrase}
        </span>
      </div>

      {phase === 'listen' ? (
        <>
          <button
            onClick={handleListen}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              width: '100%', padding: '16px', borderRadius: '14px', border: 'none',
              background: '#0d9488', color: '#fff', fontSize: '1.05rem', fontWeight: 700,
              cursor: 'pointer', marginBottom: '14px',
            }}
          >
            <Volume2 size={26} /> {t('onboarding.firstPron.listenBtn')}
          </button>
          <button className="onb-next-btn" onClick={() => setPhase('speak')} disabled={!hasListened}
            style={!hasListened ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
            {t('onboarding.next')} →
          </button>
        </>
      ) : (
        <>
          {/* 다시 들어보기 (작게) */}
          <button
            onClick={handleListen}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              margin: '0 auto 14px', padding: '8px 14px', borderRadius: '10px',
              border: '1px solid #cbd5e1', background: '#fff', color: '#0d9488',
              fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Volume2 size={16} /> {t('onboarding.firstPron.listenAgain')}
          </button>

          {micDenied ? (
            <>
              {errorMsg && <p style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'center', margin: '0 0 12px' }}>{errorMsg}</p>}
              <button className="onb-next-btn" onClick={openAppSettings}>
                {t('onboarding.firstPron.openSettings')}
              </button>
            </>
          ) : isAnalyzing ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '0.95rem' }}>
              {t('onboarding.firstPron.analyzing')}
            </div>
          ) : (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              aria-label={t('onboarding.firstPron.speakHint')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '76px', height: '76px', borderRadius: '50%', border: 'none',
                background: isRecording ? '#ef4444' : '#0d9488', color: '#fff',
                margin: '0 auto 10px', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(13,148,136,0.35)',
                transition: 'background 0.2s',
              }}
            >
              {isRecording ? <Square size={28} /> : <Mic size={30} />}
            </button>
          )}

          {!micDenied && !isAnalyzing && (
            <p style={{ textAlign: 'center', fontSize: '0.82rem', color: '#64748b', margin: '0 0 8px' }}>
              {t('onboarding.firstPron.speakHint')}
            </p>
          )}
          {errorMsg && !micDenied && (
            <p style={{ color: '#ef4444', fontSize: '0.82rem', textAlign: 'center', margin: '0 0 8px' }}>{errorMsg}</p>
          )}
        </>
      )}

      {/* 음성 처리 고지 (듣기/말하기 공통) */}
      <p style={{ fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center', lineHeight: 1.5, margin: '14px 0 10px' }}>
        🔒 {t('onboarding.firstPron.privacyNote')}{' · '}
        <a href="https://pronunfit.com/privacy" target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--brand-accent)' }}>
          {t('aiConsent.privacyLink')}
        </a>
      </p>

      <button className="onb-skip-btn" onClick={onSkip}>
        {t('onboarding.firstPron.later')}
      </button>
    </div>
  );
}
