import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Sparkles, Volume2, Star, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import './VocabTab.css';

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

export default function VocabTab({
    sourceLang,
    targetLangs = [],
    onTrialLimitReached,
    onSaveToLibrary,
    onSpeak,
    languageGoals = {},
    onBookmarkPrompt,
    onGenerate,
}) {
    const { byokGeminiKey } = useAuth();
    const t = useT(sourceLang);

    // ── State ────────────────────────────────────────────────────────
    const [selectedLang, setSelectedLang] = useState(targetLangs[0] || 'en');
    const [level, setLevel] = useState('basic');
    const [openCat, setOpenCat] = useState(null); // category id
    const [selectedTopic, setSelectedTopic] = useState(null); // { catId, subId, topicId }
    const [customInput, setCustomInput] = useState('');
    const [words, setWords] = useState([]); // generated word cards
    const [isLoading, setIsLoading] = useState(false);
    const [savedWords, setSavedWords] = useState(new Set()); // saved word indices
    const avoidWordsRef = useRef([]); // duplicate avoidance

    // visibleLanguages: Settings에서 선택한 targetLangs만 표시
    const visibleLanguages = targetLangs.filter(code =>
        ['ko', 'en', 'ja', 'zh-CN', 'vi', 'fr', 'de', 'es'].includes(code)
    );

    // targetLangs 변경 시 selectedLang 보정
    useEffect(() => {
        if (!visibleLanguages.includes(selectedLang) && visibleLanguages.length > 0) {
            setSelectedLang(visibleLanguages[0]);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    // 토픽 변경 시 리셋
    useEffect(() => {
        setWords([]);
        setSavedWords(new Set());
        avoidWordsRef.current = [];
    }, [selectedTopic, selectedLang, level]);

    // ── Generate Words ───────────────────────────────────────────────
    const handleGenerate = async () => {
        if (!selectedTopic && !customInput.trim()) return;
        setIsLoading(true);

        const topicId = selectedTopic?.topicId || 'custom';
        const topicLabel = selectedTopic ? getT(selectedLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim();
        const categoryLabel = selectedTopic ? getT(selectedLang, `vocabCat.${selectedTopic.catId}`) : customInput.trim();

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
                    avoidWords: avoidWordsRef.current,
                }),
            });

            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            if (data.words && Array.isArray(data.words)) {
                setWords(data.words);
                setSavedWords(new Set());
                if (onGenerate) onGenerate();
                // avoidWords에 새 단어들 추가
                avoidWordsRef.current = [
                    ...avoidWordsRef.current,
                    ...data.words.map(w => w.word),
                ];
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

        await onSaveToLibrary({
            word: wordObj.word,
            meaning: wordObj.meaning,
            example: wordObj.example,
            exampleTranslation: wordObj.exampleTranslation,
            pronunciation: wordObj.pronunciation,
            langCode: selectedLang,
            topic: selectedTopic ? getT(sourceLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim(),
            difficulty: level === 'advanced' ? 'high' : level,
        });

        setSavedWords(prev => new Set([...prev, index]));
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
                        <div key={i} className="vocab-word-card">
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
                                        className={`vocab-action-btn ${savedWords.has(i) ? 'saved' : ''}`}
                                        onClick={() => handleSave(w, i)}
                                        title={savedWords.has(i) ? t('scene.savedToLibrary') : t('scene.saveToLibrary')}
                                    >
                                        <Star size={16} fill={savedWords.has(i) ? '#f59e0b' : 'none'} />
                                    </button>
                                </div>
                            </div>
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
                                    {w.exampleTranslation && (
                                        <p className="vocab-word-example-trans">{w.exampleTranslation}</p>
                                    )}
                                </div>
                            )}
                        </div>
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
