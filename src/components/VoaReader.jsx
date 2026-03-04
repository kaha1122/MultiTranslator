import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Volume2, Mic, Square, Bookmark, BookmarkCheck, Loader, AlertCircle, ExternalLink } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useT } from '../utils/i18n';
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
 * hooks는 루프 안에서 사용 불가이므로 별도 컴포넌트로 분리합니다.
 */
function SentencePracticeCard({ sentence, sourceLang, onTrialLimitReached, onSave, isSaved, t }) {
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(sentence.text, 'en', sourceLang, onTrialLimitReached);

    const score = assessmentResult?.pronunciationScore;

    return (
        <div className="voa-sentence-practice">
            <div className="voa-sentence-actions">
                {!isRecording && !isAnalyzing && (
                    <button className="voa-record-btn" onClick={startRecording} title="Record">
                        <Mic size={18} />
                    </button>
                )}
                {isRecording && (
                    <button className="voa-stop-btn" onClick={stopRecording} title="Stop">
                        <Square size={18} />
                    </button>
                )}
                {isAnalyzing && (
                    <span className="voa-analyzing">
                        <Loader size={16} className="voa-spin" /> {t('card.analyzing')}
                    </span>
                )}
                <button
                    className={`voa-save-btn ${isSaved ? 'saved' : ''}`}
                    onClick={onSave}
                    disabled={isSaved}
                    title={isSaved ? t('voa.savedToLibrary') : t('voa.saveToLibrary')}
                >
                    {isSaved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                </button>
            </div>

            {errorMsg && (
                <p className="voa-error-msg"><AlertCircle size={14} /> {errorMsg}</p>
            )}

            {score !== undefined && score !== null && (
                <div className="voa-score">
                    <span className={`voa-score-badge ${score >= 80 ? 'good' : score >= 60 ? 'ok' : 'poor'}`}>
                        {Math.round(score)}pt
                    </span>
                    <span className="voa-score-detail">
                        {t('scores.accuracy')} {Math.round(assessmentResult?.accuracyScore ?? 0)} &middot;{' '}
                        {t('scores.fluency')} {Math.round(assessmentResult?.fluencyScore ?? 0)}
                    </span>
                </div>
            )}

            {coachTip && <p className="voa-coach-tip">💡 {coachTip}</p>}
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

    // 기사 목록 fetch
    const fetchArticles = useCallback(async (cat) => {
        setLoadingList(true);
        setListError('');
        setSelectedArticle(null);
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

    // 기사 본문 fetch
    const openArticle = async (article) => {
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
                            <Loader size={16} className="voa-spin" /> {t('voa.loading')}
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
                        <button
                            className="voa-back-btn"
                            onClick={() => { setSelectedArticle(null); setSentences([]); }}
                        >
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
                            <Loader size={16} className="voa-spin" /> {t('voa.articleLoading')}
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
