// ── 신작 K-Content 메타 번역 증분 (cron 전용) ────────────────────────────────
// 매일 1회 호출 권장. 최근 N일 공개 신작만 사전번역해 kculture Firestore에 캐시.
// requireCronAuth(fail-closed) — x-cron-secret 헤더 필요.
const express = require('express');
const { requireCronAuth } = require('../middleware/auth');
const { runIncremental } = require('../lib/tmdbBackfill');

const router = express.Router();

router.post('/api/cron/tmdb-pretranslate', requireCronAuth, async (req, res) => {
    try {
        const days = Math.min(parseInt(req.body?.days, 10) || 14, 90);
        const maxTitles = Math.min(parseInt(req.body?.maxTitles, 10) || 200, 500);
        const r = await runIncremental({ days, maxTitles });
        console.log('[cron/tmdb-pretranslate]', JSON.stringify(r));
        res.json({ ok: true, ...r });
    } catch (e) {
        console.error('[cron/tmdb-pretranslate]', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
