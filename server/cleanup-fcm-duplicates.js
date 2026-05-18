// FCM 토큰 중복(같은 Instance ID prefix) 일괄 정리 — 2026-05-18 one-off
//
// 배경: 옛 migrate-anonymous + saveFcmTokenToFirestore가 arrayUnion-only라
// 같은 단말의 회전된 옛 토큰 + 새 토큰을 둘 다 누적시킴 → 같은 단말에 알림 2번 발화.
// 모든 users doc 스캔 후 fcmTokens의 같은 prefix 중복 발견 시 **마지막(최신) 토큰만 유지**.
// (Firestore arrayUnion은 append 순서 보장 → 배열 마지막이 가장 최근 등록 토큰)
//
// 사용법:
//   cd server
//   node cleanup-fcm-duplicates.js --dry-run    # preview만
//   node cleanup-fcm-duplicates.js              # 실 적용
//   node cleanup-fcm-duplicates.js --uid=xxx    # 단일 유저만
require('dotenv').config();
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINGLE_UID = (args.find(a => a.startsWith('--uid=')) || '').split('=')[1] || null;

const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function dedupByPrefix(tokens) {
    // 같은 prefix(콜론 앞 Instance ID) 토큰 중 마지막 등장만 유지.
    // Firestore arrayUnion은 append 순서 보장이므로 배열 끝쪽이 더 최근.
    const lastByPrefix = new Map();
    tokens.forEach((t, i) => {
        if (!t) return;
        const prefix = t.split(':')[0];
        lastByPrefix.set(prefix, i); // 같은 prefix면 최신 인덱스로 덮어씀
    });
    const keepIndices = new Set(lastByPrefix.values());
    return tokens.filter((t, i) => t && keepIndices.has(i));
}

(async () => {
    console.log('=== FCM token dedup' + (DRY_RUN ? ' (DRY RUN)' : '') + (SINGLE_UID ? ` uid=${SINGLE_UID}` : '') + ' ===');

    let totalScanned = 0;
    let withTokens = 0;
    let needsCleanup = 0;
    let cleaned = 0;
    const samples = [];

    const processDoc = async (docSnap) => {
        totalScanned++;
        const data = docSnap.data() || {};
        const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
        if (tokens.length < 2) return;
        withTokens++;
        const deduped = dedupByPrefix(tokens);
        if (deduped.length === tokens.length) return; // 변화 없음
        needsCleanup++;
        const removed = tokens.length - deduped.length;
        if (samples.length < 10) {
            samples.push({
                uid: docSnap.id,
                email: data.email || null,
                displayName: data.displayName || null,
                before: tokens.length,
                after: deduped.length,
                removed,
                prefixes: [...new Set(tokens.map(t => (t || '').split(':')[0].slice(0, 16)))],
            });
        }
        if (!DRY_RUN) {
            await docSnap.ref.update({ fcmTokens: deduped });
            cleaned++;
        }
    };

    if (SINGLE_UID) {
        const snap = await db.collection('users').doc(SINGLE_UID).get();
        if (!snap.exists) {
            console.error('user not found:', SINGLE_UID);
            process.exit(1);
        }
        await processDoc(snap);
    } else {
        // 전체 스캔 — fcmTokens 보유한 doc만
        // (where 절로 array 길이 직접 필터 불가 → 전체 paging)
        let lastDoc = null;
        const PAGE = 500;
        while (true) {
            let q = db.collection('users').orderBy('__name__').limit(PAGE);
            if (lastDoc) q = q.startAfter(lastDoc);
            const page = await q.get();
            if (page.empty) break;
            for (const d of page.docs) await processDoc(d);
            if (page.size < PAGE) break;
            lastDoc = page.docs[page.docs.length - 1];
            process.stdout.write(`  scanned ${totalScanned}, needsCleanup ${needsCleanup}\r`);
        }
        console.log('');
    }

    console.log('\n=== Result ===');
    console.log('totalScanned:', totalScanned);
    console.log('with >=2 tokens:', withTokens);
    console.log('needsCleanup (same prefix dup):', needsCleanup);
    console.log('actually cleaned:', cleaned, DRY_RUN ? '(dry-run, 0 written)' : '');
    if (samples.length > 0) {
        console.log('\n--- sample cleanups (first 10) ---');
        samples.forEach(s => {
            console.log(`${s.uid} (${s.email || s.displayName || '?'}): ${s.before} → ${s.after} (-${s.removed}) prefixes=${s.prefixes.join(',')}`);
        });
    }
    process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
