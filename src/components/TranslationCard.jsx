import React, { useState, useRef } from 'react';
import { Play, Mic, MicOff, RotateCcw, Volume2, Award } from 'lucide-react';
import axios from 'axios';
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
    onSpeak        // 문장 읽어주기 함수
}) => {
    // --- 1. 상태 관리 (Coaching State) ---
    // 발음 연습 기능을 위한 데이터 저장 바구니들입니다.
    const [isRecording, setIsRecording] = useState(false);     // 현재 녹음 중인지 여부
    const [isAnalyzing, setIsAnalyzing] = useState(false);     // AI가 내 목소리를 분석 중인지 여부
    const [assessmentResult, setAssessmentResult] = useState(null); // 분석 결과 (점수 등) 저장
    const [coachTip, setCoachTip] = useState(null);           // AI 코치가 주는 맞춤 조언
    const [coachAudio, setCoachAudio] = useState(null);         // AI 코치의 가이드 목소리 데이터

    const mediaRecorder = useRef(null); // 녹음기 객체를 저장
    const audioChunks = useRef([]);    // 녹음된 오디오 데이터를 조각조각 저장

    // --- 2. 녹음 및 분석 로직 ---

    // 2-1. 녹음 시작 함수
    const startRecording = async () => {
        try {
            // 사용자의 마이크 권한을 요청합니다.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = []; // 데이터 조각 초기화

            // 녹음되는 동안 데이터를 조각조각 모읍니다.
            mediaRecorder.current.ondataavailable = (e) => {
                audioChunks.current.push(e.data);
            };

            // 녹음이 멈추면 모은 데이터로 분석을 요청합니다.
            mediaRecorder.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
                analyzeFullPronunciation(audioBlob); // 분석 요청 함수 실행
            };

            mediaRecorder.current.start();
            setIsRecording(true); // "녹음 중" 표시
            setAssessmentResult(null); // 이전 결과 지우기
            setCoachTip(null);
        } catch (err) {
            console.error("마이크 접근 오류:", err);
            alert("마이크 접근 권한이 필요합니다.");
        }
    };

    // 2-2. 녹음 중지 함수
    const stopRecording = () => {
        if (mediaRecorder.current && isRecording) {
            mediaRecorder.current.stop();
            setIsRecording(false);
        }
    };

    // 2-3. AI 서버에 내 목소리 분석 요청하기
    const analyzeFullPronunciation = async (blob) => {
        setIsAnalyzing(true); // "분석 중..." 상태 표시
        const formData = new FormData();
        formData.append('audio', blob, 'recording.wav'); // 내 목소리 파일 담기
        formData.append('text', text);                   // 비교할 기준 문장 담기

        try {
            // 백엔드 서버(localhost:5000)에 데이터 전송
            const response = await axios.post('http://localhost:5000/analyze', formData);
            setAssessmentResult(response.data.assessment); // 상세 점수 저장
            setCoachTip(response.data.coaching.tip);       // 코치 조언 저장
            setCoachAudio(response.data.coaching.audio);   // 코치 음성 저장
        } catch (err) {
            console.error("분석 실패:", err);
            alert("분석 서버가 꺼져있거나 오류가 발생했습니다. (백엔드 확인 필요)");
        } finally {
            setIsAnalyzing(false); // 분석 완료
        }
    };

    // 2-4. AI 코치의 가이드 음성 듣기 함수
    const playCoachVoice = () => {
        if (coachAudio) {
            const audio = new Audio(`data:audio/mp3;base64,${coachAudio}`);
            audio.play();
        }
    };

    return (
        <div className="translation-card">
            {/* 카드 상단: 언어 정보와 읽기 버튼 */}
            <div className="card-header">
                <span
                    className="language-badge"
                    style={{ backgroundColor: badgeColor, color: badgeTextColor }}
                >
                    {fullLanguage || language}
                </span>

                <button className="speak-button" onClick={onSpeak} title="발음 듣기">
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

            {/* 발음 연습 (PRONUNCIATION) 섹션 */}
            <div className="practice-section">
                <div className="section-header">
                    <span className="section-label">PRONUNCIATION</span>
                    {/* 분석 점수가 있을 때만 뱃지로 보여줍니다. */}
                    {assessmentResult && (
                        <div className="score-badge">
                            <Award size={14} />
                            {assessmentResult.pronunciationScore}점
                        </div>
                    )}
                </div>

                <div className="practice-content">
                    {/* 상태별 메시지 표시 (연습 전 / 녹음 중 / 분석 중) */}
                    {!assessmentResult && !isAnalyzing && !isRecording && (
                        <p className="practice-placeholder">버튼을 눌러 발음을 연습해보세요!</p>
                    )}

                    {isRecording && <p className="recording-status">말씀해주세요... 🎙️</p>}

                    {isAnalyzing && <p className="analyzing-status">AI 코치가 분석 중입니다... ✨</p>}

                    {/* 발음 정확도를 단어별 색상으로 보여주는 영역 */}
                    {assessmentResult && (
                        <div className="assessment-display">
                            {assessmentResult.words.map((w, i) => (
                                <span
                                    key={i}
                                    className={`assessment-word ${w.accuracyScore > 80 ? 'good' : w.accuracyScore > 50 ? 'average' : 'poor'}`}
                                    title={`Accuracy: ${w.accuracyScore}%`}
                                >
                                    {w.word}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* 녹음 버튼 및 초기화 버튼 */}
                    <div className="practice-actions">
                        <button
                            className={`record-button circle ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={isAnalyzing}
                            title="발음 연습하기"
                        >
                            {isAnalyzing ? (
                                <RotateCcw size={20} className="spin" />
                            ) : isRecording ? (
                                <MicOff size={20} />
                            ) : (
                                <Mic size={20} />
                            )}
                        </button>

                        {assessmentResult && (
                            <button className="reset-button circle-small" onClick={() => { setAssessmentResult(null); setCoachTip(null); }} title="다시하기">
                                <RotateCcw size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* AI 코치 피드백 영역: 내 발음의 문제점을 정확히 짚어줍니다. */}
            {coachTip && (
                <div className="coach-feedback-area">
                    <div className="coach-header">
                        <span className="coach-label">AI PRO COACH</span>
                        {coachAudio && (
                            <button className="coach-audio-btn" onClick={playCoachVoice}>
                                <Volume2 size={16} /> 가이드 듣기
                            </button>
                        )}
                    </div>
                    <p className="coach-tip-text">"{coachTip}"</p>
                </div>
            )}

            {/* 카드 하단: AI가 분석한 언어별 학습 팁 영역 */}
            <div className="card-footer">
                <span className="tip-label">LEARNING TIP</span>
                <div className="tip-content-wrapper">
                    {/* 팁이 하나인 경우와 여러 개인 경우를 모두 처리합니다. */}
                    {typeof learningTip === 'string' ? (
                        <p className={`tip-content font-${sourceLangCode}`}>{learningTip}</p>
                    ) : Array.isArray(learningTip) ? (
                        learningTip.map((tip, index) => (
                            <p key={index} className={`tip-content font-${sourceLangCode}`}>
                                • {tip}
                            </p>
                        ))
                    ) : (
                        <p className="tip-content">AI가 문장을 분석하고 있어요...</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TranslationCard;
