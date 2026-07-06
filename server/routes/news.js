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

// 직전 캐시 아이템(디코드/이미지 재사용용) — 메모리 우선, 없으면 미러.
async function prevItemsOf(lang) {
    const mem = memory.get(lang);
    if (mem?.items?.length) return mem.items;
    const mirror = await readMirror(lang);
    return mirror?.items || [];
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
        // 직전(만료) 캐시를 넘겨 디코드/이미지 재사용. decodeBudget 0 — Render IP는 구글에
        // 상시 429(공유 DC IP 봇월)라 여기선 디코드 안 함. 디코드는 GH Actions 워커 담당.
        const items = await fetchNewsForLang(lang, { prevItems: mirror?.items || mem?.items || [], decodeBudget: 0 });
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
    // 크론 전역 429 서킷 — 한 언어가 차단당하면 나머지도 디코드 skip(전부 이전 캐시 재사용).
    // 다음 크론에서 쿼터 회복 시 신규분만 점진 디코드.
    const state = { blocked: false };
    // 디코드 0 — Render 공유 DC IP는 구글 뉴스 페이지에서 상시 429(탐침 1건/2h도 차단 실측).
    // 원문 URL 디코드+기사 이미지는 GH Actions 워커(news-enrich-worker.js)가 다른 IP에서 수행해
    // POST /api/news/enrich 로 패치한다. 여기선 피드+필터+파비콘+직접URL og:image만.
    const DECODE_PER_LANG = 0;
    for (const lang of Object.keys(LANG_FEEDS)) {
        try {
            const prevItems = await prevItemsOf(lang);
            const items = await fetchNewsForLang(lang, { prevItems, state, decodeBudget: DECODE_PER_LANG });
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
    console.log('[cron/news-refresh]', JSON.stringify(out), state.blocked ? '429-hit' : '');
    res.json({ ok: true, counts: out, decodeBlocked: state.blocked });
});

// ── 외부 워커의 보강 패치 수신 (GH Actions / 로컬 — 구글 429 없는 IP에서 디코드) ──
// body: { lang, patches: [{ srcUrl, url, image?, icon?, id? }] }
// srcUrl(피드 원본 URL, 불변 키)로 현재 캐시 아이템을 찾아 원문 url/이미지를 병합.
// 인증은 크론과 동일한 x-cron-secret. 캐시에 없는 srcUrl은 무시(이미 교체된 옛 기사).
router.post('/api/news/enrich', requireCronAuth, async (req, res) => {
    const { lang, patches } = req.body || {};
    if (!LANG_FEEDS[lang] || !Array.isArray(patches)) {
        return res.status(400).json({ error: 'lang and patches[] required' });
    }
    const entry = memory.get(lang) || await readMirror(lang);
    if (!entry?.items?.length) return res.json({ ok: true, applied: 0, reason: 'no cache' });

    const byKey = new Map(patches.filter((p) => p?.srcUrl).map((p) => [p.srcUrl, p]));
    let applied = 0;
    for (const it of entry.items) {
        const p = byKey.get(it.srcUrl || it.url);
        if (!p) continue;
        if (p.url && typeof p.url === 'string' && p.url.startsWith('http')) {
            it.url = p.url;
            if (p.id) it.id = p.id;
        }
        if (p.icon && String(p.icon).startsWith('http')) it.icon = p.icon;
        if (p.image && String(p.image).startsWith('http')) it.image = p.image;
        applied += 1;
    }
    if (applied > 0) {
        memory.set(lang, entry); // ts 유지 — 데이터 보강이지 신규 수집이 아님
        await writeMirror(lang, entry);
    }
    console.log('[news/enrich]', lang, 'patches', patches.length, 'applied', applied);
    res.json({ ok: true, applied });
});

module.exports = router;
