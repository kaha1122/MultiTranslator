// pronunciation_records 백필 — 기존 문서에 expiresAt 필드 추가 (2026-05-20 one-off)
//
// 배경: useAudioRecorder.js가 expiresAt 필드 없이 timestamp만 기록해왔음. Firestore TTL 정책은
// expiresAt 필드를 기준으로 동작하므로 기존 문서들은 영구 잔존. 이 스크립트로 일괄 백필.
//
// 로직:
//   - collectionGroup('pronunciation_records') 전수 스캔
//   - expiresAt이 이미 있으면 skip
//   - 없으면 expiresAt = timestamp + 7d. timestamp 없는 비정상 문서는 expiresAt = now (즉시 삭제 대상)
//   - 그러면 7일 이상 된 문서는 TTL 활성화 후 24~72h 내 자동 삭제됨
//   - 7일 미만 문서는 expiresAt이 미래라 정상 케이스처럼 잔여 기간만큼 보존
//
// 사용법:
//   cd server
//   node backfill-pronunciation-expires.js --dry-run    # preview만 (개수/샘플)
//   node backfill-pronunciation-expires.js              # 실 적용
//   node backfill-pronunciation-expires.js --uid=xxx    # 단일 유저만 (테스트)
require('dotenv').config();
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINGLE_UID = (args.find(a => a.startsWith('--uid=')) || '').split('=')[1] || null;

const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

(async () => {
    console.log('=== pronunciation_records expiresAt backfill' +
        (DRY_RUN ? ' (DRY RUN)' : '') +
        (SINGLE_UID ? ` uid=${SINGLE_UID}` : '') + ' ===');

    let scanned = 0;
    let alreadyHasExpires = 0;
    let needsBackfill = 0;
    let backfilled = 0;
    let noTimestamp = 0;
    const samples = [];

    // collectionGroup 쿼리로 모든 user의 pronunciation_records 일괄 조회
    let query = db.collectionGroup('pronunciation_records');

    // SINGLE_UID 지정 시 client-side filter (collectionGroup엔 parent path 필터 어려움)
    const snap = await query.get();
    console.log(`Total docs found: ${snap.size}`);

    // Firestore batch 한도 500 — 안전하게 400씩 끊어서 commit
    const BATCH_LIMIT = 400;
    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
        scanned++;

        // SINGLE_UID 모드: parent path에서 uid 추출 후 필터
        if (SINGLE_UID) {
            const parentUid = docSnap.ref.parent.parent?.id;
            if (parentUid !== SINGLE_UID) continue;
        }

        const data = docSnap.data() || {};

        if (data.expiresAt) {
            alreadyHasExpires++;
            continue;
        }

        let expiresAtMs;
        if (data.timestamp?.toMillis) {
            // timestamp + 7d (정상 케이스). 과거 7일 이상이면 expiresAtMs는 과거 → TTL 즉시 대상
            expiresAtMs = data.timestamp.toMillis() + SEVEN_DAYS_MS;
        } else {
            // timestamp 없는 비정상 문서 — 안전하게 now로 설정해 즉시 삭제 대상으로
            noTimestamp++;
            expiresAtMs = Date.now();
        }

        needsBackfill++;
        const expiresAt = admin.firestore.Timestamp.fromMillis(expiresAtMs);

        if (samples.length < 5) {
            const parentUid = docSnap.ref.parent.parent?.id;
            samples.push({
                uid: parentUid,
                docId: docSnap.id,
                timestamp: data.timestamp?.toDate?.()?.toISOString?.() || null,
                expiresAt: expiresAt.toDate().toISOString(),
                willDeleteSoon: expiresAtMs <= Date.now(),
            });
        }

        if (!DRY_RUN) {
            batch.update(docSnap.ref, { expiresAt });
            batchCount++;
            if (batchCount >= BATCH_LIMIT) {
                await batch.commit();
                backfilled += batchCount;
                console.log(`  committed batch — running total: ${backfilled}`);
                batch = db.batch();
                batchCount = 0;
            }
        }
    }

    if (!DRY_RUN && batchCount > 0) {
        await batch.commit();
        backfilled += batchCount;
    }

    console.log('\n--- Summary ---');
    console.log(`Scanned:              ${scanned}`);
    console.log(`Already has expiresAt: ${alreadyHasExpires}`);
    console.log(`Needs backfill:       ${needsBackfill}`);
    console.log(`  - normal (timestamp + 7d): ${needsBackfill - noTimestamp}`);
    console.log(`  - missing timestamp (set to now): ${noTimestamp}`);
    console.log(`Backfilled (committed): ${backfilled}`);
    console.log(`\nSamples (first 5):`);
    samples.forEach((s, i) => console.log(`  ${i + 1}.`, s));

    if (DRY_RUN) console.log('\n[DRY RUN] No writes performed. Re-run without --dry-run to apply.');
    else console.log('\nDone. TTL 정책 활성화 시 expiresAt <= now 문서 24~72h 내 삭제됨.');

    process.exit(0);
})().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
