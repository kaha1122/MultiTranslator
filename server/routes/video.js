const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// 언어별 × 카테고리별 큐레이션 채널 (공식 채널, 2026-03-09 검증 완료)
const CURATED_CHANNELS = {
    en: {
        news:          [{ id: 'UCupvZG-5ko_eiXAupbDfxWw', name: 'CNN' }, { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News' }],
        culture:       [{ id: 'UCpVm7bg6pXKo1Pr6k5kxG9A', name: 'National Geographic' }],
        entertainment: [{ id: 'UC8-Th83bH_thdKZDJCrn88g', name: 'The Tonight Show' }],
        sports:        [{ id: 'UCiWLfSweyRNmLpgEHekhoAg', name: 'ESPN' }],
    },
    ja: {
        news:          [{ id: 'UCGCZAYq5Xxojl_tSXcVJhiQ', name: 'ANNnewsCH' }],
        culture:       [{ id: 'UCJD2Br_xC-3vY4nkJ9YPYDA', name: 'Nippon TV' }],
        entertainment: [{ id: 'UCfgQFWzaw7HfaKN-uVIf73Q', name: 'ABEMA' }],
        sports:        [{ id: 'UCWc-XpFHPK1SwGcvpFPZ8NA', name: 'Jリーグ公式' }],
    },
    ko: {
        news:          [{ id: 'UCcQTRi69dsVYHN3exePtZ1A', name: 'KBS News' }],
        culture:       [{ id: 'UCFCtZJTuJhE18k8IXwmXTYQ', name: 'EBSDocumentary' }],
        entertainment: [{ id: 'UCmjNKt6kITwaZTqvWuaSPLg', name: 'SBS Entertainment' }],
        sports:        [{ id: 'UCtm_QoN2SIxwCE-59shX7Qg', name: 'SPOTV' }],
    },
    'zh-CN': {
        news:          [{ id: 'UCcLK3j-XWdGBnt5bR9NJHaQ', name: 'CCTV' }],
        culture:       [{ id: 'UCulFhrW_YCwkq_BP16C82mA', name: '一条Yit' }],
        entertainment: [{ id: 'UC1pHFqCMAIHP8gr4lYGtNLA', name: 'MangoTV 芒果TV' }],
        sports:        [{ id: 'UC09IvZwjpunzrdHH1EHok-w', name: '央视体育' }],
    },
    fr: {
        news:          [{ id: 'UCCCPCZNChQdGa9EkATeye4g', name: 'FRANCE 24' }],
        culture:       [{ id: 'UCwI-JbGNsojunnHbFAc0M4Q', name: 'ARTE' }],
        entertainment: [{ id: 'UCh4o9ioiqbUveUrCLP8Wv6A', name: 'france tv' }],
        sports:        [{ id: 'UCyIV8rkza5Uk_sJIhqilBvQ', name: "L'ÉQUIPE" }],
    },
    de: {
        news:          [{ id: 'UC5NOEUbkLheQcaaRldYW5GA', name: 'tagesschau' }],
        culture:       [{ id: 'UCMIgOXM2JEQ2Pv2d0_PVfcg', name: 'DW Deutsch' }],
        entertainment: [{ id: 'UCeqKIgPQfNInOswGRWt48kQ', name: 'ZDFheute' }],
        sports:        [{ id: 'UC6UL29enLNe4mqwTfAyeNuw', name: 'Bundesliga' }],
    },
    es: {
        news:          [{ id: 'UC7QZIf0dta-XPXsp9Hv4dTw', name: 'RTVE Noticias' }],
        culture:       [{ id: 'UCT4Jg8h03dD0iN3Pb5L0PMA', name: 'DW Español' }],
        entertainment: [{ id: 'UCA7a5OB6RYTvoQr-1gOkfKQ', name: 'Atresmedia' }],
        sports:        [{ id: 'UCTv-XvfzLX3i4IGWAm4sbmA', name: 'LaLiga' }],
    },
    vi: {
        news:          [{ id: 'UCabsTV34JwALXKGMqHpvUiA', name: 'VTV24' }],
        culture:       [{ id: 'UCuJ5k3GndbHnXLYyiIR6Z8Q', name: 'VTV Giải Trí' }],
        entertainment: [{ id: 'UCruaM4824Rr_ry7fsD5Jwag', name: 'THVL Giải Trí' }],
        sports:        [{ id: 'UCrI4iNMPZ2vT_G-TqRO6yrw', name: 'VTV Thể Thao' }],
    },
    'pt-BR': {
        news:          [{ id: 'UC-6xqzMBF2CXTImn_a4aCVg', name: 'Jornal O Globo' }],
        culture:       [{ id: 'UCKHhA5hN2UohhFDfNXB_cvQ', name: 'Manual do Mundo' }],
        entertainment: [{ id: 'UCEWHPFNilsT0IfQfutVzsag', name: 'Porta dos Fundos' }],
        sports:        [{ id: 'UCZiYbVptd3PVPf4f6eR6UaQ', name: 'CazéTV' }],
    },
};

// UC → UU 변환 (채널 업로드 재생목록)
function channelToUploads(channelId) {
    return channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : channelId;
}

// 메모리 캐시 — 당일 자정까지 유지
const videoCache = new Map();

function getDailySeed() {
    const d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function getVideoCached(key) {
    const entry = videoCache.get(key);
    if (!entry) return null;
    if (entry.dateSeed !== getDailySeed()) { videoCache.delete(key); return null; }
    return entry.data;
}

// GET /api/video-feed?lang=en&category=news
router.get('/api/video-feed', requireAuth, rateLimit('video-feed', { perMinute: 30, perHour: 200 }), async (req, res) => {
    const lang = req.query.lang || 'en';
    const category = req.query.category || 'news';

    const channels = CURATED_CHANNELS[lang]?.[category];
    if (!channels?.length) {
        return res.status(400).json({ error: `No channels for lang=${lang}, category=${category}` });
    }
    if (!YOUTUBE_API_KEY) {
        return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
    }

    const cacheKey = `video:${lang}:${category}`;
    const cached = getVideoCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const allVideos = [];
        for (const ch of channels) {
            try {
                const playlistId = channelToUploads(ch.id);
                const { data } = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
                    params: {
                        part: 'snippet',
                        playlistId,
                        maxResults: 10,
                        key: YOUTUBE_API_KEY,
                    },
                    timeout: 10000,
                });
                const items = (data.items || []).map(item => ({
                    id: item.snippet.resourceId.videoId,
                    videoId: item.snippet.resourceId.videoId,
                    title: item.snippet.title,
                    thumbnail: item.snippet.thumbnails?.medium?.url
                        || item.snippet.thumbnails?.default?.url
                        || `https://i.ytimg.com/vi/${item.snippet.resourceId.videoId}/mqdefault.jpg`,
                    channelTitle: ch.name,
                    publishedAt: item.snippet.publishedAt,
                }));
                allVideos.push(...items);
            } catch (chErr) {
                console.warn(`[VideoFeed] Channel ${ch.name} (${ch.id}) failed:`, chErr.message);
            }
        }

        allVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        const videos = allVideos.slice(0, 15);

        const result = { videos };
        videoCache.set(cacheKey, { data: result, dateSeed: getDailySeed() });
        res.json(result);
    } catch (err) {
        console.error('[VideoFeed] Error:', err.message);
        res.status(502).json({ error: 'Failed to fetch video feed', details: err.message });
    }
});

module.exports = router;
