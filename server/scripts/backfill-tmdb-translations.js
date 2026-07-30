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
//
// ⚠ 이 스크립트는 **프로덕션 주간 sweep의 실제 경로**이기도 하다
//   (Render Cron `kculture-tmdb-weekly-sweep`: `--year-from 2024 --limit 200`, 일요일 20:30 UTC).
//   신작 성인물 게이트(processTitle)가 여기서도 발화하므로 자동 숨김이 생기면 **끝에 숨김 인덱스를
//   다시 만들어야 한다** — 안 그러면 웹 서버가 최대 12시간(hiddenTitles TTL) 그 작품을 계속 노출한다.
//   routes/cronTmdb.js의 sweep 라우트에도 같은 처리가 있다(2026-07-31 발견 — 라우트에만 있었다).
//   한쪽만 고치지 말 것.
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
    .then(async (r) => {
        console.log(`[backfill] DONE in ${Math.round((Date.now() - t0) / 1000)}s`, r);
        // 신작 성인물 자동 숨김분 즉시 반영(적중 0이면 no-op). 실패해도 백필 자체는 성공으로 끝낸다 —
        // 번역은 이미 다 됐고, 반영은 TTL이 받아준다.
        if (r?.adultHidden > 0) {
            try {
                const { refreshHiddenFilter } = require('./refresh-hidden-filter');
                const h = await refreshHiddenFilter({ quiet: true });
                console.log('[backfill] hidden', JSON.stringify({
                    adultHidden: r.adultHidden, index: h.rebuilt?.count ?? null, notified: h.notified, error: h.error || null,
                }));
            } catch (e) {
                console.warn(`[backfill] 자동 숨김 ${r.adultHidden}건이나 인덱스 반영 실패: ${e.message}`);
            }
        }
        process.exit(0);
    })
    .catch((e) => { console.error('[backfill] FAIL', e); process.exit(1); });
