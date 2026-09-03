// K-DramaAnyLang 푸시 운영 스위치 — Firestore config/kc_push { sogamEnabled, probeEnabled }
// 사용: cd server && node scripts/kc-push-flags.js                 # 현재 값 출력
//       node scripts/kc-push-flags.js --sogam on|off --probe on|off  # 토글(둘 중 하나만도 가능)
// 기본(문서 없음) = 둘 다 false → 소감 푸시·사일런트 탐침 모두 발송 안 함. 실기기 검증 후 켠다(2026-09-04).
require('dotenv').config();
const { kcultureDb } = require('../config/firebaseKculture');

(async () => {
    if (!kcultureDb) { console.error('kculture Firestore not configured'); process.exit(1); }
    const args = process.argv.slice(2);
    const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
    const ref = kcultureDb.doc('config/kc_push');
    const patch = {};
    for (const [flag, field] of [['--sogam', 'sogamEnabled'], ['--probe', 'probeEnabled']]) {
        const v = get(flag);
        if (v == null) continue;
        if (!['on', 'off'].includes(v)) { console.error(`${flag} on|off`); process.exit(1); }
        patch[field] = v === 'on';
    }
    if (Object.keys(patch).length) {
        await ref.set({ ...patch, updatedAt: new Date() }, { merge: true });
        console.log('updated', patch);
    }
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : {};
    console.log('config/kc_push =', { sogamEnabled: d.sogamEnabled === true, probeEnabled: d.probeEnabled === true, updatedAt: d.updatedAt || null });
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
