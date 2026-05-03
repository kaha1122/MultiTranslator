const express = require('express');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { optionalAuth } = require('../middleware/auth');
const { buildStartPrompt, buildReplyPrompt } = require('../utils/conversationPrompt');
const { stripAnnotations } = require('../utils/stripAnnotations');
const { geminiUrl } = require('../config/gemini');

const router = express.Router();

const UPLOADS_DIR = 'uploads/';
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOADS_DIR });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;

// ── /api/converse-tts에서 voice/style을 결정하기 위한 매핑 ────────────────
// scene/listening/scene-answer와 동일한 voice 모음을 활용하기 위해 tts.js와 동일 정의를
// 미러링한다. (tts.js export 시 하위 변경 위험이 있어 보수적으로 별도 정의)
const AZURE_TTS_VOICE_MAP = {
    'en':    { voiceFemale: 'en-US-JennyNeural',      voiceMale: 'en-US-GuyNeural',        styles: ['chat','cheerful','sad','angry','excited','friendly','hopeful','empathetic'] },
    'ja':    { voiceFemale: 'ja-JP-NanamiNeural',      voiceMale: 'ja-JP-KeitaNeural',      styles: ['chat'] },
    'zh-CN': { voiceFemale: 'zh-CN-XiaoxiaoNeural',    voiceMale: 'zh-CN-YunxiNeural',      styles: ['chat','cheerful','sad','angry','fearful','gentle','serious','friendly','empathetic','calm'] },
    'vi':    { voiceFemale: 'vi-VN-HoaiMyNeural',       voiceMale: 'vi-VN-NamMinhNeural',    styles: [] },
    'fr':    { voiceFemale: 'fr-FR-DeniseNeural',       voiceMale: 'fr-FR-HenriNeural',      styles: [] },
    'de':    { voiceFemale: 'de-DE-KatjaNeural',        voiceMale: 'de-DE-ConradNeural',     styles: [] },
    'es':    { voiceFemale: 'es-ES-ElviraNeural',       voiceMale: 'es-ES-AlvaroNeural',     styles: [] },
    'ko':    { voiceFemale: 'ko-KR-SunHiNeural',        voiceMale: 'ko-KR-InJoonNeural',     styles: ['chat','cheerful','sad','angry','friendly'] },
    'ru':    { voiceFemale: 'ru-RU-SvetlanaNeural',     voiceMale: 'ru-RU-DmitryNeural',     styles: [] },
    'pt-BR': { voiceFemale: 'pt-BR-FranciscaNeural',    voiceMale: 'pt-BR-AntonioNeural',    styles: [] },
    'ar':    { voiceFemale: 'ar-SA-ZariyahNeural',      voiceMale: 'ar-SA-HamedNeural',      styles: [] },
    'bn':    { voiceFemale: 'bn-IN-TanishaaNeural',     voiceMale: 'bn-IN-BashkarNeural',    styles: [] },
    'bg':    { voiceFemale: 'bg-BG-KalinaNeural',       voiceMale: 'bg-BG-BorislavNeural',   styles: [] },
    'zh-TW': { voiceFemale: 'zh-TW-HsiaoChenNeural',    voiceMale: 'zh-TW-YunJheNeural',     styles: [] },
    'hr':    { voiceFemale: 'hr-HR-GabrijelaNeural',    voiceMale: 'hr-HR-SreckoNeural',     styles: [] },
    'cs':    { voiceFemale: 'cs-CZ-VlastaNeural',       voiceMale: 'cs-CZ-AntoninNeural',    styles: [] },
    'da':    { voiceFemale: 'da-DK-ChristelNeural',     voiceMale: 'da-DK-JeppeNeural',      styles: [] },
    'nl':    { voiceFemale: 'nl-NL-ColetteNeural',      voiceMale: 'nl-NL-MaartenNeural',    styles: [] },
    'et':    { voiceFemale: 'et-EE-AnuNeural',          voiceMale: 'et-EE-KertNeural',       styles: [] },
    'fi':    { voiceFemale: 'fi-FI-NooraNeural',        voiceMale: 'fi-FI-HarriNeural',      styles: [] },
    'el':    { voiceFemale: 'el-GR-AthinaNeural',       voiceMale: 'el-GR-NestorasNeural',   styles: [] },
    'he':    { voiceFemale: 'he-IL-HilaNeural',         voiceMale: 'he-IL-AvriNeural',       styles: [] },
    'hi':    { voiceFemale: 'hi-IN-SwaraNeural',        voiceMale: 'hi-IN-ArjunNeural',      styles: [] },
    'hu':    { voiceFemale: 'hu-HU-NoemiNeural',        voiceMale: 'hu-HU-TamasNeural',      styles: [] },
    'id':    { voiceFemale: 'id-ID-GadisNeural',        voiceMale: 'id-ID-ArdiNeural',       styles: [] },
    'it':    { voiceFemale: 'it-IT-ElsaNeural',         voiceMale: 'it-IT-DiegoNeural',      styles: [] },
    'lv':    { voiceFemale: 'lv-LV-EveritaNeural',     voiceMale: 'lv-LV-NilsNeural',       styles: [] },
    'lt':    { voiceFemale: 'lt-LT-OnaNeural',          voiceMale: 'lt-LT-LeonasNeural',     styles: [] },
    'no':    { voiceFemale: 'nb-NO-PernilleNeural',     voiceMale: 'nb-NO-FinnNeural',       styles: [] },
    'pl':    { voiceFemale: 'pl-PL-AgnieszkaNeural',    voiceMale: 'pl-PL-MarekNeural',      styles: [] },
    'ro':    { voiceFemale: 'ro-RO-AlinaNeural',        voiceMale: 'ro-RO-EmilNeural',       styles: [] },
    'sr':    { voiceFemale: 'sr-RS-SophieNeural',       voiceMale: 'sr-RS-NicholasNeural',   styles: [] },
    'sk':    { voiceFemale: 'sk-SK-ViktoriaNeural',     voiceMale: 'sk-SK-LukasNeural',      styles: [] },
    'sl':    { voiceFemale: 'sl-SI-PetraNeural',        voiceMale: 'sl-SI-RokNeural',        styles: [] },
    'sw':    { voiceFemale: 'sw-KE-ZuriNeural',         voiceMale: 'sw-KE-RafikiNeural',     styles: [] },
    'sv':    { voiceFemale: 'sv-SE-SofieNeural',        voiceMale: 'sv-SE-MattiasNeural',    styles: [] },
    'th':    { voiceFemale: 'th-TH-PremwadeeNeural',    voiceMale: 'th-TH-NiwatNeural',      styles: [] },
    'tr':    { voiceFemale: 'tr-TR-EmelNeural',         voiceMale: 'tr-TR-AhmetNeural',      styles: [] },
    'uk':    { voiceFemale: 'uk-UA-PolinaNeural',       voiceMale: 'uk-UA-OstapNeural',      styles: [] },
};

// emotion → Azure style 매핑 (tts.js와 동일 — 의도적으로 미러)
const EMOTION_TO_STYLE = {
    'frustrated': 'angry', 'angry': 'angry', 'annoyed': 'angry', 'impatient': 'angry',
    'sad': 'sad', 'disappointed': 'sad', 'homesick': 'sad', 'lonely': 'sad',
    'cheerful': 'cheerful', 'excited': 'excited', 'happy': 'cheerful', 'grateful': 'cheerful',
    'relieved': 'cheerful', 'delighted': 'cheerful',
    'curious': 'friendly', 'friendly': 'friendly', 'interested': 'friendly', 'surprised': 'friendly',
    'hopeful': 'hopeful', 'optimistic': 'hopeful',
    'hesitant': 'gentle', 'shy': 'gentle', 'nervous': 'gentle', 'embarrassed': 'gentle',
    'uncertain': 'gentle', 'worried': 'gentle',
    'calm': 'calm', 'confident': 'chat',
    'apologetic': 'empathetic', 'empathetic': 'empathetic', 'sympathetic': 'empathetic', 'concerned': 'empathetic',
    'serious': 'serious',
    'urgent': 'fearful', 'fearful': 'fearful', 'panicked': 'fearful',
};

const escapeXml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// ─────────────────────────────────────────────────────────────────────────
// POST /api/converse-start
//   3-메시지(intro / firstUserTurn / firstAiReply)를 단일 LLM 호출로 생성.
//   기존 /api/scene-sentence + /api/scene-answer 의 Phase/Rules/스키마를 재활용.
// ─────────────────────────────────────────────────────────────────────────
router.post('/api/converse-start', optionalAuth, async (req, res) => {
    const { scene, category, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey } = req.body || {};
    if (!scene || !targetLang || !sourceLang) {
        return res.status(400).json({ error: 'Missing scene, targetLang, or sourceLang' });
    }
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const prompt = buildStartPrompt({ scene, category, targetLang, sourceLang, difficulty, speechStyle });

    try {
        const response = await axios.post(
            geminiUrl(geminiKey),
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.3, topK: 64, topP: 0.95 },
            },
            { timeout: 30000 }
        );
        const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        let parsed;
        try { parsed = JSON.parse(jsonStr); }
        catch (parseErr) {
            console.error('[ConverseStart] JSON parse failed:', parseErr.message, 'raw:', raw.slice(0, 200));
            return res.status(502).json({ error: 'AI returned invalid JSON' });
        }

        // 후처리: 두 turn 의 sentence 에 stripAnnotations 적용 (보험)
        if (parsed?.firstUserTurn?.sentence) {
            parsed.firstUserTurn.sentence = stripAnnotations(parsed.firstUserTurn.sentence, targetLang);
        }
        if (parsed?.firstAiReply?.sentence) {
            parsed.firstAiReply.sentence = stripAnnotations(parsed.firstAiReply.sentence, targetLang);
        }

        // 최소 필드 검증
        if (!parsed?.intro?.text || !parsed?.firstUserTurn?.sentence || !parsed?.firstAiReply?.sentence) {
            console.error('[ConverseStart] Missing required fields in response:', Object.keys(parsed || {}));
            return res.status(502).json({ error: 'AI response missing required fields' });
        }

        res.json(parsed);
    } catch (e) {
        console.error('[ConverseStart] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate conversation start' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/converse-tts
//   Azure TTS로 음성 합성하면서 WordBoundary 이벤트로 단어별 timing 캡처.
//   응답: { audio: <base64 mp3>, words: [{word, offsetMs, durationMs}, ...] }
//   클라이언트 useTTSSyncedReveal에서 audio.currentTime과 비교하여 단어별 reveal.
// ─────────────────────────────────────────────────────────────────────────
router.post('/api/converse-tts', optionalAuth, async (req, res) => {
    const { text, langCode, emotion, speaker, byokAzureKey, byokAzureRegion } = req.body || {};
    if (!text || !langCode) return res.status(400).json({ error: 'Missing text or langCode' });

    const azureKey = byokAzureKey || AZURE_KEY;
    const azureRegion = byokAzureRegion || AZURE_REGION;
    if (!azureKey || !azureRegion) return res.status(500).json({ error: 'Azure TTS not configured' });

    const voiceInfo = AZURE_TTS_VOICE_MAP[langCode] || { voiceFemale: 'en-US-JennyNeural', voiceMale: 'en-US-GuyNeural', styles: ['chat'] };
    const voiceName = (speaker === 'male')
        ? (voiceInfo.voiceMale || voiceInfo.voiceFemale)
        : (voiceInfo.voiceFemale || voiceInfo.voiceMale);
    const supportedStyles = voiceInfo.styles || [];
    const locale = voiceName.split('-').slice(0, 2).join('-');

    let voiceStyle = null;
    if (supportedStyles.length > 0) {
        const mapped = emotion ? EMOTION_TO_STYLE[String(emotion).toLowerCase()] : null;
        voiceStyle = (mapped && supportedStyles.includes(mapped))
            ? mapped
            : (supportedStyles.includes('chat') ? 'chat' : supportedStyles[0]);
    }

    const escaped = escapeXml(text);
    const inner = voiceStyle
        ? `<mstts:express-as style="${voiceStyle}"><prosody rate="0%" pitch="0%">${escaped}</prosody></mstts:express-as>`
        : `<prosody rate="0%" pitch="0%">${escaped}</prosody>`;
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${locale}'><voice xml:lang='${locale}' name='${voiceName}'>${inner}</voice></speak>`;

    try {
        const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3;

        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

        // WordBoundary 이벤트 캡처 (Azure는 100ns ticks → ms = ticks/10000)
        const words = [];
        synthesizer.wordBoundary = (_s, e) => {
            words.push({
                word: e.text,
                offsetMs: Math.round(e.audioOffset / 10000),
                durationMs: Math.round(e.duration / 10000),
            });
        };

        const result = await new Promise((resolve, reject) => {
            synthesizer.speakSsmlAsync(
                ssml,
                r => { synthesizer.close(); resolve(r); },
                err => { synthesizer.close(); reject(err); }
            );
        });

        if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
            const reasonName = sdk.ResultReason[result.reason] ?? `unknown(${result.reason})`;
            console.error('[ConverseTTS] synthesis non-completed:', reasonName);
            return res.status(502).json({ error: 'TTS synthesis failed', reason: reasonName });
        }

        const audioBase64 = Buffer.from(result.audioData).toString('base64');
        res.json({
            audio: audioBase64,
            mimeType: 'audio/mpeg',
            words,
            durationMs: words.length > 0
                ? words[words.length - 1].offsetMs + words[words.length - 1].durationMs
                : 0,
        });
    } catch (e) {
        console.error('[ConverseTTS] Error:', e?.message || e);
        res.status(500).json({ error: 'TTS failed' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/converse-stt
//   자유 발화 → Azure STT (발음 평가 없이 텍스트만).
//   클라이언트가 webm/m4a/wav 어떤 포맷이든 보낼 수 있어, ffmpeg으로 16kHz mono PCM WAV 변환 후 SDK에 전달.
//   요청: multipart/form-data { audio: file, langCode: string }
//   응답: { transcript: string, durationMs: number }
// ─────────────────────────────────────────────────────────────────────────
const azureLangMap = {
    'en': 'en-US', 'ja': 'ja-JP', 'zh': 'zh-CN', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
    'ko': 'ko-KR', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE', 'ru': 'ru-RU',
    'pt-BR': 'pt-BR', 'pt': 'pt-BR', 'vi': 'vi-VN', 'ar': 'ar-SA', 'bn': 'bn-IN',
    'bg': 'bg-BG', 'hr': 'hr-HR', 'cs': 'cs-CZ', 'da': 'da-DK', 'nl': 'nl-NL',
    'et': 'et-EE', 'fi': 'fi-FI', 'el': 'el-GR', 'he': 'he-IL', 'hi': 'hi-IN',
    'hu': 'hu-HU', 'id': 'id-ID', 'it': 'it-IT', 'lv': 'lv-LV', 'lt': 'lt-LT',
    'no': 'nb-NO', 'pl': 'pl-PL', 'ro': 'ro-RO', 'sr': 'sr-RS', 'sk': 'sk-SK',
    'sl': 'sl-SI', 'sw': 'sw-KE', 'sv': 'sv-SE', 'th': 'th-TH', 'tr': 'tr-TR',
    'uk': 'uk-UA',
};

function recognizeOnceFromWav(wavPath, azureLocale, azureKey, azureRegion) {
    return new Promise((resolve, reject) => {
        try {
            const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(wavPath));
            const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
            speechConfig.speechRecognitionLanguage = azureLocale;
            const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
            recognizer.recognizeOnceAsync(result => {
                try {
                    const reasonName = sdk.ResultReason[result.reason] ?? `unknown(${result.reason})`;
                    if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                        recognizer.close();
                        resolve({ transcript: result.text || '', durationMs: Math.round((result.duration || 0) / 10000) });
                    } else if (result.reason === sdk.ResultReason.NoMatch) {
                        recognizer.close();
                        resolve({ transcript: '', durationMs: 0, reason: 'NoMatch' });
                    } else {
                        recognizer.close();
                        reject(new Error(`STT non-recognized: ${reasonName}`));
                    }
                } catch (e) {
                    recognizer.close();
                    reject(e);
                }
            }, err => { recognizer.close(); reject(err); });
        } catch (e) {
            reject(e);
        }
    });
}

router.post('/api/converse-stt', optionalAuth, upload.single('audio'), async (req, res) => {
    const langCode = req.body?.langCode;
    const azureKey = req.body?.byokAzureKey || AZURE_KEY;
    const azureRegion = req.body?.byokAzureRegion || AZURE_REGION;

    if (!req.file) return res.status(400).json({ error: 'Missing audio file' });
    if (!langCode) {
        try { fs.unlinkSync(req.file.path); } catch (e) { /* noop */ }
        return res.status(400).json({ error: 'Missing langCode' });
    }
    if (!azureKey || !azureRegion) {
        try { fs.unlinkSync(req.file.path); } catch (e) { /* noop */ }
        return res.status(500).json({ error: 'Azure STT not configured' });
    }

    const inputPath = req.file.path;
    const wavPath = `${inputPath}.wav`;
    const azureLocale = azureLangMap[langCode] || 'en-US';

    try {
        // ffmpeg으로 16kHz mono PCM WAV 변환 (Azure SDK 권장)
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioCodec('pcm_s16le')
                .audioFrequency(16000)
                .audioChannels(1)
                .format('wav')
                .save(wavPath)
                .on('end', resolve)
                .on('error', reject);
        });

        const result = await recognizeOnceFromWav(wavPath, azureLocale, azureKey, azureRegion);
        res.json({ transcript: result.transcript || '', durationMs: result.durationMs || 0 });
    } catch (e) {
        console.error('[ConverseSTT] Error:', e?.message || e);
        res.status(500).json({ error: 'STT failed', detail: e?.message });
    } finally {
        try { fs.unlinkSync(inputPath); } catch (e) { /* noop */ }
        try { fs.unlinkSync(wavPath); } catch (e) { /* noop */ }
    }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/converse-reply
//   자유 발화 STT 결과 + 대화 컨텍스트로 (A) 의도 보정 + (B) AI 응답 단일 호출.
//   요청: { rawSttText, history, scenarioMeta, targetLang, sourceLang, difficulty, speechStyle }
//   응답: { intentText, intentWasCorrected, intentTranslation, aiReply: {...} }
// ─────────────────────────────────────────────────────────────────────────
router.post('/api/converse-reply', optionalAuth, async (req, res) => {
    const {
        rawSttText, history, scenarioMeta,
        targetLang, sourceLang, difficulty, speechStyle,
        byokGeminiKey,
    } = req.body || {};
    if (!rawSttText || !targetLang || !sourceLang) {
        return res.status(400).json({ error: 'Missing rawSttText, targetLang, or sourceLang' });
    }
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const prompt = buildReplyPrompt({
        rawSttText, history: history || [], scenarioMeta: scenarioMeta || {},
        targetLang, sourceLang, difficulty, speechStyle,
    });

    try {
        const response = await axios.post(
            geminiUrl(geminiKey),
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.1, topK: 40, topP: 0.95 },
            },
            { timeout: 30000 }
        );
        const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        let parsed;
        try { parsed = JSON.parse(jsonStr); }
        catch (parseErr) {
            console.error('[ConverseReply] JSON parse failed:', parseErr.message, 'raw:', raw.slice(0, 200));
            return res.status(502).json({ error: 'AI returned invalid JSON' });
        }

        // 후처리
        if (parsed?.intentText) {
            parsed.intentText = stripAnnotations(parsed.intentText, targetLang);
        }
        if (parsed?.aiReply?.sentence) {
            parsed.aiReply.sentence = stripAnnotations(parsed.aiReply.sentence, targetLang);
        }

        // 최소 필드 검증
        if (!parsed?.intentText || !parsed?.aiReply?.sentence) {
            console.error('[ConverseReply] Missing required fields:', Object.keys(parsed || {}));
            return res.status(502).json({ error: 'AI response missing required fields' });
        }

        res.json(parsed);
    } catch (e) {
        console.error('[ConverseReply] Error:', e.response?.data || e.message);
        res.status(500).json({ error: 'Failed to generate reply' });
    }
});

module.exports = router;
