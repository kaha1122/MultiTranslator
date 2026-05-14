// 다수 UID 진단 — 누락 필드 + 봇 의심 패턴 + 서브컬렉션 존재 여부
// 사용법: cd server && node check-uids-diagnostic.js UID1 UID2 UID3 ...
//   FIREBASE_SERVICE_ACCOUNT_BASE64 env 필요 (Render 대시보드에서 복사 → 로컬 server/.env)
require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
    const sa = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8')
    );
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const uids = process.argv.slice(2);
if (uids.length === 0) {
    console.error('Usage: node check-uids-diagnostic.js UID1 UID2 ...');
    process.exit(1);
}

const toIso = (ts) => ts?.toDate?.()?.toISOString() || ts || null;

// 익명 익명 doc 정상값: { uid, isAnonymous, tier, platform, deviceLang, createdAt, updatedAt }
// 실유저 정상값: + email + displayName + hasCompletedOnboarding (+ geo*)
const SUBCOLLECTIONS = ['sceneHistory', 'vocabHistory', 'listenHistory', 'freeTalkHistory', 'conversationLogs'];

(async () => {
    for (const uid of uids) {
        console.log(`\n${'='.repeat(80)}\nUID: ${uid}\n${'='.repeat(80)}`);
        const snap = await db.collection('users').doc(uid).get();

        if (!snap.exists) {
            console.log('❌ users/{uid} doc NOT FOUND');
        } else {
            const d = snap.data();
            console.log('✅ doc exists. Field dump:');
            console.log(JSON.stringify({
                // Identity
                uid: d.uid || null,
                isAnonymous: d.isAnonymous ?? null,
                email: d.email || null,
                displayName: d.displayName || null,
                hasCompletedOnboarding: d.hasCompletedOnboarding ?? null,
                // Tier
                tier: d.tier || null,
                tierSource: d.tierSource || null,
                planId: d.planId || null,
                // Platform / device
                platform: d.platform || null,
                deviceLang: d.deviceLang || null,
                currentNativePlatform: d.currentNativePlatform || null,
                firstNativePlatform: d.firstNativePlatform || null,
                // Geo
                geoCountry: d.geoCountry || null,
                geoCity: d.geoCity || null,
                geoRegion: d.geoRegion || null,
                phoneCountry: d.phoneCountry || null,
                // Language settings
                sourceLang: d.sourceLang || null,
                targetLang: d.targetLang || null,
                targetLangs: d.targetLangs || null,
                defaultLevel: d.defaultLevel || null,
                // Generate counters (Generate 이력 추적용)
                totalGenerateCount: d.totalGenerateCount || 0,
                translationGenerateCount: d.translationGenerateCount || 0,
                vocabGenerateCount: d.vocabGenerateCount || 0,
                sceneGenerateCount: d.sceneGenerateCount || 0,
                listenGenerateCount: d.listenGenerateCount || 0,
                totalFreeTalkCount: d.totalFreeTalkCount || 0,
                trialCardCount: d.trialCardCount || 0,
                savedCardCount: d.savedCardCount || 0,
                trialPronCount: d.trialPronCount || 0,
                // Lifecycle
                lifecycleStage: d.lifecycleStage || null,
                activeDayCount: d.activeDayCount || 0,
                // FCM / push
                fcmTokensCount: Array.isArray(d.fcmTokens) ? d.fcmTokens.length : 0,
                // Timestamps
                createdAt: toIso(d.createdAt),
                updatedAt: toIso(d.updatedAt),
                lastActiveAt: toIso(d.lastActiveAt),
                aiConsentAt: toIso(d.aiConsentAt),
            }, null, 2));

            // 봇 의심 휴리스틱
            const flags = [];
            if (d.isAnonymous && !d.geoCountry) flags.push('익명+geo없음(detectGeoInfo 미완)');
            if (d.isAnonymous && !d.sourceLang) flags.push('익명+sourceLang없음(설정탭 미진입)');
            if ((d.totalGenerateCount || 0) === 0 && !d.email) flags.push('Generate=0+미가입(즉시 이탈)');
            if (d.platform === 'web' && d.isAnonymous && (d.totalGenerateCount || 0) === 0) flags.push('web+익명+0generate(AdsBot 의심)');
            if (d.createdAt && d.updatedAt) {
                const c = d.createdAt.toDate?.()?.getTime?.();
                const u = d.updatedAt.toDate?.()?.getTime?.();
                if (c && u && (u - c) < 5000) flags.push(`체류<5s(${u-c}ms — bot likely)`);
            }
            if (flags.length) console.log(`🚩 Bot 의심 플래그: ${flags.join(', ')}`);
        }

        // 서브컬렉션 — Generate 이력의 직접 증거
        console.log('\nSubcollections:');
        for (const sub of SUBCOLLECTIONS) {
            try {
                const subSnap = await db.collection('users').doc(uid).collection(sub).limit(3).get();
                console.log(`  ${sub}: ${subSnap.size} docs${subSnap.size > 0 ? ' (first 3 keys: ' + subSnap.docs.map(x => x.id).join(', ') + ')' : ''}`);
            } catch (e) {
                console.log(`  ${sub}: ERROR ${e.message}`);
            }
        }

        // savedCards (top-level, userId 필드로 조회)
        try {
            const cardSnap = await db.collection('savedCards').where('userId', '==', uid).limit(3).get();
            console.log(`  savedCards (userId=${uid.slice(0,8)}...): ${cardSnap.size} docs`);
            cardSnap.forEach(d => {
                const x = d.data();
                console.log(`    - sourceType=${x.sourceType} langCode=${x.langCode} createdAt=${toIso(x.createdAt)}`);
            });
        } catch (e) {
            console.log(`  savedCards: ERROR ${e.message}`);
        }
    }

    console.log('\n' + '='.repeat(80));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(3); });
