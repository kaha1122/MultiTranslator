import { useState, useEffect, useRef } from 'react';
import { Sparkles, Volume2, Star, RefreshCw, Mic, MicOff, RotateCcw, Award, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import CategorySlider from './CategorySlider';
import TopicPickerModal from './TopicPickerModal';
import { playStarSound, playSuccessSound, playAlertSound } from '../utils/soundEffects';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
import { authFetch } from '../utils/authFetch';
import { getLangName } from '../config/languages';
import './VocabTab.css';

// Vocab history 문서 ID: {topicId}--{level}--{lang}
const makeVocabHistoryKey = (topicId, level, lang) =>
    `${topicId}--${level}--${lang}`;

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

// ── VocabWordCard 서브 컴포넌트 ─────────────────────────────────────
// 각 단어별 독립적인 useAudioRecorder + 발음 연습 + Learning Tip
export function VocabWordCard({
    w, index, selectedLang, sourceLang, onSpeak,
    isSaved, onSave, onTrialLimitReached, onPronSuccess,
    targetGoal, onBookmarkPrompt,
    activeRecIdx, onRecordingStart,
    t,
}) {
    const [practiceMode, setPracticeMode] = useState('word'); // 'word' | 'example'
    const practiceText = practiceMode === 'word' ? w.word : (w.example || '');

    // 일본어(ja)만 한자 대신 히라가나(pronunciation/examplePronunciation)를 Azure 기준으로 사용.
    // 중국어/러시아어는 원문이 더 정확히 평가됨 → 치환하지 않음.
    const referenceText = (selectedLang === 'ja')
        ? (practiceMode === 'word'
            ? (w.pronunciation || w.word)
            : (w.examplePronunciation || w.example || ''))
        : practiceText;

    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        errorMsg, saveMessage, micDenied, openAppSettings, startRecording, stopRecording, resetAssessment,
    } = useAudioRecorder(referenceText, selectedLang, sourceLang, onTrialLimitReached, onPronSuccess);

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

    // 녹음+분석 완료 후 activeRecIdx 해제
    useEffect(() => {
        if (activeRecIdx === index && !isRecording && !isAnalyzing) {
            onRecordingStart(null);
        }
    }, [isRecording, isAnalyzing]); // eslint-disable-line react-hooks/exhaustive-deps

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
                        onClick={() => onSave(assessmentResult?.pronunciationScore ?? null)}
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
                        <div className="vocab-pron-error" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <AlertCircle size={14} />
                                {errorMsg}
                            </span>
                            {micDenied && window.Capacitor?.isNativePlatform?.() && (
                                <button onClick={openAppSettings} style={{ background: 'none', border: '1px solid #6366f1', color: '#6366f1', borderRadius: '8px', padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                                    {t('errors.openSettings')}
                                </button>
                            )}
                        </div>
                    )}
                    {saveMessage && !isAnalyzing && (
                        <div className="vocab-pron-save-msg">
                            <CheckCircle size={14} />
                            {saveMessage}
                        </div>
                    )}

                    <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} langCode={selectedLang} onSpeak={onSpeak} />

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

    // ── State ────────────────────────────────────────────────────────
    // 랜덤 초기 토픽 선택
    const pickRandomTopic = () => {
        const cat = VOCAB_CATEGORIES[Math.floor(Math.random() * VOCAB_CATEGORIES.length)];
        const sub = cat.subs[Math.floor(Math.random() * cat.subs.length)];
        const topic = sub.topics[Math.floor(Math.random() * sub.topics.length)];
        return { catId: cat.id, subId: sub.id, topicId: topic.id };
    };
    const initialTopic = pickRandomTopic();

    const [selectedLang, setSelectedLang] = useState(sourceLang || targetLangs[0] || 'en');
    const [level, setLevel] = useState(userLevel || 'basic');
    useEffect(() => { if (userLevel) setLevel(userLevel); }, [userLevel]);
    const [pickerCatId, setPickerCatId] = useState(null);
    const [selectedTopic, setSelectedTopic] = useState(initialTopic);
    const [customInput, setCustomInput] = useState('');
    const [words, setWords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [savedWords, setSavedWords] = useState(new Set());
    const [activeRecIdx, setActiveRecIdx] = useState(null); // 동시 녹음 방지
    const avoidWordsRef = useRef([]);
    const historyCacheRef = useRef({});
    const generateBtnRef = useRef(null);
    const didInitialScrollRef = useRef(false);

    // 탭이 처음으로 보여질 때 Generate 버튼으로 스크롤
    //   - VocabTab 은 display:none 상태로 선마운트되므로 마운트 시점엔 요소가 숨겨져 측정 불가
    //   - isActive 가 true 로 전환되는 최초 1회에만 실행 (재진입 시 유저 스크롤 위치 존중)
    //   - scrollIntoView 는 중첩 스크롤 컨테이너 + Android WebView 조합에서 불안정 → getBoundingClientRect 직접 계산
    useEffect(() => {
        if (!isActive || didInitialScrollRef.current) return;
        didInitialScrollRef.current = true;

        // 여러 단계 지연 — display:none→block, 카테고리 확장 렌더, admob 배너 높이 반영 대기
        const tryScroll = (attempt = 0) => {
            const btn = generateBtnRef.current;
            if (!btn) return;
            const container = btn.closest('.app-container');
            if (!container) {
                btn.scrollIntoView({ block: 'center' });
                return;
            }
            const btnRect = btn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            // 버튼이 아직 레이아웃에 안 잡혔으면 (height 0) 재시도
            if (btnRect.height === 0 && attempt < 5) {
                setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            const target = container.scrollTop
                + (btnRect.top - containerRect.top)
                - (containerRect.height / 2)
                + (btnRect.height / 2);
            container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        };

        requestAnimationFrame(() => {
            setTimeout(() => tryScroll(0), 150);
        });
    }, [isActive]);

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

    const visibleLanguages = targetLangs;

    // 기본 학습 언어(targetLangs[0])가 바뀌면 selectedLang도 새 default로 따라감.
    // 탭이 display:none으로 상시 마운트돼 초깃값이 stale해지므로, 단순 includes 체크만으로는
    // stale 값이 우연히 신규 배열에 포함된 경우 사용자가 의도한 default를 무시하게 됨.
    const prevDefaultLangRef = useRef(targetLangs?.[0]);
    useEffect(() => {
        if (visibleLanguages.length === 0) return;
        const newDefault = visibleLanguages[0];
        const defaultChanged = prevDefaultLangRef.current !== newDefault;
        if (defaultChanged) prevDefaultLangRef.current = newDefault;
        if (defaultChanged || !visibleLanguages.includes(selectedLang)) {
            setSelectedLang(newDefault);
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
        // Firestore 에는 전체 누적, 서버 prompt 에는 최근 30개만 전송 (LLM long-list 한계 + 토큰 절감).
        // 서버 vocab.js 도 추가로 slice(-30) 하지만 클라 단계에서 1차 cap 으로 네트워크 비용 축소.
        const avoidForApi = allAvoid.slice(-30);

        try {
            const res = await authFetch(`${getServerUrl()}/api/vocab-words`, {
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
            topic: selectedTopic ? getT(sourceLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim(),
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

            {/* ── Category Slider + 선택 칩 ──────────────────────── */}
            <CategorySlider
                sourceLang={sourceLang}
                selectedCatId={selectedTopic?.catId || null}
                onCategoryClick={(catId) => setPickerCatId(catId)}
            />

            {selectedTopic && (
                <button
                    type="button"
                    className="vocab-selected-chip"
                    onClick={() => setPickerCatId(selectedTopic.catId)}
                    aria-label={t('vocab.changeTopic') || 'change topic'}
                >
                    <span className="vocab-selected-chip__cat">
                        {t(`vocabCat.${selectedTopic.catId}`)}
                    </span>
                    <span className="vocab-selected-chip__sep">›</span>
                    <span className="vocab-selected-chip__topic">
                        {t(`vocabTopic.${selectedTopic.topicId}`)}
                    </span>
                </button>
            )}

            {/* Custom Input — Free Talking과 동일 UI (2줄 label + 2줄 textarea) */}
            <div className="scene-custom-block">
                <div className="scene-custom-label" role="presentation">
                    <span className="scene-custom-label__icon" aria-hidden="true">✏️</span>
                    <span className="scene-custom-label__text">{t('scene.customLabelTop')}</span>
                </div>
                <textarea
                    className="scene-custom-input"
                    rows={2}
                    placeholder={t('scene.customPlaceholder')}
                    value={customInput}
                    onChange={evt => {
                        const v = evt.target.value;
                        setCustomInput(v);
                        if (v.trim()) setSelectedTopic(null);
                    }}
                />
            </div>

            {/* Generate Button */}
            <div className="vocab-generate-row">
                <button
                    ref={generateBtnRef}
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
            )}

            {/* Empty State */}
            {!isLoading && words.length === 0 && (
                <div className="vocab-empty">
                    <div className="vocab-empty-icon">📖</div>
                    {t('vocab.selectTopic')}
                </div>
            )}

            {/* Topic Picker Modal — opens when slider/chip is clicked */}
            {pickerCatId && (
                <TopicPickerModal
                    catId={pickerCatId}
                    sourceLang={sourceLang}
                    selectedTopic={selectedTopic}
                    onTopicSelect={(catId, subId, topicId) => {
                        setCustomInput('');
                        setSelectedTopic({ catId, subId, topicId });
                    }}
                    onClose={() => setPickerCatId(null)}
                />
            )}
        </div>
    );
}
