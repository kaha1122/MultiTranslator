// ── Dari 게시물 번역 증분 시드 CLI — SEED_LANGS에 새 언어 추가 후 1회 실행 ──
// 기존 스레드(curation_threads 전체)·큐레이터 리뷰(posts curator==true)에서
// 빠진 언어만 골라 번역 시드(이미 있는 언어는 재번역·재기록 없음, 멱등).
// 사용:
//   node scripts/dari-seed-missing.js --dry-run   # 누락 현황만 출력(번역·쓰기 없음)
//   node scripts/dari-seed-missing.js             # 실제 시드
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { seedMissingLangs } = require('../lib/dari');

(async () => {
    const dryRun = process.argv.includes('--dry-run');
    const stat = await seedMissingLangs({ dryRun });
    process.exit(stat.errors ? 1 : 0);
})().catch((e) => { console.error('[dari-seed-missing] FAIL', e); process.exit(1); });
