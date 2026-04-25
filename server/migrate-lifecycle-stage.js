// Lifecycle Stage 마이그레이션 — 1회성 백필 스크립트
//
// 산출 필드 3종:
//   - lifecycleStage   : null | 'starter' | 'engaged' | 'subscriber'
//   - activeDayCount   : users/{uid}/dailyProgress 서브컬렉션 doc 개수
//   - hasEverSubscribed: subscriptionExpiresAt 필드 존재 여부 (단일 신호)
//
// 분류 precedence (top-down, 첫 매치 적용):
//   if hasEverSubscribed                          → 'subscriber'
//   else if activeDayCount >= 2                    → 'engaged'
//   else if (totalGenerateCount || 0) >= 1         → 'starter'
//   else                                            → null
//
// 사용법:
//   cd server
//   node migrate-lifecycle-stage.js --dry-run      # 기본: 보고만, 쓰기 없음
//   node migrate-lifecycle-stage.js --apply        # 실제 Firestore 쓰기 + 백업
//   node migrate-lifecycle-stage.js --apply --backup-name users_lifecycle_backup_2026-04-25
//
// 옵션:
//   --out <path>          CSV 저장 경로 (기본 server/migration_lifecycle_<date>.csv)
//   --page-size <N>       cursor pagination 페이지 크기 (기본 500)
//   --backup-name <coll>  apply 시 백업 컬렉션 이름 (기본 users_lifecycle_backup_<date>)

require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const hasFlag = (k) => args.includes(k);
const getArg = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
};

const DRY_RUN = !hasFlag('--apply');
const PAGE_SIZE = parseInt(getArg('--page-size', '500'), 10);
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const OUT_CSV = getArg('--out', path.join(__dirname, `migration_lifecycle_${today}.csv`));
const BACKUP_COLLECTION = getArg('--backup-name', `users_lifecycle_backup_${today}`);

if (!admin.apps.length) {
    const sa = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8')
    );
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

// CSV escape — 쉼표/줄바꿈/따옴표 포함 시 quote
const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
};

const computeLifecycleStage = ({ hasEverSubscribed, activeDayCount, totalGenerateCount }) => {
    if (hasEverSubscribed) return 'subscriber';
    if (activeDayCount >= 2) return 'engaged';
    if ((totalGenerateCount || 0) >= 1) return 'starter';
    return null;
};

(async () => {
    console.log('');
    console.log(`=== Lifecycle Stage Migration — ${DRY_RUN ? 'DRY RUN (read-only)' : 'APPLY (writes!)'} ===`);
    console.log(`Page size       : ${PAGE_SIZE}`);
    console.log(`CSV output      : ${OUT_CSV}`);
    if (!DRY_RUN) console.log(`Backup collection: ${BACKUP_COLLECTION}`);
    console.log('');

    const startedAt = Date.now();

    // 통계 누적
    const stats = {
        scanned: 0,
        errors: 0,
        byStage: { null: 0, starter: 0, engaged: 0, subscriber: 0 },
        byAuth: {
            anonymous: { null: 0, starter: 0, engaged: 0, subscriber: 0 },
            registered: { null: 0, starter: 0, engaged: 0, subscriber: 0 },
        },
        engagedActiveDayHistogram: { '2': 0, '3-4': 0, '5-7': 0, '8-14': 0, '15+': 0 },
        subscriberBreakdown: { activePaid: 0, expiredOrCancelled: 0 },
        currentStageMismatch: 0, // 이미 lifecycleStage 있는데 다른 값으로 재계산되는 경우
        unchanged: 0,
        anomalies: [],
    };

    // CSV 헤더
    const csvHeader = [
        'uid', 'isAnonymous', 'tier', 'tierSource', 'totalGenerateCount',
        'activeDayCount', 'hasEverSubscribed', 'currentLifecycleStage',
        'computedLifecycleStage', 'shouldUpdate',
        'subscriptionExpiresAt', 'createdAt',
    ].join(',');
    const csvLines = [csvHeader];

    // 배치 (apply 모드)
    let writeBatch = db.batch();
    let backupBatch = db.batch();
    let pendingOps = 0;
    const flushBatches = async () => {
        if (pendingOps === 0) return;
        await backupBatch.commit();
        await writeBatch.commit();
        writeBatch = db.batch();
        backupBatch = db.batch();
        pendingOps = 0;
    };

    // Cursor pagination — orderBy createdAt 부재 시 __name__로 fallback
    let lastDoc = null;
    let pageNum = 0;

    while (true) {
        let q = db.collection('users').orderBy('__name__').limit(PAGE_SIZE);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;
        pageNum++;

        // 페이지 내 사용자 처리 — count query 직렬 처리 (병렬 시 quota burst 위험)
        for (const userDoc of snap.docs) {
            const uid = userDoc.id;
            const d = userDoc.data();

            try {
                // 1. dailyProgress count 조회 (aggregation = 1 read)
                const cntSnap = await db
                    .collection('users').doc(uid)
                    .collection('dailyProgress')
                    .count().get();
                const activeDayCount = cntSnap.data().count || 0;

                // 2. 신호 수집
                const totalGenerateCount = d.totalGenerateCount || 0;
                const hasEverSubscribed = !!d.subscriptionExpiresAt;
                const isAnonymous = d.isAnonymous === true;
                const currentStage = d.lifecycleStage ?? 'absent';

                // 3. lifecycleStage 계산
                const computedStage = computeLifecycleStage({
                    hasEverSubscribed, activeDayCount, totalGenerateCount,
                });

                // 4. 통계
                stats.scanned++;
                const stageKey = computedStage === null ? 'null' : computedStage;
                stats.byStage[stageKey]++;
                stats.byAuth[isAnonymous ? 'anonymous' : 'registered'][stageKey]++;

                if (computedStage === 'engaged') {
                    if (activeDayCount === 2) stats.engagedActiveDayHistogram['2']++;
                    else if (activeDayCount <= 4) stats.engagedActiveDayHistogram['3-4']++;
                    else if (activeDayCount <= 7) stats.engagedActiveDayHistogram['5-7']++;
                    else if (activeDayCount <= 14) stats.engagedActiveDayHistogram['8-14']++;
                    else stats.engagedActiveDayHistogram['15+']++;
                }
                if (computedStage === 'subscriber') {
                    if (d.tier === 'pro' || d.tier === 'premium') stats.subscriberBreakdown.activePaid++;
                    else stats.subscriberBreakdown.expiredOrCancelled++;
                }

                const shouldUpdate = currentStage !== computedStage
                    || (d.activeDayCount ?? -1) !== activeDayCount
                    || (d.hasEverSubscribed ?? null) !== hasEverSubscribed;
                if (currentStage !== 'absent' && currentStage !== computedStage) {
                    stats.currentStageMismatch++;
                }
                if (!shouldUpdate) stats.unchanged++;

                // 5. anomaly 감지
                if (d.tier === 'pro' && !d.subscriptionExpiresAt) {
                    stats.anomalies.push({ uid, type: 'pro_without_expiry', tier: d.tier, tierSource: d.tierSource });
                }
                if (hasEverSubscribed && totalGenerateCount === 0) {
                    stats.anomalies.push({ uid, type: 'subscribed_without_generate' });
                }

                // 6. CSV 기록
                csvLines.push([
                    csvEscape(uid),
                    csvEscape(isAnonymous),
                    csvEscape(d.tier || ''),
                    csvEscape(d.tierSource || ''),
                    csvEscape(totalGenerateCount),
                    csvEscape(activeDayCount),
                    csvEscape(hasEverSubscribed),
                    csvEscape(currentStage === 'absent' ? '' : (currentStage ?? 'null')),
                    csvEscape(computedStage ?? 'null'),
                    csvEscape(shouldUpdate),
                    csvEscape(d.subscriptionExpiresAt?.toDate?.()?.toISOString() || ''),
                    csvEscape(d.createdAt?.toDate?.()?.toISOString() || ''),
                ].join(','));

                // 7. apply 모드: 배치에 추가
                if (!DRY_RUN && shouldUpdate) {
                    // 백업 — 기존 값 보존 (롤백용)
                    backupBatch.set(
                        db.collection(BACKUP_COLLECTION).doc(uid),
                        {
                            uid,
                            previousLifecycleStage: d.lifecycleStage ?? null,
                            previousActiveDayCount: d.activeDayCount ?? null,
                            previousHasEverSubscribed: d.hasEverSubscribed ?? null,
                            backedUpAt: admin.firestore.FieldValue.serverTimestamp(),
                        },
                        { merge: false }
                    );

                    // 본 업데이트
                    writeBatch.update(
                        db.collection('users').doc(uid),
                        {
                            lifecycleStage: computedStage,
                            activeDayCount,
                            hasEverSubscribed,
                            lifecycleStageMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }
                    );
                    pendingOps += 2;

                    // Firestore batch 한도 500 ops — 안전마진으로 400에서 flush
                    if (pendingOps >= 400) {
                        await flushBatches();
                    }
                }
            } catch (e) {
                stats.errors++;
                console.error(`[err] uid=${uid}: ${e.message}`);
            }
        }

        lastDoc = snap.docs[snap.docs.length - 1];

        // 진행률 로그
        if (pageNum % 5 === 0 || snap.size < PAGE_SIZE) {
            console.log(`  page ${pageNum} done — scanned ${stats.scanned} so far`);
        }

        if (snap.size < PAGE_SIZE) break;
    }

    // 마지막 배치 flush
    if (!DRY_RUN) await flushBatches();

    // CSV 저장
    fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf8');

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

    // 결과 출력
    console.log('');
    console.log(`=== ${DRY_RUN ? 'DRY RUN' : 'APPLY'} 완료 (${elapsedSec}s) ===`);
    console.log(`Total scanned   : ${stats.scanned}`);
    if (stats.errors) console.log(`Errors          : ${stats.errors}`);
    if (!DRY_RUN) console.log(`Updated         : ${stats.scanned - stats.unchanged - stats.errors}`);
    if (!DRY_RUN) console.log(`Unchanged       : ${stats.unchanged}`);
    console.log('');
    console.log('Distribution:');
    const total = stats.scanned || 1;
    for (const k of ['null', 'starter', 'engaged', 'subscriber']) {
        const n = stats.byStage[k];
        console.log(`  ${k.padEnd(11)} : ${String(n).padStart(6)} (${(n / total * 100).toFixed(1)}%)`);
    }
    console.log('');
    console.log('By auth state:');
    for (const auth of ['anonymous', 'registered']) {
        const sub = stats.byAuth[auth];
        const subTotal = sub.null + sub.starter + sub.engaged + sub.subscriber;
        console.log(`  ${auth.padEnd(11)} : ${subTotal}`);
        for (const k of ['null', 'starter', 'engaged', 'subscriber']) {
            console.log(`    ${k.padEnd(9)} : ${sub[k]}`);
        }
    }
    console.log('');
    console.log('Engaged — activeDayCount distribution:');
    for (const [bucket, n] of Object.entries(stats.engagedActiveDayHistogram)) {
        console.log(`  ${bucket.padEnd(7)} : ${n}`);
    }
    console.log('');
    console.log('Subscriber breakdown:');
    console.log(`  Currently active (tier=pro|premium) : ${stats.subscriberBreakdown.activePaid}`);
    console.log(`  Expired/Cancelled (tier=trial)      : ${stats.subscriberBreakdown.expiredOrCancelled}`);
    console.log('');
    if (stats.currentStageMismatch > 0) {
        console.log(`⚠ ${stats.currentStageMismatch} users had existing lifecycleStage that differs from computed value`);
    }
    if (stats.anomalies.length > 0) {
        console.log(`⚠ Anomalies (${stats.anomalies.length}):`);
        const byType = {};
        stats.anomalies.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
        for (const [t, n] of Object.entries(byType)) console.log(`  ${t}: ${n}`);
        console.log(`  (상세는 CSV 파일 참고)`);
    }
    console.log('');
    console.log(`💾 CSV: ${OUT_CSV}`);
    if (!DRY_RUN) console.log(`💾 Backup collection: ${BACKUP_COLLECTION}`);
    console.log('');

    process.exit(0);
})().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
