import { useState, useEffect, useRef } from 'react';
import { Award, Mic, MicOff, Play, RotateCcw, Star, Volume2, Pencil } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAuth } from '../context/AuthContext';
import { useT, getT, tTag } from '../utils/i18n';
import { getLangName } from '../config/languages';
import PronunciationAssessment from './PronunciationAssessment';
import { playStarSound } from '../utils/soundEffects';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { authFetch } from '../utils/authFetch';
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
    } catch (e) { }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const SCENES = {
    // 직접입력은 그리드에서 제외(항상 노출되는 customInput으로 대체) → 12개로 4×3 그리드 유지
    locations: [
        { id: 'airport', icon: '✈️' },
        { id: 'hotel', icon: '🏨' },
        { id: 'restaurant', icon: '🍽️' },
        { id: 'transport', icon: '🚌' },
        { id: 'shopping', icon: '🛍️' },
        { id: 'hospital', icon: '🏥' },
        { id: 'tourist', icon: '🗺️' },
        { id: 'office', icon: '💼' },
        { id: 'bank', icon: '🏦' },
        { id: 'gym', icon: '💪' },
        { id: 'home', icon: '🏠' },
        { id: 'cinema', icon: '🎬' },
    ],
    situations: [
        { id: 'smalltalk', icon: '💬' },
        { id: 'lost', icon: '🆘' },
        { id: 'reservation', icon: '📅' },
        { id: 'disagree', icon: '🤝' },
        { id: 'problem', icon: '🔧' },
        { id: 'directions', icon: '🧭' },
        { id: 'intro', icon: '🎤' },
        { id: 'compliment', icon: '🙏' },
        { id: 'decline', icon: '🚫' },
        { id: 'advice', icon: '💡' },
        { id: 'debate', icon: '🗣️' },
        { id: 'phonecall', icon: '📞' },
    ],
};


// ── 생성된 카드 + 발음 연습 ─────────────────────────────────────────────────
// Free Talking 모드의 카드 팝업(MessageCardModal)에서도 동일 컴포넌트 재사용 — named export.
export function ScenePracticeCard({ generated, langCode, sourceLang, onTrialLimitReached, onPronSuccess, onSave, isSaved, onSpeak, t, targetGoal = 60, onBookmarkPrompt }) {
    // 일본어(ja)는 한자 원문 대신 히라가나(pronunciation)를 Azure 발음평가 기준으로 사용.
    // 한자는 Azure가 음소 분석을 대부분 포기해 phoneme 배열이 빈 값이 됨.
    // 중국어(zh-CN)는 pronunciation에 pinyin이 오지만 Azure는 한자 기반 평가가 더 정확 → 원문 유지.
    const referenceText = ((langCode === 'ja' && generated.pronunciation)
        ? generated.pronunciation
        : generated.sentence) || ''; // generated.sentence 누락 시 undefined→"undefined" 전달 차단(2026-06-21)
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg, micDenied, openAppSettings,
    } = useAudioRecorder(referenceText, langCode, sourceLang, onTrialLimitReached, onPronSuccess);

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
                        {generated.scene_hint && (
                            <div className="scene-card-hint-body">
                                <span className="scene-card-hint-icon">🎬</span>
                                <p>{generated.scene_hint}</p>
                            </div>
                        )}
                    </div>
                    <button
                        className="speak-button"
                        onClick={() => onSpeak(generated.sentence, langCode, generated.selected_emotion)}
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
                        <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} langCode={langCode} onSpeak={onSpeak} />
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
                {errorMsg && (
                    <div className="scene-error-msg" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <p style={{ margin: 0 }}>{errorMsg}</p>
                        {micDenied && window.Capacitor?.isNativePlatform?.() && (
                            <button onClick={openAppSettings} style={{ background: 'none', border: '1px solid #6366f1', color: '#6366f1', borderRadius: '8px', padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                                {t('errors.openSettings')}
                            </button>
                        )}
                    </div>
                )}

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
const ScenePractice = ({ sourceLang, targetLangs, userLevel, languageLevels = {}, onTrialLimitReached, onPronSuccess, onSaveToLibrary, onSpeak, languageGoals = {}, onBookmarkPrompt, onGenerate, onCheckPoints, onNavigateToLibrary, onTargetAchieved, onFreeTalkStart }) => {
    // 랜덤 초기 장소 선택 (custom 제외)
    const pickRandomScene = (cat = 'locations') => {
        const list = SCENES[cat].filter(s => s.id !== 'custom');
        return list[Math.floor(Math.random() * list.length)];
    };

    const [category, setCategory] = useState('locations');
    const [selectedScene, setSelectedScene] = useState(() => pickRandomScene('locations'));
    const [customInput, setCustomInput] = useState('');
    const [selectedLang, setSelectedLang] = useState(targetLangs?.[0] || 'en');
    // Scene 탭은 display:none으로 상시 마운트되어 초깃값이 stale해짐 → 온보딩 후 targetLangs 변경 시 동기화.
    // 기본 학습 언어(targetLangs[0])가 바뀌면 selectedLang도 새 default로 따라감
    // (단순 includes 체크만 하면 stale 초깃값이 신규 배열에 우연히 포함된 경우 사용자가 의도한 default를 무시하게 됨)
    const prevDefaultLangRef = useRef(targetLangs?.[0]);
    useEffect(() => {
        if (!Array.isArray(targetLangs) || targetLangs.length === 0) return;
        const newDefault = targetLangs[0];
        const defaultChanged = prevDefaultLangRef.current !== newDefault;
        if (defaultChanged) prevDefaultLangRef.current = newDefault;
        if (defaultChanged || !targetLangs.includes(selectedLang)) {
            setSelectedLang(newDefault);
            setGenerated(null);
            setIsSaved(false);
        }
    }, [targetLangs, selectedLang]);
    // 2026-06-06: 언어별 난이도(languageLevels) 도입 — Scene/FreeTalk 도 "선택 언어"의 설정
    //   난이도를 따름. 언어 전환/해당 언어 설정 변경 시 자동 반영, 같은 언어 내 화면에서 수동
    //   변경한 값은 deps 미변경으로 보존(setDifficulty는 difficulty만 바꿈).
    //   (구 2026-05-23 'basic 고정' 규칙 대체 — 사용자가 설정에서 언어별 default 를 직접 정함)
    const [difficulty, setDifficulty] = useState(() => languageLevels[selectedLang] || userLevel || 'basic');
    useEffect(() => {
        setDifficulty(languageLevels[selectedLang] || userLevel || 'basic');
    }, [selectedLang, languageLevels[selectedLang], userLevel]); // eslint-disable-line react-hooks/exhaustive-deps
    const [speechStyle, setSpeechStyle] = useState('formal');
    const [generated, setGenerated] = useState(null);
    const [generatedAnswer, setGeneratedAnswer] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingAnswer, setLoadingAnswer] = useState(false);
    const [error, setError] = useState(null);
    const [isSaved, setIsSaved] = useState(false);
    const [isAnswerSaved, setIsAnswerSaved] = useState(false);

    const t = useT(sourceLang);
    const { byokGeminiKey, user } = useAuth();
    const SERVER_URL = getServerUrl();
    const questionCardRef = useRef(null);
    const answerCardRef = useRef(null);

    // 카드 생성 후 해당 카드로 스크롤.
    // VocabTab / NotificationSettings 에서 검증된 패턴을 이식:
    //   - scrollIntoView는 중첩 스크롤 컨테이너(.app-container) + Android WebView에서 불안정 →
    //     .app-container 를 직접 찾아 scrollTop 계산
    //   - 조건부 렌더 + React commit 직후 race 방지를 위해 RAF + setTimeout(150) + height=0 재시도
    //   - sticky .app-header 높이 차감으로 타이틀이 헤더 뒤에 가려지지 않도록
    const scrolledQRef = useRef(null);
    const scrolledARef = useRef(null);
    const scrollToCard = (targetRef) => {
        const tryScroll = (attempt = 0) => {
            const el = targetRef.current;
            if (!el) {
                if (attempt < 5) setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            const container = el.closest('.app-container');
            if (!container) { el.scrollIntoView({ block: 'start' }); return; }
            const r = el.getBoundingClientRect();
            const cr = container.getBoundingClientRect();
            if (r.height === 0 && attempt < 5) {
                setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            const headerH = document.querySelector('.app-header')?.getBoundingClientRect().height ?? 0;
            const newTop = container.scrollTop + (r.top - cr.top) - headerH - 12;
            container.scrollTo({ top: Math.max(0, newTop), behavior: 'smooth' });
        };
        requestAnimationFrame(() => setTimeout(() => tryScroll(0), 150));
    };

    useEffect(() => {
        if (!generated) return;
        const token = generated.sentence;
        if (scrolledQRef.current === token) return;
        scrolledQRef.current = token;
        scrollToCard(questionCardRef);
    }, [generated]);

    useEffect(() => {
        if (!generatedAnswer) return;
        const token = generatedAnswer.sentence;
        if (scrolledARef.current === token) return;
        scrolledARef.current = token;
        scrollToCard(answerCardRef);
    }, [generatedAnswer]);

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
        setCustomInput(''); // 씬 선택 시 직접입력 텍스트 클리어 (둘 중 하나만 활성)
        setGenerated(null);
        setGeneratedAnswer(null);
        setError(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
    };

    // 직접입력란이 항상 노출됨: 텍스트가 있으면 custom 모드가 우선(선택된 씬보다)
    const isCustomActive = customInput.trim().length > 0;
    const canRequest = isCustomActive || !!selectedScene;

    const handleRequest = async () => {
        if (!canRequest) return;
        if (onCheckPoints && !onCheckPoints()) return; // 2026-06-16: 잔액<1 차단 + 포인트부족 모달
        setLoading(true);
        setError(null);
        setGenerated(null);
        setGeneratedAnswer(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
        try {
            // Custom 씬은 입력 텍스트를 키에 포함 → 씬별 이력 분리
            const sceneId = isCustomActive ? makeCustomSceneId(customInput) : selectedScene.id;
            const sceneText = isCustomActive ? customInput.trim() : getT('en', `scene${category === 'locations' ? 'Loc' : 'Sit'}.${selectedScene.id}`);
            const historyKey = makeHistoryKey(sceneId, difficulty, speechStyle, selectedLang);
            const avoidSentences = await loadHistory(historyKey);
            // Gemini에는 최근 200개만 전송 (토큰/속도 최적화, Firestore에는 전체 보관)
            const avoidForApi = avoidSentences.slice(-200);

            const fetchSentence = () => authFetch(`${SERVER_URL}/api/scene-sentence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: sceneText,
                    category,
                    isCustom: isCustomActive,
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
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoading(false);
        }
    };

    const handleAnswerRequest = async () => {
        if (!generated) return;
        if (onCheckPoints && !onCheckPoints()) return; // 2026-06-16: 잔액<1 차단 + 포인트부족 모달
        setLoadingAnswer(true);
        setError(null);
        setGeneratedAnswer(null);
        setIsAnswerSaved(false);
        try {
            const sceneId = isCustomActive ? makeCustomSceneId(customInput) : selectedScene.id;
            const sceneText = isCustomActive ? customInput.trim() : getT('en', `scene${category === 'locations' ? 'Loc' : 'Sit'}.${selectedScene.id}`);
            // 답변은 별도 키 (scene--difficulty--style--lang--answer)
            const historyKey = makeHistoryKey(`${sceneId}-answer`, difficulty, speechStyle, selectedLang);
            const avoidSentences = await loadHistory(historyKey);
            const avoidForApi = avoidSentences.slice(-200);

            const fetchAnswer = () => authFetch(`${SERVER_URL}/api/scene-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: generated.sentence,
                    scene: sceneText,
                    isCustom: isCustomActive,
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
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoadingAnswer(false);
        }
    };

    const handleSave = async (pronunciationScore = null) => {
        if (!generated || !selectedScene || isSaved) return;
        const cardId = await onSaveToLibrary({
            sentence: generated.sentence,
            translation: generated.translation,
            langCode: selectedLang,
            scene: selectedScene.id,
            category,
            sceneHint: generated.scene_hint,
            learningTip: generated.learning_tip,
            pronunciationScore,
            difficulty,
            selectedEmotion: generated.selected_emotion || '',
            interactionType: generated.interaction_type || '',
        });
        if (!cardId) return; // 중복 → 이미 저장됨
        playStarSound();
        setIsSaved(true);
        if (onNavigateToLibrary) onNavigateToLibrary(cardId);
    };

    const handleAnswerSave = async (pronunciationScore = null) => {
        if (!generatedAnswer || !selectedScene || isAnswerSaved) return;
        const cardId = await onSaveToLibrary({
            sentence: generatedAnswer.sentence,
            translation: generatedAnswer.translation,
            langCode: selectedLang,
            scene: selectedScene.id,
            category,
            sceneHint: generatedAnswer.scene_hint,
            learningTip: generatedAnswer.learning_tip,
            pronunciationScore,
            difficulty,
            selectedEmotion: generatedAnswer.selected_emotion || '',
            interactionType: generatedAnswer.interaction_type || '',
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
                        {['basic', 'intermediate', 'advanced'].map(d => (
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
                {/* 직접입력 — Listening/Vocab 탭과 동일 UI, 항상 노출(버튼 없이 바로 보임) */}
                <div className="scene-custom-block">
                    <div className="scene-custom-label" role="presentation">
                        <span className="scene-custom-label__icon" aria-hidden="true">
                            <Pencil size={11} strokeWidth={2.25} />
                        </span>
                        <span className="scene-custom-label__text">{t('scene.customLabelTop')}</span>
                    </div>
                    <textarea
                        className="scene-custom-input"
                        rows={2}
                        placeholder={t('scene.customPlaceholderFreetalk')}
                        value={customInput}
                        onChange={evt => {
                            const v = evt.target.value;
                            setCustomInput(v);
                            if (v.trim()) setSelectedScene(null); // 직접입력 시 씬 선택 해제 (둘 중 하나만 활성)
                        }}
                    />
                </div>

                {!selectedScene && !isCustomActive && (
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
                            {getT(sourceLang, `langNames.${code}`) || getLangName(code)}
                        </button>
                    ))}
                </div>
                {/* Free Talking 메인 CTA — Sprint 1 신규 */}
                <div className="scene-freetalk-row">
                    <button
                        className={`scene-freetalk-btn ${
                            typeof window !== 'undefined' && !localStorage.getItem('pronunfit_freetalk_seen')
                                ? 'has-new-badge' : ''
                        }`}
                        onClick={() => {
                            if (!canRequest) return;
                            try { localStorage.setItem('pronunfit_freetalk_seen', '1'); } catch (e) { /* noop */ }
                            const sceneId = isCustomActive ? makeCustomSceneId(customInput) : selectedScene.id;
                            const sceneText = isCustomActive
                                ? customInput.trim()
                                : getT('en', `scene${category === 'locations' ? 'Loc' : 'Sit'}.${selectedScene.id}`);
                            const sceneI18nLabel = isCustomActive
                                ? customInput.trim()
                                : t(`${sceneI18nPrefix}.${selectedScene.id}`);
                            const sceneIcon = isCustomActive ? '💬' : (selectedScene?.icon || '💬');
                            onFreeTalkStart?.({
                                scene: sceneText,
                                sceneId,
                                category,
                                isCustom: isCustomActive,
                                targetLang: selectedLang,
                                sourceLang,
                                difficulty,
                                speechStyle,
                                sceneI18nLabel,
                                sceneIcon,
                            });
                        }}
                        disabled={!canRequest}
                    >
                        💬 Free-Talking
                    </button>
                </div>

                {/* Legacy Generate 버튼 — Sprint 1에서 hidden, 코드는 보존 (미래 재노출 가능) */}
                <div className="scene-request-btns" style={{ display: 'none' }}>
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
                <div ref={questionCardRef} className="scene-card-scroll-anchor">
                    <ScenePracticeCard
                        generated={generated}
                        langCode={selectedLang}
                        sourceLang={sourceLang}
                        onTrialLimitReached={onTrialLimitReached}
                        onPronSuccess={onPronSuccess}
                        onSave={handleSave}
                        isSaved={isSaved}
                        onSpeak={onSpeak}
                        t={t}
                        targetGoal={languageGoals[selectedLang] || 60}
                        onBookmarkPrompt={onBookmarkPrompt}
                    />
                </div>
            )}

            {/* 답변 카드 */}
            {generatedAnswer && (
                <div ref={answerCardRef} className="scene-card-scroll-anchor">
                    <ScenePracticeCard
                        generated={generatedAnswer}
                        langCode={selectedLang}
                        sourceLang={sourceLang}
                        onTrialLimitReached={onTrialLimitReached}
                        onPronSuccess={onPronSuccess}
                        onSave={handleAnswerSave}
                        isSaved={isAnswerSaved}
                        onSpeak={onSpeak}
                        t={t}
                        targetGoal={languageGoals[selectedLang] || 60}
                        onBookmarkPrompt={onBookmarkPrompt}
                    />
                </div>
            )}
        </div>
    );
};

export default ScenePractice;
