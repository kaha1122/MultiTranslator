const express = require('express');
const axios = require('axios');  // Azure TTS/STT 등 비-Gemini 호출에 사용
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { optionalAuth } = require('../middleware/auth');
const { buildStartPrompt, buildReplyPrompt, buildSummarizePrompt } = require('../utils/conversationPrompt');
const { stripAnnotations } = require('../utils/stripAnnotations');
const { callGeminiJson } = require('../utils/geminiCall');

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
    'en': { voiceFemale: 'en-US-JennyNeural', voiceMale: 'en-US-GuyNeural', styles: ['chat', 'cheerful', 'sad', 'angry', 'excited', 'friendly', 'hopeful', 'empathetic'] },
    'ja': { voiceFemale: 'ja-JP-NanamiNeural', voiceMale: 'ja-JP-KeitaNeural', styles: ['chat'] },
    'zh-CN': { voiceFemale: 'zh-CN-XiaoxiaoNeural', voiceMale: 'zh-CN-YunxiNeural', styles: ['chat', 'cheerful', 'sad', 'angry', 'fearful', 'gentle', 'serious', 'friendly', 'empathetic', 'calm'] },
    'vi': { voiceFemale: 'vi-VN-HoaiMyNeural', voiceMale: 'vi-VN-NamMinhNeural', styles: [] },
    'fr': { voiceFemale: 'fr-FR-DeniseNeural', voiceMale: 'fr-FR-HenriNeural', styles: [] },
    'de': { voiceFemale: 'de-DE-KatjaNeural', voiceMale: 'de-DE-ConradNeural', styles: [] },
    'es': { voiceFemale: 'es-ES-ElviraNeural', voiceMale: 'es-ES-AlvaroNeural', styles: [] },
    'ko': { voiceFemale: 'ko-KR-SunHiNeural', voiceMale: 'ko-KR-InJoonNeural', styles: ['chat', 'cheerful', 'sad', 'angry', 'friendly'] },
    'ru': { voiceFemale: 'ru-RU-SvetlanaNeural', voiceMale: 'ru-RU-DmitryNeural', styles: [] },
    'pt-BR': { voiceFemale: 'pt-BR-FranciscaNeural', voiceMale: 'pt-BR-AntonioNeural', styles: [] },
    'ar': { voiceFemale: 'ar-SA-ZariyahNeural', voiceMale: 'ar-SA-HamedNeural', styles: [] },
    'bn': { voiceFemale: 'bn-IN-TanishaaNeural', voiceMale: 'bn-IN-BashkarNeural', styles: [] },
    'bg': { voiceFemale: 'bg-BG-KalinaNeural', voiceMale: 'bg-BG-BorislavNeural', styles: [] },
    'zh-TW': { voiceFemale: 'zh-TW-HsiaoChenNeural', voiceMale: 'zh-TW-YunJheNeural', styles: [] },
    'hr': { voiceFemale: 'hr-HR-GabrijelaNeural', voiceMale: 'hr-HR-SreckoNeural', styles: [] },
    'cs': { voiceFemale: 'cs-CZ-VlastaNeural', voiceMale: 'cs-CZ-AntoninNeural', styles: [] },
    'da': { voiceFemale: 'da-DK-ChristelNeural', voiceMale: 'da-DK-JeppeNeural', styles: [] },
    'nl': { voiceFemale: 'nl-NL-ColetteNeural', voiceMale: 'nl-NL-MaartenNeural', styles: [] },
    'et': { voiceFemale: 'et-EE-AnuNeural', voiceMale: 'et-EE-KertNeural', styles: [] },
    'fi': { voiceFemale: 'fi-FI-NooraNeural', voiceMale: 'fi-FI-HarriNeural', styles: [] },
    'el': { voiceFemale: 'el-GR-AthinaNeural', voiceMale: 'el-GR-NestorasNeural', styles: [] },
    'he': { voiceFemale: 'he-IL-HilaNeural', voiceMale: 'he-IL-AvriNeural', styles: [] },
    'hi': { voiceFemale: 'hi-IN-SwaraNeural', voiceMale: 'hi-IN-ArjunNeural', styles: [] },
    'hu': { voiceFemale: 'hu-HU-NoemiNeural', voiceMale: 'hu-HU-TamasNeural', styles: [] },
    'id': { voiceFemale: 'id-ID-GadisNeural', voiceMale: 'id-ID-ArdiNeural', styles: [] },
    'it': { voiceFemale: 'it-IT-ElsaNeural', voiceMale: 'it-IT-DiegoNeural', styles: [] },
    'lv': { voiceFemale: 'lv-LV-EveritaNeural', voiceMale: 'lv-LV-NilsNeural', styles: [] },
    'lt': { voiceFemale: 'lt-LT-OnaNeural', voiceMale: 'lt-LT-LeonasNeural', styles: [] },
    'no': { voiceFemale: 'nb-NO-PernilleNeural', voiceMale: 'nb-NO-FinnNeural', styles: [] },
    'pl': { voiceFemale: 'pl-PL-AgnieszkaNeural', voiceMale: 'pl-PL-MarekNeural', styles: [] },
    'ro': { voiceFemale: 'ro-RO-AlinaNeural', voiceMale: 'ro-RO-EmilNeural', styles: [] },
    'sr': { voiceFemale: 'sr-RS-SophieNeural', voiceMale: 'sr-RS-NicholasNeural', styles: [] },
    'sk': { voiceFemale: 'sk-SK-ViktoriaNeural', voiceMale: 'sk-SK-LukasNeural', styles: [] },
    'sl': { voiceFemale: 'sl-SI-PetraNeural', voiceMale: 'sl-SI-RokNeural', styles: [] },
    'sw': { voiceFemale: 'sw-KE-ZuriNeural', voiceMale: 'sw-KE-RafikiNeural', styles: [] },
    'sv': { voiceFemale: 'sv-SE-SofieNeural', voiceMale: 'sv-SE-MattiasNeural', styles: [] },
    'th': { voiceFemale: 'th-TH-PremwadeeNeural', voiceMale: 'th-TH-NiwatNeural', styles: [] },
    'tr': { voiceFemale: 'tr-TR-EmelNeural', voiceMale: 'tr-TR-AhmetNeural', styles: [] },
    'uk': { voiceFemale: 'uk-UA-PolinaNeural', voiceMale: 'uk-UA-OstapNeural', styles: [] },
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

// ── B안(slot memory): establishedFacts key 기반 병합 (순수 in-memory, DB I/O 없음) ──
// prior(클라가 carry 한 이전 누적) + next(모델이 이번 턴 반환)를 'attribute' key 로 병합.
// 핵심 방어: 구체값이 있는 슬롯을 모델이 'asked, awaiting answer' 로 되돌려도(강등)
// 무시하고 구체값 유지 → party_size: 8 같은 사실이 재질문/퇴행으로 사라지지 않음.
// 새 구체값은 갱신(사용자 정정 허용), 새 key 는 누적. prior 순서 유지 후 신규 key append.
function mergeEstablishedFacts(prior, next) {
    const parse = (f) => {
        const s = String(f);
        const idx = s.indexOf(':');
        if (idx === -1) return { key: s.trim().toLowerCase(), value: '', raw: s.trim() };
        return { key: s.slice(0, idx).trim().toLowerCase(), value: s.slice(idx + 1).trim(), raw: s.trim() };
    };
    const isPending = (v) => !v || /^asked\b/i.test(v) || /awaiting/i.test(v);
    const map = new Map();   // key -> raw string
    const order = [];
    const put = (f) => {
        if (typeof f !== 'string' || !f.trim()) return;
        const { key, value, raw } = parse(f);
        if (!key) return;
        if (!map.has(key)) { map.set(key, raw); order.push(key); return; }
        const existing = parse(map.get(key));
        const existingConcrete = !isPending(existing.value);
        const incomingConcrete = !isPending(value);
        if (incomingConcrete) map.set(key, raw);              // 새 구체값 → 갱신(정정 허용)
        else if (!existingConcrete) map.set(key, raw);        // 둘 다 pending → 최신 표현 유지
        // existingConcrete && !incomingConcrete → 강등 시도 → 무시(구체값 유지)
    };
    (Array.isArray(prior) ? prior : []).forEach(put);
    (Array.isArray(next) ? next : []).forEach(put);
    return order.map(k => map.get(k));
}

// ── 코칭 나레이션 음성 합성: 전면 비활성화 (2026-05-22) ───────────────────
// 사용자 검증 결과 ko-KR-HyunsuMultilingualNeural / en-US-AvaMultilingualNeural
// 두 케이스 모두 인용부호 안 학습언어 발음 품질이 떨어진다는 보고. 다른
// multilingual voice (Masaru/Xiaoxiao/Vivienne/Seraphina/Isidora/Macerio) 는
// 애초에 secondary locale 미명시 voice 였음.
//
// 잘못된 발음을 듣게 하는 것보다 popup 으로 텍스트만 보여주는 편이 학습상
// 안전. 학습언어 발음은 카드 모달의 본문 turn TTS (정통 Neural voice) 로 별도
// 청취 가능 — 보조 경로 존재.
//
// 모든 (sourceLang, targetLang) 조합 → null → 204 → 클라가 AITipPopup 으로
// userCoachingNarration 텍스트만 표시. userCoachingNarration 은 prompt 에서
// sourceLang 모국어로 강제 출력되므로 10 개 locale 모두 자연스럽게 표시.
//
// 부수: Azure TTS coach-tts 호출 비용 0 ($16/1M chars 절감, 비중은 작음).
function getNarrationVoice(_sourceLang, _targetLang) {
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/converse-start
//   3-메시지(intro / firstUserTurn / firstAiReply)를 단일 LLM 호출로 생성.
//   기존 /api/scene-sentence + /api/scene-answer 의 Phase/Rules/스키마를 재활용.
// ─────────────────────────────────────────────────────────────────────────
router.post('/api/converse-start', optionalAuth, async (req, res) => {
    const { scene, category, isCustom, targetLang, sourceLang, difficulty, speechStyle, byokGeminiKey, avoidSituations } = req.body || {};
    if (!scene || !targetLang || !sourceLang) {
        return res.status(400).json({ error: 'Missing scene, targetLang, or sourceLang' });
    }
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const prompt = buildStartPrompt({
        scene, category, isCustom: isCustom === true,
        targetLang, sourceLang, difficulty, speechStyle,
        avoidSituations: Array.isArray(avoidSituations) ? avoidSituations : [],
    });

    // prompt size monitoring — Gemini Flash-Lite input limit 32K tokens.
    // 50KB chars ≈ 14K tokens 임계값. 추세 모니터링용 (실제 차단 X).
    if (prompt.length > 50000) {
        console.warn(`[ConverseStart] prompt size large: ${prompt.length} chars (~${Math.round(prompt.length / 3.5)} tokens) — approaching 32K input limit`);
    }

    // 2026-05-22 — callGeminiJson (3 retry + Flash fallback) 으로 교체.
    // 기존 attemptOnce inline 로직은 shared helper 로 이전됨.
    // temperature 1.3 → 1.0 (사용자 결정): BRANCH 룰(특히 BRANCH C TOPIC) 준수 ↑
    // + placeholder/언어 swap 위반 ↓. 시나리오 다양성은 Anti-Duplication 의
    // dimensions rotation 이 보완.
    const result = await callGeminiJson(prompt, geminiKey, {
        genConfig: { temperature: 1.0, topK: 64, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => p?.intro?.text && p?.firstUserTurn?.sentence && p?.firstAiReply?.sentence,
        label: 'ConverseStart',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || 'Failed to generate conversation start' });
    }
    try {
        const parsed = result.parsed;
        // 후처리: 두 turn 의 sentence 에 stripAnnotations 적용 (보험)
        if (parsed?.firstUserTurn?.sentence) {
            parsed.firstUserTurn.sentence = stripAnnotations(parsed.firstUserTurn.sentence, targetLang);
        }
        if (parsed?.firstAiReply?.sentence) {
            parsed.firstAiReply.sentence = stripAnnotations(parsed.firstAiReply.sentence, targetLang);
        }
        // opener 가 commit 한 구체값을 슬롯 메모리 seed 로 정규화 (string[] 보장).
        // 첫 자유발화 응답이 빈 establishedFacts 로 출발해 opener 의 목적지/번호를
        // 재질문하던 회귀(2026-06-10) 차단. 모델 누락/형식오류 시 [] fallback → 현행 동작과 동일.
        parsed.establishedFacts = Array.isArray(parsed.establishedFacts)
            ? parsed.establishedFacts.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim())
            : [];
        res.json(parsed);
    } catch (e) {
        console.error('[ConverseStart] Unexpected:', e.message);
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

    // 2026-06-07: express-as(emotion 마크업) 제거 — Azure TTS는 SSML 마크업도 과금(<speak>/<voice>만 제외).
    //   짧은 FreeTalk 메시지에서 express-as 태그(~48자)가 billable 글자의 ~40%를 차지 → 중립 톤으로
    //   전환해 세션 TTS 원가 ~24% 절감. 대부분 이미 style="chat" 기본값이라 톤 체감 차이 작음.
    //   (supportedStyles/EMOTION_TO_STYLE 매핑은 추후 선택적 재도입 대비 보존)
    const escaped = escapeXml(text);
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'><voice xml:lang='${locale}' name='${voiceName}'>${escaped}</voice></speak>`;

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
// POST /api/converse-coach-tts
//   Learning Tip (모국어 코칭 + 학습언어 단어 인용) 텍스트를 단일 multilingual voice
//   로 합성. ‘...’ curly-quote segment 는 <lang xml:lang="targetLocale"> 태그로
//   wrapping 해서 multilingual voice 에 명시적 언어 hint 제공 → 영어 native-like
//   발음 + 코드스위치 자연스러움 (이전 다중 voice 방식의 transition gap/prosody
//   단절 문제 해결).
//
//   요청: { tipText, sourceLang, targetLang, byokAzureKey?, byokAzureRegion? }
//   응답:
//     - sourceLang 이 NARRATION_MULTILINGUAL_VOICE_BY_LANG 에 있음 → audio/mpeg blob
//     - 없음 (vi, ru 등) → 204 No Content (클라가 카드 모달로 fallback)
// ─────────────────────────────────────────────────────────────────────────
router.post('/api/converse-coach-tts', optionalAuth, async (req, res) => {
    const { tipText, sourceLang, targetLang, byokAzureKey, byokAzureRegion } = req.body || {};
    if (!tipText || !sourceLang || !targetLang) {
        return res.status(400).json({ error: 'Missing tipText, sourceLang, or targetLang' });
    }

    const narrationVoice = getNarrationVoice(sourceLang, targetLang);
    if (!narrationVoice) {
        // (sourceLang, targetLang) 조합이 매트릭스 미지원 — 음성 합성 X.
        // 클라가 AI-Tip Popup 으로 텍스트만 표시 (사용자 결정 옵션 A).
        return res.status(204).end();
    }

    const azureKey = byokAzureKey || AZURE_KEY;
    const azureRegion = byokAzureRegion || AZURE_REGION;
    if (!azureKey || !azureRegion) return res.status(500).json({ error: 'Azure TTS not configured' });

    const sourceLocale = narrationVoice.split('-').slice(0, 2).join('-');
    // targetLocale 결정 (학습언어 인용 부분 <lang xml:lang> hint 용)
    const targetVoiceInfo = AZURE_TTS_VOICE_MAP[targetLang] || AZURE_TTS_VOICE_MAP['en'];
    const targetLocale = (targetVoiceInfo.voiceFemale || targetVoiceInfo.voiceMale).split('-').slice(0, 2).join('-');

    // ‘...’ curly quote 부분만 <lang xml:lang="targetLocale"> 으로 wrapping →
    // multilingual voice 가 명시 언어로 native-like 발음. 단일 voice 안에서 전환되므로
    // prosody 단절 없음.
    //
    // 속도 보정 (옵션 A 사용자 결정):
    //   - sourceLang(모국어 narration) 부분: rate +5% (살짝 빠르게 — 답답함 해소)
    //   - targetLang(학습언어 인용) 부분  : rate -10% (살짝 느리게 — 발음 학습용)
    // multilingual voice 가 target locale 을 default rate 로 빠르게 발음하던 사용자
    // 보고에 대응. ±5~15% 범위는 자연스러움 유지.
    const SOURCE_RATE = '+5%';
    const TARGET_RATE = '-10%';
    const pushSourceChunk = (text) => {
        if (!text) return '';
        return `<prosody rate='${SOURCE_RATE}'>${escapeXml(text)}</prosody>`;
    };
    const pushTargetChunk = (text) => {
        if (!text) return '';
        return `<lang xml:lang='${targetLocale}'><prosody rate='${TARGET_RATE}'>${escapeXml(text)}</prosody></lang>`;
    };

    let inner = '';
    let lastIdx = 0;
    const re = /‘([^’]+)’/g;
    let m;
    while ((m = re.exec(tipText)) !== null) {
        if (m.index > lastIdx) inner += pushSourceChunk(tipText.slice(lastIdx, m.index));
        // 인용부호 글리프 자체는 source 톤 유지 (lang 태그 밖)
        inner += pushSourceChunk('‘');
        inner += pushTargetChunk(m[1]);
        inner += pushSourceChunk('’');
        lastIdx = re.lastIndex;
    }
    if (lastIdx < tipText.length) inner += pushSourceChunk(tipText.slice(lastIdx));
    if (!inner) inner = pushSourceChunk(tipText);

    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${sourceLocale}'><voice name='${narrationVoice}'>${inner}</voice></speak>`;

    try {
        const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
        speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3;
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);
        const result = await new Promise((resolve, reject) => {
            synthesizer.speakSsmlAsync(
                ssml,
                r => { synthesizer.close(); resolve(r); },
                err => { synthesizer.close(); reject(err); }
            );
        });
        if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
            const reasonName = sdk.ResultReason[result.reason] ?? `unknown(${result.reason})`;
            console.error('[ConverseCoachTTS] synthesis non-completed:', reasonName);
            return res.status(502).json({ error: 'TTS synthesis failed', reason: reasonName });
        }
        res.set('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(result.audioData));
    } catch (e) {
        console.error('[ConverseCoachTTS] Error:', e?.message || e);
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

/**
 * 긴 발화(2~3문장, 중간 호흡) 안정 인식을 위한 Continuous Recognition.
 *
 * recognizeOnceAsync 는 첫 phrase 종료(=일정 침묵 감지) 시점에 즉시 종료해
 * 학습자가 호흡/생각하는 사이에 뒷문장이 잘림. Continuous는 audio 파일이 끝날 때까지
 * 모든 phrase를 recognized 이벤트로 캡처하고, sessionStopped 시점에 모아서 반환.
 *
 * EndSilenceTimeoutMs 도 1500ms 로 상향 — 단어 사이 짧은 pause가 phrase 분할로
 * 이어지는 빈도를 줄여 자연스러운 transcript 생성.
 */
function recognizeFromWav(wavPath, azureLocale, azureKey, azureRegion) {
    return new Promise((resolve, reject) => {
        let recognizer;
        let timeoutHandle;
        let settled = false;
        const transcripts = [];

        const safeClose = () => {
            if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
            try { recognizer && recognizer.stopContinuousRecognitionAsync(() => { try { recognizer.close(); } catch { /* noop */ } }); }
            catch { try { recognizer && recognizer.close(); } catch { /* noop */ } }
        };
        const finish = (err, payload) => {
            if (settled) return;
            settled = true;
            safeClose();
            if (err) reject(err);
            else resolve(payload);
        };

        try {
            const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(wavPath));
            const speechConfig = sdk.SpeechConfig.fromSubscription(azureKey, azureRegion);
            speechConfig.speechRecognitionLanguage = azureLocale;
            // 긴 발화 안정성을 위한 silence timeout 조정
            //   - EndSilence: phrase 종료 판단 침묵 길이 (기존 1500ms → 5000ms 로 대폭 연장)
            //   - InitialSilence: 시작 전 침묵 허용 (default 5000ms 유지)
            speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '5000');
            speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000');

            recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

            recognizer.recognized = (_s, e) => {
                if (e?.result?.reason === sdk.ResultReason.RecognizedSpeech) {
                    const text = e.result.text || '';
                    if (text) transcripts.push(text);
                }
            };
            recognizer.canceled = (_s, e) => {
                const errCode = e?.errorCode;
                const errDetails = e?.errorDetails || '';
                // EndOfStream 은 정상 종료 (audio 파일 끝). NoError 도 정상.
                if (errCode && errCode !== sdk.CancellationErrorCode.NoError) {
                    console.warn(`[Azure STT canceled] code=${errCode} details=${errDetails}`);
                }
                // canceled 이후 sessionStopped 이 자연스럽게 와서 finish 처리
            };
            recognizer.sessionStopped = (_s, _e) => {
                finish(null, {
                    transcript: transcripts.join(' ').trim(),
                    durationMs: 0,
                });
            };

            // 안전장치: 60초 후에도 sessionStopped 안 오면 강제 종료
            timeoutHandle = setTimeout(() => {
                console.warn('[Azure STT] timeout 60s — forcing finish');
                finish(null, { transcript: transcripts.join(' ').trim(), durationMs: 0, reason: 'Timeout' });
            }, 60000);

            recognizer.startContinuousRecognitionAsync(
                () => { /* started */ },
                (err) => finish(new Error(`STT start failed: ${err}`)),
            );
        } catch (e) {
            finish(e);
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

        const result = await recognizeFromWav(wavPath, azureLocale, azureKey, azureRegion);
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
        establishedFacts,
        byokGeminiKey,
    } = req.body || {};
    if (!rawSttText || !targetLang || !sourceLang) {
        return res.status(400).json({ error: 'Missing rawSttText, targetLang, or sourceLang' });
    }
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    // B안(slot memory): 클라가 carry 한 누적 facts. 배열 아닌 입력은 [] 로 정규화.
    const priorFacts = Array.isArray(establishedFacts)
        ? establishedFacts.filter(f => typeof f === 'string' && f.trim())
        : [];

    const prompt = buildReplyPrompt({
        rawSttText, history: history || [], scenarioMeta: scenarioMeta || {},
        targetLang, sourceLang, difficulty, speechStyle,
        establishedFacts: priorFacts,
    });

    // 2026-05-22 — callGeminiJson (3 retry + Flash fallback) 으로 교체.
    const result = await callGeminiJson(prompt, geminiKey, {
        // 0.95 — instruction following 우선 (no-redundant-ask 등 룰 준수)
        genConfig: { temperature: 0.95, topK: 40, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => p?.intentText && p?.aiReply?.sentence,
        label: 'ConverseReply',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || 'Failed to generate reply' });
    }
    try {
        const parsed = result.parsed;
        // 후처리
        if (parsed?.intentText) {
            parsed.intentText = stripAnnotations(parsed.intentText, targetLang);
        }
        if (parsed?.aiReply?.sentence) {
            parsed.aiReply.sentence = stripAnnotations(parsed.aiReply.sentence, targetLang);
        }
        // B안(slot memory): establishedFacts key 기반 병합 — 구체값 강등 차단 +
        // prior 누적 보존 + 새 구체값 갱신/추가. 모델이 누락/강등/드롭해도 서버가 방어.
        if (parsed?.aiReply) {
            parsed.aiReply.establishedFacts = mergeEstablishedFacts(priorFacts, parsed.aiReply.establishedFacts);
        }
        res.json(parsed);
    } catch (e) {
        console.error('[ConverseReply] Unexpected:', e.message);
        res.status(500).json({ error: 'Failed to generate reply' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/converse-summarize
//   세션 종료 시 1회 호출. 전체 history에서 핵심 표현 3~5개 추출.
//   응답: { keyPhrases: [{phrase, translation, why_useful, source_role, pronunciation}] }
// ─────────────────────────────────────────────────────────────────────────
router.post('/api/converse-summarize', optionalAuth, async (req, res) => {
    const {
        history, scenarioMeta,
        targetLang, sourceLang, difficulty,
        byokGeminiKey,
    } = req.body || {};
    if (!Array.isArray(history) || history.length === 0) {
        return res.status(400).json({ error: 'Missing or empty history' });
    }
    if (!targetLang || !sourceLang) {
        return res.status(400).json({ error: 'Missing targetLang or sourceLang' });
    }
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const prompt = buildSummarizePrompt({
        history, scenarioMeta: scenarioMeta || {},
        targetLang, sourceLang, difficulty,
    });

    const result = await callGeminiJson(prompt, geminiKey, {
        genConfig: { temperature: 0.7, topK: 40, topP: 0.95, responseMimeType: 'application/json' },
        validate: (p) => Array.isArray(p?.keyPhrases) && p.keyPhrases.length > 0,
        label: 'ConverseSummarize',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || 'Failed to summarize' });
    }
    const parsed = result.parsed;

    // 후처리: 각 phrase에 stripAnnotations 적용
    parsed.keyPhrases = parsed.keyPhrases
        .filter(p => p && typeof p.phrase === 'string' && p.phrase.trim().length > 0)
        .map(p => ({
            phrase: stripAnnotations(p.phrase, targetLang),
            translation: p.translation || '',
            why_useful: p.why_useful || '',
            source_role: p.source_role === 'partner' ? 'partner' : 'learner',
            pronunciation: p.pronunciation || '',
        }));

    if (parsed.keyPhrases.length === 0) {
        return res.status(502).json({ error: 'No key phrases extracted' });
    }

    res.json(parsed);
});

module.exports = router;
