const express = require('express');
const multer = require('multer');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
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
            const realProsody = pronResult.prosodyScore;
            const displayProsody = realProsody > 0
                ? realProsody
                : Math.round((pronResult.fluencyScore + pronResult.accuracyScore) / 2);
            const output = {
                // [수정] prosody 미지원 언어(0 리턴)일 경우 fallback prosody로 pronunciationScore 재계산하여 badge와 UI 원형 점수를 일치시킴
                pronunciationScore: realProsody > 0
                    ? pronResult.pronunciationScore
                    : Math.round(
                        pronResult.accuracyScore * 0.4 +
                        pronResult.completenessScore * 0.2 +
                        pronResult.fluencyScore * 0.2 +
                        displayProsody * 0.2
                      ),
                accuracyScore: pronResult.accuracyScore,
                fluencyScore: pronResult.fluencyScore,
                completenessScore: pronResult.completenessScore,
                prosodyScore: displayProsody,
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
        const azureKeyToUse = req.body.userAzureKey || AZURE_KEY;
        const azureRegionToUse = req.body.userAzureRegion || AZURE_REGION;
        const geminiKeyToUse = req.body.userGeminiKey || GEMINI_API_KEY;

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

// ─────────────────────────────────────────────────────
// Video Feed — 큐레이션 채널 기반 YouTube 영상 목록 API
// ─────────────────────────────────────────────────────
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
app.get('/api/video-feed', async (req, res) => {
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
        // 각 채널의 uploads 재생목록에서 최신 영상 가져오기 (1 unit/요청)
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

        // 최신순 정렬, 최대 15개
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

// [2026-03-09] YouTube 자막/transcript API 제거:
// YouTube는 클라우드 서버 IP(Render 등)에서 봇 감지(reCAPTCHA)로 자막 크롤링을 차단함.
// youtubei.js, youtube-transcript 등 모든 npm 패키지가 서버 환경에서 작동 불가.
// YouTube Data API captions.download는 OAuth(영상 소유자만) 필요.
// 앱 안정성을 위해 자막 기능을 제거하고, 메모 → 번역 탭 연동으로 대체함.

/**
 * Azure Neural TTS
 * POST /api/azure-tts
 * Body: { text, langCode, emotion?, byokAzureKey?, byokAzureRegion? }
 * Returns: audio/mpeg binary
 */
const AZURE_TTS_VOICE_MAP = {
    'en':    { voice: 'en-US-JennyNeural',      styles: ['chat','cheerful','sad','angry','excited','friendly','hopeful','empathetic'] },
    'ja':    { voice: 'ja-JP-NanamiNeural',      styles: ['chat'] },
    'zh-CN': { voice: 'zh-CN-XiaoxiaoNeural',    styles: ['chat','cheerful','sad','angry','fearful','gentle','serious','friendly','empathetic','calm'] },
    'vi':    { voice: 'vi-VN-HoaiMyNeural',       styles: [] },
    'fr':    { voice: 'fr-FR-DeniseNeural',       styles: [] },
    'de':    { voice: 'de-DE-KatjaNeural',        styles: [] },
    'es':    { voice: 'es-ES-ElviraNeural',       styles: [] },
    'ko':    { voice: 'ko-KR-SunHiNeural',        styles: ['chat','cheerful','sad','angry','friendly'] },
};

// Gemini selected_emotion → Azure TTS style 매핑
const EMOTION_TO_STYLE = {
    'frustrated':    'angry',
    'angry':         'angry',
    'annoyed':       'angry',
    'impatient':     'angry',
    'sad':           'sad',
    'disappointed':  'sad',
    'homesick':      'sad',
    'lonely':        'sad',
    'cheerful':      'cheerful',
    'excited':       'excited',
    'happy':         'cheerful',
    'grateful':      'cheerful',
    'relieved':      'cheerful',
    'delighted':     'cheerful',
    'curious':       'friendly',
    'friendly':      'friendly',
    'interested':    'friendly',
    'surprised':     'friendly',
    'hopeful':       'hopeful',
    'optimistic':    'hopeful',
    'hesitant':      'gentle',
    'shy':           'gentle',
    'nervous':       'gentle',
    'embarrassed':   'gentle',
    'uncertain':     'gentle',
    'worried':       'gentle',
    'calm':          'calm',
    'confident':     'chat',
    'apologetic':    'empathetic',
    'empathetic':    'empathetic',
    'sympathetic':   'empathetic',
    'concerned':     'empathetic',
    'serious':       'serious',
    'urgent':        'fearful',
    'fearful':       'fearful',
    'panicked':      'fearful',
};

app.post('/api/azure-tts', async (req, res) => {
    const { text, langCode, emotion, byokAzureKey, byokAzureRegion } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const azureKey    = byokAzureKey    || AZURE_KEY;
    const azureRegion = byokAzureRegion || AZURE_REGION;
    if (!azureKey || !azureRegion) return res.status(500).json({ error: 'Azure TTS not configured' });

    const voiceInfo       = AZURE_TTS_VOICE_MAP[langCode] || { voice: 'en-US-JennyNeural', styles: ['chat'] };
    const voiceName       = voiceInfo.voice;
    const supportedStyles = voiceInfo.styles;
    const locale          = voiceName.split('-').slice(0, 2).join('-'); // e.g. "en-US"
    const escaped         = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // 감정 기반 style 결정: emotion → 매핑된 style → 해당 음성이 지원하면 사용, 아니면 chat 폴백
    let voiceStyle = null;
    if (supportedStyles.length > 0) {
        const mapped = emotion ? EMOTION_TO_STYLE[emotion.toLowerCase()] : null;
        voiceStyle = (mapped && supportedStyles.includes(mapped)) ? mapped : (supportedStyles.includes('chat') ? 'chat' : supportedStyles[0]);
    }

    // style이 지원되는 음성은 mstts:express-as로 감정 반영
    const innerContent = voiceStyle
        ? `<mstts:express-as style="${voiceStyle}"><prosody rate="0%" pitch="0%">${escaped}</prosody></mstts:express-as>`
        : `<prosody rate="0%" pitch="0%">${escaped}</prosody>`;
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${locale}'><voice xml:lang='${locale}' name='${voiceName}'>${innerContent}</voice></speak>`;

    try {
        const response = await axios.post(
            `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': azureKey,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-48khz-192kbitrate-mono-mp3',
                },
                responseType: 'arraybuffer',
            }
        );
        res.set('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(response.data));
    } catch (e) {
        console.error('[AzureTTS] Error:', e.response?.status, e.message);
        res.status(500).json({ error: 'Azure TTS failed' });
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

// ── 난이도별 상세 가이드라인 (CEFR 기반) ─────────────────────────────────────
const DIFFICULTY_DESC = {
    basic: `Beginner (A1/A2)
  - Vocabulary: Top 500 high-frequency words only. Simple nouns, verbs, adjectives.
  - Grammar: Simple present/past tense. One clause per sentence. No subordinate clauses.
  - Length: 5–10 words.
  - Goal: Express immediate needs in the simplest form possible.`,
    intermediate: `Intermediate (B1/B2)
  - Vocabulary: Common phrasal verbs, collocations, everyday idioms.
  - Grammar: Compound sentences with conjunctions (but, so, because). Modals for politeness. Up to 2 clauses per sentence.
  - Length: 8–15 words.
  - Goal: Express opinions, reasons, and polite requests with context.`,
    high: `Advanced (C1/C2)
  - Vocabulary: Nuanced idioms, domain-specific terms, sophisticated adjectives.
  - Grammar: Complex sentences with 3+ clauses. Conditionals, relative clauses, passive voice, subjunctive mood.
  - Length: 12–25 words.
  - Goal: Handle nuanced social situations with native-level fluency.`,
};

// ── 어투별 상세 가이드라인 ────────────────────────────────────────────────────
const STYLE_DESC = {
    casual: `Casual (Informal)
  - Focus on **Natural Fluency**. Use the language's common everyday forms, contractions, and relaxed sentence endings.
  - Reflect the chosen emotion **openly and directly** as if speaking to a close friend or peer.`,
    formal: `Formal (Polite)
  - Focus on **Social Distance & Respect**. Use standard grammatical structures and appropriate honorifics/polite forms.
  - Reflect the chosen emotion **gracefully and indirectly**. Ensure the tone remains professional or respectful toward strangers or service staff.`,
};

app.post('/api/scene-sentence', async (req, res) => {
    const { scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey, avoidSentences } = req.body;
    if (!scene || !targetLang) {
        return res.status(400).json({ error: 'Missing scene or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc = DIFFICULTY_DESC[difficulty] || DIFFICULTY_DESC.intermediate;
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    // 최근 10개는 명시적으로 나열, 나머지는 요약으로 전달
    let avoidBlock = '';
    if (avoidSentences && avoidSentences.length > 0) {
        const recent = avoidSentences.slice(-10);
        const olderCount = avoidSentences.length - recent.length;
        avoidBlock = `\n### [Previous Sentences — STRICT EXCLUSION]
The learner has already practiced ${avoidSentences.length} sentences. Do NOT reuse the same core verb, topic, or sentence structure as ANY of them.
${olderCount > 0 ? `(${olderCount} older sentences omitted for brevity)\n` : ''}Recent sentences to explicitly avoid:
${recent.map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n`;
    }

    const prompt = `### [Role]
You are a highly creative Language Learning Content Architect. Your mission is to generate a realistic sentence (Question, Statement, or Request) that a learner uses to **INITIATE** a conversation in a specific micro-situation.

---

### [Phase 1: AI-Driven Scenario & Emotion Design]
Before generating the sentence, you MUST autonomously design the emotional context:
1. **Select an Emotion**: Choose ONE appropriate emotion for "${scene}" from: Grateful, Frustrated, Confused, Excited, Hesitant, Urgent, Curious, Dissatisfied, Relieved, Apologetic, Surprised, Nervous. **Vary your choice — do NOT pick the same emotion every time.**
2. **Design the Micro-Situation**: Aim for specific "pain points" or realistic moments unique to "${scene}". Avoid generic scenarios like "Where is the restroom?" — instead think of compelling, scene-specific moments.
3. **Choose an Action Type** (exactly one of these 8):
   - **Inquiry**: Asking a question to get information.
   - **Request**: Asking someone to do something for you.
   - **Observation**: Commenting on or describing the situation.
   - **Opinion**: Sharing a personal thought or judgment.
   - **Problem**: Reporting or explaining an issue.
   - **Complaint**: Expressing dissatisfaction about something.
   - **Social**: Making small talk or casual conversation.
   - **Greeting**: Opening with a polite or friendly remark.

---

### [Phase 2: Difficulty Guidelines]
${diffDesc}

---

### [Phase 3: Speech Style & Politeness]
${styleDesc}
- **Emotion Integration**: Let the chosen emotion naturally color the tone. If 'Urgent', the phrasing should feel pressing. If 'Hesitant', use softer openers. If 'Frustrated', let mild impatience show through word choice.

---

### [Input Variables]
- Scene: ${scene}
- Target Language: ${targetLangName}
- Learner's Native Language: ${sourceLangName}
${avoidBlock}
---

### [Strict Rules]
1. **Proactive Initiation**: The learner is always the one speaking FIRST. No passive "Yes/No" answers.
2. **Scenario Alignment**: Generate the most suitable sentence based on the scenario and emotion selected in Phase 1.
3. **AI Emotion Choice**: You must pick a varied emotion that fits the scene to ensure diversity.
4. **Anti-Duplication**: Do NOT use the same core verb, topic, or sentence structure as any Previous Sentence.
5. **Modern & Realistic**: Reflect 2026 native speech, not stiff textbook phrases.
6. **Grammar & Length**: Strictly adhere to the Difficulty Guidelines above.
7. **No reading aids**: Do not add furigana/hiragana readings for ja, pinyin/tone marks for zh-CN/zh-TW, or any romanization unless explicitly requested.

---

### [Return ONLY valid JSON (no markdown)]
{
  "selected_emotion": "The emotion you chose (e.g., Frustrated, Curious, Hesitant).",
  "interaction_type": "The action type you chose: exactly one of 'Inquiry', 'Request', 'Observation', 'Opinion', 'Problem', 'Complaint', 'Social', or 'Greeting'.",
  "internal_scenario_summary": "English description of the chosen emotion, action type, and the specific micro-situation.",
  "sentence": "The generated opening sentence in ${targetLangName}.",
  "translation": "Natural translation in ${sourceLangName}.",
  "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading. For all others: empty string ''.",
  "scene_hint": "In ${sourceLangName}: a vivid description of the micro-situation WITHOUT emotion tags (e.g., '비행기가 너무 추워서 담요를 요청하려는 상황').",
  "learning_tip": "In ${sourceLangName}: a vocabulary, grammar, or pronunciation tip. Explain how the chosen emotion and ${styleDesc.split('\\n')[0].trim()} style shape this expression."
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.3, topK: 64, topP: 0.95 },
            }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        // internal_scenario_summary는 Chain-of-Thought용 — 클라이언트에 전달하지 않아도 되지만 디버깅에 유용
        res.json(parsed);
    } catch (e) {
        console.error('[SceneSentence] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate sentence' });
    }
});

/**
 * Scene Response Generation
 * POST /api/scene-answer
 * Body: { question (initiation sentence), scene, targetLang, sourceLang, byokGeminiKey? }
 */
app.post('/api/scene-answer', async (req, res) => {
    const { question, scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey, avoidSentences } = req.body;
    if (!question || !targetLang) {
        return res.status(400).json({ error: 'Missing initiation sentence or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc = DIFFICULTY_DESC[difficulty] || DIFFICULTY_DESC.intermediate;
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    // 최근 10개는 명시적으로 나열, 나머지는 요약으로 전달
    let avoidBlock = '';
    if (avoidSentences && avoidSentences.length > 0) {
        const recent = avoidSentences.slice(-10);
        const olderCount = avoidSentences.length - recent.length;
        avoidBlock = `\n### [Previous Reply Sentences — STRICT EXCLUSION]
The learner has already practiced ${avoidSentences.length} reply sentences. Do NOT reuse the same core verb, topic, or sentence structure as ANY of them.
${olderCount > 0 ? `(${olderCount} older sentences omitted for brevity)\n` : ''}Recent replies to explicitly avoid:
${recent.map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n`;
    }

    const prompt = `### [Role]
You are a highly creative Language Learning Content Architect. The learner just practiced saying an opening sentence (a question, statement, request, or observation). Now generate the most natural, context-appropriate RESPONSE that the other person would give.

---

### [Phase 1: Response Situation Design]
The learner said: "${question}" in the scene "${scene}".
- **Identify the Initiation Type**: Is the learner asking a question? Making a complaint? Sharing an observation? Greeting someone? Your response must match the type.
- **Choose a Response Action Type** (exactly one of these 8):
   - **Inquiry**: Asking a follow-up question.
   - **Request**: Asking the learner to do something.
   - **Observation**: Commenting on or describing the situation.
   - **Opinion**: Sharing a personal thought or judgment.
   - **Problem**: Pointing out an issue or limitation.
   - **Complaint**: Expressing dissatisfaction.
   - **Social**: Making small talk or casual conversation.
   - **Greeting**: Responding with a polite or friendly remark.
- **Think about WHO is responding**: a waiter? a flight attendant? a friend? a receptionist? a stranger? The response must match that person's role, knowledge, and emotional tone.
- **Select a Response Emotion**: Choose an appropriate emotion for the responder (e.g., Helpful, Sympathetic, Apologetic, Cheerful, Professional, Reassuring, Surprised). This should naturally complement the learner's tone.
- **Be Specific & Informative**: Don't give a generic "Sure!" or "Yes, of course." — give a response that contains USEFUL INFORMATION (directions, explanations, alternatives, empathy, confirmations with details).
- **Stay in Character**: The responding person should sound authentic to their role in this scene.

---

### [Phase 2: Difficulty Guidelines — Apply to the RESPONSE]
${diffDesc}

---

### [Phase 3: Speech Style & Politeness — Apply to the RESPONSE]
The response should match the same register as the learner's initiation:
${styleDesc}
- **Emotion Integration**: Let the responder's emotion naturally shape the tone. A Helpful flight attendant sounds different from an Apologetic waiter.

---

### [Input Variables]
- Scene: ${scene}
- Learner's initiation sentence: "${question}"
- Target Language: ${targetLangName}
- Learner's Native Language: ${sourceLangName}
${avoidBlock}
---

### [Strict Rules]
1. **Speaker Identity**: The OTHER PERSON is speaking — NOT the learner. This is the response to the learner's initiation.
2. **Relevance**: The response must DIRECTLY address the learner's sentence. If it was a question, answer it. If a complaint, acknowledge it. If a greeting, respond warmly.
3. **Grammar & Length**: Strictly adhere to the Difficulty Guidelines above.
4. **Anti-Duplication**: Do NOT reuse the same core verb, topic, or sentence structure as any Previous Reply Sentence.
5. **Modern & Realistic**: Reflect 2026 native speech, not stiff textbook phrases.
6. **Informative**: Include useful details — a location, a time, a price, a suggestion, empathy — not just "yes" or "no".
7. **No reading aids**: Do not add furigana/hiragana readings for ja, pinyin/tone marks for zh-CN/zh-TW, or any romanization unless explicitly requested.
---

### [Return ONLY valid JSON (no markdown)]
{
  "selected_emotion": "The responder's emotion (e.g., Helpful, Apologetic, Reassuring).",
  "interaction_type": "The action type you chose: exactly one of 'Inquiry', 'Request', 'Observation', 'Opinion', 'Problem', 'Complaint', 'Social', or 'Greeting'.",
  "internal_scenario_summary": "English description: who is responding, their emotion, what information they are giving, and why this is a natural response.",
  "sentence": "The generated response in ${targetLangName}.",
  "translation": "Natural translation in ${sourceLangName}.",
  "pronunciation": "For zh-CN/zh: pinyin with tone marks. For ja: hiragana reading. For all others: empty string ''.",
  "scene_hint": "In ${sourceLangName}: describe who is speaking (role) and what they are telling the learner, WITHOUT emotion tags (e.g., '승무원이 담요를 가져다주겠다고 안내하는 상황').",
  "learning_tip": "In ${sourceLangName}: a vocabulary, grammar, or expression tip from this response. Explain how the responder's emotion and role shape this expression."
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.3, topK: 64, topP: 0.95 },
            }
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
    const { authKey, customerKey, tier, planId, months = 1, userEmail } = req.body;
    if (!authKey || !customerKey || !tier) {
        return res.status(400).json({ error: 'authKey, customerKey, tier are required' });
    }

    const AMOUNTS = {
        pro_1: 9900, pro_3: 16500,
        premium_1: 19900, premium_3: 55000,
        // 레거시 호환
        pro: 9900, premium: 19900,
    };
    const ORDER_NAMES = {
        pro_1: 'PronunFit Pro 1개월', pro_3: 'PronunFit Pro 3개월',
        premium_1: 'PronunFit Premium 1개월', premium_3: 'PronunFit Premium 3개월',
        pro: 'PronunFit Pro', premium: 'PronunFit Premium',
    };
    const resolvedPlanId = planId || tier;
    const amount = AMOUNTS[resolvedPlanId];
    if (!amount) return res.status(400).json({ error: `Unknown plan: ${resolvedPlanId}` });

    try {
        // 1단계: authKey로 빌링키 발급
        const billingRes = await axios.post(
            `https://api.tosspayments.com/v1/billing/authorizations/${authKey}`,
            { customerKey },
            { headers: { Authorization: TOSS_AUTH_HEADER() } }
        );
        const { billingKey } = billingRes.data;

        // 2단계: 빌링키로 결제
        const orderId = `order_${Date.now()}_${customerKey.slice(0, 8)}`;
        await axios.post(
            `https://api.tosspayments.com/v1/billing/${billingKey}`,
            {
                customerKey,
                amount,
                orderId,
                orderName: ORDER_NAMES[resolvedPlanId] || `PronunFit ${tier}`,
                customerEmail: userEmail || undefined,
            },
            { headers: { Authorization: TOSS_AUTH_HEADER() } }
        );

        // 3단계: Firestore 업데이트 (customerKey === userId)
        const resolvedMonths = parseInt(months) || 1;

        // 기존 구독이 남아있으면 그 만료일부터 연장, 아니면 오늘부터
        let baseDate = new Date();
        if (adminDb) {
            const userDoc = await adminDb.collection('users').doc(customerKey).get();
            const existingExpiry = userDoc.data()?.subscriptionExpiresAt;
            if (existingExpiry) {
                const existingDate = existingExpiry.toDate ? existingExpiry.toDate() : new Date(existingExpiry);
                if (existingDate > baseDate) baseDate = existingDate;
            }
        }
        const expiresAt = new Date(baseDate);
        expiresAt.setMonth(expiresAt.getMonth() + resolvedMonths);

        if (adminDb) {
            const updateData = {
                tier,
                planId: resolvedPlanId,
                subscriptionMonths: resolvedMonths,
                tossBillingKey: billingKey,
                tossCustomerKey: customerKey,
                autoRenew: true,
                tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                subscriptionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
                subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            };
            await adminDb.collection('users').doc(customerKey).update(updateData);
            console.log(`[Toss] billing confirmed: ${customerKey} → ${resolvedPlanId} (${resolvedMonths}mo, expires ${expiresAt.toISOString().slice(0,10)})`);
        }

        res.json({ success: true, orderId });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[Toss] confirm-billing error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

// ── TossPayments 구독 취소 (자동 연장 중지, 만료일까지 서비스 유지) ──────────
app.post('/api/cancel-subscription', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        if (adminDb) {
            await adminDb.collection('users').doc(userId).update({
                autoRenew: false,
                tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Toss] auto-renew disabled: ${userId} (service continues until expiry)`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Toss] cancel-subscription error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 전화번호 중복 체크 ──────────────────────────────────────────────────────
app.post('/api/check-phone', async (req, res) => {
    const { phoneNumber, userId } = req.body;
    if (!phoneNumber || !userId) return res.status(400).json({ error: 'phoneNumber and userId required' });
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    try {
        const snapshot = await adminDb.collection('users')
            .where('phoneNumber', '==', phoneNumber)
            .where('phoneVerified', '==', true)
            .get();

        const otherUser = snapshot.docs.find(doc => doc.id !== userId);
        res.json({ isDuplicate: !!otherUser });
    } catch (err) {
        console.error('[CheckPhone] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Cron: 자동 갱신 (만료된 구독 재결제 + 연장) ─────────────────────────────
// Render cron이나 외부 스케줄러에서 매일 1회 호출: POST /api/cron/renew-subscriptions
app.post('/api/cron/renew-subscriptions', async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    const AMOUNTS = {
        pro_1: 9900, pro_3: 16500,
        premium_1: 19900, premium_3: 55000,
    };
    const ORDER_NAMES = {
        pro_1: 'PronunFit Pro 1개월', pro_3: 'PronunFit Pro 3개월',
        premium_1: 'PronunFit Premium 1개월', premium_3: 'PronunFit Premium 3개월',
    };

    try {
        const now = admin.firestore.Timestamp.now();
        // autoRenew === true이고 만료일이 지난 사용자 조회
        const snapshot = await adminDb.collection('users')
            .where('autoRenew', '==', true)
            .where('subscriptionExpiresAt', '<=', now)
            .get();

        let renewed = 0, failed = 0;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const { tossBillingKey, tossCustomerKey, planId, subscriptionMonths } = data;
            if (!tossBillingKey || !planId) {
                failed++;
                continue;
            }

            const amount = AMOUNTS[planId];
            if (!amount) { failed++; continue; }

            const months = subscriptionMonths || (planId.endsWith('_3') ? 3 : 1);
            try {
                // 빌링키로 재결제
                const orderId = `renew_${Date.now()}_${doc.id.slice(0, 8)}`;
                await axios.post(
                    `https://api.tosspayments.com/v1/billing/${tossBillingKey}`,
                    {
                        customerKey: tossCustomerKey || doc.id,
                        amount,
                        orderId,
                        orderName: ORDER_NAMES[planId] || `PronunFit ${planId}`,
                    },
                    { headers: { Authorization: TOSS_AUTH_HEADER() } }
                );

                // 만료일 연장
                const currentExpiry = data.subscriptionExpiresAt.toDate
                    ? data.subscriptionExpiresAt.toDate() : new Date(data.subscriptionExpiresAt);
                const newExpiry = new Date(currentExpiry);
                newExpiry.setMonth(newExpiry.getMonth() + months);

                await adminDb.collection('users').doc(doc.id).update({
                    subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(newExpiry),
                    lastRenewedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Cron] renewed: ${doc.id} → ${planId} (expires ${newExpiry.toISOString().slice(0,10)})`);
                renewed++;
            } catch (chargeErr) {
                // 결제 실패 → 자동갱신 중지, 빌링키 폐기, trial로 전환
                console.error(`[Cron] charge failed for ${doc.id}:`, chargeErr.response?.data?.message || chargeErr.message);
                try {
                    await axios.post(
                        `https://api.tosspayments.com/v1/billing/authorizations/revoke`,
                        { billingKey: tossBillingKey },
                        { headers: { Authorization: TOSS_AUTH_HEADER() } }
                    );
                } catch (_) {}
                await adminDb.collection('users').doc(doc.id).update({
                    tier: 'trial',
                    autoRenew: false,
                    planId: null,
                    subscriptionMonths: null,
                    tossBillingKey: null,
                    tossCustomerKey: null,
                    subscriptionExpiresAt: null,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                failed++;
            }
        }

        console.log(`[Cron] renew-subscriptions done: ${renewed} renewed, ${failed} failed`);
        res.json({ success: true, renewed, failed, total: snapshot.size });
    } catch (err) {
        console.error('[Cron] renew-subscriptions error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Vocabulary Word Generation
 * POST /api/vocab-words
 * Body: { topic, topicLabel, category, level, targetLang, sourceLang, byokGeminiKey?, avoidWords? }
 */
app.post('/api/vocab-words', async (req, res) => {
    const { topic, topicLabel, category, level, targetLang, sourceLang, byokGeminiKey, avoidWords } = req.body;
    if (!topic || !targetLang) {
        return res.status(400).json({ error: 'Missing topic or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';

    const levelDesc = {
        basic: 'beginner level — most common, everyday words that a complete beginner should learn first',
        intermediate: 'intermediate level — useful vocabulary for daily conversations and practical situations',
        advanced: 'advanced level — sophisticated, nuanced, or specialized vocabulary for fluent expression',
    }[level] || 'intermediate level';

    const avoidBlock = (avoidWords && avoidWords.length > 0)
        ? `\nIMPORTANT — The learner has already learned the following words. You MUST generate completely different words:\n${avoidWords.map((w, i) => `${i + 1}. "${w}"`).join('\n')}\n`
        : '';

    const prompt = `You are a vocabulary teacher for language learners.

Context:
- Topic: ${topicLabel || topic} (Category: ${category || ''})
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- Level: ${levelDesc}
${avoidBlock}
Generate exactly 5 vocabulary words/phrases related to this topic.

Rules:
1. Each word must be practical and commonly used in real life for this topic
2. Match the difficulty level exactly
3. Include a clear, concise meaning and one natural example sentence
4. For zh-CN: include pinyin. For ja: include hiragana reading. For others: include romanization if applicable
5. All meanings, tips, and example translations must be in ${sourceLangName}

Return ONLY valid JSON (no markdown):
{
  "words": [
    {
      "word": "<word/phrase in ${targetLangName}>",
      "pronunciation": "<pinyin/hiragana/romanization or empty string>",
      "meaning": "<concise meaning in ${sourceLangName}>",
      "example": "<example sentence in ${targetLangName}>",
      "exampleTranslation": "<example translation in ${sourceLangName}>"
    }
  ]
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.5, topK: 64, topP: 0.95 },
            }
        );
        const raw = response.data.candidates[0].content.parts[0].text;
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);
        res.json(parsed);
    } catch (e) {
        console.error('[VocabWords] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate vocabulary' });
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
