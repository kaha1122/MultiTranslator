// ── K-DramaAnyLang K-뉴스 라우트 ─────────────────────────────────────────────
// GET  /api/news?lang=xx&limit=N  — public(헤드라인은 공개 정보, 무인증) + rateLimit.
//   캐시 3단: 인메모리(TTL 2h) → Firestore 미러 news_cache/{lang}(콜드스타트 완충)
//   → 해당 언어만 라이브 fetch(바운드). 응답에 CDN 캐시 헤더.
// POST /api/cron/news-refresh — requireCronAuth. 10개 언어 순차 갱신 + 미러 기록
//   (2h 주기 스케줄 ≈ 120 writes/일). PronunFit 라우트 무영향(additive).
const express = require('express');
const { requireCronAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { kcultureDb } = require('../config/firebaseKculture');
const { LANG_FEEDS, fetchNewsForLang } = require('../lib/newsFetch');

const router = express.Router();

const MEM_TTL = 2 * 60 * 60 * 1000; // 인메모리 2h (cron 주기와 동일)
const memory = new Map(); // lang → { items, ts }

const mirrorRef = (lang) => kcultureDb?.collection('news_cache').doc(lang);

async function readMirror(lang) {
    try {
        const snap = await mirrorRef(lang)?.get();
        const data = snap?.exists ? snap.data() : null;
        if (data && Array.isArray(data.items)) return { items: data.items, ts: data.ts || 0 };
    } catch (e) { console.warn('[news] mirror read fail', lang, e.message); }
    return null;
}

async function writeMirror(lang, entry) {
    try { await mirrorRef(lang)?.set(entry); } catch (e) { console.warn('[news] mirror write fail', lang, e.message); }
}

// 언어 1개 확보(캐시 우선). 라이브 fetch는 마지막 수단 — 실패 시 빈 배열(위젯은 조용히 숨음).
async function getLang(lang) {
    const mem = memory.get(lang);
    if (mem && Date.now() - mem.ts < MEM_TTL) return mem;

    const mirror = await readMirror(lang);
    if (mirror && Date.now() - mirror.ts < MEM_TTL) {
        memory.set(lang, mirror);
        return mirror;
    }

    try {
        const items = await fetchNewsForLang(lang);
        if (items.length) {
            const entry = { items, ts: Date.now() };
            memory.set(lang, entry);
            writeMirror(lang, entry); // fire-and-forget
            return entry;
        }
    } catch (e) { console.warn('[news] live fetch fail', lang, e.message); }

    // 라이브 실패 → 오래된 캐시라도 있으면 그걸로(뉴스는 신선도보다 가용성 우선)
    return mirror || mem || { items: [], ts: 0 };
}

router.get('/api/news', rateLimit('news', { perMinute: 30, perHour: 300 }), async (req, res) => {
    const lang = LANG_FEEDS[req.query.lang] ? req.query.lang : 'en';
    const limit = Math.min(parseInt(req.query.limit, 10) || 40, 40);
    const { items, ts } = await getLang(lang);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ items: items.slice(0, limit), fetchedAt: ts });
});

router.post('/api/cron/news-refresh', requireCronAuth, async (req, res) => {
    const out = {};
    for (const lang of Object.keys(LANG_FEEDS)) {
        try {
            const items = await fetchNewsForLang(lang);
            if (items.length) {
                const entry = { items, ts: Date.now() };
                memory.set(lang, entry);
                await writeMirror(lang, entry);
            }
            out[lang] = items.length;
        } catch (e) {
            out[lang] = `fail: ${e.message}`; // 언어별 격리 — 다음 언어 계속
        }
    }
    console.log('[cron/news-refresh]', JSON.stringify(out));
    res.json({ ok: true, counts: out });
});

module.exports = router;
