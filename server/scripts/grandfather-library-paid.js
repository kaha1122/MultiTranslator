// ── 기존 보관함 소급 면제: users/*/library/* 에 paid:true 마커 일괄 부여 (2026-09-13) ─────────
// 포인트제 ON(POINTS_ENABLED=true) 시점에 1회 실행 — 그 전에 담긴 작품은 Add to MY 2pt를 받지 않는다
// (KCulture POINTS_ECONOMY_V2 §10-1 "기존 사용자 소급 없음"). 재활성화 런북(DECISIONS.md)의 한 단계.
// 프리뷰 테스트에서 특정 계정만 면제하려면 --uid <uid>.
//
// 사용: cd server && node scripts/grandfather-library-paid.js            # dry-run(기본) — 대상 수만 출력
//       node scripts/grandfather-library-paid.js --apply                  # 실제 반영
//       node scripts/grandfather-library-paid.js --apply --uid <uid>      # 한 사용자만
// 멱등: paid 필드가 이미 있는 문서는 건너뛴다. paidCost:0 으로 남겨 "소급 면제"임을 구분한다.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { kcultureDb } = require('../config/firebaseKculture');

const APPLY = process.argv.includes('--apply');
const uidArgIdx = process.argv.indexOf('--uid');
const ONLY_UID = uidArgIdx > -1 ? process.argv[uidArgIdx + 1] : null;
const PAGE = 500;

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb not configured (KCULTURE_SERVICE_ACCOUNT_BASE64)');
    let q = ONLY_UID
        ? kcultureDb.collection('users').doc(ONLY_UID).collection('library').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE)
        : kcultureDb.collectionGroup('library').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    let last = null, scanned = 0, targets = 0, written = 0;
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (;;) {
        const snap = await (last ? q.startAfter(last) : q).get();
        if (snap.empty) break;
        let batch = kcultureDb.batch(), n = 0;
        for (const d of snap.docs) {
            scanned++;
            // collectionGroup('library')는 users/*/library 외 다른 library 컬렉션도 잡을 수 있어 경로를 확인한다.
            if (!ONLY_UID && !/^users\/[^/]+\/library\/[^/]+$/.test(d.ref.path)) continue;
            if (d.data().paid !== undefined) continue;
            targets++;
            if (APPLY) { batch.set(d.ref, { paid: true, paidAt: now, paidCost: 0 }, { merge: true }); n++; }
            if (n >= 400) { await batch.commit(); written += n; batch = kcultureDb.batch(); n = 0; }
        }
        if (n) { await batch.commit(); written += n; }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE) break;
    }
    console.log(`[grandfather] scanned=${scanned} targets(no paid)=${targets} ${APPLY ? `written=${written}` : '(dry-run — add --apply)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
