// ── 자동 소감 게시 수동 실행기 — 테스트/백필용 ────────────────────────────────────
// 사용: cd server && node scripts/sogam-autopost.js [--force]
//   --force  슬롯 시각·중복 게이트 우회(즉시 1건 게시) — 파이프라인 테스트용
// 프로덕션은 news-refresh 체이닝이 자동 호출(KST 09/17/21/01) — 이 스크립트는 평시 불필요.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runAutopost } = require('../lib/sogam');

(async () => {
    const r = await runAutopost({ force: process.argv.includes('--force') });
    console.log('[sogam-autopost]', JSON.stringify(r));
    process.exit(0);
})().catch((e) => { console.error('[sogam-autopost] FAIL', e); process.exit(1); });
