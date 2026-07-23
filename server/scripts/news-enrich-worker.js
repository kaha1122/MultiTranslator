// ── K-뉴스 보강 워커 (구글 429 없는 IP에서 실행 — GH Actions / 로컬 PC) ────────
// 배경: Render 공유 DC IP는 news.google.com 기사 페이지에서 상시 429(봇월)라
//       서버는 디코드를 포기(decodeBudget 0). 이 워커가 다른 IP에서:
//   ① GET /api/news?lang → 아직 구글 URL이거나 이미지 없는 아이템 수집
//   ② 구글 원문 URL 디코드(2단계: 기사 페이지 sg/ts → batchexecute) — 직렬+간격+서킷
//   ③ 원문 페이지 og:image 스크레이프 — 실패 시(퍼블리셔 WAF 403 등) 구글 뉴스
//      '웹 검색' 페이지의 기사별 썸네일(/api/attachments → 302 → 공개 gstatic)로 폴백
//   ④ POST /api/news/enrich 로 서버 캐시에 패치(x-cron-secret 인증)
// 의존성 0 (Node 18+ 전역 fetch) — GH Actions에서 checkout+node 만으로 실행.
//
// 실행: NEWS_CRON_SECRET=<CRON_SECRET> node server/scripts/news-enrich-worker.js
// env:  NEWS_API_BASE (기본 https://multitranslator.onrender.com)
//       NEWS_LANGS    (기본 전체 12개, 콤마 구분)
//       NEWS_DECODE_PER_LANG (기본 10)
const crypto = require('crypto');

const API = process.env.NEWS_API_BASE || 'https://multitranslator.onrender.com';
const SECRET = process.env.NEWS_CRON_SECRET || process.env.CRON_SECRET;
const LANGS = (process.env.NEWS_LANGS || 'ko,en,ja,zh-CN,vi,fr,de,es,ru,pt-BR,id,ar').split(',');
const DECODE_PER_LANG = parseInt(process.env.NEWS_DECODE_PER_LANG || '10', 10);
// 런당 전역 디코드 예산 — GH 러너 실측: ~37건(≈74요청)에서 429. 30건이면 매 런 무-429로
// 종료하고, 언어 순서 회전과 합쳐 몇 런 안에 전 언어가 채워짐(2h 주기 × 30 = 360/일 ≫ 신규 기사량).
const GLOBAL_DECODE_BUDGET = parseInt(process.env.NEWS_GLOBAL_DECODE || '30', 10);
const GAP_MS = 600;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HEADERS = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: 'SOCS=CAI; CONSENT=YES+cb.20220419-08-p0.cs+FX+411',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const isGoogle = (u) => String(u || '').includes('news.google.com');

// 구글 뉴스 링크 → 원문 URL (서버 lib/newsFetch.js decodeGoogleUrl과 동일 기법)
async function decodeGoogleUrl(gUrl, circuit) {
    try {
        const m = gUrl.match(/articles\/([^?]+)/);
        if (!m) return null;
        const id = m[1];
        const pageRes = await fetch(`https://news.google.com/articles/${id}`, {
            headers: HEADERS, signal: AbortSignal.timeout(8000),
        });
        if (!pageRes.ok) {
            if (pageRes.status === 429) circuit.blocked = true;
            console.warn('  decode: page', pageRes.status);
            return null;
        }
        const page = await pageRes.text();
        const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
        if (!sg || !ts) { console.warn('  decode: no sg/ts'); return null; }
        const inner = JSON.stringify(['garturlreq',
            [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
                'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
        const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
        const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
            method: 'POST',
            headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body, signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            if (res.status === 429) circuit.blocked = true;
            console.warn('  decode: batch', res.status);
            return null;
        }
        const text = await res.text();
        const um = text.match(/garturlres\\",\\"(https?:[^\\"]+)/) || text.match(/"garturlres","(https?:[^"]+)"/);
        return um ? um[1].replace(/\\u003d/gi, '=').replace(/\\\//g, '/') : null;
    } catch (e) { console.warn('  decode: err', e.message); return null; }
}

async function scrapeOgImage(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        const html = (await res.text()).slice(0, 200000);
        const og = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
        return og && og[1].startsWith('http') ? og[1] : null;
    } catch { return null; }
}

// ── 구글 뉴스 '웹 검색' 페이지 → 기사ID→썸네일 벌크 맵 (2026-07-24) ─────────────
// 원문이 봇월(WP Engine 등 TLS 지문 403)이라 og:image를 못 긁는 소스가 존재
// (실측: fr 피드 67%를 차지한 altselection.ouest-france.fr 전면 403). 같은 검색
// 쿼리의 웹 페이지(rss/search→search)는 서버렌더 HTML에 기사별 썸네일이 실려 있고,
//   · read/<id>의 id = RSS articles/<id>의 id (동일 문자열 — ko 캐시 40건 중 37건 조인 실측)
//   · /api/attachments/<att>-w400-h224…는 무인증 302 → 공개 gstatic 이미지(핫링크 가능)
// 라 스크레이프 불가 기사도 커버된다. 언어당 최대 1 fetch — 디코드와 동일 예산 계상.
// ⚠ 쿼리는 서버 lib/newsFetch.js LANG_FEEDS와 수동 동기(피드 쿼리 변경 시 여기도).
const SEARCH_PAGES = {
    ko: 'https://news.google.com/search?q=%ED%95%9C%EA%B5%AD+%EB%93%9C%EB%9D%BC%EB%A7%88&hl=ko&gl=KR&ceid=KR:ko',
    en: 'https://news.google.com/search?q=kdrama&hl=en-US&gl=US&ceid=US:en',
    ja: 'https://news.google.com/search?q=%E9%9F%93%E5%9B%BD%E3%83%89%E3%83%A9%E3%83%9E&hl=ja&gl=JP&ceid=JP:ja',
    'zh-CN': 'https://news.google.com/search?q=%E9%9F%A9%E5%89%A7&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
    vi: 'https://news.google.com/search?q=phim+H%C3%A0n+Qu%E1%BB%91c&hl=vi&gl=VN&ceid=VN:vi',
    fr: 'https://news.google.com/search?q=drama+cor%C3%A9en&hl=fr&gl=FR&ceid=FR:fr',
    de: 'https://news.google.com/search?q=k-drama&hl=de&gl=DE&ceid=DE:de',
    es: 'https://news.google.com/search?q=dorama+coreano&hl=es-419&gl=MX&ceid=MX:es-419',
    ru: 'https://news.google.com/search?q=%D0%B4%D0%BE%D1%80%D0%B0%D0%BC%D0%B0&hl=ru&gl=RU&ceid=RU:ru',
    'pt-BR': 'https://news.google.com/search?q=dorama+coreano&hl=pt-BR&gl=BR&ceid=BR:pt-419',
    id: 'https://news.google.com/search?q=drakor&hl=id&gl=ID&ceid=ID:id',
    ar: 'https://news.google.com/search?q=%D9%85%D8%B3%D9%84%D8%B3%D9%84+%D9%83%D9%88%D8%B1%D9%8A&hl=ar&gl=SA&ceid=SA:ar',
};
async function fetchThumbMap(lang, circuit) {
    const pageUrl = SEARCH_PAGES[lang];
    if (!pageUrl) return null;
    try {
        const res = await fetch(pageUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
            if (res.status === 429) circuit.blocked = true;
            console.warn(`  thumbMap: HTTP ${res.status}`);
            return null;
        }
        const html = await res.text();
        // 기사 블록당 read/<id> 뒤 ~525자 지점에 썸네일이 옴(블록 간격 ~24KB라 1500자 창이면 안전)
        const imgs = [...html.matchAll(/\/api\/attachments\/([A-Za-z0-9_=-]+)-w400-h224/g)];
        const map = new Map();
        for (const m of html.matchAll(/read\/([A-Za-z0-9_-]{40,})/g)) {
            if (map.has(m[1])) continue;
            const near = imgs.find((im) => im.index > m.index && im.index - m.index < 1500);
            if (near) map.set(m[1], `https://news.google.com/api/attachments/${near[1]}-w400-h224-p-df-rw`);
        }
        console.log(`  thumbMap: ${map.size} thumbs`);
        return map;
    } catch (e) { console.warn('  thumbMap: err', e.message); return null; }
}

(async () => {
    if (!SECRET) { console.error('NEWS_CRON_SECRET(=서버 CRON_SECRET) 필요'); process.exit(1); }
    const circuit = { blocked: false }; // 전 언어 공유 — 429 시 디코드 중단(스크레이프는 계속)
    let totalPatched = 0;
    let globalDecodes = 0;

    // 언어 시작 순서 회전 — 중간에 429로 끊겨도 매 실행 다른 언어가 앞 순서를 받아
    // 꼬리 언어(ru/pt-BR)가 굶지 않게 함. 2시간 주기 기준 회전.
    const rot = Math.floor(Date.now() / (2 * 60 * 60 * 1000)) % LANGS.length;
    const ordered = [...LANGS.slice(rot), ...LANGS.slice(0, rot)];
    console.log('[worker] lang order:', ordered.join(','));

    for (let li = 0; li < ordered.length; li += 1) {
        const lang = ordered[li];
        let items;
        try {
            const r = await fetch(`${API}/api/news?lang=${encodeURIComponent(lang)}&limit=40`, { signal: AbortSignal.timeout(30000) });
            items = (await r.json()).items || [];
        } catch (e) { console.warn(`[${lang}] api read fail:`, e.message); continue; }

        // 공정 분배: 남은 예산 ÷ 남은 언어(올림) — 선착순이면 회전 선두 2~3개 언어의 백로그가
        // 예산 30을 통째로 먹어 뒤 언어(예: ko)가 10시간+ 굶는 실측 문제(2026-07-07).
        // 언어당 ~3건이면 신규 기사(2h당 1~3건)는 매 런 전 언어 처리되고, 밀린 백로그는
        // 앞 언어가 덜 쓴 잔여 예산 + 회전으로 점진 소화된다.
        const langCap = Math.min(DECODE_PER_LANG,
            Math.ceil((GLOBAL_DECODE_BUDGET - globalDecodes) / (ordered.length - li)));

        // 썸네일 맵은 필요해진 순간 언어당 1회만 fetch(lazy) — 전 아이템이 이미 완성이면 0회
        let thumbMap;
        const ensureThumbMap = async () => {
            if (thumbMap !== undefined) return thumbMap;
            if (circuit.blocked || globalDecodes >= GLOBAL_DECODE_BUDGET) return (thumbMap = null);
            globalDecodes += 1; // news.google.com 요청 1회 — 디코드와 동일 예산 계상
            thumbMap = await fetchThumbMap(lang, circuit);
            await sleep(GAP_MS);
            return thumbMap;
        };

        const patches = [];
        let decodes = 0;
        for (const it of items) {
            const key = it.srcUrl || it.url;
            let url = it.url;
            let patch = null;
            if (isGoogle(url)) {
                // 디코드는 구글 쿼터 소비 — 서킷/언어당(공정 분배)/전역 예산 안에서만. 초과 시 이
                // 아이템만 skip(뒤의 직접 URL 아이템 og:image 스크레이프는 구글 무관이라 계속).
                if (circuit.blocked || decodes >= langCap || globalDecodes >= GLOBAL_DECODE_BUDGET) continue;
                decodes += 1; globalDecodes += 1;
                const real = await decodeGoogleUrl(url, circuit);
                await sleep(GAP_MS);
                if (!real) continue;
                url = real;
                patch = { srcUrl: key, url: real, id: sha1(real) };
                try { patch.icon = `https://www.google.com/s2/favicons?domain=${new URL(real).hostname}&sz=64`; } catch { /* 유지 */ }
            } else if (it.image) {
                continue; // 이미 완성된 아이템
            }
            let img = await scrapeOgImage(url);
            if (!img) {
                // 원문 스크레이프 실패(봇월 403·og:image 부재) → 구글 검색페이지 썸네일 폴백
                const gid = String(it.srcUrl || '').match(/articles\/([A-Za-z0-9_-]+)/)?.[1];
                if (gid) img = (await ensureThumbMap())?.get(gid) || null;
            }
            if (img) patch = { ...(patch || { srcUrl: key }), image: img };
            if (patch) patches.push(patch);
        }

        if (patches.length) {
            try {
                const r = await fetch(`${API}/api/news/enrich`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-cron-secret': SECRET },
                    body: JSON.stringify({ lang, patches }),
                    signal: AbortSignal.timeout(30000),
                });
                const j = await r.json();
                console.log(`[${lang}] patches ${patches.length} → applied ${j.applied ?? '?'} (HTTP ${r.status})`);
                totalPatched += j.applied || 0;
            } catch (e) { console.warn(`[${lang}] enrich POST fail:`, e.message); }
        } else {
            console.log(`[${lang}] nothing to patch${circuit.blocked ? ' (429)' : ''}`);
        }
    }
    console.log('[worker] done — applied', totalPatched, '| decodes', globalDecodes + '/' + GLOBAL_DECODE_BUDGET, circuit.blocked ? '| 429 circuit opened' : '');
})();
