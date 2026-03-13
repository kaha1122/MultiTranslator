import { useState, useEffect, useRef } from 'react';
import { Award, Mic, MicOff, Play, RotateCcw, Star, Volume2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAuth } from '../context/AuthContext';
import { useT, getT, tTag } from '../utils/i18n';
import PronunciationAssessment from './PronunciationAssessment';
import { playStarSound } from '../utils/soundEffects';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import './ScenePractice.css';

// Firebase sceneHistory 문서 ID 생성 (특수문자 없는 복합키)
const makeHistoryKey = (sceneId, difficulty, style, lang) =>
    `${sceneId}--${difficulty}--${style}--${lang}`;

// Custom 씬 키: 입력 텍스트를 포함해 씬별로 이력 분리 (최대 30자, 공백→_)
const makeCustomSceneId = (text) =>
    `custom-${text.trim().slice(0, 30).replace(/\s+/g, '_')}`;

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const SCENES = {
    locations: [
        { id: 'airport',    icon: '✈️' },
        { id: 'hotel',      icon: '🏨' },
        { id: 'restaurant', icon: '🍽️' },
        { id: 'transport',  icon: '🚌' },
        { id: 'shopping',   icon: '🛍️' },
        { id: 'hospital',   icon: '🏥' },
        { id: 'tourist',    icon: '🗺️' },
        { id: 'office',     icon: '💼' },
        { id: 'bank',       icon: '🏦' },
        { id: 'gym',        icon: '💪' },
        { id: 'custom',     icon: '✏️' },
    ],
    situations: [
        { id: 'smalltalk',  icon: '💬' },
        { id: 'lost',       icon: '🆘' },
        { id: 'reservation',icon: '📅' },
        { id: 'disagree',   icon: '🤝' },
        { id: 'problem',    icon: '🔧' },
        { id: 'directions', icon: '🧭' },
        { id: 'intro',      icon: '🎤' },
        { id: 'compliment', icon: '🙏' },
        { id: 'decline',    icon: '🚫' },
        { id: 'advice',     icon: '💡' },
        { id: 'custom',     icon: '✏️' },
    ],
};

const LANG_NAMES = {
    ko: '한국어', en: 'English', ja: '日本語', 'zh-CN': '中文',
    vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español',
};

// ── 생성된 카드 + 발음 연습 ─────────────────────────────────────────────────
function ScenePracticeCard({ generated, langCode, sourceLang, onTrialLimitReached, onSave, isSaved, onSpeak, t, targetGoal = 80, onBookmarkPrompt }) {
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(generated.sentence, langCode, sourceLang, onTrialLimitReached);

    const playMyRecording = () => {
        if (assessmentResult?.audioUrl) {
            new Audio(assessmentResult.audioUrl).play();
        }
    };

    // 발음 점수가 목표에 도달하면 북마크 유도 팝업 표시 (저장 시 카운트)
    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal && !isSaved) {
                onBookmarkPrompt?.(score, () => onSave(score));
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="library-card-wrapper">
            <div className="scene-card">
                {/* 카드 헤더: 씬 힌트(좌) + TTS 재생버튼(우) */}
                <div className="scene-card-header">
                    <div className="scene-card-hint">
                        {(generated.interaction_type || generated.selected_emotion) && (
                            <div className="scene-tag-row">
                                {generated.interaction_type && (
                                    <span className="scene-action-tag">{tTag(t, 'tags.action', generated.interaction_type)}</span>
                                )}
                                {generated.selected_emotion && (
                                    <span className="scene-emotion-tag">{tTag(t, 'tags.emotion', generated.selected_emotion)}</span>
                                )}
                            </div>
                        )}
                        <div className="scene-card-hint-body">
                            <span className="scene-card-hint-icon">🎬</span>
                            <p>{generated.scene_hint}</p>
                        </div>
                    </div>
                    <button
                        className="speak-button"
                        onClick={() => onSpeak(generated.sentence, langCode)}
                        title="Listen"
                    >
                        <Play size={22} fill="white" stroke="white" />
                    </button>
                </div>

                {/* 생성 문장 */}
                <div className="scene-card-sentence">{generated.sentence}</div>

                {/* 발음 표기 (중국어 병음 / 일본어 히라가나) — 평가 전에만 표시 */}
                {generated.pronunciation && !assessmentResult && (
                    <p className="scene-card-pronunciation">{generated.pronunciation}</p>
                )}

                {/* 번역 */}
                <div className="scene-card-translation">{generated.translation}</div>

                {/* 학습 팁 */}
                {generated.learning_tip && (
                    <div className="scene-card-tip">
                        <span>💡</span>
                        <p>{generated.learning_tip}</p>
                    </div>
                )}

                {/* 발음 평가 결과 */}
                {assessmentResult && (
                    <>
                        <div className="score-badge">
                            <Award size={12} /> {assessmentResult.pronunciationScore}Pt
                        </div>
                        <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />
                    </>
                )}

                {/* AI 코치 팁 */}
                {coachTip && (
                    <div className="scene-coach-tip">
                        <span>🤖</span>
                        <p>{coachTip}</p>
                    </div>
                )}

                {/* 에러 메시지 */}
                {errorMsg && <p className="scene-error-msg">{errorMsg}</p>}

                {/* 발음 연습 녹음 버튼 (중앙 배치) */}
                <div className="scene-record-wrap">
                    {isRecording && <p className="scene-recording-status">{t('card.recording')}</p>}
                    {isAnalyzing && <p className="scene-analyzing-status">{t('card.analyzing')}</p>}
                    <button
                        className={`record-button circle ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
                        onClick={() => isRecording ? stopRecording() : startRecording()}
                        disabled={isAnalyzing}
                        title="Practice pronunciation"
                    >
                        {isAnalyzing
                            ? <RotateCcw size={20} className="spin" />
                            : isRecording
                                ? <MicOff size={20} />
                                : <Mic size={20} />
                        }
                    </button>
                </div>
            </div>

            {/* 하단 액션바 — Library와 동일한 구조 */}
            <div className="card-action-bar">
                <div className="action-left" style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="stat-text" title="목표 점수">🎯 <strong>{targetGoal}</strong></span>
                    <span className="stat-divider">·</span>
                    <span className="stat-text" title="내 점수">⭐️ <strong>{assessmentResult?.pronunciationScore ?? '-'}</strong></span>
                    <span className="stat-divider">·</span>
                    <span className="stat-text" title="달성 여부">
                        {assessmentResult?.pronunciationScore != null && assessmentResult.pronunciationScore >= targetGoal ? '✅' : '❌'}
                    </span>
                    <span className="stat-divider">·</span>
                    <button
                        className="stat-icon-btn"
                        title={assessmentResult?.audioUrl ? '내 발음 다시 듣기' : '녹음 후 활성화됩니다'}
                        onClick={playMyRecording}
                        disabled={!assessmentResult?.audioUrl}
                        style={{ background: 'none', border: 'none', outline: 'none', cursor: assessmentResult?.audioUrl ? 'pointer' : 'default', padding: 0, display: 'flex', alignItems: 'center', opacity: assessmentResult?.audioUrl ? 1 : 0.3, color: 'var(--text-secondary)' }}
                    >
                        <Volume2 size={16} />
                    </button>
                </div>
                <div className="action-right">
                    <button
                        className={`scene-star-btn ${isSaved ? 'saved' : ''}`}
                        onClick={() => onSave(assessmentResult?.pronunciationScore ?? null)}
                        disabled={isSaved}
                        title={isSaved ? t('scene.savedToLibrary') : t('scene.saveToLibrary')}
                    >
                        <Star size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── 메인 ScenePractice 컴포넌트 ───────────────────────────────────────────
const ScenePractice = ({ sourceLang, targetLangs, onTrialLimitReached, onSaveToLibrary, onSpeak, languageGoals = {}, onBookmarkPrompt, onGenerate, onNavigateToLibrary }) => {
    const [category, setCategory]           = useState('locations');
    const [selectedScene, setSelectedScene] = useState(null);
    const [customInput, setCustomInput]     = useState('');
    const [selectedLang, setSelectedLang]   = useState(targetLangs?.[0] || 'en');
    const [difficulty, setDifficulty]       = useState('basic');
    const [speechStyle, setSpeechStyle]     = useState('formal');
    const [generated, setGenerated]         = useState(null);
    const [generatedAnswer, setGeneratedAnswer] = useState(null);
    const [loading, setLoading]             = useState(false);
    const [loadingAnswer, setLoadingAnswer] = useState(false);
    const [error, setError]                 = useState(null);
    const [isSaved, setIsSaved]             = useState(false);
    const [isAnswerSaved, setIsAnswerSaved] = useState(false);

    const t = useT(sourceLang);
    const { byokGeminiKey, user } = useAuth();
    const SERVER_URL = getServerUrl();
    const questionCardRef = useRef(null);
    const answerCardRef = useRef(null);

    // 카드 생성 후 DOM이 확실히 렌더된 시점에 중앙 스크롤
    const [scrollTarget, setScrollTarget] = useState(null);
    useEffect(() => {
        if (!scrollTarget) return;
        const ref = scrollTarget === 'question' ? questionCardRef : answerCardRef;
        // requestAnimationFrame으로 브라우저 페인트 직후 실행
        const raf = requestAnimationFrame(() => {
            ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        setScrollTarget(null);
        return () => cancelAnimationFrame(raf);
    }, [scrollTarget]);

    // 세션 + Firebase 중복 방지 이력 캐시 — ref로 관리 (렌더 트리거 없음, 동기 읽기 보장)
    const historyCacheRef = useRef({});

    // Firebase에서 해당 키의 이력 읽어 ref에 저장 (생성 직전 호출)
    const loadHistory = async (key) => {
        if (!user) return [];
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key]; // 캐시 히트
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/sceneHistory`, key));
            const sentences = snap.exists() ? (snap.data().sentences || []) : [];
            historyCacheRef.current = { ...historyCacheRef.current, [key]: sentences };
            return sentences;
        } catch {
            return [];
        }
    };

    // 생성 성공 후 이력에 추가 (무제한 — 중복 생성 완전 방지) — state updater 밖에서 setDoc 호출
    const appendHistory = (key, sentence) => {
        const existing = historyCacheRef.current[key] || [];
        const updated = [...existing, sentence];
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/sceneHistory`, key), {
                sentences: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    const switchCategory = (cat) => {
        setCategory(cat);
        setSelectedScene(null);
        setCustomInput('');
        setGenerated(null);
        setGeneratedAnswer(null);
        setError(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
    };

    const selectScene = (scene) => {
        setSelectedScene(scene);
        setGenerated(null);
        setGeneratedAnswer(null);
        setError(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
    };

    const isCustomSelected = selectedScene?.id === 'custom';
    const canRequest = selectedScene && (!isCustomSelected || customInput.trim().length > 0);

    const handleRequest = async () => {
        if (!canRequest) return;
        setLoading(true);
        setError(null);
        setGenerated(null);
        setGeneratedAnswer(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
        try {
            // Custom 씬은 입력 텍스트를 키에 포함 → 씬별 이력 분리
            const sceneId = isCustomSelected ? makeCustomSceneId(customInput) : selectedScene.id;
            const sceneText = isCustomSelected ? customInput.trim() : getT('en', `scene${category === 'locations' ? 'Loc' : 'Sit'}.${selectedScene.id}`);
            const historyKey = makeHistoryKey(sceneId, difficulty, speechStyle, selectedLang);
            const avoidSentences = await loadHistory(historyKey);
            // Gemini에는 최근 200개만 전송 (토큰/속도 최적화, Firestore에는 전체 보관)
            const avoidForApi = avoidSentences.slice(-200);

            const fetchSentence = () => fetch(`${SERVER_URL}/api/scene-sentence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: sceneText,
                    category,
                    targetLang: selectedLang,
                    sourceLang,
                    difficulty,
                    speechStyle,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidSentences: avoidForApi.length > 0 ? avoidForApi : undefined,
                }),
            });

            let res = await fetchSentence();
            if (!res.ok) throw new Error('Server error');
            let data = await res.json();

            // LLM이 avoid 지시를 무시하고 중복 생성한 경우 1회 재시도
            if (data.sentence && avoidSentences.includes(data.sentence)) {
                const res2 = await fetchSentence();
                if (res2.ok) data = await res2.json();
            }

            setGenerated(data);
            if (data.sentence) appendHistory(historyKey, data.sentence);
            if (onGenerate) onGenerate();
            setScrollTarget('question');
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoading(false);
        }
    };

    const handleAnswerRequest = async () => {
        if (!generated) return;
        setLoadingAnswer(true);
        setError(null);
        setGeneratedAnswer(null);
        setIsAnswerSaved(false);
        try {
            const sceneId = isCustomSelected ? makeCustomSceneId(customInput) : selectedScene.id;
            const sceneText = isCustomSelected ? customInput.trim() : getT('en', `scene${category === 'locations' ? 'Loc' : 'Sit'}.${selectedScene.id}`);
            // 답변은 별도 키 (scene--difficulty--style--lang--answer)
            const historyKey = makeHistoryKey(`${sceneId}-answer`, difficulty, speechStyle, selectedLang);
            const avoidSentences = await loadHistory(historyKey);
            const avoidForApi = avoidSentences.slice(-200);

            const fetchAnswer = () => fetch(`${SERVER_URL}/api/scene-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: generated.sentence,
                    scene: sceneText,
                    targetLang: selectedLang,
                    sourceLang,
                    difficulty,
                    speechStyle,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidSentences: avoidForApi.length > 0 ? avoidForApi : undefined,
                }),
            });

            let res = await fetchAnswer();
            if (!res.ok) throw new Error('Server error');
            let data = await res.json();

            // LLM이 avoid 지시를 무시하고 중복 생성한 경우 1회 재시도
            if (data.sentence && avoidSentences.includes(data.sentence)) {
                const res2 = await fetchAnswer();
                if (res2.ok) data = await res2.json();
            }

            setGeneratedAnswer(data);
            if (data.sentence) appendHistory(historyKey, data.sentence);
            if (onGenerate) onGenerate();
            setScrollTarget('answer');
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoadingAnswer(false);
        }
    };

    const handleSave = async (pronunciationScore = null) => {
        if (!generated || !selectedScene || isSaved) return;
        const cardId = await onSaveToLibrary({
            sentence:          generated.sentence,
            translation:       generated.translation,
            langCode:          selectedLang,
            scene:             selectedScene.id,
            category,
            sceneHint:         generated.scene_hint,
            learningTip:       generated.learning_tip,
            pronunciationScore,
            difficulty,
            selectedEmotion:   generated.selected_emotion || '',
            interactionType:   generated.interaction_type || '',
        });
        if (!cardId) return; // 중복 → 이미 저장됨
        playStarSound();
        setIsSaved(true);
        if (onNavigateToLibrary) onNavigateToLibrary(cardId);
    };

    const handleAnswerSave = async (pronunciationScore = null) => {
        if (!generatedAnswer || !selectedScene || isAnswerSaved) return;
        const cardId = await onSaveToLibrary({
            sentence:          generatedAnswer.sentence,
            translation:       generatedAnswer.translation,
            langCode:          selectedLang,
            scene:             selectedScene.id,
            category,
            sceneHint:         generatedAnswer.scene_hint,
            learningTip:       generatedAnswer.learning_tip,
            pronunciationScore,
            difficulty,
            selectedEmotion:   generatedAnswer.selected_emotion || '',
            interactionType:   generatedAnswer.interaction_type || '',
        });
        if (!cardId) return; // 중복 → 이미 저장됨
        playStarSound();
        setIsAnswerSaved(true);
        if (onNavigateToLibrary) onNavigateToLibrary(cardId);
    };

    const currentScenes = SCENES[category];
    const sceneI18nPrefix = category === 'locations' ? 'sceneLoc' : 'sceneSit';

    return (
        <div className="scene-root">
            {/* 카테고리 토글 */}
            <div className="scene-category-toggle">
                <button
                    className={category === 'locations' ? 'active' : ''}
                    onClick={() => switchCategory('locations')}
                >
                    📍 {t('scene.locations')}
                </button>
                <button
                    className={category === 'situations' ? 'active' : ''}
                    onClick={() => switchCategory('situations')}
                >
                    🎭 {t('scene.situations')}
                </button>
            </div>

            {/* 씬 그리드 */}
            <div className="scene-grid">
                {currentScenes.map(scene => (
                    <button
                        key={scene.id}
                        className={`scene-item ${selectedScene?.id === scene.id ? 'selected' : ''} ${scene.id === 'custom' ? 'scene-item-custom' : ''}`}
                        onClick={() => selectScene(scene)}
                    >
                        <span className="scene-icon">{scene.icon}</span>
                        <span className="scene-name">{t(`${sceneI18nPrefix}.${scene.id}`)}</span>
                    </button>
                ))}
            </div>

            {/* 난이도 + 말투 선택 */}
            <div className="scene-options">
                <div className="scene-option-row">
                    <span className="scene-option-label">{t('scene.diffTitle')}</span>
                    <div className="scene-option-pills">
                        {['basic', 'intermediate', 'high'].map(d => (
                            <button
                                key={d}
                                className={`scene-option-pill ${difficulty === d ? 'active' : ''}`}
                                onClick={() => setDifficulty(d)}
                            >
                                {t(`scene.diff${d.charAt(0).toUpperCase() + d.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="scene-option-row">
                    <span className="scene-option-label">{t('scene.styleTitle')}</span>
                    <div className="scene-option-pills">
                        {['casual', 'formal'].map(s => (
                            <button
                                key={s}
                                className={`scene-option-pill ${speechStyle === s ? 'active' : ''}`}
                                onClick={() => setSpeechStyle(s)}
                            >
                                {t(`scene.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 언어 선택 + Request 버튼 — 탭 진입 시 항상 표시 */}
            <div className="scene-controls">
                {/* 직접입력 선택 시 텍스트 입력 */}
                {isCustomSelected && (
                    <input
                        className="scene-custom-input"
                        type="text"
                        placeholder={t('scene.customPlaceholder')}
                        value={customInput}
                        onChange={e => setCustomInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && canRequest && !loading) handleRequest(); }}
                        autoFocus
                    />
                )}

                {!selectedScene && (
                    <p className="scene-prompt-inline">{t('scene.selectScene')}</p>
                )}

                <div className="scene-lang-pills">
                    {(targetLangs || []).map(code => (
                        <button
                            key={code}
                            className={`scene-lang-pill ${selectedLang === code ? 'active' : ''}`}
                            onClick={() => {
                                setSelectedLang(code);
                                setGenerated(null);
                                setIsSaved(false);
                            }}
                        >
                            {LANG_NAMES[code] || code}
                        </button>
                    ))}
                </div>
                <div className="scene-request-btns">
                    <button
                        className="scene-request-btn"
                        onClick={handleRequest}
                        disabled={loading || loadingAnswer || !canRequest}
                    >
                        {loading
                            ? <RotateCcw size={18} className="spin" />
                            : t('scene.questionBtn')
                        }
                    </button>
                    <button
                        className="scene-answer-btn"
                        onClick={handleAnswerRequest}
                        disabled={loadingAnswer || loading || !generated || !!generatedAnswer}
                    >
                        {loadingAnswer
                            ? <RotateCcw size={18} className="spin" />
                            : t('scene.answerBtn')
                        }
                    </button>
                </div>
            </div>

            {/* 에러 */}
            {error && <p className="scene-error">{error}</p>}

            {/* 질문 카드 */}
            {generated && (
                <div ref={questionCardRef}>
                <ScenePracticeCard
                    generated={generated}
                    langCode={selectedLang}
                    sourceLang={sourceLang}
                    onTrialLimitReached={onTrialLimitReached}
                    onSave={handleSave}
                    isSaved={isSaved}
                    onSpeak={onSpeak}
                    t={t}
                    targetGoal={languageGoals[selectedLang] || 80}
                    onBookmarkPrompt={onBookmarkPrompt}
                />
                </div>
            )}

            {/* 답변 카드 */}
            {generatedAnswer && (
                <div ref={answerCardRef}>
                <ScenePracticeCard
                    generated={generatedAnswer}
                    langCode={selectedLang}
                    sourceLang={sourceLang}
                    onTrialLimitReached={onTrialLimitReached}
                    onSave={handleAnswerSave}
                    isSaved={isAnswerSaved}
                    onSpeak={onSpeak}
                    t={t}
                    targetGoal={languageGoals[selectedLang] || 80}
                    onBookmarkPrompt={onBookmarkPrompt}
                />
                </div>
            )}
        </div>
    );
};

export default ScenePractice;
