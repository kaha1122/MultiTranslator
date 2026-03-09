import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Award, ChevronLeft, Mic, MicOff, RotateCcw, Star, AlertCircle, ExternalLink } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useT } from '../utils/i18n';
import { playStarSound } from '../utils/soundEffects';
import PronunciationAssessment from './PronunciationAssessment';
import './VideoReader.css';
import AdBanner from './AdBanner';

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const CATEGORIES = ['news', 'culture', 'entertainment', 'sports'];

const CATEGORY_COLORS = {
    news:          { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6', dot: '#3b82f6' },
    culture:       { bg: '#ede9fe', text: '#5b21b6', border: '#7c3aed', dot: '#8b5cf6' },
    entertainment: { bg: '#fce7f3', text: '#9d174d', border: '#ec4899', dot: '#ec4899' },
    sports:        { bg: '#dcfce7', text: '#166534', border: '#16a34a', dot: '#22c55e' },
};

// Azure 발음 평가 지원 언어 (vi는 미지원)
const PRON_SUPPORTED = new Set(['en', 'ja', 'ko', 'zh-CN', 'fr', 'de', 'es']);

/**
 * SentencePracticeCard — 문장별 발음 연습 (VOA 패턴 재활용, langCode 동적)
 */
function SentencePracticeCard({ sentence, langCode, sourceLang, onTrialLimitReached, onSave, isSaved, t, onBookmarkPrompt, targetGoal = 80 }) {
    const pronSupported = PRON_SUPPORTED.has(langCode);
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(
        pronSupported ? sentence.text : '',
        pronSupported ? langCode : 'en',
        sourceLang,
        onTrialLimitReached
    );

    // 발음 점수가 목표에 도달하면 북마크 유도 팝업
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
        <div className="vid-sentence-practice">
            {assessmentResult && (
                <>
                    <div className="score-badge">
                        <Award size={12} /> {assessmentResult.pronunciationScore}Pt
                    </div>
                    <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />
                </>
            )}

            {coachTip && (
                <div className="vid-coach-tip">💡 {coachTip}</div>
            )}

            <div className="vid-practice-actions">
                <div className="vid-practice-left">
                    {isRecording && (
                        <p className="vid-recording-status">{t('card.recording')}</p>
                    )}
                    {isAnalyzing && (
                        <p className="vid-analyzing-status">{t('card.analyzing')}</p>
                    )}
                    {pronSupported ? (
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
                    ) : (
                        <p className="vid-pron-unsupported">{t('video.pronUnsupported')}</p>
                    )}
                </div>

                <button
                    className={`vid-bookmark-btn ${isSaved ? 'saved' : ''}`}
                    onClick={() => { playStarSound(); onSave(assessmentResult?.pronunciationScore ?? null); }}
                    disabled={isSaved}
                    title={isSaved ? t('video.savedToLibrary') : t('video.saveToLibrary')}
                >
                    <Star size={26} color={isSaved ? '#facc15' : '#94a3b8'} fill={isSaved ? '#facc15' : 'none'} />
                </button>
            </div>

            {errorMsg && (
                <p className="vid-error-msg"><AlertCircle size={14} /> {errorMsg}</p>
            )}
        </div>
    );
}

/**
 * VideoReader — 다국어 YouTube 동영상 학습 탭
 */
const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'zh-CN', name: '中文' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
    { code: 'vi', name: 'Tiếng Việt' },
];

export default function VideoReader({ sourceLang, onTrialLimitReached, onSaveToLibrary, onBookmarkPrompt, languageGoals = {} }) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    const [targetLang, setTargetLang] = useState('en');
    const [category, setCategory]     = useState('news');
    const [videos, setVideos]         = useState([]);
    const [loadingVideos, setLoadingVideos] = useState(true);
    const [videosError, setVideosError]     = useState('');

    const [selected, setSelected]           = useState(null);
    const [sentences, setSentences]         = useState([]);
    const [loadingSentences, setLoadingSentences] = useState(false);
    const [sentenceError, setSentenceError] = useState('');
    const [expandedIdx, setExpandedIdx]     = useState(null);
    const [savedSet, setSavedSet]           = useState(new Set());

    const selectedRef = useRef(null);

    // 영상 목록 fetch
    const fetchVideos = useCallback(async (lang, cat) => {
        setLoadingVideos(true);
        setVideosError('');
        setSelected(null);
        selectedRef.current = null;
        setSentences([]);
        setExpandedIdx(null);
        try {
            const res = await fetch(`${SERVER_URL}/api/video-feed?lang=${lang}&category=${cat}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setVideos(data.videos || []);
        } catch {
            setVideosError(t('video.loadError'));
        } finally {
            setLoadingVideos(false);
        }
    }, [SERVER_URL, t]);

    useEffect(() => { fetchVideos(targetLang, category); }, [targetLang, category, fetchVideos]);

    // 하드웨어 뒤로 버튼
    useEffect(() => {
        const handlePop = () => {
            if (selectedRef.current) {
                selectedRef.current = null;
                setSelected(null);
                setSentences([]);
            }
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, []);

    // 영상 선택 → 자막 로드
    const openVideo = async (video) => {
        window.history.pushState({ video: true }, '');
        selectedRef.current = video;
        setSelected(video);
        setSentences([]);
        setExpandedIdx(null);
        setSavedSet(new Set());
        setSentenceError('');
        setLoadingSentences(true);
        try {
            const url = `https://www.youtube.com/watch?v=${video.videoId}`;
            const res = await fetch(`${SERVER_URL}/api/youtube-transcript?url=${encodeURIComponent(url)}&lang=${targetLang}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setSentences(data.sentences || []);
            if ((data.sentences || []).length > 0) setExpandedIdx(0);
        } catch {
            setSentenceError(t('video.transcriptError'));
        } finally {
            setLoadingSentences(false);
        }
    };

    const handleBack = () => {
        selectedRef.current = null;
        setSelected(null);
        setSentences([]);
        window.history.back();
    };

    const handleSave = async (sentence, idx, pronunciationScore = null) => {
        await onSaveToLibrary(sentence.text, selected?.title || '', targetLang, pronunciationScore);
        setSavedSet(prev => new Set([...prev, idx]));
    };

    const cc = CATEGORY_COLORS[category] || CATEGORY_COLORS.news;

    return (
        <div className="vid-container">
            {/* Target Language 선택 */}
            <div className="vid-lang-selector">
                {SUPPORTED_LANGUAGES.map(lang => (
                    <button
                        key={lang.code}
                        className={`vid-lang-pill ${targetLang === lang.code ? 'active' : ''}`}
                        onClick={() => setTargetLang(lang.code)}
                    >
                        {lang.name}
                    </button>
                ))}
            </div>

            {/* 카테고리 탭 */}
            {!selected && (
                <div className="vid-category-tabs">
                    {CATEGORIES.map(cat => {
                        const color = CATEGORY_COLORS[cat];
                        const isActive = category === cat;
                        return (
                            <button
                                key={cat}
                                className={`vid-cat-btn ${isActive ? 'active' : ''}`}
                                style={isActive ? {
                                    background: color.bg,
                                    borderColor: color.border,
                                    color: color.text,
                                } : {}}
                                onClick={() => setCategory(cat)}
                            >
                                <span className="vid-cat-dot" style={{ background: color.dot }} />
                                {t(`video.categories.${cat}`)}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* 영상 목록 */}
            {!selected && (
                <div
                    className="vid-video-list"
                    style={{ opacity: loadingVideos ? 0.4 : 1, transition: 'opacity 0.25s' }}
                >
                    {loadingVideos && videos.length === 0 && (
                        <p className="vid-status-msg">
                            <RotateCcw size={16} className="spin" /> {t('video.loading')}
                        </p>
                    )}
                    {videosError && (
                        <p className="vid-error-msg"><AlertCircle size={16} /> {videosError}</p>
                    )}

                    {videos.map(video => (
                        <div
                            key={video.id}
                            className="vid-video-card"
                            onClick={() => openVideo(video)}
                        >
                            <div
                                className="vid-thumbnail"
                                style={{ backgroundImage: `url(${video.thumbnail})` }}
                            >
                                <span
                                    className="vid-channel-badge"
                                    style={{ background: cc.border }}
                                >
                                    {video.channelTitle}
                                </span>
                                <div className="vid-play-overlay">
                                    <div className="vid-play-icon">▶</div>
                                </div>
                            </div>
                            <div className="vid-card-body">
                                <h3 className="vid-card-title">{video.title}</h3>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 영상 상세 뷰 */}
            {selected && (
                <div className="vid-detail-view">
                    <div className="vid-detail-header">
                        <button className="vid-back-btn" onClick={handleBack}>
                            <ChevronLeft size={22} />
                        </button>
                        <h2 className="vid-detail-heading">{selected.title || 'YouTube'}</h2>
                        <a
                            className="vid-yt-link"
                            href={`https://www.youtube.com/watch?v=${selected.videoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <ExternalLink size={18} />
                        </a>
                    </div>

                    {/* YouTube 플레이어 */}
                    <div className="vid-video-wrapper">
                        <iframe
                            className="vid-iframe"
                            src={`https://www.youtube.com/embed/${selected.videoId}?cc_load_policy=1&hl=${targetLang}&rel=0`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                            allowFullScreen
                            title={selected.title || 'YouTube'}
                        />
                    </div>

                    {/* 자막 문장 리스트 */}
                    {loadingSentences && (
                        <p className="vid-status-msg">
                            <RotateCcw size={16} className="spin" /> {t('video.transcriptLoading')}
                        </p>
                    )}
                    {sentenceError && (
                        <p className="vid-error-msg" style={{ margin: '8px 16px' }}>
                            <AlertCircle size={14} /> {sentenceError}
                        </p>
                    )}
                    {!loadingSentences && sentences.length === 0 && !sentenceError && (
                        <p className="vid-status-msg" style={{ color: '#94a3b8' }}>
                            {t('video.noTranscript')}
                        </p>
                    )}

                    <div className="vid-sentence-list">
                        {sentences.map((sentence, idx) => (
                            <div key={sentence.id} className="vid-sentence-item">
                                <div
                                    className={`vid-sentence-text ${expandedIdx === idx ? 'expanded' : ''}`}
                                    onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                                >
                                    <span className="vid-sentence-num">{idx + 1}</span>
                                    <span>{sentence.text}</span>
                                </div>
                                {expandedIdx === idx && (
                                    <SentencePracticeCard
                                        sentence={sentence}
                                        langCode={targetLang}
                                        sourceLang={sourceLang}
                                        onTrialLimitReached={onTrialLimitReached}
                                        onSave={(score) => handleSave(sentence, idx, score)}
                                        isSaved={savedSet.has(idx)}
                                        t={t}
                                        onBookmarkPrompt={onBookmarkPrompt}
                                        targetGoal={languageGoals[targetLang] || 80}
                                    />
                                )}
                            </div>
                        ))}
                        {!loadingSentences && sentences.length > 0 && (
                            <p className="vid-select-prompt">{t('video.practicePrompt')}</p>
                        )}
                        <AdBanner slot="TODO" style={{ margin: '16px 0 8px' }} />
                    </div>
                </div>
            )}
        </div>
    );
}
