import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { ChevronLeft, RotateCcw, AlertCircle, ExternalLink, Send } from 'lucide-react';
import { useT, getT } from '../utils/i18n';
import { ALL_LANGUAGES, SUPPORTED_LANGUAGES, EXTRA_LANGUAGES } from '../config/languages';
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

// 언어 목록은 config/languages.js에서 ALL_LANGUAGES로 import

/**
 * VideoReader — 다국어 YouTube 동영상 학습 탭
 *
 * [2026-03-09] 자막/transcript 기능 제거 결정:
 * YouTube는 서버 IP(Render 등 클라우드)에서의 자막 크롤링을 봇 감지로 차단함.
 * youtubei.js, youtube-transcript 등 모든 npm 패키지가 서버 환경에서 작동 불가.
 * YouTube Data API captions.download는 OAuth 필요(영상 소유자만 가능).
 * 앱 안정성을 위해 자막 기능 대신 메모 → 번역 탭 연동으로 대체.
 */
function VideoReader({
    sourceLang, onTrialLimitReached, onSaveToLibrary, onBookmarkPrompt,
    languageGoals = {}, targetLangs = [], onSendToTranslation, onDetailChange,
}, ref) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    // Settings에서 설정한 학습 언어만 표시
    const visibleLanguages = ALL_LANGUAGES.filter(
        lang => targetLangs.includes(lang.code)
    );

    // Settings의 targetLangs 첫 번째 값으로 초기화, 없으면 'en'
    const [targetLang, setTargetLang] = useState(() => {
        if (targetLangs.length > 0) return targetLangs[0];
        return 'en';
    });
    // targetLangs가 변경되면 현재 선택이 유효한지 확인
    useEffect(() => {
        if (targetLangs.length > 0 && !targetLangs.includes(targetLang)) {
            setTargetLang(targetLangs[0]);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    const [category, setCategory]     = useState('news');
    const [videos, setVideos]         = useState([]);
    const [loadingVideos, setLoadingVideos] = useState(true);
    const [videosError, setVideosError]     = useState('');

    const [selected, setSelected]     = useState(null);
    const [memo, setMemo]             = useState('');

    const selectedRef = useRef(null);

    useImperativeHandle(ref, () => ({
        isDetailOpen: () => !!selectedRef.current,
        closeDetail: () => { selectedRef.current = null; setSelected(null); onDetailChange?.(false); },
    }));

    // 영상 목록 fetch
    const fetchVideos = useCallback(async (lang, cat) => {
        setLoadingVideos(true);
        setVideosError('');
        setSelected(null);
        selectedRef.current = null;
        onDetailChange?.(false);
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

    // 영상 선택 → 자동 재생
    const openVideo = (video) => {
        selectedRef.current = video;
        setSelected(video);
        setMemo('');
        onDetailChange?.(true);
    };

    const handleBack = () => {
        selectedRef.current = null;
        setSelected(null);
        onDetailChange?.(false);
    };

    // 메모를 번역 탭으로 전송 (자동 번역 포함, 영상 언어도 전달)
    const handleSendToTranslation = () => {
        if (!memo.trim()) return;
        onSendToTranslation?.(memo.trim(), targetLang);
    };

    const cc = CATEGORY_COLORS[category] || CATEGORY_COLORS.news;

    return (
        <div className="vid-container">
            {/* Target Language 선택 */}
            <div className="vid-lang-selector">
                {visibleLanguages.map(lang => (
                    <button
                        key={lang.code}
                        className={`vid-lang-pill ${targetLang === lang.code ? 'active' : ''}`}
                        onClick={() => setTargetLang(lang.code)}
                    >
                        {getT(sourceLang, `langNames.${lang.code}`) || lang.name}
                    </button>
                ))}
            </div>

            {/* 기타 언어 동영상 미지원 안내 */}
            {EXTRA_LANGUAGES.some(l => l.code === targetLang) && (
                <div style={{
                    padding: '12px 16px', margin: '8px 0', borderRadius: '10px',
                    background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e',
                    fontSize: '0.83rem', fontWeight: 500, textAlign: 'center',
                }}>
                    {t('video.extraLangNotSupported') || '기타 언어는 동영상이 제공되지 않습니다.'}
                </div>
            )}

            {/* 카테고리 탭 */}
            {!selected && !EXTRA_LANGUAGES.some(l => l.code === targetLang) && (
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

                    {/* YouTube 플레이어 (autoplay) */}
                    <div className="vid-video-wrapper">
                        <iframe
                            className="vid-iframe"
                            src={`https://www.youtube.com/embed/${selected.videoId}?cc_load_policy=1&hl=${targetLang}&rel=0&autoplay=1`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                            allowFullScreen
                            title={selected.title || 'YouTube'}
                        />
                    </div>

                    {/* 메모 + 번역 전송 */}
                    <div className="vid-memo-section">
                        <textarea
                            className="vid-memo-textarea"
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder={t('video.memoPlaceholder')}
                            rows={6}
                        />
                        <button
                            className="vid-translate-btn"
                            onClick={handleSendToTranslation}
                            disabled={!memo.trim()}
                        >
                            <Send size={18} />
                            {t('video.sendToTranslation')}
                        </button>
                    </div>

                    <AdBanner slot="TODO" style={{ margin: '16px 16px 8px' }} />
                </div>
            )}
        </div>
    );
}

export default forwardRef(VideoReader);
