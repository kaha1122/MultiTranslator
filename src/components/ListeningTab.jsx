import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Sparkles, Volume2, Pause, Repeat, Loader2, BookOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import { VocabWordCard } from './VocabTab';
import { authFetch } from '../utils/authFetch';
import { playStarSound } from '../utils/soundEffects';
import { getLangName } from '../config/languages';
import './ListeningTab.css';

// 대화형 지문에서 A:/B: 레이블 제거 + 줄바꿈을 SSML pause로 변환
const cleanDialogueForTTS = (text) => {
    if (!text) return text;
    // A: B: 등 화자 레이블 제거, 줄바꿈 유지 (TTS 엔진이 줄바꿈에서 자연스럽게 쉼)
    return text.replace(/^[A-Z]:\s*/gm, '\n').replace(/\n{2,}/g, '\n\n');
};

// 지문을 문장 단위로 분리 (대화: 줄 단위 / 에세이: 문장부호 기준)
const splitIntoSentences = (text, isDialogue) => {
    if (!text) return [];
    if (isDialogue) {
        // 대화: 줄바꿈 기준 분리, 빈 줄 제거
        return text.split('\n').filter(s => s.trim());
    }
    // 에세이: 문장 종결 부호 기준 분리 (마침표, 물음표, 느낌표 + CJK 구두점)
    // 부호 뒤에서 분리하되 부호는 앞 문장에 포함
    const parts = text.split(/(?<=[。．.！!？?\n])\s*/);
    return parts.filter(s => s.trim());
};

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const makeHistoryKey = (topicId, type, level, lang) =>
    `${topicId}--${type}--${level}--${lang}`;

export default function ListeningTab({
    sourceLang,
    targetLangs = [],
    onTrialLimitReached,
    onPronSuccess,
    onSaveToLibrary,
    onSpeak,
    languageGoals = {},
    onBookmarkPrompt,
    onGenerate,
    onNavigateToLibrary,
    userLevel,
    isActive = true,
}) {
    const { byokGeminiKey, user } = useAuth();
    const t = useT(sourceLang);

    // ── State ────────────────────────────────────────────────────
    // 랜덤 초기 토픽 선택
    const pickRandomTopic = () => {
        const cat = VOCAB_CATEGORIES[Math.floor(Math.random() * VOCAB_CATEGORIES.length)];
        const sub = cat.subs[Math.floor(Math.random() * cat.subs.length)];
        const topic = sub.topics[Math.floor(Math.random() * sub.topics.length)];
        return { catId: cat.id, subId: sub.id, topicId: topic.id };
    };

    const [selectedLang, setSelectedLang] = useState(sourceLang || targetLangs[0] || 'en');
    const [level, setLevel] = useState(userLevel || 'basic');
    useEffect(() => { if (userLevel) setLevel(userLevel); }, [userLevel]);
    const [passageType, setPassageType] = useState('essay'); // 'essay' | 'dialogue'
    const [selectedTopic, setSelectedTopic] = useState(() => pickRandomTopic()); // { catId, subId, topicId }
    const [showCategorySheet, setShowCategorySheet] = useState(false);
    const [customInput, setCustomInput] = useState(''); // 사용자가 직접 입력한 커스텀 주제

    const [passage, setPassage] = useState(null);
    const [keywords, setKeywords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [showPronunciation, setShowPronunciation] = useState(false);
    const [savedWords, setSavedWords] = useState(new Set());
    const [activeRecIdx, setActiveRecIdx] = useState(null);
    const [playingSentenceIdx, setPlayingSentenceIdx] = useState(null);

    // 장문 TTS 재생 관리
    const [passagePlaying, setPassagePlaying] = useState(false); // 재생 중 여부
    const [passageLoading, setPassageLoading] = useState(false); // TTS 로딩 중
    const [loopMode, setLoopMode] = useState(false); // 반복 재생 모드
    const passageAudioRef = useRef(null); // 현재 재생 중인 Audio 객체
    const passageAudioUrlRef = useRef(null); // blob URL (누수 방지용)
    const loopModeRef = useRef(false); // useCallback 내에서 최신 값 접근용
    const playGenRef = useRef(0); // 재생 세대 토큰 (stale fetch 응답 무효화)
    const ttsAbortRef = useRef(null); // 진행 중 TTS fetch 취소용

    // loopMode 최신 값 동기화
    useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);

    // 장문 재생 정리 — in-flight fetch 취소 + stale 응답 무효화 + audio/blob 정리
    const stopPassageAudio = useCallback(() => {
        playGenRef.current += 1; // 이후 도착할 fetch 응답은 stale 로 간주됨
        if (ttsAbortRef.current) {
            try { ttsAbortRef.current.abort(); } catch {}
            ttsAbortRef.current = null;
        }
        if (passageAudioRef.current) {
            try { passageAudioRef.current.pause(); } catch {}
            passageAudioRef.current.onended = null;
            try { passageAudioRef.current.src = ''; } catch {}
            passageAudioRef.current = null;
        }
        if (passageAudioUrlRef.current) {
            try { URL.revokeObjectURL(passageAudioUrlRef.current); } catch {}
            passageAudioUrlRef.current = null;
        }
        setPassagePlaying(false);
        setPassageLoading(false);
    }, []);

    // 장문 재생/일시정지 토글
    const handlePassagePlay = useCallback(async () => {
        if (!passage?.text || !onSpeak) return;

        // 재생 중 → 일시정지
        if (passagePlaying && passageAudioRef.current) {
            passageAudioRef.current.pause();
            setPassagePlaying(false);
            return;
        }

        // 일시정지 상태에서 재개
        if (passageAudioRef.current && passageAudioRef.current.paused && passageAudioRef.current.currentTime > 0) {
            passageAudioRef.current.play().catch(() => {});
            setPassagePlaying(true);
            return;
        }

        // 새로 재생 시작 — 세대 토큰 + AbortController 로 race 방지
        const ttsText = passageType === 'dialogue' ? cleanDialogueForTTS(passage.text) : passage.text;
        const SERVER_URL = getServerUrl();
        const myGen = ++playGenRef.current;
        const controller = new AbortController();
        ttsAbortRef.current = controller;
        setPassageLoading(true);

        let objectUrl = null;
        try {
            const res = await authFetch(`${SERVER_URL}/api/azure-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: ttsText, langCode: selectedLang }),
                signal: controller.signal,
            });
            if (myGen !== playGenRef.current) return; // stale
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const blob = await res.blob();
            if (myGen !== playGenRef.current) return; // stale

            objectUrl = URL.createObjectURL(blob);
            const audio = new Audio(objectUrl);

            audio.onended = () => {
                if (myGen !== playGenRef.current) return;
                if (loopModeRef.current) {
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                } else {
                    setPassagePlaying(false);
                    if (passageAudioUrlRef.current) {
                        try { URL.revokeObjectURL(passageAudioUrlRef.current); } catch {}
                        passageAudioUrlRef.current = null;
                    }
                    passageAudioRef.current = null;
                }
            };

            passageAudioRef.current = audio;
            passageAudioUrlRef.current = objectUrl;
            objectUrl = null; // ref 로 이전됨 — finally 에서 revoke 하지 않도록
            await audio.play();
            if (myGen !== playGenRef.current) return; // 재생 직후에도 체크 (중간에 stop 된 경우)
            setPassagePlaying(true);
        } catch (e) {
            if (e?.name === 'AbortError') return; // 정상 취소
            console.warn('[ListeningTab] TTS error:', e);
            // fallback: 기존 onSpeak 사용
            if (myGen === playGenRef.current) onSpeak(ttsText, selectedLang);
        } finally {
            if (objectUrl) {
                try { URL.revokeObjectURL(objectUrl); } catch {}
            }
            if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
            if (myGen === playGenRef.current) setPassageLoading(false);
        }
    }, [passage, passagePlaying, passageType, selectedLang, onSpeak, stopPassageAudio]);

    const avoidTitlesRef = useRef([]);
    const historyCacheRef = useRef({});

    const visibleLanguages = targetLangs;

    useEffect(() => {
        if (!visibleLanguages.includes(selectedLang) && visibleLanguages.length > 0) {
            setSelectedLang(visibleLanguages[0]);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    // 조건 변경 시 리셋
    useEffect(() => {
        stopPassageAudio();
        setPassage(null);
        setKeywords([]);
        setSavedWords(new Set());
        setActiveRecIdx(null);
        setShowTranslation(false);
        setShowPronunciation(false);
        avoidTitlesRef.current = [];
    }, [selectedTopic, selectedLang, level, passageType]); // eslint-disable-line react-hooks/exhaustive-deps

    // 탭 이탈 시 TTS 정지 (다른 탭의 Generate 등으로 이동하는 경우 대응)
    useEffect(() => {
        if (!isActive) stopPassageAudio();
    }, [isActive, stopPassageAudio]);

    // 언마운트 시 정리
    useEffect(() => () => stopPassageAudio(), [stopPassageAudio]);

    // ── Firestore History ────────────────────────────────────────
    const loadHistory = async (key) => {
        if (!user) return [];
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key];
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/listeningHistory`, key));
            const titles = snap.exists() ? (snap.data().titles || []) : [];
            historyCacheRef.current = { ...historyCacheRef.current, [key]: titles };
            return titles;
        } catch {
            return [];
        }
    };

    const appendHistory = (key, newTitle) => {
        const existing = historyCacheRef.current[key] || [];
        const updated = [...existing, newTitle];
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/listeningHistory`, key), {
                titles: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    // ── Generate Passage ─────────────────────────────────────────
    const handleGenerate = async () => {
        const hasCustom = customInput.trim().length > 0;
        if (!selectedTopic && !hasCustom) return;
        stopPassageAudio();
        setIsLoading(true);
        setActiveRecIdx(null);

        const topicId = hasCustom ? 'custom' : selectedTopic.topicId;
        const topicLabel = hasCustom
            ? customInput.trim()
            : getT(selectedLang, `vocabTopic.${selectedTopic.topicId}`);
        const categoryLabel = hasCustom
            ? customInput.trim()
            : getT(selectedLang, `vocabCat.${selectedTopic.catId}`);
        const historyKey = makeHistoryKey(topicId, passageType, level, selectedLang);
        const persistedTitles = await loadHistory(historyKey);
        const allAvoid = [...new Set([...persistedTitles, ...avoidTitlesRef.current])];

        try {
            const res = await authFetch(`${getServerUrl()}/api/listening-passage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: topicId,
                    topicLabel,
                    category: categoryLabel,
                    level,
                    type: passageType,
                    targetLang: selectedLang,
                    sourceLang,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidTitles: allAvoid.slice(-50),
                }),
            });

            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            if (data.passage || data.title) {
                setPassage({
                    title: data.title || '',
                    titleTranslation: data.titleTranslation || '',
                    text: data.passage || '',
                    pronunciation: data.passagePronunciation || '',
                    translation: data.passageTranslation || '',
                });
                setKeywords(data.words || []);
                setSavedWords(new Set());
                setShowTranslation(false);
                setShowPronunciation(false);
                if (onGenerate) onGenerate();
                if (data.title) {
                    avoidTitlesRef.current = [...avoidTitlesRef.current, data.title];
                    appendHistory(historyKey, data.title);
                }
            }
        } catch (e) {
            console.error('[ListeningTab] Generate error:', e);
            alert(t('scene.loadError'));
        } finally {
            setIsLoading(false);
        }
    };

    // ── Save Word to Library ─────────────────────────────────────
    const handleSave = async (wordObj, index, pronunciationScore = null) => {
        if (savedWords.has(index)) return;
        if (!onSaveToLibrary) return;

        const cardId = await onSaveToLibrary({
            word: wordObj.word,
            meaning: wordObj.meaning,
            example: wordObj.example,
            exampleTranslation: wordObj.exampleTranslation,
            pronunciation: wordObj.pronunciation,
            learningTip: wordObj.learningTip || [],
            langCode: selectedLang,
            topic: getT(sourceLang, `vocabTopic.${selectedTopic?.topicId}`),
            categoryId: selectedTopic?.catId || 'custom',
            topicId: selectedTopic?.topicId || 'custom',
            difficulty: level,
            pronunciationScore,
        });

        if (!cardId) return;
        playStarSound();
        setSavedWords(prev => new Set([...prev, index]));
        if (onNavigateToLibrary) onNavigateToLibrary(cardId);
    };

    // ── Topic selection from bottom sheet ─────────────────────────
    const handleTopicSelect = (catId, subId, topicId) => {
        setCustomInput('');
        setSelectedTopic({ catId, subId, topicId });
        setShowCategorySheet(false);
    };

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="listening-container">
            {/* Language Pills */}
            <div className="vocab-lang-row">
                {visibleLanguages.map(code => (
                    <button
                        key={code}
                        className={`vocab-lang-pill ${selectedLang === code ? 'active' : ''}`}
                        onClick={() => setSelectedLang(code)}
                    >
                        {getT(sourceLang, `langNames.${code}`) || getLangName(code)}
                    </button>
                ))}
            </div>

            {/* Level Selector */}
            <div className="vocab-level-row">
                {[
                    { value: 'basic', key: 'diffBasic' },
                    { value: 'intermediate', key: 'diffIntermediate' },
                    { value: 'advanced', key: 'diffAdvanced' },
                ].map(lv => (
                    <button
                        key={lv.value}
                        className={`vocab-level-btn ${level === lv.value ? 'active' : ''}`}
                        onClick={() => setLevel(lv.value)}
                    >
                        {t(`scene.${lv.key}`)}
                    </button>
                ))}
            </div>

            {/* Essay / Dialogue Toggle */}
            <div className="listening-type-row">
                <span
                    className={`listening-type-label ${passageType === 'essay' ? 'active' : ''}`}
                    onClick={() => setPassageType('essay')}
                >
                    {t('listening.essay')}
                </span>
                <button
                    className={`listening-type-track ${passageType === 'dialogue' ? 'on' : ''}`}
                    onClick={() => setPassageType(p => p === 'essay' ? 'dialogue' : 'essay')}
                >
                    <span className="listening-type-thumb" />
                </button>
                <span
                    className={`listening-type-label ${passageType === 'dialogue' ? 'active' : ''}`}
                    onClick={() => setPassageType('dialogue')}
                >
                    {t('listening.dialogue')}
                </span>
            </div>

            {/* Category & Topic Selector */}
            <div className="listening-selector-row">
                <button
                    className={`listening-select-btn ${selectedTopic ? 'selected' : ''}`}
                    onClick={() => setShowCategorySheet(true)}
                >
                    <span>
                        {selectedTopic
                            ? `${t(`vocabCat.${selectedTopic.catId}`)} › ${t(`vocabTopic.${selectedTopic.topicId}`)}`
                            : t('listening.selectTopic')}
                    </span>
                    <ChevronDown size={14} />
                </button>
            </div>

            {/* Custom Input — 사용자 직접 주제 입력 */}
            <input
                className="vocab-custom-input"
                placeholder={t('scene.customPlaceholder')}
                value={customInput}
                onChange={e => {
                    setCustomInput(e.target.value);
                    if (e.target.value.trim()) setSelectedTopic(null);
                }}
            />

            {/* Generate Button */}
            <button
                className="listening-generate-btn"
                onClick={handleGenerate}
                disabled={isLoading || (!selectedTopic && !customInput.trim())}
            >
                {isLoading ? (
                    <><Loader2 size={18} className="spin" /> {t('listening.generating')}</>
                ) : (
                    <><Sparkles size={18} /> {passage ? t('listening.regenerate') : t('listening.generate')}</>
                )}
            </button>

            {/* Loading */}
            {isLoading && (
                <div className="listening-loading">
                    <Loader2 size={28} className="spin" style={{ color: '#00a884' }} />
                    {t('listening.generating')}
                </div>
            )}

            {/* Passage Card */}
            {passage && !isLoading && (
                <>
                    <div className="listening-passage-card">
                        <div className="listening-passage-header">
                            <div style={{ flex: 1 }}>
                                <h3 className="listening-passage-title">{passage.title}</h3>
                                {passage.titleTranslation && (
                                    <p className="listening-passage-title-trans">{passage.titleTranslation}</p>
                                )}
                            </div>
                            {/* 재생 ↔ 반복 토글 */}
                            <div className="listening-loop-toggle">
                                <span className={`listening-loop-label ${!loopMode ? 'active' : ''}`}>
                                    <Volume2 size={11} />
                                </span>
                                <button
                                    className={`listening-loop-track ${loopMode ? 'on' : ''}`}
                                    onClick={() => setLoopMode(m => !m)}
                                >
                                    <span className="listening-loop-thumb" />
                                </button>
                                <span className={`listening-loop-label ${loopMode ? 'active' : ''}`}>
                                    <Repeat size={11} />
                                </span>
                            </div>
                            {/* 재생/일시정지 버튼 */}
                            <button
                                className={`listening-tts-btn ${passagePlaying ? 'playing' : ''}`}
                                onClick={handlePassagePlay}
                                disabled={passageLoading}
                                title={passagePlaying ? 'Pause' : 'Play'}
                            >
                                {passageLoading
                                    ? <Loader2 size={18} className="spin" />
                                    : passagePlaying
                                        ? <Pause size={18} />
                                        : <Volume2 size={18} />}
                            </button>
                        </div>

                        <div className="listening-passage-text">
                            {splitIntoSentences(passage.text, passageType === 'dialogue').map((sentence, idx) => (
                                <span
                                    key={idx}
                                    className={`listening-sentence ${playingSentenceIdx === idx ? 'playing' : ''}`}
                                    onClick={() => {
                                        setPlayingSentenceIdx(idx);
                                        const ttsText = passageType === 'dialogue'
                                            ? sentence.replace(/^[A-Z]:\s*/, '')
                                            : sentence;
                                        onSpeak?.(ttsText, selectedLang);
                                    }}
                                >
                                    {sentence}
                                    {passageType === 'dialogue' ? '\n' : ' '}
                                </span>
                            ))}
                        </div>

                        {passage.pronunciation && (
                            <>
                                <button
                                    className="listening-translation-toggle"
                                    onClick={() => setShowPronunciation(!showPronunciation)}
                                >
                                    {showPronunciation ? t('listening.hidePronunciation') : t('listening.showPronunciation')}
                                    <ChevronDown size={14} className={showPronunciation ? 'rotated' : ''} />
                                </button>
                                {showPronunciation && (
                                    <div className="listening-passage-pron">{passage.pronunciation}</div>
                                )}
                            </>
                        )}

                        <button
                            className="listening-translation-toggle"
                            onClick={() => setShowTranslation(!showTranslation)}
                        >
                            {showTranslation ? t('listening.hideTranslation') : t('listening.showTranslation')}
                            <ChevronDown size={14} className={showTranslation ? 'rotated' : ''} />
                        </button>
                        {showTranslation && (
                            <div className="listening-passage-translation">{passage.translation}</div>
                        )}
                    </div>

                    {/* Key Words */}
                    {keywords.length > 0 && (
                        <>
                            <div className="listening-keywords-label">
                                <BookOpen size={14} />
                                {t('listening.keywords')}
                            </div>
                            <div className="listening-keywords-list">
                                {keywords.map((w, i) => (
                                    <VocabWordCard
                                        key={i}
                                        w={w}
                                        index={i}
                                        selectedLang={selectedLang}
                                        sourceLang={sourceLang}
                                        onSpeak={onSpeak}
                                        isSaved={savedWords.has(i)}
                                        onSave={(score) => handleSave(w, i, score)}
                                        onTrialLimitReached={onTrialLimitReached}
                                        onPronSuccess={onPronSuccess}
                                        targetGoal={languageGoals[selectedLang] || 80}
                                        onBookmarkPrompt={onBookmarkPrompt}
                                        activeRecIdx={activeRecIdx}
                                        onRecordingStart={setActiveRecIdx}
                                        t={t}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}

            {/* Empty State */}
            {!passage && !isLoading && (
                <div className="listening-empty">
                    <div className="listening-empty-icon">🎧</div>
                    <p>{t('listening.emptyState')}</p>
                </div>
            )}

            {/* Category Bottom Sheet */}
            {showCategorySheet && (
                <>
                    <div className="listening-bs-overlay" onClick={() => setShowCategorySheet(false)} />
                    <div className="listening-bs-sheet">
                        <div className="listening-bs-handle" />
                        <div className="listening-bs-title">{t('listening.selectTopic')}</div>
                        <div className="listening-bs-scroll">
                            {VOCAB_CATEGORIES.map(cat => (
                                <div key={cat.id}>
                                    <div className="listening-bs-cat-header">
                                        <span className="listening-bs-cat-icon">{cat.icon}</span>
                                        {t(`vocabCat.${cat.id}`)}
                                    </div>
                                    {cat.subs.map(sub => (
                                        <div key={sub.id}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', padding: '6px 0 2px 26px' }}>
                                                {t(`vocabSub.${sub.id}`)}
                                            </div>
                                            <div className="listening-bs-topics">
                                                {sub.topics.map(topic => (
                                                    <button
                                                        key={topic.id}
                                                        className={`listening-bs-topic-pill ${selectedTopic?.topicId === topic.id ? 'active' : ''}`}
                                                        onClick={() => handleTopicSelect(cat.id, sub.id, topic.id)}
                                                    >
                                                        {t(`vocabTopic.${topic.id}`)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
