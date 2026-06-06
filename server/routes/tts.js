const express = require('express');
const axios = require('axios');
const { optionalAuth } = require('../middleware/auth');
const ttsCache = require('../utils/ttsCache');

const router = express.Router();

const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_REGION = process.env.AZURE_SPEECH_REGION;

// 각 언어별 Azure Neural voice 매핑
// voiceFemale: 기본 voice (단일 voice 경로의 기본값, dialogue turns의 speaker A 기본)
// voiceMale: dialogue turns의 speaker B 기본 — 남녀 대화 구분용
// 하위호환: legacy `voice` 필드를 읽는 곳이 있을 수 있어 voiceFemale 별칭으로 voice도 유지
const AZURE_TTS_VOICE_MAP = {
    // 기존 10개 언어
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
    // 추가 Tier 1 언어 (28개)
    'ar':    { voiceFemale: 'ar-SA-ZariyahNeural',      voiceMale: 'ar-SA-HamedNeural',      styles: [] },
    'bn':    { voiceFemale: 'bn-IN-TanishaaNeural',     voiceMale: 'bn-IN-BashkarNeural',    styles: [] },
    'bg':    { voiceFemale: 'bg-BG-KalinaNeural',       voiceMale: 'bg-BG-BorislavNeural',   styles: [] },
    'zh-TW': { voiceFemale: 'zh-TW-HsiaoChenNeural',    voiceMale: 'zh-TW-YunJheNeural',     styles: [] },
    'hr':    { voiceFemale: 'hr-HR-GabrijelaNeural',    voiceMale: 'hr-HR-SreckoNeural',     styles: [] },
    'cs':    { voiceFemale: 'cs-CZ-VlastaNeural',       voiceMale: 'cs-CZ-AntoninNeural',    styles: [] },
    'da':    { voiceFemale: 'da-DK-ChristelNeural',     voiceMale: 'da-DK-JeppeNeural',      styles: [] },
    'nl':    { voiceFemale: 'nl-NL-ColetteNeural',      voiceMale: 'nl-NL-MaartenNeural',    styles: [] },
    'et':    { voiceFemale: 'et-EE-AnuNeural',           voiceMale: 'et-EE-KertNeural',       styles: [] },
    'fi':    { voiceFemale: 'fi-FI-NooraNeural',         voiceMale: 'fi-FI-HarriNeural',      styles: [] },
    'el':    { voiceFemale: 'el-GR-AthinaNeural',        voiceMale: 'el-GR-NestorasNeural',   styles: [] },
    'he':    { voiceFemale: 'he-IL-HilaNeural',          voiceMale: 'he-IL-AvriNeural',       styles: [] },
    'hi':    { voiceFemale: 'hi-IN-SwaraNeural',         voiceMale: 'hi-IN-ArjunNeural',      styles: [] },
    'hu':    { voiceFemale: 'hu-HU-NoemiNeural',         voiceMale: 'hu-HU-TamasNeural',      styles: [] },
    'id':    { voiceFemale: 'id-ID-GadisNeural',         voiceMale: 'id-ID-ArdiNeural',       styles: [] },
    'it':    { voiceFemale: 'it-IT-ElsaNeural',          voiceMale: 'it-IT-DiegoNeural',      styles: [] },
    'lv':    { voiceFemale: 'lv-LV-EveritaNeural',      voiceMale: 'lv-LV-NilsNeural',       styles: [] },
    'lt':    { voiceFemale: 'lt-LT-OnaNeural',           voiceMale: 'lt-LT-LeonasNeural',     styles: [] },
    'no':    { voiceFemale: 'nb-NO-PernilleNeural',      voiceMale: 'nb-NO-FinnNeural',       styles: [] },
    'pl':    { voiceFemale: 'pl-PL-AgnieszkaNeural',     voiceMale: 'pl-PL-MarekNeural',      styles: [] },
    'ro':    { voiceFemale: 'ro-RO-AlinaNeural',         voiceMale: 'ro-RO-EmilNeural',       styles: [] },
    'sr':    { voiceFemale: 'sr-RS-SophieNeural',        voiceMale: 'sr-RS-NicholasNeural',   styles: [] },
    'sk':    { voiceFemale: 'sk-SK-ViktoriaNeural',      voiceMale: 'sk-SK-LukasNeural',      styles: [] },
    'sl':    { voiceFemale: 'sl-SI-PetraNeural',         voiceMale: 'sl-SI-RokNeural',        styles: [] },
    'sw':    { voiceFemale: 'sw-KE-ZuriNeural',          voiceMale: 'sw-KE-RafikiNeural',     styles: [] },
    'sv':    { voiceFemale: 'sv-SE-SofieNeural',         voiceMale: 'sv-SE-MattiasNeural',    styles: [] },
    'th':    { voiceFemale: 'th-TH-PremwadeeNeural',     voiceMale: 'th-TH-NiwatNeural',      styles: [] },
    'tr':    { voiceFemale: 'tr-TR-EmelNeural',           voiceMale: 'tr-TR-AhmetNeural',      styles: [] },
    'uk':    { voiceFemale: 'uk-UA-PolinaNeural',         voiceMale: 'uk-UA-OstapNeural',      styles: [] },
};

// 간단한 deterministic 해시 — dialogueSeed로부터 스왑 여부 결정
const simpleHash = (str) => {
    let h = 0;
    for (let i = 0; i < String(str || '').length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
};

// SSML 이스케이프
const escapeXml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

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

router.post('/api/azure-tts', optionalAuth, async (req, res) => {
    const { text, langCode, emotion, byokAzureKey, byokAzureRegion, turns, dialogueSeed } = req.body;
    // text 또는 turns 둘 중 하나는 필수
    if (!text && !(Array.isArray(turns) && turns.length > 0)) {
        return res.status(400).json({ error: 'Missing text or turns' });
    }

    const azureKey    = byokAzureKey    || AZURE_KEY;
    const azureRegion = byokAzureRegion || AZURE_REGION;
    if (!azureKey || !azureRegion) return res.status(500).json({ error: 'Azure TTS not configured' });

    const voiceInfo       = AZURE_TTS_VOICE_MAP[langCode] || { voiceFemale: 'en-US-JennyNeural', voiceMale: 'en-US-GuyNeural', styles: ['chat'] };
    const voiceFemale     = voiceInfo.voiceFemale || voiceInfo.voice || 'en-US-JennyNeural';
    const voiceMale       = voiceInfo.voiceMale || voiceFemale; // 남성 voice 없으면 여성으로 폴백
    const supportedStyles = voiceInfo.styles || [];
    const locale          = voiceFemale.split('-').slice(0, 2).join('-');

    // emotion → style 매핑 (단일 voice 경로 및 dialogue turns 공통)
    let voiceStyle = null;
    if (supportedStyles.length > 0) {
        const mapped = emotion ? EMOTION_TO_STYLE[emotion.toLowerCase()] : null;
        voiceStyle = (mapped && supportedStyles.includes(mapped)) ? mapped : (supportedStyles.includes('chat') ? 'chat' : supportedStyles[0]);
    }

    // ── SSML 생성 ──
    let ssml;
    if (Array.isArray(turns) && turns.length > 0) {
        // 대화 모드: speaker 'A'/'B'를 여성/남성 voice로 교차. dialogueSeed 기반 deterministic 스왑.
        const seedStr = dialogueSeed || turns.map(t => t.text || '').join('|');
        const swap = (simpleHash(seedStr) % 2) === 1;
        const voiceForA = swap ? voiceMale : voiceFemale;
        const voiceForB = swap ? voiceFemale : voiceMale;

        const voiceTags = turns
            .filter(t => t && typeof t.text === 'string' && t.text.trim())
            .map(t => {
                const speaker = (t.speaker || 'A').toString().toUpperCase();
                const chosen = speaker === 'B' ? voiceForB : voiceForA;
                const escaped = escapeXml(t.text);
                // 대화 모드에서는 style을 각 턴에 적용 (emotion 전역이지만 각 voice에 중첩 필요)
                const inner = voiceStyle
                    ? `<mstts:express-as style="${voiceStyle}"><prosody rate="0%" pitch="0%">${escaped}</prosody></mstts:express-as>`
                    : `<prosody rate="0%" pitch="0%">${escaped}</prosody>`;
                return `<voice xml:lang='${locale}' name='${chosen}'>${inner}</voice>`;
            })
            .join('');
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${locale}'>${voiceTags}</speak>`;
    } else {
        // 단일 voice 경로 (기존 동작 유지) — voiceFemale 기본 사용
        const escaped = escapeXml(text);
        const innerContent = voiceStyle
            ? `<mstts:express-as style="${voiceStyle}"><prosody rate="0%" pitch="0%">${escaped}</prosody></mstts:express-as>`
            : `<prosody rate="0%" pitch="0%">${escaped}</prosody>`;
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='${locale}'><voice xml:lang='${locale}' name='${voiceFemale}'>${innerContent}</voice></speak>`;
    }

    // 검증용 로그 토글 (기본 ON, TTS_LOG_VERBOSE=0 으로 끔)
    const VERBOSE = process.env.TTS_LOG_VERBOSE !== '0';
    const id = ttsCache.shortId(ssml);
    const chars = ssml.length;

    // 캐시 조회 — 동일 SSML이면 Azure 재합성 없이 즉시 반환 (BYOK는 bypass)
    const useCache = !byokAzureKey;
    if (useCache) {
        const hit = ttsCache.get(ssml);
        if (hit) {
            if (VERBOSE) console.log(`[AzureTTS] HIT  id=${id} lang=${langCode} chars=${chars} — 캐시 제공(Azure 호출 0)`);
            res.set('Content-Type', 'audio/mpeg');
            return res.send(hit);
        }
    }

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
        const buf = Buffer.from(response.data);
        if (useCache) ttsCache.set(ssml, buf); // 성공 응답만 캐시
        if (VERBOSE) console.log(`[AzureTTS] MISS id=${id} lang=${langCode} chars=${chars} → Azure 합성(과금 발생)${byokAzureKey ? ' [BYOK·캐시제외]' : ''}`);
        res.set('Content-Type', 'audio/mpeg');
        res.send(buf);
    } catch (e) {
        console.error('[AzureTTS] Error:', e.response?.status, e.message);
        res.status(500).json({ error: 'Azure TTS failed' });
    }
});

module.exports = router;
