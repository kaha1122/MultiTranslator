const crypto = require('crypto');
const { admin } = require('../config/firebase');

const CRON_SECRET = process.env.CRON_SECRET || '';

async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    if (!admin.apps.length) {
        // Firebase Admin 미초기화 시 스킵 (로컬 개발용)
        req.uid = 'dev-user';
        return next();
    }
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.uid = decoded.uid;
        next();
    } catch (err) {
        console.error('[Auth] Token verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// 선택적 인증 (토큰 있으면 검증, 없으면 통과 — 데모용)
async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        req.uid = null;
        return next();
    }
    const idToken = authHeader.split('Bearer ')[1];
    if (!admin.apps.length) {
        req.uid = 'dev-user';
        return next();
    }
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.uid = decoded.uid;
    } catch {
        req.uid = null;
    }
    next();
}

// cron 전용 인증 (CRON_SECRET 헤더)
// 2026-06-11 fail-closed: 미설정 시 통과하던 하위호환 제거 — 대량 이메일 발송·PII 덤프·
// 카드 청구 cron이 env 누락 한 번에 공개되던 설계 반전. 로컬 개발은 .env에 CRON_SECRET 설정.
function requireCronAuth(req, res, next) {
    if (!CRON_SECRET) {
        console.error('[CronAuth] CRON_SECRET not set — rejecting (fail-closed)');
        return res.status(503).json({ error: 'Cron auth not configured' });
    }
    const cronKey = req.headers['x-cron-secret'] || '';
    // timing-safe 비교 (길이 불일치는 즉시 거부)
    const a = Buffer.from(cronKey);
    const b = Buffer.from(CRON_SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    return res.status(401).json({ error: 'Unauthorized cron request' });
}

module.exports = { requireAuth, optionalAuth, requireCronAuth };
