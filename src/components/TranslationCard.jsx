import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, Mic, MicOff, RotateCcw, Award, CheckCircle, AlertCircle, Star, Flag } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAuth } from '../context/AuthContext';
import PronunciationAssessment from './PronunciationAssessment';
import { playAlertSound, playSuccessSound, playStarSound } from '../utils/soundEffects';
import { useT } from '../utils/i18n';
import { db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
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
    onTargetAchieved,   // Library 전용 + Translation 탭 이미저장 카드
    onBookmarkPrompt,   // 비Library 탭 미저장 카드 전용 (score, saveFn) => void
    savedCardId,        // Translation 탭에서 저장 후 받은 Firestore docId
    isLibraryView,
    targetGoal = 80,
    // 메모 & 어노테이션 (Library에서만 사용)
    cardId,
    memos = [],
    annotations = [],
    userNotes = [],
    onMemoUpdate,
    // Library 중요 마크
    starred = false,
    onToggleStarred,
    // Library에서 외부적으로 팝업 열기/닫기 제어
    memoPopupOpen = false,
    onMemoClose,
    // Scene 태그
    selectedEmotion = '',
    interactionType = '',
}) => {
    const t = useT(sourceLangCode);
    const { byokGeminiKey } = useAuth();

    // ── 메모 팝업 상태 ──
    const [showMemoPopup, setShowMemoPopup] = useState(false);
    const [memoTab, setMemoTab] = useState('ai'); // 'ai' | 'note'
    const [memoInput, setMemoInput] = useState('');
    const [noteInput, setNoteInput] = useState('');
    const [isMemoLoading, setIsMemoLoading] = useState(false);
    const [lastResponse, setLastResponse] = useState(null);
    // 낙관적 업데이트용 pending 목록
    const [pendingMemos, setPendingMemos] = useState([]);
    const [pendingNotes, setPendingNotes] = useState([]);
    const memoInputRef = useRef(null);
    const noteInputRef = useRef(null);

    // Firestore 반영 후 pending 제거
    useEffect(() => {
        setPendingMemos(prev =>
            prev.filter(pm => !(memos || []).some(m => m.createdAt === pm.createdAt))
        );
    }, [memos]);
    useEffect(() => {
        setPendingNotes(prev =>
            prev.filter(pn => !(userNotes || []).some(n => n.createdAt === pn.createdAt))
        );
    }, [userNotes]);

    // 카드에 실제 표시할 목록 (prop + pending)
    const displayMemos = [...(memos || []), ...pendingMemos];
    const displayNotes = [...(userNotes || []), ...pendingNotes];

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
            setNoteInput('');
            setTimeout(() => memoInputRef.current?.focus(), 80);
        }
    }, [memoPopupOpen]);

    // ── 팝업 닫기 ──
    const closePopup = () => {
        if (isMemoLoading) return;
        setShowMemoPopup(false);
        setMemoInput('');
        setNoteInput('');
        setLastResponse(null);
        setMemoTab('ai');
        onMemoClose?.();
    };

    // ── Gemini AI 메모 호출 ──
    const callGeminiMemo = async (query) => {
        const key = byokGeminiKey || import.meta.env.VITE_GEMINI_API_KEY;
        if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다.');
        const langNames = { ko: '한국어', en: 'English', ja: '日本語', 'zh-CN': '中文', vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español' };
        const srcName = langNames[sourceLangCode] || 'Korean';
        const tipText = Array.isArray(learningTip)
            ? learningTip.map(t => (t && typeof t === 'object') ? (t.content || '') : String(t || '')).join(' ')
            : (learningTip || '');

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
        if (!res.ok) {
            throw new Error(data.error?.message || `API 오류 (${res.status})`);
        }
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
            const memoEntry = { query, response, createdAt: new Date().toISOString() };
            const newMemos = [...(memos || []), memoEntry];
            setPendingMemos(prev => [...prev, memoEntry]);
            if (cardId) {
                await updateDoc(doc(db, "savedCards", cardId), { memos: newMemos });
            }
            onMemoUpdate?.(newMemos, annotations, userNotes);
            setLastResponse({ query, text: response });
        } catch (e) {
            console.error('Memo failed:', e);
            setLastResponse({ query, text: `❌ 오류: ${e.message || '다시 시도해 주세요.'}` });
        } finally {
            setIsMemoLoading(false);
        }
    };

    // ── 내 메모(노트) 저장 ──
    const handleNoteSubmit = async () => {
        const text = noteInput.trim();
        if (!text) return;
        const noteEntry = { text, createdAt: new Date().toISOString() };
        const newNotes = [...(userNotes || []), noteEntry];
        setNoteInput('');
        setPendingNotes(prev => [...prev, noteEntry]);
        if (cardId) {
            await updateDoc(doc(db, "savedCards", cardId), { userNotes: newNotes });
        }
        onMemoUpdate?.(memos, annotations, newNotes);
    };

    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal) {
                playSuccessSound();
                if (isLibraryView) {
                    // Library: 카드 ID 기반으로 바로 카운트
                    onTargetAchieved?.(`library-${cardId}`);
                } else if (isSaved && savedCardId) {
                    // Translation 탭 — 이미 저장된 카드: docId 기반으로 바로 카운트
                    onTargetAchieved?.(`library-${savedCardId}`);
                } else if (!isSaved) {
                    // 비Library 미저장: 북마크 유도 팝업 → 저장 시 카운트
                    onBookmarkPrompt?.(score, () => { playStarSound(); onSave?.(); });
                }
            } else {
                playAlertSound();
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult, targetGoal]); // eslint-disable-line react-hooks/exhaustive-deps

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

                {/* Library 중요 마크 (card-header 중앙) */}
                {isLibraryView && onToggleStarred && (
                    <button
                        className="lib-flag-btn"
                        onClick={(e) => { e.stopPropagation(); onToggleStarred(); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', transition: 'transform 0.2s' }}
                    >
                        <Flag size={20} fill={starred ? '#f59e0b' : 'none'} color={starred ? '#f59e0b' : '#d1d5db'} />
                    </button>
                )}

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

            {/* Scene 태그 (emotion / interaction type) */}
            {(interactionType || selectedEmotion) && (
                <div className="scene-tag-row" style={{ padding: '0 14px', marginTop: -2 }}>
                    {interactionType && (
                        <span className="scene-action-tag">{t(`tags.action.${interactionType}`) || interactionType}</span>
                    )}
                    {selectedEmotion && (
                        <span className="scene-emotion-tag">{t(`tags.emotion.${selectedEmotion}`) || selectedEmotion}</span>
                    )}
                </div>
            )}

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
                        learningTip.map((tip, index) => {
                            const tipText = (tip && typeof tip === 'object') ? (tip.content || '') : String(tip || '');
                            return (
                                <p key={index} className={`tip-content font-${sourceLangCode}`}>
                                    • <AnnotatedText text={tipText} annotations={annotations} />
                                </p>
                            );
                        })
                    ) : (
                        <p className="tip-content">AI is analyzing the sentence...</p>
                    )}
                </div>

                {/* AI Q&A 메모 */}
                {displayMemos.length > 0 && (
                    <div className="card-memos">
                        <span className="memo-section-label">🤖 AI Q&amp;A</span>
                        {displayMemos.map((memo, i) => (
                            <div key={memo.createdAt || i} className="memo-item memo-item-ai">
                                <p className="memo-query">💬 {memo.query}</p>
                                <p className="memo-response">{memo.response}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* 사용자 직접 메모 */}
                {displayNotes.length > 0 && (
                    <div className="card-memos">
                        <span className="memo-section-label memo-section-label-note">✏️ 내 메모</span>
                        {displayNotes.map((note, i) => (
                            <div key={note.createdAt || i} className="memo-item memo-item-note">
                                <p className="memo-note-text">{note.text}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 메모 팝업 — Portal로 body에 렌더링 (transform 부모 탈출) */}
            {showMemoPopup && createPortal(
                <div className="memo-popup-overlay" onClick={closePopup}>
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
                            >🤖 AI Q&amp;A</button>
                            <button
                                className={`memo-tab-btn memo-tab-note ${memoTab === 'note' ? 'active' : ''}`}
                                onClick={() => { setMemoTab('note'); setTimeout(() => noteInputRef.current?.focus(), 50); }}
                            >✏️ 내 메모</button>
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

                        {/* 내 메모 탭 */}
                        {memoTab === 'note' && (
                            <div className="memo-tab-content">
                                <div className="memo-input-row memo-note-row">
                                    <textarea
                                        ref={noteInputRef}
                                        className="memo-note-textarea"
                                        value={noteInput}
                                        onChange={e => setNoteInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNoteSubmit(); } }}
                                        placeholder="기억하고 싶은 내용을 자유롭게 적어보세요. (Enter로 저장)"
                                        rows={3}
                                    />
                                    <button
                                        className="memo-submit-btn memo-note-submit-btn"
                                        onClick={handleNoteSubmit}
                                        disabled={!noteInput.trim()}
                                        title="저장"
                                    >+</button>
                                </div>
                                {displayNotes.length > 0 && (
                                    <div className="memo-note-list">
                                        {[...displayNotes].reverse().map((note, i) => (
                                            <div key={note.createdAt || i} className="memo-note-preview">
                                                <p>{note.text}</p>
                                                <span className="memo-note-date">{new Date(note.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default TranslationCard;
