import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Mic, MicOff, RotateCcw, Star, AlertCircle } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useT } from '../utils/i18n';
import { playStarSound } from '../utils/soundEffects';
import PronunciationAssessment from './PronunciationAssessment';
import './TedReader.css';

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

function extractVideoId(url) {
    const patterns = [
        /[?&]v=([^&]+)/,
        /youtu\.be\/([^?&]+)/,
        /youtube\.com\/embed\/([^?&]+)/,
        /youtube\.com\/shorts\/([^?&]+)/,
    ];
    for (const p of patterns) {
        const m = (url || '').match(p);
        if (m) return m[1];
    }
    return null;
}

function SentencePracticeCard({ sentence, sourceLang, onTrialLimitReached, onSave, isSaved, t }) {
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(sentence.text, 'en', sourceLang, onTrialLimitReached);

    return (
        <div className="ted-sentence-practice">
            {assessmentResult && (
                <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />
            )}
            {coachTip && (
                <div className="ted-coach-tip">💡 {coachTip}</div>
            )}
            <div className="ted-practice-actions">
                <div className="ted-practice-left">
                    {isRecording && <p className="ted-recording-status">{t('card.recording')}</p>}
                    {isAnalyzing && <p className="ted-analyzing-status">{t('card.analyzing')}</p>}
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
                <button
                    className={`ted-bookmark-btn ${isSaved ? 'saved' : ''}`}
                    onClick={onSave}
                    disabled={isSaved}
                    title={isSaved ? t('ted.savedToLibrary') : t('ted.saveToLibrary')}
                >
                    <Star size={26} fill={isSaved ? '#facc15' : 'none'} />
                </button>
            </div>
            {errorMsg && (
                <p className="ted-error-inline"><AlertCircle size={14} /> {errorMsg}</p>
            )}
        </div>
    );
}

export default function TedReader({ sourceLang, onTrialLimitReached, onSaveToLibrary }) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    // ── 목록 상태
    const [videos, setVideos] = useState([]);
    const [loadingVideos, setLoadingVideos] = useState(true);
    const [videosError, setVideosError] = useState('');

    // ── URL 입력
    const [urlInput, setUrlInput] = useState('');

    // ── 선택된 영상 (null = 목록 뷰)
    const [selected, setSelected] = useState(null); // { videoId, title, url }
    const selectedRef = useRef(null);

    // ── 자막 상태
    const [sentences, setSentences] = useState([]);
    const [loadingSentences, setLoadingSentences] = useState(false);
    const [transcriptError, setTranscriptError] = useState('');
    const [expandedIdx, setExpandedIdx] = useState(null);
    const [savedSet, setSavedSet] = useState(new Set());

    // TED 채널 최신 영상 로드
    useEffect(() => {
        (async () => {
            setLoadingVideos(true);
            setVideosError('');
            try {
                const res = await fetch(`${SERVER_URL}/api/ted-videos`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setVideos(data.videos || []);
            } catch {
                setVideosError(t('ted.videosError'));
            } finally {
                setLoadingVideos(false);
            }
        })();
    }, [SERVER_URL, t]);

    // 뒤로가기 (하드웨어 버튼)
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

    const loadTranscript = async (videoUrl, videoInfo) => {
        const vid = extractVideoId(videoUrl);
        if (!vid) { setTranscriptError(t('ted.invalidUrl')); return; }

        window.history.pushState({ tedVideo: true }, '');
        const info = videoInfo || { videoId: vid, title: videoUrl, url: videoUrl };
        selectedRef.current = info;
        setSelected(info);
        setSentences([]);
        setExpandedIdx(null);
        setSavedSet(new Set());
        setTranscriptError('');
        setLoadingSentences(true);

        try {
            const res = await fetch(`${SERVER_URL}/api/youtube-transcript?url=${encodeURIComponent(videoUrl)}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const sents = data.sentences || [];
            setSentences(sents);
            if (sents.length > 0) setExpandedIdx(0);
            if (sents.length === 0) setTranscriptError(t('ted.noTranscript'));
        } catch (err) {
            setTranscriptError(t('ted.loadError'));
            console.error('[TED] transcript error:', err.message);
        } finally {
            setLoadingSentences(false);
        }
    };

    const handleBack = () => {
        selectedRef.current = null;
        setSelected(null);
        setSentences([]);
        setTranscriptError('');
        window.history.back();
    };

    const handleUrlLoad = () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        loadTranscript(trimmed);
    };

    const handleSave = async (sentence, idx) => {
        playStarSound();
        await onSaveToLibrary(sentence.text, selected?.url || urlInput.trim());
        setSavedSet(prev => new Set([...prev, idx]));
    };

    // ── 영상 상세 뷰
    if (selected) {
        return (
            <div className="ted-container">
                <div className="ted-article-header">
                    <button className="ted-back-btn" onClick={handleBack}>
                        <ChevronLeft size={22} />
                    </button>
                    <h2 className="ted-article-heading">{selected.title}</h2>
                </div>

                {/* YouTube iframe */}
                <div className="ted-video-wrapper">
                    <iframe
                        className="ted-iframe"
                        src={`https://www.youtube.com/embed/${selected.videoId}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title={selected.title}
                    />
                </div>

                {loadingSentences && (
                    <p className="ted-status-msg">
                        <RotateCcw size={16} className="spin" /> {t('ted.loading')}
                    </p>
                )}
                {transcriptError && (
                    <p className="ted-error-msg" style={{ margin: '8px 16px' }}>
                        <AlertCircle size={14} /> {transcriptError}
                    </p>
                )}

                <div className="ted-sentence-list">
                    {sentences.map((sentence, idx) => (
                        <div key={sentence.id} className="ted-sentence-item">
                            <div
                                className={`ted-sentence-text ${expandedIdx === idx ? 'expanded' : ''}`}
                                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                            >
                                <span className="ted-sentence-num">{idx + 1}</span>
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
                    {!loadingSentences && sentences.length > 0 && (
                        <p className="ted-select-prompt">{t('ted.practicePrompt')}</p>
                    )}
                </div>
            </div>
        );
    }

    // ── 목록 뷰
    return (
        <div className="ted-container">
            {/* URL 직접 입력 */}
            <div className="ted-input-area">
                <input
                    className="ted-url-input"
                    type="text"
                    placeholder={t('ted.placeholder')}
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUrlLoad()}
                />
                <button
                    className="ted-load-btn"
                    onClick={handleUrlLoad}
                    disabled={!urlInput.trim()}
                >
                    {t('ted.loadBtn')}
                </button>
            </div>

            {/* TED 채널 최신 영상 */}
            <div
                className="ted-video-list"
                style={{ opacity: loadingVideos ? 0.4 : 1, transition: 'opacity 0.25s' }}
            >
                {loadingVideos && videos.length === 0 && (
                    <p className="ted-status-msg">
                        <RotateCcw size={16} className="spin" /> {t('ted.loadingVideos')}
                    </p>
                )}
                {videosError && (
                    <p className="ted-error-msg" style={{ margin: '8px 16px' }}>
                        <AlertCircle size={14} /> {videosError}
                    </p>
                )}
                {videos.map(video => (
                    <div key={video.id} className="ted-video-card">
                        <div
                            className="ted-thumbnail"
                            style={{ backgroundImage: `url(${video.thumbnail})` }}
                        >
                            <span className="ted-channel-badge">TED</span>
                        </div>
                        <div className="ted-card-body">
                            <h3 className="ted-card-title">{video.title}</h3>
                            <div className="ted-card-actions">
                                <a
                                    className="ted-action-btn ted-yt-btn"
                                    href={video.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    YouTube
                                </a>
                                <button
                                    className="ted-action-btn ted-practice-btn"
                                    onClick={() => loadTranscript(video.url, video)}
                                >
                                    <Mic size={13} /> {t('voa.practiceBtn')}
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
