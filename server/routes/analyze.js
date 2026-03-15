const express = require('express');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOADS_DIR = 'uploads/';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOADS_DIR });

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

        const azureLangMap = {
            'en': 'en-US',
            'ja': 'ja-JP',
            'zh': 'zh-CN',
            'zh-CN': 'zh-CN',
            'zh-TW': 'zh-TW',
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
        pronConfig.enableProsodyAssessment = true;

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        pronConfig.applyTo(recognizer);

        recognizer.recognizeOnceAsync(result => {
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
router.post('/analyze', upload.single('audio'), optionalAuth, async (req, res) => {
    const originalAudioPath = req.file?.path;
    const referenceText = req.body.text;
    const langCode = req.body.lang || 'en';

    if (!originalAudioPath || !referenceText) {
        return res.status(400).json({ error: "Missing audio or text" });
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
        const tip = await generateCoachingTip(referenceText, assessment, req.body.sourceLang, geminiKeyToUse);

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
