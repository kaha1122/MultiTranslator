// ── 자동 소감 고정 페르소나 계정 6개 생성/보장 (멱등) ─────────────────────────────
// 사용: cd server && node scripts/sogam-accounts.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ensureSogamAccount, LANGS, PERSONAS } = require('../lib/sogam');

(async () => {
    for (const lang of LANGS) {
        const uid = await ensureSogamAccount(lang);
        console.log(`${lang}\t${PERSONAS[lang]}\t${uid}`);
    }
    console.log('[sogam-accounts] DONE');
    process.exit(0);
})().catch((e) => { console.error('[sogam-accounts] FAIL', e); process.exit(1); });
