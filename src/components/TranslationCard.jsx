import { useState, useRef, useEffect } from 'react';
import { Play, Mic, MicOff, RotateCcw, Award, CheckCircle, AlertCircle, Star } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
import { playAlertSound, playSuccessSound, playStarSound } from '../utils/soundEffects';
import { useT } from '../utils/i18n';
import './TranslationCard.css';

const TranslationCard = ({
    language,
    langCode,
    sourceLangCode,
    fullLanguage,
    text,
    pronunciation,
    learningTip,
    badgeColor,
    badgeTextColor,
    onSpeak,
    onSave,
    isSaved,
    onPracticeResult,
    onTrialLimitReached,
    isLibraryView,
    targetGoal = 80,
}) => {
    const t = useT(sourceLangCode);

    const {
        isRecording,
        isAnalyzing,
        assessmentResult,
        coachTip,
        errorMsg,
        saveMessage,
        startRecording,
        stopRecording,
    } = useAudioRecorder(text, langCode, sourceLangCode, onTrialLimitReached);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (assessmentResult && onPracticeResult) {
            onPracticeResult(langCode, assessmentResult);
        }
    }, [assessmentResult, langCode]);

    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal) {
                playSuccessSound();
            } else {
                playAlertSound();
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult, targetGoal]);

    const handleStarClick = (e) => {
        e.stopPropagation();
        if (isSaved) return;
        playStarSound();
        onSave?.();
    };

    return (
        <div className="translation-card">
            {/* 카드 상단: 언어 정보, 별 저장 버튼, 읽기 버튼 */}
            <div className="card-header">
                <span
                    className="language-badge"
                    style={{ backgroundColor: badgeColor, color: badgeTextColor }}
                >
                    {fullLanguage || language}
                </span>

                <div className="card-header-actions">
                    {!isLibraryView && (
                        <button
                            className={`card-star-btn ${isSaved ? 'saved' : ''}`}
                            onClick={handleStarClick}
                            disabled={isSaved}
                            title="Save to Library"
                        >
                            <Star size={22} fill={isSaved ? '#facc15' : 'none'} color={isSaved ? '#facc15' : '#94a3b8'} />
                        </button>
                    )}
                    <button
                        className="speak-button"
                        onClick={(e) => { e.stopPropagation(); onSpeak(); }}
                        title="Listen"
                    >
                        <Play size={22} fill="white" stroke="white" />
                    </button>
                </div>
            </div>

            {/* 카드 본문: 번역 문장과 기본 발음 가이드 */}
            <div className="card-body">
                <p className={`translated-text font-${langCode}`}>
                    {text || '...'}
                </p>
                {pronunciation && !assessmentResult && (
                    <p className={`pronunciation-text font-${langCode}`}>
                        {pronunciation}
                    </p>
                )}
            </div>

            <div className="section-divider"></div>

            {/* 발음 연습 섹션 */}
            <div className="practice-section">
                <div className="section-header">
                    <span className="section-label">PRONUNCIATION</span>
                    {assessmentResult && (
                        <div className="score-badge">
                            <Award size={14} />
                            {assessmentResult.pronunciationScore}Pt
                        </div>
                    )}
                </div>

                <div className="practice-content">
                    {!assessmentResult && !isAnalyzing && !isRecording && (
                        <p className="practice-placeholder">{t('card.practicePrompt')}</p>
                    )}
                    {isRecording && <p className="recording-status">{t('card.recording')}</p>}
                    {isAnalyzing && <p className="analyzing-status">{t('card.analyzing')}</p>}

                    {errorMsg && (
                        <div className="error-message" style={{ color: '#ef4444', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', justifyContent: 'center' }}>
                            <AlertCircle size={14} />
                            {errorMsg}
                        </div>
                    )}

                    {saveMessage && !isAnalyzing && (
                        <div className="save-message" style={{ color: '#10b981', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', justifyContent: 'center', fontWeight: 'bold' }}>
                            <CheckCircle size={14} />
                            {saveMessage}
                        </div>
                    )}

                    <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLangCode} />

                    <div className="practice-actions">
                        <button
                            className={`record-button circle ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
                            onClick={(e) => { e.stopPropagation(); isRecording ? stopRecording() : startRecording(); }}
                            disabled={isAnalyzing}
                            title="Practice pronunciation"
                        >
                            {isAnalyzing ? <RotateCcw size={20} className="spin" /> : isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* AI 코치 피드백 영역 */}
            {coachTip && (
                <div className="coach-feedback-area">
                    <div className="coach-header">
                        <span className="coach-label">AI PRO COACH</span>
                    </div>
                    <p className="coach-tip-text">"{coachTip}"</p>
                </div>
            )}

            {/* 카드 하단: 학습 팁 영역 */}
            <div className="card-footer">
                <span className="tip-label">LEARNING TIP</span>
                <div className="tip-content-wrapper">
                    {typeof learningTip === 'string' ? (
                        <p className={`tip-content font-${sourceLangCode}`}>{learningTip}</p>
                    ) : Array.isArray(learningTip) ? (
                        learningTip.map((tip, index) => (
                            <p key={index} className={`tip-content font-${sourceLangCode}`}>
                                • {tip}
                            </p>
                        ))
                    ) : (
                        <p className="tip-content">AI is analyzing the sentence...</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TranslationCard;
