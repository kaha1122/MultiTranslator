// ── Dari's Lounge 일일 발행 cron (K-DramaAnyLang 전용, additive) ──────────────
// requireCronAuth(fail-closed) — x-cron-secret 헤더 필요. Render Cron이 매일 00:05 UTC POST.
// 결정적 발행(Gemini·TMDB 0, 멱등)이라 검수 게이트 없이 전자동 안전(DECISIONS.md §9).
const express = require('express');
const { requireCronAuth } = require('../middleware/auth');
const { openDailyLounge } = require('../lib/dariLounge');

const router = express.Router();

router.post('/api/cron/dari-lounge', requireCronAuth, async (req, res) => {
    try {
        const r = await openDailyLounge(req.body?.date);
        res.json({ ok: true, id: r.id, themeKey: r.themeKey, skipped: !!r.skipped });
    } catch (e) {
        console.error('[cron/dari-lounge] FAIL', e?.message);
        res.status(500).json({ ok: false, error: e?.message });
    }
});

module.exports = router;
