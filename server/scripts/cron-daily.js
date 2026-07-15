// ── 신작 K-Content 메타 번역 DAILY (Render Cron Job 대상) ─────────────────────
// Render Cron Job command 예: `cd server && node scripts/cron-daily.js`
//   스케줄 `0 20 * * *` (20:00 UTC = 다음날 05:00 KST).
// 필요 env (Render Cron Job 환경 / 로컬은 server/.env):
//   TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64, PRIMARY_CONTENT_LANG(옵션)
// 하는 일: ① runIncremental(신규=릴리스일 최근 N일 한국작) ② runRetry(부분실패 metaTranslated=false).
//   둘 다 바운드(수백 건)라 빠르고 싸다. 멱등 — 이미 번역된 작품은 skip.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runIncremental, runRetry } = require('../lib/tmdbBackfill');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const days = parseInt(arg('days', '14'), 10);
const maxTitles = parseInt(arg('maxTitles', '200'), 10);
const retryLimit = parseInt(arg('retryLimit', '100'), 10);

(async () => {
    const t0 = Date.now();
    console.log('[cron-daily] start', { days, maxTitles, retryLimit });
    const incremental = await runIncremental({ days, maxTitles });
    console.log('[cron-daily] incremental', JSON.stringify(incremental));
    const retry = await runRetry({ limit: retryLimit });
    console.log('[cron-daily] retry', JSON.stringify(retry));
    console.log(`[cron-daily] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(0);
})().catch((e) => { console.error('[cron-daily] FAIL', e); process.exit(1); });
