// ── 전 유저 users.points 일괄 50pt 리셋 (2026-09-18 포인트제 전면 오픈 런북 1단계) ─────────
// 무료 개방 기간(2026-07-02~09-18)의 누적분·2026-07-12 이전 가입자 1000pt 부여분을 정리해 전원 같은 출발선(50pt)에서
// 포인트제를 시작한다(DECISIONS.md "재활성화 런북", KCulture CLAUDE.md "Phase R"). 사용자 결정 2026-09-18: **모든 사용자를
// 정확히 50pt로**(게스트 포함 — 2026-09-13부터 게스트도 50pt 정책). Pro 활성 사용자는 잔액을 쓰지 않으므로(unlimited) 같이 맞춰도 무해.
//
// 사용: cd server && node scripts/reset-points-50.js            # dry-run(기본) — 대상 수·분포만 출력
//       node scripts/reset-points-50.js --apply                  # 실제 반영
//       node scripts/reset-points-50.js --apply --uid <uid>      # 한 사용자만
// 멱등: 이미 50인 문서는 건너뛴다. 감사용으로 users/{uid}/pointLedger 에 {type:'reset50', from, amount:50-from} 1건을 남긴다.
// ⚠ users 본문 write는 AuthContext onSnapshot을 깨우지만(§6-1) 1회성 배치라 허용 — 사용 중인 기기는 잔액이 즉시 50으로 보인다.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { kcultureDb } = require('../config/firebaseKculture');

const APPLY = process.argv.includes('--apply');
const uidArgIdx = process.argv.indexOf('--uid');
const ONLY_UID = uidArgIdx > -1 ? process.argv[uidArgIdx + 1] : null;
const TARGET = 50;
const PAGE = 500;

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb not configured (KCULTURE_SERVICE_ACCOUNT_BASE64)');
    const now = admin.firestore.FieldValue.serverTimestamp();
    let scanned = 0, targets = 0, written = 0, noPointsField = 0;
    const buckets = { '<50': 0, '=50': 0, '51-100': 0, '101-1000': 0, '>1000': 0 };
    const bucketOf = (p) => (p < 50 ? '<50' : p === 50 ? '=50' : p <= 100 ? '51-100' : p <= 1000 ? '101-1000' : '>1000');

    if (ONLY_UID) {
        const ref = kcultureDb.collection('users').doc(ONLY_UID);
        const snap = await ref.get();
        if (!snap.exists) throw new Error(`users/${ONLY_UID} not found`);
        const from = Number(snap.data().points) || 0;
        console.log(`[reset50] ${ONLY_UID} points ${from} → ${TARGET}`);
        if (APPLY && from !== TARGET) {
            const b = kcultureDb.batch();
            b.set(ref, { points: TARGET, pointsResetAt: now }, { merge: true });
            b.set(ref.collection('pointLedger').doc(), { type: 'reset50', from, amount: TARGET - from, createdAt: now });
            await b.commit();
            console.log('[reset50] written');
        }
        return;
    }

    let q = kcultureDb.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    let last = null;
    for (;;) {
        const snap = await (last ? q.startAfter(last) : q).get();
        if (snap.empty) break;
        let batch = kcultureDb.batch(), n = 0;
        for (const d of snap.docs) {
            scanned++;
            const data = d.data();
            if (data.points === undefined) noPointsField++;
            const from = Number(data.points) || 0;
            buckets[bucketOf(from)]++;
            if (from === TARGET) continue;
            targets++;
            if (APPLY) {
                batch.set(d.ref, { points: TARGET, pointsResetAt: now }, { merge: true });
                batch.set(d.ref.collection('pointLedger').doc(), { type: 'reset50', from, amount: TARGET - from, createdAt: now });
                n += 2;
            }
            if (n >= 400) { await batch.commit(); written += n / 2; batch = kcultureDb.batch(); n = 0; }
        }
        if (n) { await batch.commit(); written += n / 2; }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE) break;
    }
    console.log(`[reset50] scanned=${scanned} noPointsField=${noPointsField} distribution=${JSON.stringify(buckets)}`);
    console.log(`[reset50] targets(≠50)=${targets} ${APPLY ? `written=${written}` : '(dry-run — add --apply)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
