import React, { useState, useRef } from 'react';
import { Mic, MicOff, RotateCcw, Star, AlertCircle } from 'lucide-react';
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
        /youtu\.be\/([^?]+)/,
        /youtube\.com\/embed\/([^?]+)/,
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
                <p className="ted-error-msg"><AlertCircle size={14} /> {errorMsg}</p>
            )}
        </div>
    );
}

export default function TedReader({ sourceLang, onTrialLimitReached, onSaveToLibrary }) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    const [urlInput, setUrlInput] = useState('');
    const [videoId, setVideoId] = useState(null);
    const [sentences, setSentences] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedIdx, setExpandedIdx] = useState(null);
    const [savedSet, setSavedSet] = useState(new Set());
    const inputRef = useRef(null);

    const handleLoad = async () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        const vid = extractVideoId(trimmed);
        if (!vid) { setError(t('ted.invalidUrl')); return; }

        setError('');
        setLoading(true);
        setSentences([]);
        setExpandedIdx(null);
        setSavedSet(new Set());
        setVideoId(vid);

        try {
            const res = await fetch(`${SERVER_URL}/api/youtube-transcript?url=${encodeURIComponent(trimmed)}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            const sents = data.sentences || [];
            setSentences(sents);
            if (sents.length > 0) setExpandedIdx(0);
            if (sents.length === 0) setError(t('ted.noTranscript'));
        } catch (err) {
            setError(t('ted.loadError'));
            console.error('[TED] transcript error:', err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (sentence, idx) => {
        playStarSound();
        await onSaveToLibrary(sentence.text, urlInput.trim());
        setSavedSet(prev => new Set([...prev, idx]));
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleLoad();
    };

    return (
        <div className="ted-container">
            {/* URL 입력 영역 */}
            <div className="ted-input-area">
                <input
                    ref={inputRef}
                    className="ted-url-input"
                    type="text"
                    placeholder={t('ted.placeholder')}
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                />
                <button
                    className="ted-load-btn"
                    onClick={handleLoad}
                    disabled={loading || !urlInput.trim()}
                >
                    {loading
                        ? <RotateCcw size={16} className="spin" />
                        : t('ted.loadBtn')
                    }
                </button>
            </div>

            {error && (
                <p className="ted-error-msg" style={{ margin: '8px 16px 0' }}>
                    <AlertCircle size={14} /> {error}
                </p>
            )}

            {/* YouTube 동영상 임베드 */}
            {videoId && (
                <div className="ted-video-wrapper">
                    <iframe
                        className="ted-iframe"
                        src={`https://www.youtube.com/embed/${videoId}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title="YouTube video"
                    />
                </div>
            )}

            {/* 로딩 */}
            {loading && (
                <p className="ted-status-msg">
                    <RotateCcw size={16} className="spin" /> {t('ted.loading')}
                </p>
            )}

            {/* 문장 목록 */}
            {sentences.length > 0 && (
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
                    <p className="ted-select-prompt">{t('ted.practicePrompt')}</p>
                </div>
            )}

            {/* 초기 안내 */}
            {!videoId && !loading && (
                <div className="ted-empty-state">
                    <span style={{ fontSize: 48 }}>🎬</span>
                    <p>{t('ted.emptyHint')}</p>
                </div>
            )}
        </div>
    );
}
