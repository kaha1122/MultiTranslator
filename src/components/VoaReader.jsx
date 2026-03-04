import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, Volume2, Mic, Square, Bookmark, BookmarkCheck, Loader, AlertCircle } from 'lucide-react';
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

const CATEGORIES = ['all', 'health', 'science', 'business', 'stories'];

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
 * VoaReader — VOA Learning English 발음 연습 탭
 * Props:
 *   sourceLang        — 사용자 UI 언어 (에러 메시지, 코치팁 언어)
 *   onTrialLimitReached — Trial 한도 초과 시 모달 표시 콜백
 *   onSaveToLibrary   — (sentenceText, articleTitle) → Library에 저장
 */
export default function VoaReader({ sourceLang, onTrialLimitReached, onSaveToLibrary }) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    const [category, setCategory]               = useState('all');
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

    return (
        <div className="voa-container">
            {/* 카테고리 탭 */}
            <div className="voa-category-tabs">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat}
                        className={`voa-cat-btn ${category === cat ? 'active' : ''}`}
                        onClick={() => setCategory(cat)}
                    >
                        {t(`voa.categories.${cat}`)}
                    </button>
                ))}
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
                        <div key={article.id} className="voa-article-card" onClick={() => openArticle(article)}>
                            <div className="voa-article-info">
                                <p className="voa-article-title">{article.title}</p>
                                <p className="voa-article-date">
                                    {article.pubDate ? new Date(article.pubDate).toLocaleDateString() : ''}
                                </p>
                            </div>
                            {article.audioUrl && (
                                <button
                                    className="voa-audio-btn"
                                    onClick={e => { e.stopPropagation(); playAudio(article.audioUrl); }}
                                    title={t('voa.playAudio')}
                                >
                                    <Volume2 size={18} />
                                </button>
                            )}
                        </div>
                    ))}
                    {!loadingList && !listError && articles.length > 0 && (
                        <p className="voa-select-prompt">{t('voa.selectPrompt')}</p>
                    )}
                </div>
            )}

            {/* 기사 본문 */}
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
