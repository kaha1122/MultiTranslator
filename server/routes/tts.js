const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;

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

router.post('/api/azure-tts', requireAuth, async (req, res) => {
    const { text, langCode, emotion, byokAzureKey, byokAzureRegion } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const azureKey    = byokAzureKey    || AZURE_KEY;
    const azureRegion = byokAzureRegion || AZURE_REGION;
    if (!azureKey || !azureRegion) return res.status(500).json({ error: 'Azure TTS not configured' });

    const voiceInfo       = AZURE_TTS_VOICE_MAP[langCode] || { voice: 'en-US-JennyNeural', styles: ['chat'] };
    const voiceName       = voiceInfo.voice;
    const supportedStyles = voiceInfo.styles;
    const locale          = voiceName.split('-').slice(0, 2).join('-');
    const escaped         = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    let voiceStyle = null;
    if (supportedStyles.length > 0) {
        const mapped = emotion ? EMOTION_TO_STYLE[emotion.toLowerCase()] : null;
        voiceStyle = (mapped && supportedStyles.includes(mapped)) ? mapped : (supportedStyles.includes('chat') ? 'chat' : supportedStyles[0]);
    }

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

module.exports = router;
