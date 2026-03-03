import { useState, useRef, useEffect } from 'react';
import { Play, Mic, MicOff, RotateCcw, Award, CheckCircle, AlertCircle } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
import { playAlertSound, playSuccessSound, playSwipeSound } from '../utils/soundEffects';
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
    isSelected,
    onToggleSelect,
    onSwipeSave,
    isInSelectionMode,
    onPracticeResult,
    isLibraryView,
    targetGoal = 80,
    librarySaveMessage
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
    } = useAudioRecorder(text, langCode, sourceLangCode);

    const [swipeX, setSwipeX] = useState(0);
    const [isSaving, setIsSaving] = useState(false);

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

    const longPressTimer = useRef(null);
    const touchStartPos = useRef({ x: 0, y: 0 });
    const isSwiping = useRef(false);

    const handleTouchStart = (e) => {
        if (isLibraryView) return;

        const touch = e.touches[0];
        touchStartPos.current = { x: touch.clientX, y: touch.clientY };
        isSwiping.current = false;

        longPressTimer.current = setTimeout(() => {
            if (!isSwiping.current) {
                if ("vibrate" in navigator) navigator.vibrate(50);
                onToggleSelect();
            }
        }, 500);
    };

    const handleTouchMove = (e) => {
        if (isLibraryView) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - touchStartPos.current.x;
        const deltaY = touch.clientY - touchStartPos.current.y;

        if (Math.abs(deltaX) > 10) {
            isSwiping.current = true;
            clearTimeout(longPressTimer.current);

            if (!isInSelectionMode) {
                setSwipeX(deltaX);
            }
        }

        if (Math.abs(deltaY) > 30) {
            clearTimeout(longPressTimer.current);
        }
    };

    const handleTouchEnd = () => {
        if (isLibraryView) return;

        clearTimeout(longPressTimer.current);

        if (swipeX < -120 && !isInSelectionMode) {
            playSwipeSound();
            setIsSaving(true);
            setTimeout(() => {
                onSwipeSave();
                setSwipeX(0);
                setIsSaving(false);
            }, 300);
        } else {
            setSwipeX(0);
        }
    };

    const handleClick = () => {
        if (isLibraryView) return;

        if (isInSelectionMode) {
            onToggleSelect();
        }
    };

    return (
        <div
            className={`translation-card ${isSelected ? 'selected' : ''} ${isSaving ? 'saving-swipe-left' : ''}`}
            style={{ '--swipe-x': `${swipeX}px`, transform: `translateX(${swipeX}px)` }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onClick={handleClick}
        >
            {/* 선택 모드일 때 나타나는 체크박스 */}
            {isInSelectionMode && (
                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                    <CheckCircle size={24} fill={isSelected ? "#6366f1" : "white"} color={isSelected ? "white" : "#d1d5db"} />
                </div>
            )}

            {/* 카드 상단: 언어 정보와 읽기 버튼 */}
            <div className="card-header">
                <span
                    className="language-badge"
                    style={{ backgroundColor: badgeColor, color: badgeTextColor }}
                >
                    {fullLanguage || language}
                </span>

                <button className={`speak-button ${isInSelectionMode ? 'disabled' : ''}`} onClick={(e) => { e.stopPropagation(); onSpeak(); }} disabled={isInSelectionMode} title="Listen">
                    <Play size={22} fill="white" stroke="white" />
                </button>
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

            {/* 발음 연습 섹션 - 선택 모드에선 가리기 */}
            {!isInSelectionMode && (
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

                        {/* 보관함 중복 저장 차단 메시지 */}
                        {librarySaveMessage && !isAnalyzing && (
                            <div className="library-save-message" style={{
                                color: librarySaveMessage.includes('⚠️') ? '#f59e0b' : '#10b981',
                                backgroundColor: librarySaveMessage.includes('⚠️') ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                fontSize: '0.875rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginTop: '12px',
                                justifyContent: 'center',
                                fontWeight: '600'
                            }}>
                                {librarySaveMessage.includes('⚠️') ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
                                {librarySaveMessage.replace('⚠️ ', '').replace('✅ ', '')}
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
            )}

            {/* AI 코치 피드백 영역 */}
            {coachTip && !isInSelectionMode && (
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
