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
    req.authProvider = decoded.firebase?.sign_in_provider || null; // 'anonymous' | 'google.com' | 'password' … (과금 라우트의 게스트 차단용)
    // ── 이메일 검증 상태(2026-09-19) ─────────────────────────────────────────
    // 이메일/비번 자격증명이 붙은 계정(firebase.identities.password)은 메일 확인을 끝내야
    // 포인트를 쓸 수 있다(KCulture 정책). 익명·소셜은 대상이 아니다 — Facebook은 email_verified가
    // false로 오는 경우가 있어 그 클레임만 보면 정상 사용자가 막힌다.
    // 토큰만으로 판정 = DB read 0. 같은 규약이 KCulture firestore.rules·src/lib/emailVerify.js에도 있다.
    req.hasPasswordIdentity = !!decoded.firebase?.identities?.password;
    req.emailUnverified = req.hasPasswordIdentity && decoded.email_verified !== true;
    next();
}

// ── 선택적 인증 (공개 읽기 라우트용 — /api/tmdb/* discover·검색·상세 등) ──────
// TMDB는 공개 데이터라 로그인 없이 열람 가능해야 한다(로그아웃 홈/탐색). 토큰이 있으면
// 검증해 req.uid를 채우고(레이트리밋을 uid 기준으로), 없거나 유효하지 않으면 익명으로 통과한다
// (rateLimit이 req.uid 부재 시 IP로 폴백). ⚠ 쓰기/과금 라우트(community translate 등)에는 쓰지 말 것.
async function optionalAuthAny(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next(); // 익명 허용

    const idToken = authHeader.split('Bearer ')[1];
    if (!admin.apps.length) { req.uid = 'dev-user'; return next(); }

    const tryVerify = async (authInstance) => {
        if (!authInstance) return null;
        try { return await authInstance.verifyIdToken(idToken); }
        catch { return null; }
    };
    let decoded = await tryVerify(kcultureAuth);
    if (!decoded) decoded = await tryVerify(admin.auth());
    if (decoded) req.uid = decoded.uid; // 유효하지 않아도 401 대신 익명 통과
    next();
}

// ── 이메일 검증 필수 게이트 (2026-09-19) ──────────────────────────────────────
// requireAuthAny 뒤에 붙여 쓴다. 미검증 이메일 계정은 403 { error:'email_unverified' }.
// 클라(KCulture apiClient)는 이 코드를 보면 검증 안내 모달을 띄운다 — 문자열을 바꾸지 말 것.
// ⚠ 포인트를 쓰거나 적립하는 라우트에만 붙인다. 읽기·세션 로그·구매(결제)에는 붙이지 않는다
//   (결제는 돈을 받는 쪽이라 막을 이유가 없고, 검증 후 잔액이 그대로 살아 있다).
function requireVerifiedEmail(req, res, next) {
    if (req.emailUnverified) {
        console.log(`[AuthAny] email_unverified uid=${req.uid} path=${req.path}`);
        return res.status(403).json({ error: 'email_unverified' });
    }
    next();
}

module.exports = { requireAuthAny, optionalAuthAny, requireVerifiedEmail };
