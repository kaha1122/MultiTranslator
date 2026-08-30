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

// 라우트별 응답 바이트 계측 — Render 대역폭 소비처 진단(2026-07-30). 라우트보다 **먼저** 등록해야
// 모든 응답의 finish를 잡는다. 조회는 GET /api/kdl/bw, 그리고 1시간마다 [bw] 로그.
const { bwMeter, bwReport } = require('./middleware/bwMeter');
app.use(bwMeter);

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
app.use(require('./routes/adReward'));
app.use(require('./routes/streak'));
app.use(require('./routes/reengagement'));
app.use(require('./routes/converse'));
app.use(require('./routes/tmdb')); // [신규] K-DramaLingo TMDB 프록시 (requireAuthAny — PronunFit 영향 없음)
app.use(require('./routes/cronTmdb')); // [신규] K-DramaLingo 신작 메타 번역 증분 (requireCronAuth)
app.use(require('./routes/community')); // [신규] K-DramaLingo 커뮤니티 UGC 번역 (requireAuthAny)
app.use(require('./routes/communityPoints')); // [신규] K-DramaAnyLang 포인트 일회성 구매 PayPal (requireAuthAny)
app.use(require('./routes/restoreCredential')); // [신규] K-DramaAnyLang Zero-Tap 로그인 복원 토큰 (kculture 전용 인증 + 비인증 redeem)
app.use(require('./routes/news')); // [신규] K-DramaAnyLang K-뉴스 (public read + requireCronAuth refresh)
app.use(require('./routes/curation')); // [신규] K-DramaAnyLang Dari AI 큐레이터 게시 (x-curation-secret, fail-closed)
app.use(require('./routes/cronLounge')); // [신규] K-DramaAnyLang Dari's Lounge 일일 발행 (requireCronAuth, 결정적 — Gemini 0)

// [신규] 서버 잠 깨우기용(Warm-up) 가벼운 API
app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is awake!' });
});

// 대역폭 소비처 조회(public — /api/kdl/version과 동일 규약). 노출 정보는 라우트 경로·건수뿐이라
// 비밀 없음. 값은 프로세스 부팅 이후 누적이므로 sinceISO/uptimeHours와 함께 읽을 것.
app.get('/api/kdl/bw', (req, res) => {
    res.json(bwReport(Math.min(parseInt(req.query.top, 10) || 20, 50)));
});

// 공식 유튜브 채널 allowlist 조회(public — 채널명 목록뿐, 비밀 없음). SSOT는 lib/highlightGate.js OFFICIAL_CHANNELS.
// 소비처: KCulture scripts/clip-scout.mjs(에이전트 공용 클립 파이프라인, 2026-08-30) — 리포 두 곳에 목록을
// 복사하지 않기 위한 라우트. 채널 추가는 highlightGate.js 한 곳에서만(oEmbed author_name 그대로).
app.get('/api/kdl/official-channels', (req, res) => {
    const { OFFICIAL_CHANNELS } = require('./lib/highlightGate');
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ channels: OFFICIAL_CHANNELS, count: OFFICIAL_CHANNELS.length, source: 'server/lib/highlightGate.js' });
});

// 세션 시작 로그 — 클라가 앱 실행/로그인 직후(프로필 로드 후) 세션당 1회 호출.
//   목적: 로그만으로 "이 UID 유저가 접속을 시작했다"(신규/기존)를 추적. DB write 없음(로그 전용)
//   → users 본문 write로 인한 onSnapshot 재렌더/iOS 발열과 무관(CLAUDE.md 규칙6 안전).
//   컨텍스트는 클라가 보유한 profile에서 받음(서버 DB read 0) + IP는 서버에서 해석.
const { requireAuth } = require('./middleware/auth');
const { rateLimit } = require('./middleware/rateLimit');
app.post('/api/session-start', requireAuth, rateLimit('session-start', { perMinute: 10, perHour: 120 }), (req, res) => {
    if (!req.uid) return res.status(401).json({ error: 'unauthorized' });
    const xForwardedFor = req.headers['x-forwarded-for'] || '';
    const clientIp = xForwardedFor.split(',')[0]?.trim() || req.ip;
    const b = req.body || {};
    const f = (v) => (v == null || v === '' ? '?' : String(v).slice(0, 40));
    console.log(`[SessionStart] uid=${req.uid} new=${b.isNew ? 'Y' : 'n'} anon=${b.isAnonymous ? 'Y' : 'n'} tier=${f(b.tier)} platform=${f(b.platform)} nativeVer=${f(b.nativeVersion)} lang=${f(b.lang)} country=${f(b.country)} ip=${clientIp}`);
    res.json({ ok: true });
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
