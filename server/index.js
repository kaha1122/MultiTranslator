const express = require('express');
const multer = require('multer');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const RssParser = require('rss-parser');
const { parse: parseHtml } = require('node-html-parser');
const { YoutubeTranscript } = require('youtube-transcript');
const admin = require('firebase-admin');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
require('dotenv').config();

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;
const TOSS_AUTH_HEADER = () => 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');

// ── Firebase Admin 초기화 ────────────────────────────────────────────────────
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(
            Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8')
        );
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('[Firebase Admin] Initialized successfully');
    } catch (e) {
        console.warn('[Firebase Admin] Init skipped (no FIREBASE_SERVICE_ACCOUNT_BASE64):', e.message);
    }
}
const adminDb = admin.apps.length ? admin.firestore() : null;

const app = express();
app.use(cors());
app.use(express.json());

const UPLOADS_DIR = 'uploads/';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOADS_DIR });

// API Keys (To be set in .env)
const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * 1. Azure Pronunciation Assessment
 */
async function analyzePronunciation(audioPath, referenceText, langCode, azureKey = AZURE_KEY, azureRegion = AZURE_REGION) {
    return new Promise((resolve, reject) => {
        const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(audioPath));
        const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);

        // 프론트엔드에서 넘어온 언어 코드(en, ja, zh-TW 등)를 Azure가 알아들을 수 있는 코드로 변환
        const azureLangMap = {
            'en': 'en-US',
            'ja': 'ja-JP',
            'zh': 'zh-CN', // 중국어 
            'zh-CN': 'zh-CN', // 중국어 (간체)
            'zh-TW': 'zh-TW', // 중국어 (번체)
            'ko': 'ko-KR',
            'es': 'es-ES',
            'fr': 'fr-FR',
            'de': 'de-DE'
        };
        const targetLanguage = azureLangMap[langCode] || "en-US";
        speechConfig.speechRecognitionLanguage = targetLanguage;

        const pronConfig = new sdk.PronunciationAssessmentConfig(
            referenceText,
            sdk.PronunciationAssessmentGradingSystem.HundredMark,
            sdk.PronunciationAssessmentGranularity.Phoneme,
            true
        );
        pronConfig.enableProsodyAssessment = true; // [수정] 운율감 채점을 명시적으로 활성화합니다.

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        pronConfig.applyTo(recognizer);

        recognizer.recognizeOnceAsync(result => {
            const pronResult = sdk.PronunciationAssessmentResult.fromResult(result);
            const output = {
                pronunciationScore: pronResult.pronunciationScore,
                accuracyScore: pronResult.accuracyScore,
                fluencyScore: pronResult.fluencyScore,
                completenessScore: pronResult.completenessScore,
                // [수정] Azure API가 운율감(prosody)을 지원하지 않는 언어(0 리턴)일 경우, 유창성과 정확성을 바탕으로 추정값을 제공합니다.
                prosodyScore: pronResult.prosodyScore > 0 ? pronResult.prosodyScore : Math.round((pronResult.fluencyScore + pronResult.accuracyScore) / 2),
                words: pronResult.detailResult.Words.map(w => ({
                    word: w.Word,
                    accuracyScore: w.PronunciationAssessment.AccuracyScore,
                    errorType: w.PronunciationAssessment.ErrorType,
                    phonemes: w.Phonemes ? w.Phonemes.map(p => ({
                        phoneme: p.Phoneme,
                        accuracyScore: p.PronunciationAssessment.AccuracyScore
                    })) : []
                }))
            };
            recognizer.close();
            resolve(output);
        }, err => {
            recognizer.close();
            reject(err);
        });
    });
}

/**
 * 2. Gemini Coaching Tip Generation
 */
async function generateCoachingTip(referenceText, assessmentData, sourceLangCode, geminiKey = GEMINI_API_KEY) {
    // 사용자의 언어 맵핑
    const langNames = {
        'ko': 'Korean',
        'en': 'English',
        'ja': 'Japanese',
        'zh': 'Chinese (Simplified)',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German'
    };
    const targetLangName = langNames[sourceLangCode?.split('-')[0]] || 'Korean';

    const prompt = `
    You are a friendly and expert pronunciation coach. 
    A student tried to say: "${referenceText}"
    
    Here are their Azure Pronunciation Assessment results:
    - Overall Score: ${assessmentData.pronunciationScore}
    - Accuracy: ${assessmentData.accuracyScore}
    - Fluency: ${assessmentData.fluencyScore}
    
    Word-level breakdown:
    ${assessmentData.words.map(w => `- ${w.word}: Accuracy ${w.accuracyScore}, Error: ${w.errorType}`).join('\n')}
    
    Based on this data, provide ONE short, encouraging coaching tip (max 2 sentences) in EXACTLY ${targetLangName}. 
    CRITICAL RULES:
    1. Focus on the weakest part, specific mispronounced sounds, or a general tip to sound more natural.
    2. Vary your responses! Do not use generic fallback phrases like "정말 잘하셨어요. 조금만 더 연습하면...". Provide unique insight each time based on their actual performance.
    3. If they scored 100/100, enthusiastically praise their perfect pronunciation with varied phrasing.
    4. Return ONLY the tip text in ${targetLangName}, nothing else.
    `;

    try {
        console.log(`[Gemini] Requesting with model: gemini-2.0-flash, Key prefix: ${geminiKey?.substring(0, 5)}...`);
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("Gemini Error:", error.response?.data || error.message);
        // Fallback message mapped by language
        const fallbacks = {
            'ko': '현재 AI 코치 연결이 원활하지 않지만, 발음 연습을 응원합니다!',
            'en': 'The AI Coach is currently unavailable, but keep up the great pronunciation practice!',
            'ja': '現在AIコーチの接続が不安定ですが、発音練習を応援しています！',
            'zh': '目前AI教练连接不畅，但我们支持你的发音练习！'
        };
        return fallbacks[sourceLangCode?.split('-')[0]] || fallbacks['ko'];
    }
}


/**
 * Main Analysis Endpoint
 */
app.post('/analyze', upload.single('audio'), async (req, res) => {
    const originalAudioPath = req.file?.path;
    const referenceText = req.body.text;
    const langCode = req.body.lang || 'en'; // 프론트엔드에서 보낸 언어 코드

    if (!originalAudioPath || !referenceText) {
        return res.status(400).json({ error: "Missing audio or text" });
    }

    const audioPath = `${originalAudioPath}.wav`;

    try {
        // 0. Convert WebM/MP4 (from browser) to WAV (for Azure)
        // [수정] Azure Speech가 요구하는 아주 깐깐한 오디오 성향에 100% 맞춰줍니다.
        // - 오디오 채널을 1개(모노)로 만듭니다. 스테레오면 점수가 안 나오거나 오류가 납니다.
        // - 사람 목소리에 적합한 16000Hz 주파수로 맞춥니다.
        // - 완벽한 pcm_s16le 방식의 WAV 포맷으로 코딩합니다.
        await new Promise((resolve, reject) => {
            ffmpeg(originalAudioPath)
                .toFormat('wav')
                .audioChannels(1)       // 모노 채널
                .audioFrequency(16000)  // 16kHz
                .audioCodec('pcm_s16le') // 16-bit PCM 포맷 코덱
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(audioPath);
        });

        // BYOK: 사용자가 직접 제공한 키가 있으면 우선 사용, 없으면 서버 환경 변수 사용
        const azureKeyToUse    = req.body.userAzureKey    || AZURE_KEY;
        const azureRegionToUse = req.body.userAzureRegion || AZURE_REGION;
        const geminiKeyToUse   = req.body.userGeminiKey   || GEMINI_API_KEY;

        // 1. Azure Assessment (언어 코드 추가 전달)
        const assessment = await analyzePronunciation(audioPath, referenceText, langCode, azureKeyToUse, azureRegionToUse);

        // 2. Gemini Coaching (사용자 언어 전달)
        const tip = await generateCoachingTip(referenceText, assessment, req.body.sourceLang, geminiKeyToUse);

        // Cleanup
        if (fs.existsSync(originalAudioPath)) fs.unlinkSync(originalAudioPath);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

        res.json({
            assessment,
            coaching: { tip }
        });
    } catch (error) {
        console.error("Analysis Pipeline Failed:", error);
        if (originalAudioPath && fs.existsSync(originalAudioPath)) fs.unlinkSync(originalAudioPath);
        if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});

/**
 * VOA Learning English — 기사 목록 & 본문 제공 엔드포인트
 * 저작권: 미국 정부 제작물(VOA)은 공공 도메인이므로 상업적 사용 가능
 */
const rssParser = new RssParser({ timeout: 8000 });

const VOA_FEEDS = {
    beginner:     'https://learningenglish.voanews.com/api/zti_qvl-vomx-tpekgvqr', // Ask a Teacher
    intermediate: 'https://learningenglish.voanews.com/api/zmmpql-vomx-tpey-_q',    // Health & Lifestyle
    advanced:     'https://learningenglish.voanews.com/api/zyg__l-vomx-tpetmty',    // American Stories
};

// 주 URL이 실패했을 때 사용하는 검증된 대체 RSS 피드
const VOA_FALLBACK = 'https://learningenglish.voanews.com/api/zmmpql-vomx-tpey-_q';

// 메모리 캐시 — 당일 자정까지 유지 (매일 새 10개 선택 보장)
const voaCache = new Map();

function getCached(key) {
    const entry = voaCache.get(key);
    if (!entry) return null;
    // 캐시된 날짜(YYYYMMDD)가 오늘과 다르면 무효
    if (entry.dateSeed !== getDailySeed()) { voaCache.delete(key); return null; }
    return entry.data;
}

const isImageUrl = (url) => !!(url && (/\.(jpe?g|png|webp|gif)/i.test(url) || url.includes('gdb.voanews.com')));

// 날짜 기반 시드 LCG 랜덤 — 하루 동안 동일한 순서, 매일 다른 10개 선택
function seededShuffle(arr, seed) {
    const a = [...arr];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        const j = Math.abs(s) % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getDailySeed() {
    const d = new Date();
    // YYYYMMDD 형태의 정수를 시드로 사용
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// GET /api/voa-news?category=intermediate
app.get('/api/voa-news', async (req, res) => {
    const category = VOA_FEEDS[req.query.category] ? req.query.category : 'intermediate';
    const cacheKey = `news:${category}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        let feedUrl = VOA_FEEDS[category];
        let feed;
        try {
            feed = await rssParser.parseURL(feedUrl);
        } catch (primaryErr) {
            // 카테고리별 피드 실패 시 메인 피드로 fallback
            console.warn(`[VOA] Primary feed failed (${feedUrl}): ${primaryErr.message} — trying fallback`);
            feed = await rssParser.parseURL(VOA_FALLBACK);
        }
        const rawArticles = (feed.items || []).map(item => {
            const encUrl = item.enclosure?.url || '';
            return {
                id: encodeURIComponent(item.link || item.guid || item.title),
                title: item.title || '',
                summary: item.contentSnippet || item.summary || '',
                articleUrl: item.link || '',
                imageUrl: isImageUrl(encUrl) ? encUrl : '',
                audioUrl: encUrl && !isImageUrl(encUrl) ? encUrl : '',
            };
        });

        // 프로그램 로고(반복 이미지)를 가진 항목 제거 — 동일 이미지 URL이 3회 이상이면 오디오 전용 프로그램으로 판단
        const imgFreq = {};
        rawArticles.forEach(a => { if (a.imageUrl) imgFreq[a.imageUrl] = (imgFreq[a.imageUrl] || 0) + 1; });
        const pool = rawArticles.filter(a => !a.imageUrl || imgFreq[a.imageUrl] < 3);

        // 날짜+카테고리 기반 시드로 매일 다른 10개 선택
        const seed = getDailySeed() + category.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const articles = seededShuffle(pool, seed).slice(0, 10);

        const result = { articles };
        voaCache.set(cacheKey, { data: result, dateSeed: getDailySeed() });
        res.json(result);
    } catch (err) {
        console.error('[VOA] Feed fetch error:', err.message);
        res.status(502).json({ error: 'Failed to fetch VOA feed', details: err.message });
    }
});

// GET /api/voa-article?url=<encodedUrl>
app.get('/api/voa-article', async (req, res) => {
    const articleUrl = req.query.url;
    if (!articleUrl) return res.status(400).json({ error: 'Missing url parameter' });

    const cacheKey = `article:${articleUrl}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    try {
        const response = await axios.get(articleUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000,
        });
        const root = parseHtml(response.data);

        // VOA 기사 본문 선택자 (순서대로 시도)
        const bodyEl = root.querySelector('div.article-body')
            || root.querySelector('div.wsw')
            || root.querySelector('div[class*="body"]')
            || root.querySelector('article');

        const title = root.querySelector('h1')?.text?.trim() || '';
        const audioUrl = root.querySelector('audio source')?.getAttribute('src')
            || root.querySelector('meta[property="og:audio"]')?.getAttribute('content')
            || '';

        const paragraphs = bodyEl ? bodyEl.querySelectorAll('p') : [];
        const rawText = [...paragraphs].map(p => p.text.trim()).join(' ');

        // 문장 분리: 마침표/느낌표/물음표 뒤 공백 기준
        const sentenceRaw = rawText.split(/(?<=[.!?])\s+/);
        const SKIP_PATTERNS = /originally appeared|subscribe to|follow us|copyright|©|visit our|for more|no media source/i;

        const sentences = sentenceRaw
            .map(s => s.replace(/\s+/g, ' ').trim())
            .filter(s => s.length >= 15 && s.length <= 200 && !SKIP_PATTERNS.test(s))
            .slice(0, 25)
            .map((text, id) => ({ id, text }));

        const result = { title, audioUrl, sentences };
        voaCache.set(cacheKey, { data: result, dateSeed: getDailySeed() });
        res.json(result);
    } catch (err) {
        console.error('[VOA] Article fetch error:', err.message);
        res.status(502).json({ error: 'Failed to fetch article', details: err.message });
    }
});

// ─────────────────────────────────────────────────────
// YouTube 자막 추출 API  (3단계 폴백)
// ─────────────────────────────────────────────────────
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

// 짧은 자막 조각 → 문장 단위 병합
function mergeToSentences(items) {
    const sentences = [];
    let current = '';
    let startSec = 0;
    const SKIP = /^\[.+\]$|^♪/; // [Music], [Applause], ♪ 등 제거

    for (const item of items) {
        const text = (item.text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text || SKIP.test(text)) continue;
        if (!current) startSec = Math.round((item.offset || 0) / 1000);
        current += (current ? ' ' : '') + text;

        if (/[.!?]$/.test(current) && current.length >= 20) {
            sentences.push({ id: sentences.length, text: current, start: startSec });
            current = '';
        } else if (current.length > 220) {
            sentences.push({ id: sentences.length, text: current, start: startSec });
            current = '';
        }
    }
    if (current.length >= 15) {
        sentences.push({ id: sentences.length, text: current, start: startSec });
    }
    return sentences.filter(s => s.text.length >= 15 && s.text.length <= 250).slice(0, 40);
}

// 브래킷 균형 탐색으로 JSON 배열 안전하게 추출
// 기존 /[.*?]/ 방식은 중첩 ] 에서 조기 종료 버그 있음
function extractJsonArray(html, marker) {
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const start = idx + marker.length;
    if (html[start] !== '[') return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (esc)              { esc = false; continue; }
        if (c === '\\' && inStr) { esc = true; continue; }
        if (c === '"')        { inStr = !inStr; continue; }
        if (!inStr) {
            if (c === '[' || c === '{') depth++;
            else if (c === ']' || c === '}') {
                depth--;
                if (depth === 0) {
                    try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
                }
            }
        }
    }
    return null;
}

// captionTracks → 실제 자막 아이템 배열
async function fetchCaptionItems(tracks) {
    const track = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
        || tracks.find(t => t.languageCode === 'en')
        || tracks.find(t => t.kind === 'asr')
        || tracks[0];
    if (!track?.baseUrl) throw new Error('No usable caption track');

    const url = track.baseUrl.replace(/\\u0026/g, '&') + '&fmt=json3';
    const { data } = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.youtube.com/' },
        timeout: 10000,
    });
    return (data.events || [])
        .filter(e => e.segs)
        .map(e => ({
            text: e.segs.map(s => s.utf8 || '').join(''),
            offset: e.tStartMs || 0,
            duration: e.dDurationMs || 0,
        }))
        .filter(item => item.text.trim());
}

// [Method 2] InnerTube Android 클라이언트 — 봇 감지 우회에 효과적
async function fetchTranscriptInnerTube(videoId) {
    const { data: player } = await axios.post(
        'https://www.youtube.com/youtubei/v1/player',
        {
            videoId,
            context: {
                client: {
                    clientName: 'ANDROID',
                    clientVersion: '19.09.37',
                    androidSdkVersion: 30,
                    hl: 'en',
                    gl: 'US',
                    timeZone: 'UTC',
                    utcOffsetMinutes: 0,
                },
            },
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
                'X-YouTube-Client-Name': '3',
                'X-YouTube-Client-Version': '19.09.37',
                'Origin': 'https://www.youtube.com',
            },
            timeout: 15000,
        }
    );
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) throw new Error('No captions in InnerTube response');
    return fetchCaptionItems(tracks);
}

// [Method 3] 웹 페이지 스크래핑 (브래킷 균형 파싱)
async function fetchTranscriptFromPage(videoId) {
    const { data: html } = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            // consent 쿠키로 EU 동의 페이지 우회
            'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+409;',
        },
        timeout: 15000,
    });
    const tracks = extractJsonArray(html, '"captionTracks":');
    if (!tracks?.length) throw new Error(`captionTracks not found (html ${html.length} chars)`);
    return fetchCaptionItems(tracks);
}

// GET /api/youtube-transcript?url=<encodedYouTubeUrl>
app.get('/api/youtube-transcript', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    const errors = [];
    let rawItems = null;

    // Method 1a: youtube-transcript 패키지 (영어 지정)
    try {
        rawItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        console.log(`[YT] M1a OK (${rawItems.length})`);
    } catch (e1) {
        errors.push(`m1a: ${e1.message}`);
        // Method 1b: 언어 무관
        try {
            rawItems = await YoutubeTranscript.fetchTranscript(videoId);
            console.log(`[YT] M1b OK (${rawItems.length})`);
        } catch (e2) {
            errors.push(`m1b: ${e2.message}`);
            // Method 2: InnerTube Android API
            try {
                rawItems = await fetchTranscriptInnerTube(videoId);
                console.log(`[YT] M2-InnerTube OK (${rawItems.length})`);
            } catch (e3) {
                errors.push(`m2: ${e3.message}`);
                // Method 3: 페이지 스크래핑
                try {
                    rawItems = await fetchTranscriptFromPage(videoId);
                    console.log(`[YT] M3-Scrape OK (${rawItems.length})`);
                } catch (e4) {
                    errors.push(`m3: ${e4.message}`);
                }
            }
        }
    }

    if (!rawItems?.length) {
        console.error('[YT] All methods failed:', errors.join(' | '));
        return res.status(502).json({ error: 'Failed to fetch transcript', details: errors.join(' | ') });
    }

    const sentences = mergeToSentences(rawItems);
    if (!sentences.length) {
        return res.status(404).json({ error: 'No captions found for this video' });
    }
    res.json({ videoId, sentences });
});

// ─────────────────────────────────────────────────────
// TED 채널 최신 영상 목록 API  (일 1회 캐시)
// ─────────────────────────────────────────────────────
// TED YouTube 채널 ID (youtube.com/@TED)
const TED_CHANNEL_ID = 'UCsooa4yRKGN_zEE8iknghZA';
const TED_FEED_URL   = `https://www.youtube.com/feeds/videos.xml?channel_id=${TED_CHANNEL_ID}`;
const tedCache = new Map();

const rssParserYT = new RssParser({
    customFields: { item: [['yt:videoId', 'videoId'], ['media:group', 'mediaGroup']] },
    timeout: 10000,
});

// GET /api/ted-videos
app.get('/api/ted-videos', async (req, res) => {
    const cacheKey = 'ted:videos';
    const cached = tedCache.get(cacheKey);
    if (cached && cached.dateSeed === getDailySeed()) {
        return res.json(cached.data);
    }

    try {
        const feed = await rssParserYT.parseURL(TED_FEED_URL);
        const videos = (feed.items || []).map(item => {
            const vid = item.videoId || extractVideoId(item.link || '');
            if (!vid) return null;
            return {
                id: vid,
                title: item.title || '',
                videoId: vid,
                url: `https://www.youtube.com/watch?v=${vid}`,
                thumbnail: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
                pubDate: item.pubDate || item.isoDate || '',
            };
        }).filter(Boolean);

        const result = { videos };
        tedCache.set(cacheKey, { data: result, dateSeed: getDailySeed() });
        res.json(result);
    } catch (err) {
        console.error('[TED] Feed fetch error:', err.message);
        res.status(502).json({ error: 'Failed to fetch TED channel', details: err.message });
    }
});

/**
 * Scene Sentence Generation
 * POST /api/scene-sentence
 * Body: { scene, category, targetLang, sourceLang, byokGeminiKey? }
 */
const LANG_NAMES_FOR_SCENE = {
    'ko': 'Korean', 'en': 'English', 'ja': 'Japanese',
    'zh-CN': 'Chinese (Simplified)', 'vi': 'Vietnamese',
    'fr': 'French', 'de': 'German', 'es': 'Spanish',
};

const DIFFICULTY_DESC = {
    basic:        'beginner level — use only the most common, simple words and very short phrases',
    intermediate: 'intermediate level — use natural everyday expressions and moderate vocabulary',
    high:         'advanced level — use complex sentence structures, idiomatic expressions, and nuanced language',
};
const STYLE_DESC = {
    casual: 'casual, informal tone — as if speaking to a close friend; use contractions and relaxed language',
    formal: 'polite, formal tone — as if speaking to a stranger, staff, or superior; use respectful expressions',
};

app.post('/api/scene-sentence', async (req, res) => {
    const { scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey } = req.body;
    if (!scene || !targetLang) {
        return res.status(400).json({ error: 'Missing scene or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc   = DIFFICULTY_DESC[difficulty]  || DIFFICULTY_DESC.intermediate;
    const styleDesc  = STYLE_DESC[speechStyle]      || STYLE_DESC.formal;

    const prompt = `You are a language learning coach. Generate a single natural QUESTION sentence for a learner to practice speaking in a real-life context.

Context:
- Scene: ${scene}
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- Difficulty: ${diffDesc}
- Speech style: ${styleDesc}

Rules:
1. The sentence must be a QUESTION the LEARNER asks (e.g., asking staff, locals, or a counterpart in the scene)
2. Length: 8–18 words — short enough to practice in one breath
3. Match the difficulty and speech style exactly
4. The sentence must end with a question mark

Return ONLY valid JSON (no markdown):
{
  "sentence": "<sentence in ${targetLangName}>",
  "translation": "<translation in ${sourceLangName}>",
  "scene_hint": "<one sentence in ${sourceLangName} describing the exact moment — e.g., '수하물을 못 찾아 직원에게 말하는 상황'>",
  "learning_tip": "<one pronunciation or expression tip in ${sourceLangName}>"
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        res.json(parsed);
    } catch (e) {
        console.error('[SceneSentence] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate sentence' });
    }
});

/**
 * Scene Answer Generation
 * POST /api/scene-answer
 * Body: { question, scene, targetLang, sourceLang, byokGeminiKey? }
 */
app.post('/api/scene-answer', async (req, res) => {
    const { question, scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey } = req.body;
    if (!question || !targetLang) {
        return res.status(400).json({ error: 'Missing question or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc  = DIFFICULTY_DESC[difficulty]  || DIFFICULTY_DESC.intermediate;
    const styleDesc = STYLE_DESC[speechStyle]      || STYLE_DESC.formal;

    const prompt = `You are a language learning coach. A learner just practiced saying a question in ${targetLangName}. Now generate a natural REPLY that the other person would say in response.

Context:
- Scene: ${scene}
- Question the learner said: "${question}"
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- Difficulty: ${diffDesc}
- Speech style: ${styleDesc}

Rules:
1. The sentence must be the OTHER PERSON'S natural reply to the question above
2. Length: 8–18 words — short enough to practice in one breath
3. Match the difficulty and speech style exactly
4. Make the reply directly relevant to the question asked

Return ONLY valid JSON (no markdown):
{
  "sentence": "<reply sentence in ${targetLangName}>",
  "translation": "<translation in ${sourceLangName}>",
  "scene_hint": "<one sentence in ${sourceLangName} describing who is speaking and what they mean>",
  "learning_tip": "<one pronunciation or expression tip in ${sourceLangName}>"
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        res.json(parsed);
    } catch (e) {
        console.error('[SceneAnswer] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate answer' });
    }
});

// ── Stripe Checkout 세션 생성 ────────────────────────────────────────────────
// ── TossPayments 빌링키 발급 + 첫 결제 ──────────────────────────────────────
// 흐름: 프론트(requestBillingAuth) → 토스 카드 입력 → successUrl?authKey=xxx
//       → 앱이 이 엔드포인트 호출 → 빌링키 발급 → 첫 결제 → Firestore 업데이트
app.post('/api/toss-confirm-billing', async (req, res) => {
    const { authKey, customerKey, tier, userEmail } = req.body;
    if (!authKey || !customerKey || !tier) {
        return res.status(400).json({ error: 'authKey, customerKey, tier are required' });
    }

    const AMOUNTS = { pro: 4900, premium: 16900 };
    const ORDER_NAMES = { pro: 'PronunFit Pro', premium: 'PronunFit Premium' };
    const amount = AMOUNTS[tier];
    if (!amount) return res.status(400).json({ error: `Unknown tier: ${tier}` });

    try {
        // 1단계: authKey로 빌링키 발급
        const billingRes = await axios.post(
            `https://api.tosspayments.com/v1/billing/authorizations/${authKey}`,
            { customerKey },
            { headers: { Authorization: TOSS_AUTH_HEADER() } }
        );
        const { billingKey } = billingRes.data;

        // 2단계: 빌링키로 첫 달 결제
        const orderId = `order_${Date.now()}_${customerKey.slice(0, 8)}`;
        await axios.post(
            `https://api.tosspayments.com/v1/billing/${billingKey}`,
            {
                customerKey,
                amount,
                orderId,
                orderName: ORDER_NAMES[tier],
                customerEmail: userEmail || undefined,
            },
            { headers: { Authorization: TOSS_AUTH_HEADER() } }
        );

        // 3단계: Firestore 업데이트 (customerKey === userId)
        if (adminDb) {
            await adminDb.collection('users').doc(customerKey).update({
                tier,
                tossBillingKey: billingKey,
                tossCustomerKey: customerKey,
                tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                subscriptionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Toss] billing confirmed: ${customerKey} → ${tier}`);
        }

        res.json({ success: true, orderId });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[Toss] confirm-billing error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

// ── TossPayments 구독 취소 ────────────────────────────────────────────────────
app.post('/api/cancel-subscription', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        if (adminDb) {
            await adminDb.collection('users').doc(userId).update({
                tier: 'trial',
                tossBillingKey: null,
                tossCustomerKey: null,
                tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Toss] subscription cancelled: ${userId}`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Toss] cancel-subscription error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// [신규] 서버 잠 깨우기용(Warm-up) 가벼운 API
// 클라우드 서비스(Render 등)는 접속이 없으면 잠들어버리는데, 앱 접속 시 이 주소를 몰래 찔러서 깨웁니다.
app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is awake!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 AI Orchestrator running on http://localhost:${PORT}`);
    console.log(`[Config] Azure Region: ${AZURE_REGION}`);
    console.log(`[Config] Gemini Key Prefix: ${GEMINI_API_KEY?.substring(0, 5)}...`);
    if (!AZURE_KEY) console.warn("⚠️ AZURE_SPEECH_KEY is missing in .env");
    if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY is missing in .env");
});
