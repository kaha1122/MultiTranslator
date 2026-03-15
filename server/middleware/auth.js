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

// cron 전용 인증 (Bearer 토큰 또는 CRON_SECRET 헤더)
function requireCronAuth(req, res, next) {
    const cronKey = req.headers['x-cron-secret'];
    if (CRON_SECRET && cronKey === CRON_SECRET) return next();
    // cron secret 미설정 시 통과 (하위 호환)
    if (!CRON_SECRET) return next();
    return res.status(401).json({ error: 'Unauthorized cron request' });
}

module.exports = { requireAuth, optionalAuth, requireCronAuth };
