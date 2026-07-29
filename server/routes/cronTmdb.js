// ── 신작 K-Content 메타 번역 cron (전용) ─────────────────────────────────────
// requireCronAuth(fail-closed) — x-cron-secret 헤더 필요. 스케줄러(GitHub Actions/Render Cron)가 POST.
//
// 델타 전략(전체 25k 매일 스캔 회피):
//   ① /api/cron/tmdb-pretranslate  (DAILY, 한국시간 05:00 권장)
//        = runIncremental(신규 = 릴리스일 최근 N일 한국작) + runRetry(부분실패 metaTranslated=false)
//        둘 다 바운드됨(수백 건) → 빠르고 싸다. 신작은 정의상 최근 릴리스라 여기서 잡힘.
//   ② /api/cron/tmdb-sweep        (WEEKLY)
//        = runBackfill 전체 idempotent sweep — "릴리스일은 오래됐는데 TMDB에 뒤늦게 등재된 구작"(케이스 C) 캐치.
//        전체 열거라 수 분 소요 → 백그라운드(fire-and-forget)로 돌리고 202 즉시 응답. 멱등이라 중단 시 다음 주 재개.
const express = require('express');
const { requireCronAuth } = require('../middleware/auth');
const { runIncremental, runRetry, runBackfill, refreshOfficialTitles } = require('../lib/tmdbBackfill');

const router = express.Router();

// DAILY — 신규 + 부분실패 재시도. 동기 처리(바운드라 빠름).
router.post('/api/cron/tmdb-pretranslate', requireCronAuth, async (req, res) => {
    try {
        const days = Math.min(parseInt(req.body?.days, 10) || 14, 90);
        const maxTitles = Math.min(parseInt(req.body?.maxTitles, 10) || 200, 500);
        const retryLimit = Math.min(parseInt(req.body?.retryLimit, 10) || 100, 500);
        const incremental = await runIncremental({ days, maxTitles });
        const retry = await runRetry({ limit: retryLimit });
        // ③ 공식 제목 뒤늦은 반영 — TMDB는 신작의 언어별 제목을 방영 후에 채운다. 그동안 우리가
        //    원제→Gemini로 만들어 둔 제목을 공식 제목으로 갈아끼운다(Gemini 호출 0).
        //    ⚠ ①로는 안 된다 — discover가 그 작품을 물어와도 processTitle이 완비된 작품을
        //      skip하기 때문(정상 동작). 실제로 「오싹한 연애」(298610)가 그 상태였다.
        const titles = await refreshOfficialTitles({
            days: Math.min(parseInt(req.body?.titleDays, 10) || 400, 2000),
            maxTitles: Math.min(parseInt(req.body?.titleMax, 10) || 300, 1000),
        });
        const out = { ok: true, incremental, retry, titles };
        console.log('[cron/tmdb-pretranslate]', JSON.stringify(out));
        res.json(out);
    } catch (e) {
        console.error('[cron/tmdb-pretranslate]', e.message);
        res.status(500).json({ error: e.message });
    }
});

// WEEKLY — 전체 sweep(케이스 C). 오래 걸려 백그라운드로 kick off 후 즉시 202.
//   멱등: done은 마커 1 read 후 skip(상세/Gemini 미호출) → 재실행/중단복구 안전.
//   ⚠ free-tier 슬립 시 중단될 수 있음 → 초기 대량 채움은 로컬 scripts/backfill-tmdb-translations.js 권장.
router.post('/api/cron/tmdb-sweep', requireCronAuth, (req, res) => {
    const media = ['tv', 'movie', 'both'].includes(req.body?.media) ? req.body.media : 'both';
    const yearFrom = Math.max(parseInt(req.body?.yearFrom, 10) || 1950, 1900);
    const concurrency = Math.min(parseInt(req.body?.concurrency, 10) || 4, 8);
    res.status(202).json({ ok: true, started: true, media, yearFrom, note: 'sweep running in background' });
    // 응답 후 백그라운드 실행 (await 안 함) — 완료/오류는 로그로만 추적.
    runBackfill({ media, yearFrom, concurrency, onProgress: (p) => console.log('[cron/tmdb-sweep]', JSON.stringify(p)) })
        .then((r) => console.log('[cron/tmdb-sweep] DONE', JSON.stringify(r)))
        .catch((e) => console.error('[cron/tmdb-sweep] FAIL', e.message));
});

module.exports = router;
