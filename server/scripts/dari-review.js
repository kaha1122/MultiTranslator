// ── Dari AI 큐레이터 — 리뷰 글(posts) 수동 게시 CLI ──────────────────────────
// 초안은 운영자/Claude가 작성(자동 생성 아님 — DECISIONS.md §8 STEP D 반자동 파이프라인).
// 사용: cd server && node scripts/dari-review.js --file <초안.json> [--dry]
//       cd server && node scripts/dari-review.js --reseed <postId>   (기존 글 번역 재시드 — 본문+제목)
// 초안 JSON: { "tmdbId": 123, "media": "movie"|"tv", "title": "...", "body": "...", "spoilerBody": null }
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ensureDariAccount, createReviewPost, reseedReviewPost } = require('../lib/dari');
const { kcultureDb } = require('../config/firebaseKculture');
const { collectQuietly } = require('../lib/collectHighlights');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const t0 = Date.now();

async function main() {
    const reseedId = arg('reseed', '');
    if (reseedId) {
        const r = await reseedReviewPost(reseedId);
        console.log(`[dari-review] 재시드 완료: ${r.seededLangs.join(', ')}`);
        return;
    }

    const file = arg('file', '');
    const dryRun = process.argv.includes('--dry');
    if (!file || !fs.existsSync(file)) {
        console.error('사용법: node scripts/dari-review.js --file <초안.json> [--dry] | --reseed <postId>');
        process.exit(1);
    }
    const draft = JSON.parse(fs.readFileSync(file, 'utf8'));

    console.log('[dari-review] start', { tmdbId: draft.tmdbId, media: draft.media, dryRun });
    const uid = await ensureDariAccount();
    console.log(`[dari-review] Dari uid=${uid}`);
    const r = await createReviewPost({ ...draft, dryRun });
    console.log('─'.repeat(60));
    console.log(`문서 경로 : ${r.path || '(dry-run — 미기록)'}`);
    console.log(`작품      : ${r.titleName} (${r.media} ${r.titleId})`);
    console.log(`제목      : ${r.title}`);
    if (r.seededLangs) console.log(`번역 시드 : ${r.seededLangs.join(', ')}`);
    console.log('─'.repeat(60));

    // ── 회차 하이라이트 자동 수집 (2026-08-28 사용자 지시) ──────────────────────
    // 리뷰를 쓴 작품은 그 자리에서 에피소드 탭 하이라이트까지 채운다.
    // 부가 기능이므로 **실패해도 게시는 성공으로 둔다**(collectQuietly 는 throw 하지 않는다).
    // 시즌은 초안 JSON 의 season(선택, 기본 1) — ⚠ 다시즌 작품은 반드시 넣을 것.
    if (!dryRun && !process.argv.includes('--no-highlights')) {
        const season = Number(draft.season) > 0 ? Number(draft.season) : 1;
        console.log(`[dari-review] 하이라이트 수집 시작 — ${r.titleId} S${season} (${r.media})`);
        const h = await collectQuietly(kcultureDb, { titleId: r.titleId, season, media: r.media, tag: `review-${r.titleId}` });
        if (h.skipped) console.log(`[dari-review] 하이라이트 건너뜀 — ${h.skipped}`);
        else console.log(`[dari-review] 하이라이트 — 저장 ${h.saved.length} / 검토 ${h.ambiguous.length} / 없음 ${h.notfound.length}`);
    }
}

main()
    .then(() => { console.log(`[dari-review] DONE in ${Math.round((Date.now() - t0) / 1000)}s`); process.exit(0); })
    .catch((e) => { console.error('[dari-review] FAIL', e); process.exit(1); });
