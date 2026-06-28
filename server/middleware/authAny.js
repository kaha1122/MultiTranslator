// ── 다중 프로젝트 토큰 검증 (K-DramaLingo 전용 라우트용) ──────────────────
// kculture-f96d8(주 사용자) 토큰을 우선 검증하고, 실패 시 PronunFit 기본 앱으로 폴백.
// ⚠ 기존 requireAuth(PronunFit 전용)는 절대 변경하지 않는다 — 이 미들웨어는 /api/tmdb/* 에만 사용.
const { admin } = require('../config/firebase');
const { kcultureAuth } = require('../config/firebaseKculture');

async function requireAuthAny(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required' });
    }
    const idToken = authHeader.split('Bearer ')[1];

    // Admin 미초기화(로컬 개발) — 기존 requireAuth와 동일하게 통과
    if (!admin.apps.length) {
        req.uid = 'dev-user';
        return next();
    }

    const tryVerify = async (authInstance) => {
        if (!authInstance) return null;
        try { return await authInstance.verifyIdToken(idToken); }
        catch { return null; }
    };

    // kculture 우선 → 실패 시 default(PronunFit)
    let decoded = await tryVerify(kcultureAuth);
    if (!decoded) decoded = await tryVerify(admin.auth());

    if (!decoded) {
        console.error('[AuthAny] Token verification failed for both projects');
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.uid = decoded.uid;
    next();
}

module.exports = { requireAuthAny };
