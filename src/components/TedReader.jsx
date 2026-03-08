import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, RotateCcw, AlertCircle, ExternalLink } from 'lucide-react';
import { useT } from '../utils/i18n';
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

// YouTube RSS를 클라이언트에서 직접 파싱 (Render 서버 IP 차단 우회)
const TED_CHANNEL_ID = 'UCsooa4yRKGN_zEE8iknghZA';
const TED_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${TED_CHANNEL_ID}`;

async function fetchTedVideosDirect() {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(TED_RSS_URL)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const entries = Array.from(doc.querySelectorAll('entry'));
    return entries.map(entry => {
        const vid =
            entry.getElementsByTagNameNS('http://www.youtube.com/xml/schemas/2015', 'videoId')[0]?.textContent
            || extractVideoId(entry.querySelector('link')?.getAttribute('href') || '');
        if (!vid) return null;
        return {
            id: vid,
            title: entry.querySelector('title')?.textContent || '',
            videoId: vid,
            url: `https://www.youtube.com/watch?v=${vid}`,
            thumbnail: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
        };
    }).filter(Boolean);
}

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

export default function TedReader({ sourceLang }) {
    const t = useT(sourceLang);
    const SERVER_URL = getServerUrl();

    // 목록 상태
    const [videos, setVideos] = useState([]);
    const [loadingVideos, setLoadingVideos] = useState(true);
    const [videosError, setVideosError] = useState('');

    // URL 입력
    const [urlInput, setUrlInput] = useState('');

    // 선택된 영상
    const [selected, setSelected] = useState(null); // { videoId, title, url }
    const selectedRef = useRef(null);

    // TED 채널 최신 영상 로드 — 백엔드 우선, 실패 시 클라이언트 직접 fetch
    useEffect(() => {
        (async () => {
            setLoadingVideos(true);
            setVideosError('');
            try {
                // 1차: 백엔드 서버
                const res = await fetch(`${SERVER_URL}/api/ted-videos`,
                    { signal: AbortSignal.timeout(8000) }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if ((data.videos || []).length > 0) {
                    setVideos(data.videos);
                    return;
                }
                throw new Error('empty');
            } catch {
                // 2차: 클라이언트 직접 fetch (CORS 프록시)
                try {
                    const videos = await fetchTedVideosDirect();
                    setVideos(videos);
                } catch {
                    setVideosError(t('ted.videosError'));
                }
            } finally {
                setLoadingVideos(false);
            }
        })();
    }, [SERVER_URL, t]);

    // 하드웨어 뒤로 버튼
    useEffect(() => {
        const handlePop = () => {
            if (selectedRef.current) {
                selectedRef.current = null;
                setSelected(null);
            }
        };
        window.addEventListener('popstate', handlePop);
        return () => window.removeEventListener('popstate', handlePop);
    }, []);

    const openVideo = (videoInfo) => {
        window.history.pushState({ tedVideo: true }, '');
        selectedRef.current = videoInfo;
        setSelected(videoInfo);
    };

    const handleUrlLoad = () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        const vid = extractVideoId(trimmed);
        if (!vid) return;
        openVideo({ videoId: vid, title: '', url: trimmed });
    };

    const handleBack = () => {
        selectedRef.current = null;
        setSelected(null);
        window.history.back();
    };

    // ── 영상 상세 뷰 (플레이어)
    if (selected) {
        return (
            <div className="ted-container">
                <div className="ted-article-header">
                    <button className="ted-back-btn" onClick={handleBack}>
                        <ChevronLeft size={22} />
                    </button>
                    <h2 className="ted-article-heading">
                        {selected.title || 'YouTube'}
                    </h2>
                    {selected.url && (
                        <a
                            className="ted-yt-link-btn"
                            href={selected.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="YouTube에서 열기"
                        >
                            <ExternalLink size={18} />
                        </a>
                    )}
                </div>

                {/* YouTube iframe — cc_load_policy=1 로 CC 자막 자동 활성화 */}
                <div className="ted-video-wrapper">
                    <iframe
                        className="ted-iframe"
                        src={`https://www.youtube.com/embed/${selected.videoId}?cc_load_policy=1&hl=en&rel=0`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        allowFullScreen
                        title={selected.title || 'YouTube'}
                    />
                </div>

                {/* 안내 문구 */}
                <div className="ted-watch-hint">
                    <span>💬</span>
                    <p>{t('ted.watchHint')}</p>
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

                {/* 섹션 제목 */}
                {!loadingVideos && videos.length > 0 && (
                    <p className="ted-section-title">{t('ted.sectionTitle')}</p>
                )}

                {videos.map(video => (
                    <div
                        key={video.id}
                        className="ted-video-card"
                        onClick={() => openVideo(video)}
                    >
                        <div
                            className="ted-thumbnail"
                            style={{ backgroundImage: `url(${video.thumbnail})` }}
                        >
                            <span className="ted-channel-badge">TED</span>
                            <div className="ted-play-overlay">
                                <div className="ted-play-icon">▶</div>
                            </div>
                        </div>
                        <div className="ted-card-body">
                            <h3 className="ted-card-title">{video.title}</h3>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
