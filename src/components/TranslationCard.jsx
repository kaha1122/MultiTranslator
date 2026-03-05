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
                p.ann ? <strong key={i} className={`ann-${p.ann}`}>{p.t}</strong> : p.t
            )}
        </>
    );
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
    const [memoTab, setMemoTab] = useState('ai'); // 'ai' | 'edit'
    const [memoInput, setMemoInput] = useState('');
    const [editWord, setEditWord] = useState('');
    const [isMemoLoading, setIsMemoLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState(null); // { text } — 팝업 안에 즉시 표시
    const memoInputRef = useRef(null);
    const editInputRef = useRef(null);

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
            setMemoTab('ai');
            setLastResponse(null);
            setMemoInput('');
            setEditWord('');
            setTimeout(() => memoInputRef.current?.focus(), 80);
        }
    }, [memoPopupOpen]);

    // ── 팝업 닫기 (내부 + 외부 상태 모두 초기화) ──
    const closePopup = () => {
        if (isMemoLoading) return;
        setShowMemoPopup(false);
        setMemoInput('');
        setEditWord('');
        setLastResponse(null);
        setMemoTab('ai');
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

    // ── AI Q/A 제출 ──
    const handleMemoSubmit = async () => {
        const query = memoInput.trim();
        if (!query || isMemoLoading) return;
        setMemoInput('');
        setLastResponse(null);
        setIsMemoLoading(true);
        try {
            const response = await callGeminiMemo(query);
            const newMemos = [...(memos || []), { query, response, createdAt: new Date().toISOString() }];
            await onMemoUpdate?.(newMemos, annotations);
            setLastResponse({ query, text: response });
        } catch (e) {
            console.error('Memo failed:', e);
            setLastResponse({ query, text: '❌ 오류가 발생했습니다. 다시 시도해 주세요.' });
        } finally {
            setIsMemoLoading(false);
        }
    };

    // ── Edit 탭: 어노테이션 적용 ──
    const handleEditApply = async (style) => {
        const word = editWord.trim();
        if (!word || isMemoLoading) return;
        setIsMemoLoading(true);
        setLastResponse(null);
        try {
            const ann = { matchText: word, type: style };
            const newAnnotations = [
                ...(annotations || []).filter(a => a.matchText.toLowerCase() !== word.toLowerCase()),
                ann,
            ];
            await onMemoUpdate?.(memos, newAnnotations);
            const label = style === 'underline' ? '밑줄' : style === 'red' ? '빨강' : '형광';
            setLastResponse({ text: `"${word}" 에 ${label} 적용 완료 ✅` });
            setEditWord('');
        } catch (e) {
            setLastResponse({ text: '❌ 오류가 발생했습니다.' });
        } finally {
            setIsMemoLoading(false);
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

                {/* 저장된 메모 목록 (AI Q&A만) */}
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
                        {/* 헤더: 타이틀 + 닫기 */}
                        <div className="memo-popup-header">
                            <span className="memo-popup-title">메모</span>
                            <button className="memo-popup-close" onClick={closePopup} disabled={isMemoLoading}>✕</button>
                        </div>

                        {/* 탭 */}
                        <div className="memo-tab-bar">
                            <button
                                className={`memo-tab-btn ${memoTab === 'ai' ? 'active' : ''}`}
                                onClick={() => { setMemoTab('ai'); setLastResponse(null); setTimeout(() => memoInputRef.current?.focus(), 50); }}
                            >AI Q&amp;A</button>
                            <button
                                className={`memo-tab-btn ${memoTab === 'edit' ? 'active' : ''}`}
                                onClick={() => { setMemoTab('edit'); setLastResponse(null); setTimeout(() => editInputRef.current?.focus(), 50); }}
                            >Edit</button>
                        </div>

                        {/* AI Q&A 탭 */}
                        {memoTab === 'ai' && (
                            <div className="memo-tab-content">
                                <div className="memo-input-row">
                                    <input
                                        ref={memoInputRef}
                                        type="text"
                                        className="memo-input"
                                        value={memoInput}
                                        onChange={e => setMemoInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleMemoSubmit()}
                                        placeholder="예) run이 무슨 뜻이야?"
                                        disabled={isMemoLoading}
                                    />
                                    <button
                                        className="memo-submit-btn"
                                        onClick={handleMemoSubmit}
                                        disabled={!memoInput.trim() || isMemoLoading}
                                        title="전송"
                                    >
                                        {isMemoLoading ? <RotateCcw size={16} className="spin" /> : '→'}
                                    </button>
                                </div>
                                {isMemoLoading && (
                                    <div className="memo-loading-status">
                                        <span className="memo-loading-dot" />
                                        AI가 답변을 생성하고 있습니다...
                                    </div>
                                )}
                                {lastResponse && !isMemoLoading && (
                                    <div className="memo-popup-response">
                                        <p className="memo-popup-response-query">💬 {lastResponse.query}</p>
                                        <p className="memo-popup-response-text">{lastResponse.text}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Edit 탭 */}
                        {memoTab === 'edit' && (
                            <div className="memo-tab-content">
                                <input
                                    ref={editInputRef}
                                    type="text"
                                    className="memo-input"
                                    value={editWord}
                                    onChange={e => setEditWord(e.target.value)}
                                    placeholder="단어를 입력하세요"
                                    disabled={isMemoLoading}
                                />
                                <div className="memo-style-btns">
                                    <button
                                        className="memo-style-btn memo-style-highlight"
                                        onClick={() => handleEditApply('highlight')}
                                        disabled={!editWord.trim() || isMemoLoading}
                                    >🟡 형광</button>
                                    <button
                                        className="memo-style-btn memo-style-underline"
                                        onClick={() => handleEditApply('underline')}
                                        disabled={!editWord.trim() || isMemoLoading}
                                    >밑줄</button>
                                    <button
                                        className="memo-style-btn memo-style-red"
                                        onClick={() => handleEditApply('red')}
                                        disabled={!editWord.trim() || isMemoLoading}
                                    >🔴 빨강</button>
                                </div>
                                {isMemoLoading && (
                                    <div className="memo-loading-status">
                                        <span className="memo-loading-dot" />
                                        적용 중...
                                    </div>
                                )}
                                {lastResponse && !isMemoLoading && (
                                    <div className="memo-popup-response">
                                        <p className="memo-popup-response-text">{lastResponse.text}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranslationCard;
