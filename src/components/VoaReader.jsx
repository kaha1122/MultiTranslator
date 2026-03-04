import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, Volume2, Mic, MicOff, RotateCcw, Bookmark, BookmarkCheck, AlertCircle, ExternalLink } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useT } from '../utils/i18n';
import PronunciationAssessment from './PronunciationAssessment';
import './VoaReader.css';

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const CATEGORIES = ['beginner', 'intermediate', 'advanced'];

const LEVEL_COLORS = {
    beginner:     { bg: '#dcfce7', text: '#166534', border: '#16a34a', dot: '#22c55e' },
    intermediate: { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6', dot: '#3b82f6' },
    advanced:     { bg: '#ede9fe', text: '#5b21b6', border: '#7c3aed', dot: '#8b5cf6' },
};

/**
 * SentencePracticeCard
 * TranslationCard와 동일한 녹음 버튼 + PronunciationAssessment 게이지 사용
 */
function SentencePracticeCard({ sentence, sourceLang, onTrialLimitReached, onSave, isSaved, t }) {
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(sentence.text, 'en', sourceLang, onTrialLimitReached);

    return (
        <div className="voa-sentence-practice">
            {/* 원형 게이지 + 단어 신호등 (TranslationCard와 동일한 컴포넌트) */}
            {assessmentResult && (
                <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />
            )}

            {/* AI 코치 팁 */}
            {coachTip && (
                <div className="voa-coach-tip">💡 {coachTip}</div>
            )}

            {/* 녹음 버튼 행 */}
            <div className="voa-practice-actions">
                <div className="voa-practice-left">
                    {isRecording && (
                        <p className="voa-recording-status">{t('card.recording')}</p>
                    )}
                    {isAnalyzing && (
                        <p className="voa-analyzing-status">{t('card.analyzing')}</p>
                    )}
                    {/* 녹음 버튼: TranslationCard와 동일한 record-button circle 클래스 */}
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

                {/* 북마크 버튼 — 아이콘만, 저장 시 초록색 */}
                <button
                    className={`voa-bookmark-btn ${isSaved ? 'saved' : ''}`}
                    onClick={onSave}
                    disabled={isSaved}
                    title={isSaved ? t('voa.savedToLibrary') : t('voa.saveToLibrary')}
                >
                    {isSaved ? <BookmarkCheck size={22} /> : <Bookmark size={22} />}
                </button>
            </div>

            {errorMsg && (
                <p className="voa-error-msg"><AlertCircle size={14} /> {errorMsg}</p>
            )}
        </div>
    );
}

/**
 * VoaReader — VOA Learning English 레벨별 발음 연습 탭
 */
export default function VoaReader({ sourceLang, onTrialLimitReached, onSaveToLibrary }) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    const [category, setCategory]               = useState('intermediate');
    const [articles, setArticles]               = useState([]);
    const [loadingList, setLoadingList]         = useState(false);
    const [listError, setListError]             = useState('');
    const [selectedArticle, setSelectedArticle] = useState(null);
    const [sentences, setSentences]             = useState([]);
    const [loadingArticle, setLoadingArticle]   = useState(false);
    const [articleError, setArticleError]       = useState('');
    const [expandedIdx, setExpandedIdx]         = useState(null);
    const [savedSet, setSavedSet]               = useState(new Set());

    // 하드웨어 뒤로 버튼 처리용 ref
    const selectedArticleRef = useRef(null);

    // 기사 목록 fetch
    const fetchArticles = useCallback(async (cat) => {
        setLoadingList(true);
        setListError('');
        setArticles([]);
        setSelectedArticle(null);
        selectedArticleRef.current = null;
        setSentences([]);
        setExpandedIdx(null);
        try {
            const res = await fetch(`${SERVER_URL}/api/voa-news?category=${cat}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setArticles(data.articles || []);
        } catch {
            setListError(t('voa.loadError'));
        } finally {
            setLoadingList(false);
        }
    }, [SERVER_URL, t]);

    useEffect(() => { fetchArticles(category); }, [category, fetchArticles]);

    // 하드웨어 뒤로 버튼 감지 — 기사 상세 뷰에서 뒤로 가면 목록으로
    useEffect(() => {
        const handlePop = () => {
            if (selectedArticleRef.current) {
                selectedArticleRef.current = null;
                setSelectedArticle(null);
                setSentences([]);
            }
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, []);

    // 기사 본문 fetch
    const openArticle = async (article) => {
        // 히스토리 스택에 상태 추가 — 뒤로 버튼 시 popstate 발생
        window.history.pushState({ voaArticle: true }, '');
        selectedArticleRef.current = article;
        setSelectedArticle(article);
        setSentences([]);
        setExpandedIdx(null);
        setSavedSet(new Set());
        setArticleError('');
        setLoadingArticle(true);
        try {
            const res = await fetch(`${SERVER_URL}/api/voa-article?url=${encodeURIComponent(article.articleUrl)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setSentences(data.sentences || []);
            if (data.audioUrl) setSelectedArticle(prev => ({ ...prev, audioUrl: data.audioUrl || prev.audioUrl }));
        } catch {
            setArticleError(t('voa.articleLoadError'));
        } finally {
            setLoadingArticle(false);
        }
    };

    // < 버튼 — 히스토리도 함께 소비
    const handleBack = () => {
        selectedArticleRef.current = null;
        setSelectedArticle(null);
        setSentences([]);
        window.history.back();
    };

    const handleSave = async (sentence, idx) => {
        await onSaveToLibrary(sentence.text, selectedArticle?.title || '');
        setSavedSet(prev => new Set([...prev, idx]));
    };

    const playAudio = (url) => {
        if (!url) return;
        new Audio(url).play().catch(() => {});
    };

    const lc = LEVEL_COLORS[category] || LEVEL_COLORS.intermediate;

    return (
        <div className="voa-container">
            {/* 레벨 탭 */}
            <div className="voa-category-tabs">
                {CATEGORIES.map(cat => {
                    const color = LEVEL_COLORS[cat];
                    const isActive = category === cat;
                    return (
                        <button
                            key={cat}
                            className={`voa-cat-btn ${isActive ? 'active' : ''}`}
                            style={isActive ? {
                                background: color.bg,
                                borderColor: color.border,
                                color: color.text,
                            } : {}}
                            onClick={() => setCategory(cat)}
                        >
                            <span
                                className="voa-level-dot"
                                style={{ background: color.dot }}
                            />
                            {t(`voa.categories.${cat}`)}
                        </button>
                    );
                })}
            </div>

            {/* 기사 목록 */}
            {!selectedArticle && (
                <div className="voa-article-list">
                    {loadingList && (
                        <p className="voa-status-msg">
                            <RotateCcw size={16} className="spin" /> {t('voa.loading')}
                        </p>
                    )}
                    {listError && (
                        <p className="voa-error-msg"><AlertCircle size={16} /> {listError}</p>
                    )}
                    {!loadingList && articles.map(article => (
                        <div key={article.id} className="voa-article-card">
                            {/* 썸네일 이미지 */}
                            <div
                                className="voa-article-img"
                                style={article.imageUrl ? { backgroundImage: `url(${article.imageUrl})` } : {}}
                            >
                                {!article.imageUrl && (
                                    <div className="voa-img-placeholder">
                                        <span style={{ fontSize: 36 }}>📰</span>
                                    </div>
                                )}
                                <span
                                    className="voa-level-badge"
                                    style={{ background: lc.bg, color: lc.text }}
                                >
                                    {t(`voa.categories.${category}`)}
                                </span>
                            </div>

                            {/* 텍스트 영역 */}
                            <div className="voa-article-body">
                                <p className="voa-article-date">
                                    {article.pubDate ? new Date(article.pubDate).toLocaleDateString() : ''}
                                </p>
                                <h3 className="voa-article-title">{article.title}</h3>
                                {article.summary && (
                                    <p className="voa-article-summary">{article.summary}</p>
                                )}

                                <div className="voa-article-actions">
                                    {article.audioUrl && (
                                        <button
                                            className="voa-action-btn voa-listen-btn"
                                            onClick={() => playAudio(article.audioUrl)}
                                            title={t('voa.playAudio')}
                                        >
                                            <Volume2 size={15} />
                                        </button>
                                    )}
                                    {article.articleUrl && (
                                        <a
                                            className="voa-action-btn voa-link-btn"
                                            href={article.articleUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <ExternalLink size={13} /> {t('voa.openArticle')}
                                        </a>
                                    )}
                                    <button
                                        className="voa-action-btn voa-practice-btn"
                                        style={{ background: lc.border }}
                                        onClick={() => openArticle(article)}
                                    >
                                        <Mic size={13} /> {t('voa.practiceBtn')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 기사 본문 — 문장별 발음 연습 */}
            {selectedArticle && (
                <div className="voa-article-view">
                    <div className="voa-article-header">
                        <button className="voa-back-btn" onClick={handleBack}>
                            <ChevronLeft size={22} />
                        </button>
                        <h2 className="voa-article-heading">{selectedArticle.title}</h2>
                        {selectedArticle.audioUrl && (
                            <button
                                className="voa-audio-btn"
                                onClick={() => playAudio(selectedArticle.audioUrl)}
                                title={t('voa.playAudio')}
                            >
                                <Volume2 size={20} />
                            </button>
                        )}
                    </div>

                    {loadingArticle && (
                        <p className="voa-status-msg">
                            <RotateCcw size={16} className="spin" /> {t('voa.articleLoading')}
                        </p>
                    )}
                    {articleError && (
                        <p className="voa-error-msg"><AlertCircle size={16} /> {articleError}</p>
                    )}

                    <div className="voa-sentence-list">
                        {sentences.map((sentence, idx) => (
                            <div key={sentence.id} className="voa-sentence-item">
                                <div
                                    className={`voa-sentence-text ${expandedIdx === idx ? 'expanded' : ''}`}
                                    onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                                >
                                    <span className="voa-sentence-num">{idx + 1}</span>
                                    <span>{sentence.text}</span>
                                </div>
                                {expandedIdx === idx && (
                                    <SentencePracticeCard
                                        sentence={sentence}
                                        sourceLang={sourceLang}
                                        onTrialLimitReached={onTrialLimitReached}
                                        onSave={() => handleSave(sentence, idx)}
                                        isSaved={savedSet.has(idx)}
                                        t={t}
                                    />
                                )}
                            </div>
                        ))}
                        {!loadingArticle && sentences.length > 0 && (
                            <p className="voa-select-prompt">{t('voa.practicePrompt')}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
