// ── TMDB "전체 메타" 영속 백필 실행 (평가용 1회성, 멱등) ─────────────────────────
// 이미 번역된 타이틀(titles/{id}.media 있음) 전체에 대해 TMDB 전체 메타를 titles/{id}.meta 에 저장.
// 서빙 후보 평가용 — 실행 후 문서 크기 통계로 운영 방향(영속 서빙 vs 라이브)을 정한다.
//
// 로컬 실행 (server/.env 에 TMDB_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/backfill-tmdb-meta.js [옵션]
// 옵션:
//   --concurrency 6   (TMDB 동시 처리 수, 기본 6)
//   --limit 20        (테스트용 상한 — 먼저 소수로 시범 권장)
//   --force           (이미 metaCachedAt 있어도 재수집)
// 멱등: metaCachedAt 있으면 skip → 중단 후 재실행 시 남은 것만.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runMetaBackfill } = require('../lib/tmdbMetaBackfill');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const opts = {
    concurrency: parseInt(arg('concurrency', '6'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : Infinity,
    force: process.argv.includes('--force'),
};

const kb = (b) => `${(b / 1024).toFixed(1)}KB`;

console.log('[meta-backfill] start', opts);
const t0 = Date.now();
runMetaBackfill({
    ...opts,
    onProgress: (p) => console.log('[meta-backfill]', JSON.stringify(p)),
})
    .then((r) => {
        console.log('\n[meta-backfill] DONE in', Math.round((Date.now() - t0) / 1000) + 's');
        console.log('  대상(번역됨):', r.total, '| 저장:', r.done, '| skip:', r.skipped, '| 오류:', r.errors);
        console.log('  문서크기  평균:', kb(r.bytesAvg), '| 최대:', kb(r.bytesMax), '| 1MB근접(>900KB):', r.near1mb);
        if (r.top5?.length) {
            console.log('  최대 5개:');
            r.top5.forEach((t) => console.log(`    - ${t.media}/${t.id}: ${kb(t.bytes)}`));
        }
        console.log('  총 저장량(meta 합):', kb(r.bytesSum));
        process.exit(0);
    })
    .catch((e) => { console.error('[meta-backfill] FAIL', e); process.exit(1); });
