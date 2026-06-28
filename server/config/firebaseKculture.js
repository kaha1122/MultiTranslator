// ── K-DramaLingo(kculture-f96d8) 전용 2번째 Admin 앱 ──────────────────────
// 용도: ① /api/tmdb/* 라우트의 kculture 토큰 검증 ② TMDB 사전번역 배치/크론의 Firestore 쓰기.
// PronunFit 기본 Admin 앱(config/firebase.js, trnaslatorapp)과 완전 분리된 named 앱.
//
// 자격증명:
//   - KCULTURE_SERVICE_ACCOUNT_BASE64 있으면 service account로 초기화 → 토큰검증 + Firestore 쓰기 가능
//   - 없으면 projectId-only → verifyIdToken만 가능(공개 인증서), Firestore 쓰기 불가(kcultureDb=null)
const admin = require('firebase-admin');

const KCULTURE_PROJECT_ID = process.env.KCULTURE_PROJECT_ID || 'kculture-f96d8';

let kcultureApp = null;
let hasCreds = false;
try {
    const existing = admin.apps.find((a) => a && a.name === 'kculture');
    if (existing) {
        kcultureApp = existing;
        hasCreds = !!process.env.KCULTURE_SERVICE_ACCOUNT_BASE64;
    } else if (process.env.KCULTURE_SERVICE_ACCOUNT_BASE64) {
        const sa = JSON.parse(
            Buffer.from(process.env.KCULTURE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
        );
        kcultureApp = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'kculture');
        hasCreds = true;
        console.log('[Firebase Admin/kculture] Initialized with service account (verify + Firestore)');
    } else {
        kcultureApp = admin.initializeApp({ projectId: KCULTURE_PROJECT_ID }, 'kculture');
        console.log('[Firebase Admin/kculture] Initialized (projectId-only, verify-only)');
    }
} catch (e) {
    console.warn('[Firebase Admin/kculture] Init failed:', e.message);
}

const kcultureAuth = kcultureApp ? admin.auth(kcultureApp) : null;
// Firestore는 service account가 있을 때만 (projectId-only는 쓰기 불가)
const kcultureDb = hasCreds && kcultureApp ? admin.firestore(kcultureApp) : null;

module.exports = { kcultureApp, kcultureAuth, kcultureDb };
