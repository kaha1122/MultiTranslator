// ── Firestore config/points 문서 생성·갱신 (2026-09-13) ─────────────────────────────────────
// 필드: addToMyCost(서버 routes/libraryAdd.js 권위, 5분 캐시) · memoFreePerTitle(클라 JournalScreen, 세션 1회 read)
//   memoFreePerTitle: 작품당 무료 메모 수. 넘는 메모부터 1pt(POINTS_ENABLED=true일 때만). null = 무제한.
// 사용: cd server
//   node scripts/set-points-config.js                                   # 현재 값 출력
//   node scripts/set-points-config.js --addToMyCost 2 --memoFreePerTitle 3
//   node scripts/set-points-config.js --memoFreePerTitle null           # 무제한으로 되돌리기
// 규칙: config/* 는 클라 read 공개·write는 Admin 전용(firestore.rules) — 이 스크립트(Admin SDK)로만 쓴다.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { kcultureDb } = require('../config/firebaseKculture');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const num = (v) => (v === undefined ? undefined : v === 'null' ? null : Number(v));

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb not configured');
    const ref = kcultureDb.doc('config/points');
    const patch = {};
    const cost = num(arg('--addToMyCost'));
    const free = num(arg('--memoFreePerTitle'));
    if (cost !== undefined) { if (cost === null || !Number.isFinite(cost) || cost < 0) throw new Error('addToMyCost must be >= 0'); patch.addToMyCost = cost; }
    if (free !== undefined) { if (free !== null && (!Number.isFinite(free) || free < 0)) throw new Error('memoFreePerTitle must be >= 0 or null'); patch.memoFreePerTitle = free; }
    if (Object.keys(patch).length) {
        patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await ref.set(patch, { merge: true });
        console.log('[config/points] set', patch);
    }
    const s = await ref.get();
    console.log('[config/points] now =', s.exists ? s.data() : '(없음)');
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
