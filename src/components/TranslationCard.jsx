import { useState, useRef, useEffect } from 'react';
import { Play, Mic, MicOff, RotateCcw, Award, CheckCircle, AlertCircle, Star } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAuth } from '../context/AuthContext';
import PronunciationAssessment from './PronunciationAssessment';
import { playAlertSound, playSuccessSound, playStarSound } from '../utils/soundEffects';
import { useT } from '../utils/i18n';
import './TranslationCard.css';

// ── 어노테이션 헬퍼 ──────────────────────────────────────────────
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function AnnotatedText({ text, annotations }) {
    if (!annotations?.length || !text) return <>{text}</>;
    let parts = [{ t: text, ann: null }];
    for (const ann of annotations) {
        if (!ann.matchText) continue;
        const re = new RegExp(`(${escapeRegex(ann.matchText)})`, 'gi');
        parts = parts.flatMap(p => {
            if (p.ann !== null) return [p];
            return p.t.split(re).filter(Boolean).map(chunk => ({
                t: chunk,
                ann: re.test(chunk) ? ann.type : null,
            }));
        });
    }
    return (
        <>
            {parts.map((p, i) =>
                p.ann ? <span key={i} className={`ann-${p.ann}`}>{p.t}</span> : p.t
            )}
        </>
    );
}

function isAnnotationCommand(text) {
    return /(밑줄|underline|형광|highlight|별표|star)/i.test(text);
}

function parseAnnotation(input) {
    let type = 'highlight';
    if (/(밑줄|underline)/i.test(input)) type = 'underline';
    else if (/(별표|star)/i.test(input)) type = 'star';

    // 따옴표로 감싼 단어 우선 추출, 없으면 "X에/X을/X를" 패턴
    const quoted = input.match(/["'"'`]([^"'"'`]+)["'"'`]/);
    let matchText = '';
    if (quoted) {
        matchText = quoted[1].trim();
    } else {
        const cleaned = input
            .replace(/(밑줄|underline|형광펜?|highlight|별표|star|쳐줘|칠해줘|해줘|그어줘|처줘|적용|을|를|에|은|는)/gi, ' ')
            .trim();
        matchText = cleaned.split(/\s+/).filter(Boolean).join(' ').trim();
    }
    return { matchText, type };
}

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
    // 메모 & 어노테이션 (Library에서만 사용)
    cardId,
    memos = [],
    annotations = [],
    onMemoUpdate,
    // Library에서 외부적으로 팝업 열기/닫기 제어
    memoPopupOpen = false,
    onMemoClose,
}) => {
    const t = useT(sourceLangCode);
    const { byokGeminiKey } = useAuth();

    // ── 메모 팝업 상태 ──
    const [showMemoPopup, setShowMemoPopup] = useState(false);
    const [memoInput, setMemoInput] = useState('');
    const [isMemoLoading, setIsMemoLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState(null); // { query, text } — 팝업 안에 즉시 표시
    const memoInputRef = useRef(null);

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

    // ── 외부(Library)에서 memoPopupOpen prop으로 팝업 열기 ──
    useEffect(() => {
        if (memoPopupOpen) {
            setShowMemoPopup(true);
            setLastResponse(null);
            setTimeout(() => memoInputRef.current?.focus(), 80);
        }
    }, [memoPopupOpen]);

    // ── 팝업 닫기 (내부 + 외부 상태 모두 초기화) ──
    const closePopup = () => {
        if (isMemoLoading) return;
        setShowMemoPopup(false);
        setMemoInput('');
        setLastResponse(null);
        onMemoClose?.();
    };

    // ── Gemini AI 메모 호출 ──
    const callGeminiMemo = async (query) => {
        const key = byokGeminiKey || import.meta.env.VITE_GEMINI_API_KEY;
        const langNames = { ko: '한국어', en: 'English', ja: '日本語', 'zh-CN': '中文', vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español' };
        const srcName = langNames[sourceLangCode] || 'Korean';
        const tipText = Array.isArray(learningTip) ? learningTip.join(' ') : (learningTip || '');

        const prompt = `You are a language learning assistant.
Card text: "${text}" (${langCode})
Learning Tips: "${tipText}"
Student asks in ${srcName}: "${query}"

Answer in ${srcName}, exactly 2 lines:
① [Core meaning or explanation — 1 sentence]
② [Example sentence or usage tip — 1 sentence]
Return only these 2 lines.`;

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
        );
        const data = await res.json();
        return data.candidates[0].content.parts[0].text.trim();
    };

    // ── 메모 제출 처리 ──
    const handleMemoSubmit = async () => {
        const query = memoInput.trim();
        if (!query || isMemoLoading) return;
        setMemoInput('');
        setLastResponse(null);
        setIsMemoLoading(true);
        try {
            if (isAnnotationCommand(query)) {
                const ann = parseAnnotation(query);
                if (ann.matchText) {
                    const newAnnotations = [
                        ...(annotations || []).filter(a => a.matchText.toLowerCase() !== ann.matchText.toLowerCase()),
                        ann,
                    ];
                    await onMemoUpdate?.(memos, newAnnotations);
                    setLastResponse({ query, text: `"${ann.matchText}" 에 ${ann.type === 'underline' ? '밑줄' : ann.type === 'star' ? '별표' : '형광펜'} 적용 완료 ✅` });
                }
            } else {
                const response = await callGeminiMemo(query);
                const newMemos = [...(memos || []), { query, response, createdAt: new Date().toISOString() }];
                await onMemoUpdate?.(newMemos, annotations);
                setLastResponse({ query, text: response });
            }
        } catch (e) {
            console.error('Memo failed:', e);
            setLastResponse({ query, text: '❌ 오류가 발생했습니다. 다시 시도해 주세요.' });
        } finally {
            setIsMemoLoading(false);
            // 팝업 자동 닫힘 없음 — 사용자가 직접 X 버튼으로 닫아야 함
        }
    };

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
                        <p className={`tip-content font-${sourceLangCode}`}>
                            <AnnotatedText text={learningTip} annotations={annotations} />
                        </p>
                    ) : Array.isArray(learningTip) ? (
                        learningTip.map((tip, index) => (
                            <p key={index} className={`tip-content font-${sourceLangCode}`}>
                                • <AnnotatedText text={tip} annotations={annotations} />
                            </p>
                        ))
                    ) : (
                        <p className="tip-content">AI is analyzing the sentence...</p>
                    )}
                </div>

                {/* 저장된 메모 목록 */}
                {memos?.length > 0 && (
                    <div className="card-memos">
                        <span className="memo-section-label">MY MEMOS</span>
                        {memos.map((memo, i) => (
                            <div key={i} className="memo-item">
                                <p className="memo-query">💬 {memo.query}</p>
                                <p className="memo-response">{memo.response}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 메모 팝업 */}
            {showMemoPopup && (
                <div className="memo-popup-overlay">
                    <div className="memo-popup" onClick={e => e.stopPropagation()}>
                        {/* 헤더: 타이틀 + 전송 + 닫기 */}
                        <div className="memo-popup-header">
                            <span className="memo-popup-title">메모</span>
                            <div className="memo-popup-header-actions">
                                <button
                                    className="memo-submit-btn"
                                    onClick={handleMemoSubmit}
                                    disabled={!memoInput.trim() || isMemoLoading}
                                    title="전송"
                                >
                                    {isMemoLoading ? <RotateCcw size={16} className="spin" /> : '→'}
                                </button>
                                <button className="memo-popup-close" onClick={closePopup} disabled={isMemoLoading}>✕</button>
                            </div>
                        </div>

                        {/* 입력창 — 팝업 전체 너비 */}
                        <input
                            ref={memoInputRef}
                            type="text"
                            className="memo-input"
                            value={memoInput}
                            onChange={e => setMemoInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleMemoSubmit()}
                            placeholder='예) "run이 무슨 뜻이야?" · "Baseball에 밑줄 쳐줘"'
                            disabled={isMemoLoading}
                        />

                        {/* 진행 중 표시 */}
                        {isMemoLoading && (
                            <div className="memo-loading-status">
                                <span className="memo-loading-dot" />
                                AI가 답변을 생성하고 있습니다...
                            </div>
                        )}

                        {/* AI 답변 즉시 표시 */}
                        {lastResponse && !isMemoLoading && (
                            <div className="memo-popup-response">
                                <p className="memo-popup-response-query">💬 {lastResponse.query}</p>
                                <p className="memo-popup-response-text">{lastResponse.text}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranslationCard;
