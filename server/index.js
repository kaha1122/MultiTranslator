const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
require('dotenv').config();

// Firebase Admin 초기화 (다른 모듈보다 먼저 로드)
require('./config/firebase');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── 라우트 모듈 등록 ─────────────────────────────────────────────────────────
app.use(require('./routes/analyze'));
app.use(require('./routes/video'));
app.use(require('./routes/tts'));
app.use(require('./routes/scene'));
app.use(require('./routes/subscription'));
app.use(require('./routes/account'));
app.use(require('./routes/vocab'));
app.use(require('./routes/listening'));
app.use(require('./routes/ocr'));
app.use(require('./routes/translate'));
app.use(require('./routes/webhook'));
app.use(require('./routes/referral'));
app.use(require('./routes/reviewBonus'));
app.use(require('./routes/reengagement'));

// [신규] 서버 잠 깨우기용(Warm-up) 가벼운 API
app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is awake!' });
});

// IP 기반 국가 감지 (프로필 geoCountry 기록용) — 클라이언트 IP를 서버에서 조회
app.get('/api/detect-country', async (req, res) => {
    const xForwardedFor = req.headers['x-forwarded-for'] || '';
    const clientIp = xForwardedFor.split(',')[0]?.trim() || req.ip;
    console.log(`[detect-country] x-forwarded-for: "${xForwardedFor}", req.ip: "${req.ip}", resolved: "${clientIp}"`);
    try {
        const url = `https://ipwhois.app/json/${clientIp}?objects=country_code,city,region`;
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        console.log(`[detect-country] result: country=${d.country_code}, city=${d.city}, region=${d.region}`);
        res.json({
            country: d.country_code || '',
            city: d.city || '',
            region: d.region || '',
        });
    } catch (e) {
        console.warn('[detect-country] IP lookup failed:', e.message);
        res.json({ country: '', city: '', region: '' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    const AZURE_REGION = process.env.AZURE_SPEECH_REGION;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const AZURE_KEY = process.env.AZURE_SPEECH_KEY;
    console.log(`🚀 AI Orchestrator running on http://localhost:${PORT}`);
    console.log(`[Config] Azure Region: ${AZURE_REGION}`);
    console.log(`[Config] Gemini Key Prefix: ${GEMINI_API_KEY?.substring(0, 5)}...`);
    if (!AZURE_KEY) console.warn("⚠️ AZURE_SPEECH_KEY is missing in .env");
    if (!GEMINI_API_KEY) console.warn("⚠️ GEMINI_API_KEY is missing in .env");
});
