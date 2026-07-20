// ── Dari AI 큐레이터 — 리뷰 글(posts) 수동 게시 CLI ──────────────────────────
// 초안은 운영자/Claude가 작성(자동 생성 아님 — DECISIONS.md §8 STEP D 반자동 파이프라인).
// 사용: cd server && node scripts/dari-review.js --file <초안.json> [--dry]
// 초안 JSON: { "tmdbId": 123, "media": "movie"|"tv", "title": "...", "body": "...", "spoilerBody": null }
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ensureDariAccount, createReviewPost } = require('../lib/dari');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const file = arg('file', '');
const dryRun = process.argv.includes('--dry');
if (!file || !fs.existsSync(file)) {
    console.error('사용법: node scripts/dari-review.js --file <초안.json> [--dry]');
    process.exit(1);
}
const draft = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log('[dari-review] start', { tmdbId: draft.tmdbId, media: draft.media, dryRun });
const t0 = Date.now();
(async () => {
    const uid = await ensureDariAccount();
    console.log(`[dari-review] Dari uid=${uid}`);
    const r = await createReviewPost({ ...draft, dryRun });
    console.log('─'.repeat(60));
    console.log(`문서 경로 : ${r.path || '(dry-run — 미기록)'}`);
    console.log(`작품      : ${r.titleName} (${r.media} ${r.titleId})`);
    console.log(`제목      : ${r.title}`);
    if (r.seededLangs) console.log(`번역 시드 : ${r.seededLangs.join(', ')}`);
    console.log('─'.repeat(60));
    console.log(`[dari-review] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(0);
})().catch((e) => { console.error('[dari-review] FAIL', e); process.exit(1); });
