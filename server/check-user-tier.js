// 단일 유저 tier/구독 상태 진단 (광고 표시 원인 분석용)
// 사용법: cd server && node check-user-tier.js <UID>
require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
    const sa = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8')
    );
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const db = admin.firestore();
const uid = process.argv[2];
if (!uid) { console.error('UID required'); process.exit(1); }

(async () => {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) { console.error('user not found:', uid); process.exit(2); }
    const d = snap.data();
    const toIso = (ts) => ts?.toDate?.()?.toISOString() || ts || null;
    console.log(JSON.stringify({
        uid,
        // Tier 핵심
        tier: d.tier || null,
        tierSource: d.tierSource || null,
        tierUpdatedAt: toIso(d.tierUpdatedAt),
        planId: d.planId || null,
        autoRenew: d.autoRenew ?? null,
        subscriptionExpiresAt: toIso(d.subscriptionExpiresAt),
        // Auth
        isAnonymous: !!d.isAnonymous,
        email: d.email || null,
        displayName: d.displayName || null,
        // Platform
        currentNativePlatform: d.currentNativePlatform || null,
        currentNativeVersion: d.currentNativeVersion || null,
        firstNativePlatform: d.firstNativePlatform || null,
        // AI Consent gate (광고 표시 전제)
        aiConsentAt: toIso(d.aiConsentAt),
        // Activity
        lastActiveAt: toIso(d.lastActiveAt),
        createdAt: toIso(d.createdAt),
    }, null, 2));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(3); });
