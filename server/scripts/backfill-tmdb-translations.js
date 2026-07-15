// ── TMDB K-Content 메타 사전번역 풀 백필 (1회성, 멱등) ────────────────────────
// 로컬 실행 (server/.env 에 TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/backfill-tmdb-translations.js [옵션]
// 옵션:
//   --media tv|movie|both   (기본 both)
//   --year-from 1990        (기본 1950)
//   --year-to 2026          (기본 올해)
//   --concurrency 4         (TMDB+Gemini 동시 처리 수)
//   --limit 500             (테스트용 상한)
//   --force                 (이미 번역된 작품도 재번역)
// 멱등이라 중단 후 다시 실행하면 남은 작품만 처리. 먼저 --limit 50 으로 시범 권장.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runBackfill } = require('../lib/tmdbBackfill');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const opts = {
    media: arg('media', 'both'),
    yearFrom: parseInt(arg('year-from', '1950'), 10),
    yearTo: arg('year-to') ? parseInt(arg('year-to'), 10) : undefined,
    concurrency: parseInt(arg('concurrency', '4'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : Infinity,
    force: process.argv.includes('--force'),
};

console.log('[backfill] start', opts);
const t0 = Date.now();
runBackfill({
    ...opts,
    onProgress: (p) => console.log('[backfill]', JSON.stringify(p)),
})
    .then((r) => { console.log(`[backfill] DONE in ${Math.round((Date.now() - t0) / 1000)}s`, r); process.exit(0); })
    .catch((e) => { console.error('[backfill] FAIL', e); process.exit(1); });
