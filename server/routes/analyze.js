const express = require('express');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { callGeminiText } = require('../utils/geminiCall');

const router = express.Router();

// 발음 코칭 팁 인메모리 LRU 캐시 — (refText + sourceLang + 점수밴드)별 재사용.
//   반복 연습·유저 간 동일 단어/점수대는 같은 팁 → Gemini 호출 급감 + 503 회피.
const coachCache = new Map();
const COACH_MAX = Number(process.env.COACH_CACHE_MAX || 1000);
const scoreBucket = (s) => (s >= 90 ? '90' : s >= 80 ? '80' : s >= 60 ? '60' : '0');

const UPLOADS_DIR = 'uploads/';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
// fileSize 상한 — 무제한 업로드(디스크/ffmpeg DoS) 차단. 발음 녹음은 수십 초 = 1~2MB 수준
const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { geminiUrl } = require('../config/gemini');

/**
 * 1. Azure Pronunciation Assessment (single attempt)
 */
async function analyzePronunciationAttempt(audioBuffer, referenceText, langCode, azureKey, azureRegion) {
    return new Promise((resolve, reject) => {
        const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer);
        const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);

        const azureLangMap = {
            'en': 'en-US',
            'ja': 'ja-JP',
            'zh': 'zh-CN',
            'zh-CN': 'zh-CN',
            'zh-TW': 'zh-TW',
            'ko': 'ko-KR',
            'es': 'es-ES',
            'fr': 'fr-FR',
            'de': 'de-DE',
            'ru': 'ru-RU',
            'pt-BR': 'pt-BR',
            'pt': 'pt-BR'
        };
        const targetLanguage = azureLangMap[langCode] || "en-US";
        speechConfig.speechRecognitionLanguage = targetLanguage;

        const pronConfig = new sdk.PronunciationAssessmentConfig(
            referenceText,
            sdk.PronunciationAssessmentGradingSystem.HundredMark,
            sdk.PronunciationAssessmentGranularity.Phoneme,
            true
        );
        pronConfig.enableProsodyAssessment = true;

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        pronConfig.applyTo(recognizer);

        recognizer.recognizeOnceAsync(result => {
            try {
                // 진단 로그: Azure 응답의 실제 내용 파악 (2026-04-24 장애 조사)
                const reasonName = sdk.ResultReason[result.reason] ?? `unknown(${result.reason})`;
                console.log(`[Azure-Diag] reason=${reasonName} lang=${targetLanguage} text="${(result.text || '').slice(0,60)}" refText="${(referenceText || '').slice(0,60)}" duration=${result.duration || 0}`);
                if (result.reason === sdk.ResultReason.Canceled) {
                    try {
                        const cancel = sdk.CancellationDetails.fromResult(result);
                        console.error(`[Azure-Diag] Cancelled: reason=${cancel.reason} errorCode=${cancel.errorCode} errorDetails="${cancel.errorDetails}"`);
                    } catch (e) {
                        console.error(`[Azure-Diag] fromResult(cancel) 실패:`, e?.message);
                    }
                }
                const jsonRaw = result.properties?.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
                if (!jsonRaw) {
                    console.warn(`[Azure-Diag] SpeechServiceResponse_JsonResult 비어있음 — NoMatch 또는 Cancel 상황`);
                }
                const pronResult = sdk.PronunciationAssessmentResult.fromResult(result);
                const realProsody = pronResult.prosodyScore;
                const displayProsody = realProsody > 0
                    ? realProsody
                    : Math.round((pronResult.fluencyScore + pronResult.accuracyScore) / 2);
                const output = {
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
                        // 1순위: Phonemes에 실제 기호 (영/불/독/서/러 등 IPA)
                        // 2순위: Phonemes의 NBestPhonemes 첫 후보 (Azure 내부 대체 기호)
                        // 3순위: Syllables (ja/zh/ko CJK 음절)
                        // 4순위: Phonemes 원본(빈 값이어도 점수는 있으므로 표시)
                        phonemes: (() => {
                            const hasPhonemeSymbols = w.Phonemes && w.Phonemes.some(p => p.Phoneme);
                            if (hasPhonemeSymbols) {
                                return w.Phonemes.map(p => ({
                                    phoneme: p.Phoneme || '',
                                    accuracyScore: p.PronunciationAssessment.AccuracyScore
                                }));
                            }
                            // NBestPhonemes fallback — 카타카나/한자 외래어 등에서 간혹 채워져 있음
                            const hasNBest = w.Phonemes && w.Phonemes.some(p => Array.isArray(p.NBestPhonemes) && p.NBestPhonemes.some(np => np.Phoneme));
                            if (hasNBest) {
                                return w.Phonemes.map(p => ({
                                    phoneme: (p.NBestPhonemes && p.NBestPhonemes[0] && p.NBestPhonemes[0].Phoneme) || '',
                                    accuracyScore: p.PronunciationAssessment.AccuracyScore
                                }));
                            }
                            if (w.Syllables && w.Syllables.length > 0) {
                                return w.Syllables.map(s => ({
                                    phoneme: s.Syllable || '',
                                    accuracyScore: s.PronunciationAssessment.AccuracyScore
                                }));
                            }
                            return (w.Phonemes || []).map(p => ({
                                phoneme: p.Phoneme || '',
                                accuracyScore: p.PronunciationAssessment.AccuracyScore
                            }));
                        })()
                    }))
                };
                recognizer.close();
                resolve(output);
            } catch (err) {
                // fromResult 내부에서 throwIfNullOrUndefined:json 등이 동기 throw되는 경우 보호
                recognizer.close();
                reject(err);
            }
        }, err => {
            recognizer.close();
            reject(err);
        });
    });
}

// Azure Speech transient 장애(throwIfNullOrUndefined:json, 지역 블립 등) 대응:
// 3회 시도(500ms → 1500ms backoff). 정상 케이스는 1회차에서 성공하므로 p50 영향 없음.
async function analyzePronunciation(audioPath, referenceText, langCode, azureKey = AZURE_KEY, azureRegion = AZURE_REGION) {
    const audioBuffer = fs.readFileSync(audioPath);
    const delays = [0, 500, 1500];
    let lastError;
    for (let attempt = 1; attempt <= delays.length; attempt++) {
        if (delays[attempt - 1] > 0) {
            await new Promise(r => setTimeout(r, delays[attempt - 1]));
        }
        try {
            const result = await analyzePronunciationAttempt(audioBuffer, referenceText, langCode, azureKey, azureRegion);
            if (attempt > 1) console.log(`[Azure] Pronunciation retry succeeded on attempt ${attempt}`);
            return result;
        } catch (err) {
            lastError = err;
            console.warn(`[Azure] Pronunciation attempt ${attempt}/${delays.length} failed: ${err?.message || err}`);
        }
    }
    throw lastError;
}

/**
 * 2. Gemini Coaching Tip Generation
 */
async function generateCoachingTip(referenceText, assessmentData, sourceLangCode, geminiKey = GEMINI_API_KEY) {
    const langNames = {
        'ko': 'Korean',
        'en': 'English',
        'ja': 'Japanese',
        'zh': 'Chinese (Simplified)',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'ru': 'Russian',
        'pt-BR': 'Portuguese (Brazil)',
        'pt': 'Portuguese',
        'vi': 'Vietnamese',
    };
    const targetLangName = langNames[sourceLangCode] || langNames[sourceLangCode?.split('-')[0]] || 'English';

    const fallbacks = {
        'ko': '현재 AI 코치 연결이 원활하지 않지만, 발음 연습을 응원합니다!',
        'en': 'The AI Coach is currently unavailable, but keep up the great pronunciation practice!',
        'ja': '現在AIコーチの接続が不安定ですが、発音練習を応援しています！',
        'zh': '目前AI教练连接不畅，但我们支持你的发音练习！',
        'ru': 'AI-тренер временно недоступен, но продолжайте практиковать произношение!',
        'pt': 'O treinador de IA está temporariamente indisponível, mas continue praticando a pronúncia!'
    };
    const fallbackTip = fallbacks[sourceLangCode?.split('-')[0]] || fallbacks['ko'];

    // 캐시 조회 — (refText + sourceLang + 점수밴드). 같은 단어/점수대는 같은 팁 재사용(Gemini 0).
    const cacheKey = `${sourceLangCode}|${scoreBucket(assessmentData.pronunciationScore || 0)}|${referenceText}`;
    const cachedTip = coachCache.get(cacheKey);
    if (cachedTip !== undefined) {
        coachCache.delete(cacheKey); coachCache.set(cacheKey, cachedTip); // LRU 갱신
        return cachedTip;
    }

    const prompt = `
    You are a friendly and expert pronunciation coach.
    A student tried to say: "${referenceText}"

    Here are their Azure Pronunciation Assessment results:
    - Overall Score: ${assessmentData.pronunciationScore}
    - Accuracy: ${assessmentData.accuracyScore}
    - Fluency: ${assessmentData.fluencyScore}

    Word-level breakdown (with phoneme detail where available):
    ${assessmentData.words.map(w => {
        const phonemeDetail = w.phonemes?.length
            ? ` [phonemes: ${w.phonemes.map(p => `${p.phoneme}(${p.accuracyScore})`).join(', ')}]`
            : '';
        return `- "${w.word}": Accuracy ${w.accuracyScore}, Error: ${w.errorType}${phonemeDetail}`;
    }).join('\n')}

    Based on this data, provide ONE short, encouraging coaching tip (max 2 sentences) in EXACTLY ${targetLangName}.
    CRITICAL RULES:
    1. Write the entire tip in ${targetLangName}. However, when referring to specific words or phonemes, ALWAYS use the ORIGINAL script/characters from the student's sentence (e.g., write "电影" or "diànyǐng", NEVER translate them into ${targetLangName} equivalents like "영화" or "movie").
    2. Vary your responses! Do not use generic fallback phrases. Provide unique insight based on actual performance.
    3. If they scored 100/100, enthusiastically praise their perfect pronunciation with varied phrasing.
    4. Return ONLY the tip text in ${targetLangName}, nothing else.
    `;

    // callGeminiText: Flash-Lite 재시도 → 503 등 시 Flash로 자동 폴백 (코칭 503 무방비 해소)
    const result = await callGeminiText(prompt, geminiKey, {
        genConfig: { temperature: 1.0, topK: 40, topP: 0.95 },
        label: 'CoachingTip',
    });
    if (result.text) {
        coachCache.set(cacheKey, result.text);
        while (coachCache.size > COACH_MAX) coachCache.delete(coachCache.keys().next().value);
        return result.text;
    }
    return fallbackTip; // Flash 폴백까지 실패 — 정적 폴백(캐시 안 함)
}

/**
 * Main Analysis Endpoint
 */
// 2026-06-11 서버 권위 확립: 인증을 multer 앞에 배치 — 무토큰 요청이 디스크에 파일을
// 쓰기 전에 차단. 발음평가는 최고가 경로(STT+Enhanced)라 rate limit 필수.
router.post('/analyze', requireAuth, rateLimit('analyze', { perMinute: 20, perHour: 200 }), upload.single('audio'), async (req, res) => {
    const originalAudioPath = req.file?.path;
    const referenceText = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    const langCode = req.body.lang || 'en';

    // 'undefined'/'null'은 클라 FormData가 JS undefined/null을 문자열화한 값 — 빈 텍스트와 동일 취급.
    //   이게 통과하면 Azure가 refText="undefined"로 엉뚱하게 평가(2026-06-21 GBqG... 사례).
    if (!originalAudioPath || !referenceText || referenceText === 'undefined' || referenceText === 'null') {
        if (originalAudioPath) { try { fs.unlinkSync(originalAudioPath); } catch (_) { /* noop */ } }
        return res.status(400).json({ error: "Missing audio or text" });
    }
    if (referenceText.length > 1000) {
        try { fs.unlinkSync(originalAudioPath); } catch (_) { /* noop */ }
        return res.status(413).json({ error: 'Reference text too long (max 1000 chars)' });
    }

    const audioPath = `${originalAudioPath}.wav`;

    try {
        await new Promise((resolve, reject) => {
            ffmpeg(originalAudioPath)
                .toFormat('wav')
                .audioChannels(1)
                .audioFrequency(16000)
                .audioCodec('pcm_s16le')
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(audioPath);
        });

        const azureKeyToUse = req.body.userAzureKey || AZURE_KEY;
        const azureRegionToUse = req.body.userAzureRegion || AZURE_REGION;
        const geminiKeyToUse = req.body.userGeminiKey || GEMINI_API_KEY;

        const assessment = await analyzePronunciation(audioPath, referenceText, langCode, azureKeyToUse, azureRegionToUse);
        // 온보딩 첫발음 등은 코칭 팁을 표시하지 않으므로 Gemini 호출 생략(불필요 과금/지연 제거)
        const skipCoaching = req.body.skipCoaching === '1' || req.body.skipCoaching === true;
        const tip = skipCoaching ? '' : await generateCoachingTip(referenceText, assessment, req.body.sourceLang, geminiKeyToUse);

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

module.exports = router;
