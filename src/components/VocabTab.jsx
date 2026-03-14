import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Sparkles, Volume2, Star, RefreshCw, Mic, MicOff, RotateCcw, Award, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import { playStarSound, playSuccessSound, playAlertSound } from '../utils/soundEffects';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
import './VocabTab.css';

// Vocab history 문서 ID: {topicId}--{level}--{lang}
const makeVocabHistoryKey = (topicId, level, lang) =>
    `${topicId}--${level}--${lang}`;

const LANG_NAMES = {
    ko: '한국어', en: 'English', ja: '日本語', 'zh-CN': '中文',
    vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español',
};

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

// ── VocabWordCard 서브 컴포넌트 ─────────────────────────────────────
// 각 단어별 독립적인 useAudioRecorder + 발음 연습 + Learning Tip
function VocabWordCard({
    w, index, selectedLang, sourceLang, onSpeak,
    isSaved, onSave, onTrialLimitReached,
    targetGoal, onBookmarkPrompt,
    activeRecIdx, onRecordingStart,
    t,
}) {
    const [practiceMode, setPracticeMode] = useState('word'); // 'word' | 'example'
    const practiceText = practiceMode === 'word' ? w.word : (w.example || '');

    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        errorMsg, saveMessage, startRecording, stopRecording, resetAssessment,
    } = useAudioRecorder(practiceText, selectedLang, sourceLang, onTrialLimitReached);

    // practiceMode 전환 시 이전 결과 초기화
    const handleModeChange = (mode) => {
        if (mode === practiceMode) return;
        resetAssessment();
        setPracticeMode(mode);
    };

    // 녹음 시작 시 부모에게 알려서 다른 카드 녹음 차단
    const handleStart = () => {
        onRecordingStart(index);
        startRecording();
    };

    // 다른 카드가 녹음 중이면 이 카드의 녹음 버튼 비활성화
    const isOtherRecording = activeRecIdx !== null && activeRecIdx !== index;

    // 녹음 완료 후 점수 기반 효과음 + 북마크 안내
    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal) {
                playSuccessSound();
                if (!isSaved) onBookmarkPrompt?.(score);
            } else {
                playAlertSound();
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult]); // eslint-disable-line react-hooks/exhaustive-deps

    const tips = w.learningTip || [];

    return (
        <div className="vocab-word-card">
            {/* 상단: 단어 + 발음 + 뜻 + 액션 */}
            <div className="vocab-word-top">
                <div className="vocab-word-main">
                    <p className="vocab-word-text">{w.word}</p>
                    {w.pronunciation && (
                        <p className="vocab-word-pronunciation">{w.pronunciation}</p>
                    )}
                    <p className="vocab-word-meaning">{w.meaning}</p>
                </div>
                <div className="vocab-word-actions">
                    <button
                        className="vocab-action-btn"
                        onClick={() => onSpeak?.(w.word, selectedLang)}
                        title="TTS"
                    >
                        <Volume2 size={16} />
                    </button>
                    <button
                        className={`vocab-action-btn ${isSaved ? 'saved' : ''}`}
                        onClick={onSave}
                        title={isSaved ? t('scene.savedToLibrary') : t('scene.saveToLibrary')}
                    >
                        <Star size={16} fill={isSaved ? '#f59e0b' : 'none'} />
                    </button>
                </div>
            </div>

            {/* 예문 */}
            {w.example && (
                <div className="vocab-word-example">
                    <p className="vocab-word-example-text">
                        {w.example}
                        <button
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#64748b', padding: '0 0 0 6px', verticalAlign: 'middle'
                            }}
                            onClick={() => onSpeak?.(w.example, selectedLang)}
                        >
                            <Volume2 size={14} />
                        </button>
                    </p>
                    {w.examplePronunciation && (
                        <p className="vocab-word-example-pron">{w.examplePronunciation}</p>
                    )}
                    {w.exampleTranslation && (
                        <p className="vocab-word-example-trans">{w.exampleTranslation}</p>
                    )}
                </div>
            )}

            {/* ── 발음 연습 섹션 ── */}
            <div className="vocab-pron-section">
                <div className="vocab-pron-header">
                    <span className="vocab-pron-label">PRONUNCIATION</span>
                    {assessmentResult && (
                        <div className="vocab-score-badge">
                            <Award size={14} />
                            {assessmentResult.pronunciationScore}Pt
                        </div>
                    )}
                </div>

                {/* 단어 ↔ 예문 토글 (LearningGauge 슬라이드 토글 스타일) */}
                {w.example && (
                    <div className="vocab-pron-toggle">
                        <span className={`vocab-pron-toggle-label ${practiceMode === 'word' ? 'active' : ''}`}>{t('vocab.practiceWord')}</span>
                        <button
                            className={`vocab-pron-toggle-track ${practiceMode === 'example' ? 'on' : ''}`}
                            onClick={() => handleModeChange(practiceMode === 'word' ? 'example' : 'word')}
                            disabled={isRecording || isAnalyzing}
                        >
                            <span className="vocab-pron-toggle-thumb" />
                        </button>
                        <span className={`vocab-pron-toggle-label ${practiceMode === 'example' ? 'active' : ''}`}>{t('vocab.practiceExample')}</span>
                    </div>
                )}

                <div className="vocab-pron-content">
                    {/* 연습 대상 텍스트 미리보기 */}
                    <p className="vocab-pron-target">
                        {practiceText}
                    </p>

                    {!assessmentResult && !isAnalyzing && !isRecording && (
                        <p className="vocab-pron-prompt">{t('card.practicePrompt')}</p>
                    )}
                    {isRecording && <p className="vocab-pron-status recording">{t('card.recording')}</p>}
                    {isAnalyzing && <p className="vocab-pron-status analyzing">{t('card.analyzing')}</p>}

                    {errorMsg && (
                        <div className="vocab-pron-error">
                            <AlertCircle size={14} />
                            {errorMsg}
                        </div>
                    )}
                    {saveMessage && !isAnalyzing && (
                        <div className="vocab-pron-save-msg">
                            <CheckCircle size={14} />
                            {saveMessage}
                        </div>
                    )}

                    <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />

                    {/* 녹음 버튼 */}
                    <div className="practice-actions">
                        <button
                            className={`record-button circle ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
                            onClick={() => isRecording ? stopRecording() : handleStart()}
                            disabled={isAnalyzing || isOtherRecording}
                            title={t('card.practicePrompt')}
                        >
                            {isAnalyzing ? <RotateCcw size={20} className="spin" /> : isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                        </button>
                    </div>
                </div>

                {/* AI 코치 피드백 */}
                {coachTip && (
                    <div className="vocab-coach-area">
                        <span className="vocab-coach-label">AI PRO COACH</span>
                        <p className="vocab-coach-text">"{coachTip}"</p>
                    </div>
                )}
            </div>

            {/* ── Learning Tip 섹션 ── */}
            {tips.length > 0 && (
                <div className="vocab-tip-section">
                    <span className="vocab-tip-label">LEARNING TIP</span>
                    <div className="vocab-tip-list">
                        {tips.map((tip, idx) => (
                            <p key={idx} className="vocab-tip-item">• {typeof tip === 'object' ? (tip.content || '') : String(tip || '')}</p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── 메인 VocabTab ────────────────────────────────────────────────────
export default function VocabTab({
    sourceLang,
    targetLangs = [],
    onTrialLimitReached,
    onSaveToLibrary,
    onSpeak,
    languageGoals = {},
    onBookmarkPrompt,
    onGenerate,
    onNavigateToLibrary,
}) {
    const { byokGeminiKey, user } = useAuth();
    const t = useT(sourceLang);

    // ── State ────────────────────────────────────────────────────────
    const [selectedLang, setSelectedLang] = useState(sourceLang || targetLangs[0] || 'en');
    const [level, setLevel] = useState('basic');
    const [openCat, setOpenCat] = useState('daily');
    const [selectedTopic, setSelectedTopic] = useState(null);
    const [customInput, setCustomInput] = useState('');
    const [words, setWords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [savedWords, setSavedWords] = useState(new Set());
    const [activeRecIdx, setActiveRecIdx] = useState(null); // 동시 녹음 방지
    const avoidWordsRef = useRef([]);
    const historyCacheRef = useRef({});

    // Firebase에서 해당 키의 이력 읽기
    const loadVocabHistory = async (key) => {
        if (!user) return [];
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key];
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/vocabHistory`, key));
            const words = snap.exists() ? (snap.data().words || []) : [];
            historyCacheRef.current = { ...historyCacheRef.current, [key]: words };
            return words;
        } catch {
            return [];
        }
    };

    const appendVocabHistory = (key, newWords) => {
        const existing = historyCacheRef.current[key] || [];
        const updated = [...existing, ...newWords];
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/vocabHistory`, key), {
                words: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    const visibleLanguages = targetLangs.filter(code =>
        ['ko', 'en', 'ja', 'zh-CN', 'vi', 'fr', 'de', 'es'].includes(code)
    );

    useEffect(() => {
        if (!visibleLanguages.includes(selectedLang) && visibleLanguages.length > 0) {
            setSelectedLang(visibleLanguages[0]);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    // 토픽 변경 시 리셋
    useEffect(() => {
        setWords([]);
        setSavedWords(new Set());
        setActiveRecIdx(null);
        avoidWordsRef.current = [];
    }, [selectedTopic, selectedLang, level]);

    // ── Generate Words ───────────────────────────────────────────────
    const handleGenerate = async () => {
        if (!selectedTopic && !customInput.trim()) return;
        setIsLoading(true);
        setActiveRecIdx(null);

        const topicId = selectedTopic?.topicId || 'custom';
        const topicLabel = selectedTopic ? getT(selectedLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim();
        const categoryLabel = selectedTopic ? getT(selectedLang, `vocabCat.${selectedTopic.catId}`) : customInput.trim();

        const historyKey = makeVocabHistoryKey(topicId, level, selectedLang);
        const persistedWords = await loadVocabHistory(historyKey);
        const allAvoid = [...new Set([...persistedWords, ...avoidWordsRef.current])];
        const avoidForApi = allAvoid.slice(-200);

        try {
            const res = await fetch(`${getServerUrl()}/api/vocab-words`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: topicId,
                    topicLabel,
                    category: categoryLabel,
                    level,
                    targetLang: selectedLang,
                    sourceLang,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidWords: avoidForApi,
                }),
            });

            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            if (data.words && Array.isArray(data.words)) {
                setWords(data.words);
                setSavedWords(new Set());
                if (onGenerate) onGenerate();
                const newWordTexts = data.words.map(w => w.word);
                avoidWordsRef.current = [...avoidWordsRef.current, ...newWordTexts];
                appendVocabHistory(historyKey, newWordTexts);
            }
        } catch (e) {
            console.error('[VocabTab] Generate error:', e);
            alert(t('scene.loadError'));
        } finally {
            setIsLoading(false);
        }
    };

    // ── Save to Library ──────────────────────────────────────────────
    const handleSave = async (wordObj, index) => {
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
            topic: selectedTopic ? getT(sourceLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim(),
            categoryId: selectedTopic?.catId || 'custom',
            topicId: selectedTopic?.topicId || 'custom',
            difficulty: level === 'advanced' ? 'high' : level,
        });

        if (!cardId) return;
        playStarSound();
        setSavedWords(prev => new Set([...prev, index]));
        if (onNavigateToLibrary) onNavigateToLibrary(cardId);
    };

    // ── Render ───────────────────────────────────────────────────────
    return (
        <div className="vocab-container">
            {/* Language Pills */}
            <div className="vocab-lang-row">
                {visibleLanguages.map(code => (
                    <button
                        key={code}
                        className={`vocab-lang-pill ${selectedLang === code ? 'active' : ''}`}
                        onClick={() => setSelectedLang(code)}
                    >
                        {LANG_NAMES[code] || code}
                    </button>
                ))}
            </div>

            {/* Level Selector */}
            <div className="vocab-level-row">
                {[
                    { value: 'basic', key: 'diffBasic' },
                    { value: 'intermediate', key: 'diffIntermediate' },
                    { value: 'advanced', key: 'diffHigh' },
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

            {/* Category Accordion */}
            {VOCAB_CATEGORIES.map(cat => {
                const isOpen = openCat === cat.id;
                return (
                    <div key={cat.id} className="vocab-category">
                        <button
                            className="vocab-cat-header"
                            onClick={() => setOpenCat(isOpen ? null : cat.id)}
                        >
                            <span className="vocab-cat-icon">{cat.icon}</span>
                            <span className="vocab-cat-label">{t(`vocabCat.${cat.id}`)}</span>
                            <ChevronRight size={16} className={`vocab-cat-chevron ${isOpen ? 'open' : ''}`} />
                        </button>

                        {isOpen && (
                            <div style={{ padding: '4px 0 8px' }}>
                                {cat.subs.map(sub => (
                                    <div key={sub.id} className="vocab-sub">
                                        <div className="vocab-sub-label">{t(`vocabSub.${sub.id}`)}</div>
                                        <div className="vocab-topics">
                                            {sub.topics.map(topic => {
                                                const isActive = selectedTopic?.topicId === topic.id &&
                                                    selectedTopic?.catId === cat.id;
                                                return (
                                                    <button
                                                        key={topic.id}
                                                        className={`vocab-topic-pill ${isActive ? 'active' : ''}`}
                                                        onClick={() => {
                                                            setCustomInput('');
                                                            setSelectedTopic({
                                                                catId: cat.id,
                                                                subId: sub.id,
                                                                topicId: topic.id,
                                                            });
                                                        }}
                                                    >
                                                        {t(`vocabTopic.${topic.id}`)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Custom Input */}
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
            <div className="vocab-generate-row">
                <button
                    className="vocab-generate-btn"
                    onClick={handleGenerate}
                    disabled={isLoading || (!selectedTopic && !customInput.trim())}
                >
                    {isLoading ? (
                        <RefreshCw size={18} style={{ animation: 'vocab-spin 0.8s linear infinite' }} />
                    ) : (
                        <Sparkles size={18} />
                    )}
                    {isLoading
                        ? t('card.analyzing')
                        : words.length > 0
                            ? t('vocab.regenerate')
                            : t('vocab.generate')
                    }
                </button>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="vocab-loading">
                    <div className="vocab-spinner" />
                    {t('vocab.generating')}
                </div>
            )}

            {/* Word Cards */}
            {!isLoading && words.length > 0 && (
                <div className="vocab-words-list">
                    {words.map((w, i) => (
                        <VocabWordCard
                            key={i}
                            w={w}
                            index={i}
                            selectedLang={selectedLang}
                            sourceLang={sourceLang}
                            onSpeak={onSpeak}
                            isSaved={savedWords.has(i)}
                            onSave={() => handleSave(w, i)}
                            onTrialLimitReached={onTrialLimitReached}
                            targetGoal={languageGoals[selectedLang] || 80}
                            onBookmarkPrompt={onBookmarkPrompt}
                            activeRecIdx={activeRecIdx}
                            onRecordingStart={setActiveRecIdx}
                            t={t}
                        />
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && words.length === 0 && (
                <div className="vocab-empty">
                    <div className="vocab-empty-icon">📖</div>
                    {t('vocab.selectTopic')}
                </div>
            )}
        </div>
    );
}
