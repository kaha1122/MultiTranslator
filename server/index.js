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
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
require('dotenv').config();

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
