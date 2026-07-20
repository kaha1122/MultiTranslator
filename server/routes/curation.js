// ── K-DramaAnyLang Dari AI 큐레이터 게시 (운영자 전용) ───────────────────────
// POST /api/curation/publish — 회차 토론 스레드/큐레이터 리뷰 글을 kculture Firestore에 게시.
// 인증: x-curation-secret 헤더 = env CURATION_ADMIN_SECRET (fail-closed — 미설정 시 503,
//   requireCronAuth와 동일 설계·timing-safe 비교). 사용자 토큰 아님 — 운영자/스케줄러 전용.
// 실 게시 로직은 lib/dari.js (scripts/dari-publish.js CLI와 공용).
const express = require('express');
const crypto = require('crypto');
const { ensureDariAccount, createEpisodeThread, createReviewPost } = require('../lib/dari');

const router = express.Router();
const CURATION_ADMIN_SECRET = process.env.CURATION_ADMIN_SECRET || '';

// 운영자 인증 (middleware/auth.js requireCronAuth와 동일 패턴 — fail-closed + timing-safe)
function requireCurationAuth(req, res, next) {
    if (!CURATION_ADMIN_SECRET) {
        console.error('[CurationAuth] CURATION_ADMIN_SECRET not set — rejecting (fail-closed)');
        return res.status(503).json({ error: 'Curation auth not configured' });
    }
    const key = req.headers['x-curation-secret'] || '';
    const a = Buffer.from(key);
    const b = Buffer.from(CURATION_ADMIN_SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    return res.status(401).json({ error: 'Unauthorized curation request' });
}

router.post('/api/curation/publish', requireCurationAuth, async (req, res) => {
    const b = req.body || {};
    try {
        await ensureDariAccount();
        if (b.type === 'episode_thread') {
            const episodes = Array.isArray(b.episodes) ? b.episodes.map(Number) : [];
            const r = await createEpisodeThread({
                tmdbId: Number(b.tmdbId),
                season: Number.isInteger(Number(b.season)) && Number(b.season) > 0 ? Number(b.season) : 1,
                episodes,
                dryRun: !!b.dryRun,
            });
            console.log(`[Curation] episode_thread tmdbId=${b.tmdbId} eps=${episodes.join(',')} → ${r.skipped ? 'SKIP(존재)' : r.dryRun ? 'DRY' : 'OK'} ${r.path}`);
            return res.json({ ok: true, result: r });
        }
        if (b.type === 'review') {
            const r = await createReviewPost({
                tmdbId: Number(b.tmdbId),
                media: b.media,
                title: b.title,
                body: b.body,
                spoilerBody: b.spoilerBody || null,
                dryRun: !!b.dryRun,
            });
            console.log(`[Curation] review tmdbId=${b.tmdbId} media=${b.media} → ${r.dryRun ? 'DRY' : `OK posts/${r.postId}`}`);
            return res.json({ ok: true, result: r });
        }
        return res.status(400).json({ error: "type: 'episode_thread' | 'review'" });
    } catch (e) {
        console.error(`[Curation] FAIL type=${b.type}:`, e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
