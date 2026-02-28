import React, { useState, useRef, useEffect } from 'react';
import { Play, Mic, MicOff, RotateCcw, Volume2, Award, CheckCircle, AlertCircle } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment'; // [신규] 발음 시각화 전담 컴포넌트 추가
import { playAlertSound, playSuccessSound, playSwipeSound } from '../utils/soundEffects'; // [신규] 효과음 함수 가져오기
import './TranslationCard.css';

const TranslationCard = ({
    language,      // 언어 이름 (예: 'English')
    langCode,      // 언어 코드 (예: 'en')
    sourceLangCode,// 출발 언어 코드 (예: 'ko')
    fullLanguage,  // 언어 전체 이름
    text,          // 번역된 문장
    pronunciation, // AI가 만든 발음 정보
    learningTip,   // AI가 만든 학습 팁
    badgeColor,    // 카드 상단 뱃지 배경색
    badgeTextColor,// 카드 상단 뱃지 글자색
    onSpeak,       // 문장 읽어주기 함수
    isSelected,    // 현재 카드가 선택되었는지 여부
    onToggleSelect,// 카드 선택 상태를 반전시키는 함수
    onSwipeSave,   // 스와이프 시 저장을 실행하는 함수
    isInSelectionMode, // 현재 앱이 선택 모드인지 여부
    onPracticeResult, // [신규] 발음 연습 완료 시 결과를 부모에게 전달하는 함수
    isLibraryView,    // [신규] 보관함에서 보여지는 카드인지 여부
    targetGoal = 80,  // [신규] 목표 점수 설정값 (없으면 기본값 80)
    librarySaveMessage // [신규] App에서 관리되는 보관함 저장 상탯값/메시지
}) => {
    // --- 1. 상태 관리 (Coaching & Gestures) ---
    // 오디오 관련 복잡한 로직(녹음, 분석 요청 등)을 커스텀 훅으로 분리했습니다.
    // 이렇게 하면 TranslationCard 컴포넌트는 UI를 예쁘게 보여주는 역할에만 충실해집니다.
    const {
        isRecording,
        isAnalyzing,
        assessmentResult,
        coachTip,
        coachAudio,
        errorMsg, // 에러 메시지(마이크 권한 획득 실패 등) 상태도 함께 가져옵니다.
        saveMessage, // [신규] 저장 성공/실패 메시지
        startRecording,
        stopRecording,
        playCoachVoice,
        resetAssessment
    } = useAudioRecorder(text, langCode, sourceLangCode); // [수정] 출발 언어 정보도 함께 넘겨줍니다.

    // 제스처 관련 상태
    const [swipeX, setSwipeX] = useState(0); // 스와이프 거리 저장
    const [isSaving, setIsSaving] = useState(false); // 스와이프 저장 도중 애니메이션 상태

    // [수정] 발음 평가 결과 부모 전달 및 무한 루프 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (assessmentResult && onPracticeResult) {
            // assessmentResult(점수, 오디오URL 등)가 업데이트 될 때 부모(Library 등)에게 알림
            onPracticeResult(langCode, assessmentResult);
        }
    }, [assessmentResult, langCode]); // onPracticeResult를 의존성에서 제거하여 무한 루프 렌더링을 차단합니다.

    // [신규] 효과음 재생 로직 (분석이 방금 막 끝났을 때 단 1회만 재생)
    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal) {
                playSuccessSound(); // ✨ 목표 달성 축하음 1회 재생
            } else {
                playAlertSound(); // 🔔 일반 완료 알림음 1회 재생
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult, targetGoal]);

    // useRef(mediaRecorder) 및 audioChunks는 useAudioRecorder.js 내부로 이동되었습니다.

    // 롱프레스 및 스와이프 감지를 위한 Ref
    const longPressTimer = useRef(null);
    const touchStartPos = useRef({ x: 0, y: 0 });
    const isSwiping = useRef(false);

    // --- 2. 제스처 핸들러 (Long Press & Swipe) ---

    // 2-1. 터치 시작 (롱프레스 타이머 시작 및 좌표 기록)
    const handleTouchStart = (e) => {
        if (isLibraryView) return; // 보관함에서는 제스처 완전 차단

        const touch = e.touches[0];
        touchStartPos.current = { x: touch.clientX, y: touch.clientY };
        isSwiping.current = false;

        // 0.5초 이상 누르면 선택 모드 진입
        longPressTimer.current = setTimeout(() => {
            if (!isSwiping.current) {
                if ("vibrate" in navigator) navigator.vibrate(50); // 햅틱 진동
                onToggleSelect(); // 선택 상태 변경 (이것이 첫 선택이면 앱 전체가 선택 모드가 됨)
            }
        }, 500);
    };

    // 2-2. 터치 이동 (스와이프 거리 계산)
    const handleTouchMove = (e) => {
        if (isLibraryView) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - touchStartPos.current.x;
        const deltaY = touch.clientY - touchStartPos.current.y;

        // 가로 이동이 크면 스와이프로 간주
        if (Math.abs(deltaX) > 10) {
            isSwiping.current = true;
            clearTimeout(longPressTimer.current); // 스와이프 중엔 롱프레스 취소

            // 선택 모드가 아닐 때만 개별 스와이프 애니메이션 허용
            if (!isInSelectionMode) {
                setSwipeX(deltaX);
            }
        }

        // 세로 스크롤 방해 방지
        if (Math.abs(deltaY) > 30) {
            clearTimeout(longPressTimer.current);
        }
    };

    // 2-3. 터치 종료 (스와이프 성공 여부 판단 및 애니메이션 실행)
    const handleTouchEnd = () => {
        if (isLibraryView) return;

        clearTimeout(longPressTimer.current);

        // 스와이프 거리가 왼쪽으로 120px 이상이면 저장 실행 (swipeX가 음수)
        if (swipeX < -120 && !isInSelectionMode) {
            playSwipeSound(); // [신규] 쓱! 날아가는 소리 재생
            setIsSaving(true); // 왼쪽으로 날아가는 애니메이션 시작
            setTimeout(() => {
                onSwipeSave(); // 실제 저장 로직 호출
                setSwipeX(0);
                setIsSaving(false);
            }, 300); // 더 빠르고 직관적인 속도(0.3초)
        } else {
            setSwipeX(0); // 원위치
        }
    };

    // 단순 클릭(탭) 처리
    const handleClick = () => {
        if (isLibraryView) return;

        if (isInSelectionMode) {
            onToggleSelect();
        }
    };

    // --- 3. 오디오 및 분석 로직 ---
    // 모든 녹음 및 분석(서버 통신) 로직들은 useAudioRecorder 훅에서 가져다 씁니다!

    return (
        <div
            className={`translation-card ${isSelected ? 'selected' : ''} ${isSaving ? 'saving-swipe-left' : ''}`}
            style={{ '--swipe-x': `${swipeX}px`, transform: `translateX(${swipeX}px)` }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd} // [버그 수정]: 스크롤 중 터치 끊김 시 멈춤 방지
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

            {/* 발음 연습 (PRONUNCIATION) 섹션 - 선택 모드에선 가리기 */}
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
                            <p className="practice-placeholder">Press the button to practice pronunciation!</p>
                        )}
                        {isRecording && <p className="recording-status">Speak now... 🎙️</p>}
                        {isAnalyzing && <p className="analyzing-status">AI Coach is analyzing... ✨</p>}

                        {/* 에러가 발생한 경우 부드러운 UI 텍스트로 사용자에게 안내합니다. alert() 창 대체 */}
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

                        {/* [신규] 보관함 중복 저장 차단 메시지 */}
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

                        {/* 새로 구현한 발음 평가 시각화 UI 컴포넌트입니다 */}
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
            {
                coachTip && !isInSelectionMode && (
                    <div className="coach-feedback-area">
                        <div className="coach-header">
                            <span className="coach-label">AI PRO COACH</span>
                            {coachAudio && (
                                <button className="coach-audio-btn" onClick={(e) => { e.stopPropagation(); playCoachVoice(); }}>
                                    <Volume2 size={16} /> Listen to Guide
                                </button>
                            )}
                        </div>
                        <p className="coach-tip-text">"{coachTip}"</p>
                    </div>
                )
            }

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
        </div >
    );
};

export default TranslationCard;
