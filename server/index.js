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

// 언어별 × 카테고리별 큐레이션 채널 (공신력 있는 공식 채널)
// ⚠️ 채널 ID 확인 필요한 항목은 최초 배포 후 검증 예정
const CURATED_CHANNELS = {
    en: {
        news:          [{ id: 'UCupvZG-5ko_eiXAupbDfxWw', name: 'CNN' }, { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News' }],
        culture:       [{ id: 'UCpVm7bg6pXKo1Pr6k5kxG9A', name: 'National Geographic' }],
        entertainment: [{ id: 'UC8-Th83bH_thdKZDJCrn88g', name: 'The Tonight Show' }],
        sports:        [{ id: 'UCiWLfSweyRNmLpgEHekhoAg', name: 'ESPN' }],
    },
    ja: {
        news:          [{ id: 'UCGCZAYq5Xxojl_tSXcVJhiQ', name: 'ANNnewsCH' }],
        culture:       [{ id: 'UCkKVQ_GNjd8FbAuT6xhl7eg', name: 'テレ東BIZ' }],
        entertainment: [{ id: 'UC1oPBUd3bVHkuY9jOHqiktQ', name: 'しくじり先生' }],
        sports:        [{ id: 'UCAnIalCSkauMhO0s7LkfN8Q', name: 'DAZN Japan' }],
    },
    ko: {
        news:          [{ id: 'UCcQTRi69dsVYHN3exePtZ1A', name: 'KBS News' }],
        culture:       [{ id: 'UCFVXsGx232hfnuynMFprbtA', name: 'EBS 다큐멘터리' }],
        entertainment: [{ id: 'UCVy7e2rKXMoTA8v1Vi2fBYA', name: 'SBS NOW' }],
        sports:        [{ id: 'UC0KjKLxg45UL_aMHOgtnDlA', name: 'KBS Sports' }],
    },
    'zh-CN': {
        news:          [{ id: 'UCcLK3j-XWdGBnt5bR9NJHaQ', name: 'CCTV' }],
        culture:       [{ id: 'UCKjkjESmXFJn2NGtNB_cNsA', name: '一条 Yit' }],
        entertainment: [{ id: 'UCtEPFHG37TBR8VrgtWJbCeg', name: '浙江卫视' }],
        sports:        [{ id: 'UC09IvZwjpunzrdHH1EHok-w', name: '央视体育' }],
    },
    fr: {
        news:          [{ id: 'UCCCPCZNChQdGa9EkATeye4g', name: 'FRANCE 24' }],
        culture:       [{ id: 'UCL_cZf5sHKQHMRIEax5o3rg', name: 'Arte' }],
        entertainment: [{ id: 'UC3BOBaUKIrieXZM23GfCe0Q', name: 'France Télévisions' }],
        sports:        [{ id: 'UCOchO7W1rXjE74MrpMiRFNg', name: "L'Équipe" }],
    },
    de: {
        news:          [{ id: 'UC5NOEUbkLheQcaaRldYW5GA', name: 'tagesschau' }],
        culture:       [{ id: 'UCMIgOXM2JEQ2Pv2d0_PVfcg', name: 'DW Deutsch' }],
        entertainment: [{ id: 'UC_EnhVnNQpPGLHIiGB0oSig', name: 'ZDF' }],
        sports:        [{ id: 'UCGBg1R2KSfFRrVSWxcoF2Nw', name: 'Bundesliga' }],
    },
    es: {
        news:          [{ id: 'UCf5u4MhbjLAk3iGiqhv2LPg', name: 'RTVE Noticias' }],
        culture:       [{ id: 'UCT2VGk-S_PM1Y1Y-1MUgodw', name: 'DW Español' }],
        entertainment: [{ id: 'UCup00HgCUk7Xv-5eorIHJ1g', name: 'Atresmedia' }],
        sports:        [{ id: 'UCshmOm7GR3VU0QTBX5Sb5Bw', name: 'LaLiga' }],
    },
    vi: {
        news:          [{ id: 'UCR1TJPMhmGsmM4JbFz86XxA', name: 'VTV24' }],
        culture:       [{ id: 'UCuFGhMEokJbiyF9rUKJFMLQ', name: 'VTV Giải Trí' }],
        entertainment: [{ id: 'UCruaM4824Rr_ry7fsD5Jwag', name: 'THVL Giải Trí' }],
        sports:        [{ id: 'UCVVkGFg3XsMnUvs6GQKCD9A', name: 'VTV Thể Thao' }],
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
 * Body: { text, langCode, byokAzureKey?, byokAzureRegion? }
 * Returns: audio/mpeg binary
 */
const AZURE_TTS_VOICE_MAP = {
    'en':    'en-US-JennyNeural',
    'ja':    'ja-JP-NanamiNeural',
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    'vi':    'vi-VN-HoaiMyNeural',
    'fr':    'fr-FR-DeniseNeural',
    'de':    'de-DE-KatjaNeural',
    'es':    'es-ES-ElviraNeural',
    'ko':    'ko-KR-SunHiNeural',
};

app.post('/api/azure-tts', async (req, res) => {
    const { text, langCode, byokAzureKey, byokAzureRegion } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const azureKey    = byokAzureKey    || AZURE_KEY;
    const azureRegion = byokAzureRegion || AZURE_REGION;
    if (!azureKey || !azureRegion) return res.status(500).json({ error: 'Azure TTS not configured' });

    const voiceName = AZURE_TTS_VOICE_MAP[langCode] || 'en-US-JennyNeural';
    const locale    = voiceName.split('-').slice(0, 2).join('-'); // e.g. "en-US"
    const escaped   = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const ssml      = `<speak version='1.0' xml:lang='${locale}'><voice xml:lang='${locale}' name='${voiceName}'>${escaped}</voice></speak>`;

    try {
        const response = await axios.post(
            `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
            ssml,
            {
                headers: {
                    'Ocp-Apim-Subscription-Key': azureKey,
                    'Content-Type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
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

const DIFFICULTY_DESC = {
    basic: 'beginner level — use only the most common, simple words and very short phrases',
    intermediate: 'intermediate level — use natural everyday expressions and moderate vocabulary',
    high: 'advanced level — use complex sentence structures, idiomatic expressions, and nuanced language',
};
const STYLE_DESC = {
    casual: 'casual, informal tone — as if speaking to a close friend; use contractions and relaxed language',
    formal: 'polite, formal tone — as if speaking to a stranger, staff, or superior; use respectful expressions',
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

    const avoidBlock = (avoidSentences && avoidSentences.length > 0)
        ? `\nIMPORTANT — The learner has already practiced the following sentences. You MUST generate a sentence that is completely different in structure and vocabulary from ALL of these:\n${avoidSentences.map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n`
        : '';

    const prompt = `You are a language learning coach. Generate a single natural QUESTION sentence for a learner to practice speaking in a real-life context.

Context:
- Scene: ${scene}
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- Difficulty: ${diffDesc}
- Speech style: ${styleDesc}
${avoidBlock}
Rules:
1. The sentence must be a QUESTION the LEARNER asks (e.g., asking staff, locals, or a counterpart in the scene)
2. Length: 8–18 words — short enough to practice in one breath
3. Match the difficulty and speech style exactly
4. The sentence must end with a question mark

Return ONLY valid JSON (no markdown):
{
  "sentence": "<sentence in ${targetLangName}>",
  "translation": "<translation in ${sourceLangName}>",
  "pronunciation": "<For zh-CN/zh: pinyin with tone marks (e.g. 'xǐ shǒu jiān'). For ja: hiragana reading (e.g. 'こんにちは'). For all other languages: empty string ''>",
  "scene_hint": "<one sentence in ${sourceLangName} describing the exact moment — e.g., '수하물을 못 찾아 직원에게 말하는 상황'>",
  "learning_tip": "<one pronunciation or expression tip in ${sourceLangName}>"
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.8, topK: 64, topP: 0.95 },
            }
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
    const { question, scene, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey, avoidSentences } = req.body;
    if (!question || !targetLang) {
        return res.status(400).json({ error: 'Missing question or targetLang' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const targetLangName = LANG_NAMES_FOR_SCENE[targetLang] || 'English';
    const sourceLangName = LANG_NAMES_FOR_SCENE[sourceLang] || 'Korean';
    const diffDesc = DIFFICULTY_DESC[difficulty] || DIFFICULTY_DESC.intermediate;
    const styleDesc = STYLE_DESC[speechStyle] || STYLE_DESC.formal;

    const avoidBlock = (avoidSentences && avoidSentences.length > 0)
        ? `\nIMPORTANT — The learner has already practiced the following reply sentences. You MUST generate a reply that is completely different in structure and vocabulary from ALL of these:\n${avoidSentences.map((s, i) => `${i + 1}. "${s}"`).join('\n')}\n`
        : '';

    const prompt = `You are a language learning coach. A learner just practiced saying a question in ${targetLangName}. Now generate a natural REPLY that the other person would say in response.

Context:
- Scene: ${scene}
- Question the learner said: "${question}"
- Target language: ${targetLangName}
- Learner's native language: ${sourceLangName}
- Difficulty: ${diffDesc}
- Speech style: ${styleDesc}
${avoidBlock}
Rules:
1. The sentence must be the OTHER PERSON'S natural reply to the question above
2. Length: 8–18 words — short enough to practice in one breath
3. Match the difficulty and speech style exactly
4. Make the reply directly relevant to the question asked

Return ONLY valid JSON (no markdown):
{
  "sentence": "<reply sentence in ${targetLangName}>",
  "translation": "<translation in ${sourceLangName}>",
  "pronunciation": "<For zh-CN/zh: pinyin with tone marks (e.g. 'xǐ shǒu jiān'). For ja: hiragana reading (e.g. 'こんにちは'). For all other languages: empty string ''>",
  "scene_hint": "<one sentence in ${sourceLangName} describing who is speaking and what they mean>",
  "learning_tip": "<one pronunciation or expression tip in ${sourceLangName}>"
}`;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.8, topK: 64, topP: 0.95 },
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
