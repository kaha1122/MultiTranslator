const express = require('express');
const multer = require('multer');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// API Keys (To be set in .env)
const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Default Adam voice

/**
 * 1. Azure Pronunciation Assessment
 */
async function analyzePronunciation(audioPath, referenceText) {
    return new Promise((resolve, reject) => {
        const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(audioPath));
        const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_KEY, AZURE_REGION);
        speechConfig.speechRecognitionLanguage = "en-US"; // Default to English for now

        const pronConfig = new sdk.PronunciationAssessmentConfig(
            referenceText,
            sdk.PronunciationAssessmentGradingSystem.HundredMark,
            sdk.PronunciationAssessmentGranularity.Phoneme,
            true
        );

        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        pronConfig.applyTo(recognizer);

        recognizer.recognizeOnceAsync(result => {
            const pronResult = sdk.PronunciationAssessmentResult.fromResult(result);
            const output = {
                pronunciationScore: pronResult.pronunciationScore,
                accuracyScore: pronResult.accuracyScore,
                fluencyScore: pronResult.fluencyScore,
                completenessScore: pronResult.completenessScore,
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
async function generateCoachingTip(referenceText, assessmentData) {
    const prompt = `
    You are a friendly and expert English pronunciation coach. 
    A student tried to say: "${referenceText}"
    
    Here are their Azure Pronunciation Assessment results:
    - Overall Score: ${assessmentData.pronunciationScore}
    - Accuracy: ${assessmentData.accuracyScore}
    - Fluency: ${assessmentData.fluencyScore}
    
    Word-level breakdown:
    ${assessmentData.words.map(w => `- ${w.word}: Accuracy ${w.accuracyScore}, Error: ${w.errorType}`).join('\n')}
    
    Based on this data, provide ONE short, encouraging coaching tip (max 2 sentences) in Korean. 
    Focus on the weakest part or a general tip to sound more natural.
    Return ONLY the tip text.
    `;

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("Gemini Error:", error.response?.data || error.message);
        return "정말 잘하셨어요! 조금만 더 연습하면 원어민처럼 발음할 수 있을 거예요.";
    }
}

/**
 * 3. ElevenLabs Text-to-Speech
 */
async function generateCoachAudio(text) {
    try {
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
            {
                text: text,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            },
            {
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json"
                },
                responseType: 'arraybuffer'
            }
        );
        return Buffer.from(response.data).toString('base64');
    } catch (error) {
        console.error("ElevenLabs Error:", error.response?.data || error.message);
        return null; // Fallback to no audio if ElevenLabs fails
    }
}

/**
 * Main Analysis Endpoint
 */
app.post('/analyze', upload.single('audio'), async (req, res) => {
    const audioPath = req.file?.path;
    const referenceText = req.body.text;

    if (!audioPath || !referenceText) {
        return res.status(400).json({ error: "Missing audio or text" });
    }

    try {
        // 1. Azure Assessment
        const assessment = await analyzePronunciation(audioPath, referenceText);

        // 2. Gemini Coaching
        const tip = await generateCoachingTip(referenceText, assessment);

        // 3. ElevenLabs Audio
        const audioBase64 = await generateCoachAudio(tip);

        // Cleanup
        fs.unlinkSync(audioPath);

        res.json({
            assessment,
            coaching: {
                tip,
                audio: audioBase64 // Base64 encoded WAV/MP3
            }
        });
    } catch (error) {
        console.error("Analysis Pipeline Failed:", error);
        if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 AI Orchestrator running on http://localhost:${PORT}`);
    if (!AZURE_KEY) console.warn("⚠️ AZURE_SPEECH_KEY is missing in .env");
    if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY is missing in .env");
    if (!ELEVENLABS_API_KEY) console.warn("⚠️ ELEVENLABS_API_KEY is missing in .env");
});
