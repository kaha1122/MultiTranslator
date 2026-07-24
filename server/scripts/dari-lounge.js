// ── Dari's Lounge 수동 개설 CLI — 파일럿·백필용 (cron 미가동 시 일일 운영) ──
// 사용: cd server && node scripts/dari-lounge.js [--date 2026-07-24]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { openDailyLounge } = require('../lib/dariLounge');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

(async () => {
    const r = await openDailyLounge(arg('date', ''));
    console.log(`[dari-lounge] ${r.skipped ? 'skip' : 'DONE'} — ${r.id} theme=${r.themeKey}`);
    process.exit(0);
})().catch((e) => { console.error('[dari-lounge] FAIL', e); process.exit(1); });
