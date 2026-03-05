import { useState, useRef, useEffect } from 'react';
import { Play, Mic, MicOff, RotateCcw, Award, CheckCircle, AlertCircle, Star, PenLine } from 'lucide-react';
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
}) => {
    const t = useT(sourceLangCode);
    const { byokGeminiKey } = useAuth();

    // ── 메모 팝업 상태 ──
    const [showMemoPopup, setShowMemoPopup] = useState(false);
    const [memoInput, setMemoInput] = useState('');
    const [isMemoLoading, setIsMemoLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
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

    // ── 메모 팝업 열릴 때 input 포커스 ──
    useEffect(() => {
        if (showMemoPopup) setTimeout(() => memoInputRef.current?.focus(), 80);
    }, [showMemoPopup]);

    // ── 음성 받아쓰기 (Web Speech API) ──
    const startListening = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { alert('이 브라우저는 음성 인식을 지원하지 않습니다.'); return; }
        const rec = new SR();
        const langMap = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', 'zh-CN': 'zh-CN', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
        rec.lang = langMap[sourceLangCode] || 'ko-KR';
        rec.interimResults = false;
        setIsListening(true);
        rec.start();
        rec.onresult = (e) => { setMemoInput(e.results[0][0].transcript); setIsListening(false); };
        rec.onerror = () => setIsListening(false);
        rec.onend = () => setIsListening(false);
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
                }
            } else {
                const response = await callGeminiMemo(query);
                const newMemos = [...(memos || []), { query, response, createdAt: new Date().toISOString() }];
                await onMemoUpdate?.(newMemos, annotations);
            }
        } catch (e) {
            console.error('Memo failed:', e);
        } finally {
            setIsMemoLoading(false);
            setShowMemoPopup(false);
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
                    {onMemoUpdate && (
                        <button
                            className={`memo-open-btn ${memos?.length || annotations?.length ? 'has-content' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setShowMemoPopup(true); }}
                            title="메모 / 어노테이션"
                        >
                            <PenLine size={17} />
                        </button>
                    )}
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
                <div className="memo-popup-overlay" onClick={() => setShowMemoPopup(false)}>
                    <div className="memo-popup" onClick={e => e.stopPropagation()}>
                        <div className="memo-popup-header">
                            <span>✏️ 메모 · 어노테이션</span>
                            <button className="memo-popup-close" onClick={() => setShowMemoPopup(false)}>✕</button>
                        </div>
                        <p className="memo-popup-hint">
                            질문하거나 단어에 표시하세요.<br />
                            <em>예) "run이 무슨 뜻이야?" · "Baseball에 밑줄 쳐줘"</em>
                        </p>
                        <div className="memo-input-row">
                            <input
                                ref={memoInputRef}
                                type="text"
                                className="memo-input"
                                value={memoInput}
                                onChange={e => setMemoInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleMemoSubmit()}
                                placeholder="질문 또는 어노테이션 명령..."
                                disabled={isMemoLoading}
                            />
                            <button className="memo-voice-btn" onClick={startListening} disabled={isListening || isMemoLoading} title="음성 입력">
                                {isListening ? <RotateCcw size={16} className="spin" /> : <Mic size={16} />}
                            </button>
                            <button className="memo-submit-btn" onClick={handleMemoSubmit} disabled={!memoInput.trim() || isMemoLoading} title="전송">
                                {isMemoLoading ? <RotateCcw size={16} className="spin" /> : '→'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TranslationCard;
