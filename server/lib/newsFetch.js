// ── K-DramaAnyLang 뉴스 수집 (Google News RSS 언어별 + Soompi 영어 스파인) ────
// 표시 규범: 헤드라인+출처+시간+원문 링크만(전문 미저장·미표시 — 애그리게이터 표준).
// Google News RSS는 비공식(무SLA) → 방어적 파싱 + 언어별 격리(한 피드 실패가 전체를 못 죽임).
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { callGeminiJson } = require('../utils/geminiCall');

// K-DramaAnyLang UI 10개 locale ↔ 언어별 네이티브 검색 피드 (Gemini 번역 불필요 = 비용 0)
const LANG_FEEDS = {
    ko: 'https://news.google.com/rss/search?q=%ED%95%9C%EA%B5%AD+%EB%93%9C%EB%9D%BC%EB%A7%88&hl=ko&gl=KR&ceid=KR:ko',
    en: 'https://news.google.com/rss/search?q=kdrama&hl=en-US&gl=US&ceid=US:en',
    ja: 'https://news.google.com/rss/search?q=%E9%9F%93%E5%9B%BD%E3%83%89%E3%83%A9%E3%83%9E&hl=ja&gl=JP&ceid=JP:ja',
    'zh-CN': 'https://news.google.com/rss/search?q=%E9%9F%A9%E5%89%A7&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
    vi: 'https://news.google.com/rss/search?q=phim+H%C3%A0n+Qu%E1%BB%91c&hl=vi&gl=VN&ceid=VN:vi',
    fr: 'https://news.google.com/rss/search?q=drama+cor%C3%A9en&hl=fr&gl=FR&ceid=FR:fr',
    de: 'https://news.google.com/rss/search?q=k-drama&hl=de&gl=DE&ceid=DE:de',
    es: 'https://news.google.com/rss/search?q=dorama+coreano&hl=es-419&gl=MX&ceid=MX:es-419',
    ru: 'https://news.google.com/rss/search?q=%D0%B4%D0%BE%D1%80%D0%B0%D0%BC%D0%B0&hl=ru&gl=RU&ceid=RU:ru',
    'pt-BR': 'https://news.google.com/rss/search?q=dorama+coreano&hl=pt-BR&gl=BR&ceid=BR:pt-419',
};
const SOOMPI_FEED = 'https://www.soompi.com/feed'; // 검증된 RSS 2.0, 영어 K-드라마/K-pop 전문지

const MAX_ITEMS = 40;
const parser = new XMLParser({ ignoreAttributes: false });

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// RSS 텍스트 → 정규화 아이템 배열. 형식 이탈 아이템은 조용히 버림(비공식 피드 방어).
function parseRss(xml, { fallbackSource, lang }) {
    let doc;
    try { doc = parser.parse(xml); } catch { return []; }
    let items = doc?.rss?.channel?.item;
    if (!items) return [];
    if (!Array.isArray(items)) items = [items];
    const out = [];
    for (const it of items) {
        try {
            const rawTitle = String(it.title?.['#text'] ?? it.title ?? '').trim();
            const url = String(it.link?.['#text'] ?? it.link ?? '').trim();
            if (!rawTitle || !url.startsWith('http')) continue;
            // Google News: <source>가 매체명, @_url 속성이 매체 도메인. 제목 꼬리 " - 매체명" 중복 제거.
            let source = String(it.source?.['#text'] ?? it.source ?? '').trim() || fallbackSource;
            let title = rawTitle;
            if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
            const publishedAt = it.pubDate ? new Date(it.pubDate).toISOString() : null;
            // 매체 로고(파비콘) — Google News 아이템은 원문 og:image를 못 얻으므로(JS 리다이렉트 페이지)
            // 매체 도메인 파비콘을 좌측 썸네일 폴백으로 사용. 직접 URL 아이템은 자기 도메인.
            let iconDomain = null;
            try {
                const srcUrl = it.source?.['@_url'];
                iconDomain = new URL(srcUrl || url).hostname;
                if (iconDomain.includes('news.google.com')) iconDomain = null;
            } catch { /* 도메인 파싱 실패 — 아이콘 없음 */ }
            const icon = iconDomain ? `https://www.google.com/s2/favicons?domain=${iconDomain}&sz=64` : null;
            out.push({ id: sha1(url), title, url, source: source || 'News', publishedAt, lang, icon, image: null });
        } catch { /* 개별 아이템 파손 무시 */ }
    }
    return out;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ── Gemini 콘텐츠 필터 ───────────────────────────────────────────
// K-콘텐츠 앱 정합성: 특정 작품/배우를 다루는 기사만 통과. 행정(MOU·조성)·산업·경제·
// 관광 기사 제외. 언어 무관(헤드라인만 배치 전달 — 언어당 1콜, 2h 주기라 비용 미미).
// Gemini 실패 시 무필터 통과(가용성 우선), 과도 필터(5건 미만) 시에도 원본 유지.
async function filterContentNews(items) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || items.length === 0) return items;
    const lines = items.map((it, i) => `${i}. ${it.title}`).join('\n');
    const prompt = [
        'You curate the news feed of a fan app for Korean dramas, movies and variety shows.',
        'Below are numbered news headlines (any language).',
        'KEEP only headlines about the CONTENT itself: a specific Korean drama/movie/variety show or its actors —',
        'releases, casting, trailers, reviews, ratings/viewership of a show, plot, awards, interviews, where to watch, top-N show lists.',
        'DROP headlines about: government or city policy, MOUs/agreements, industry/business/finance/production-cost economics,',
        'studios\' stock or investors, technology, tourism, festivals/events not tied to a specific title, K-pop music-only news,',
        'and anything not about Korean entertainment content.',
        'Return ONLY JSON: {"keep":[indexes]}',
        '',
        lines,
    ].join('\n');
    const r = await callGeminiJson(prompt, key, {
        genConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        validate: (p) => Array.isArray(p?.keep),
        label: 'NewsFilter',
    });
    if (!r.parsed) return items;
    const keep = new Set(r.parsed.keep.map(Number));
    const filtered = items.filter((_, i) => keep.has(i));
    return filtered.length >= 5 ? filtered : items;
}

// ── Google News 링크 → 원문 URL 디코드 ──────────────────────────
// 링크가 JS 리다이렉트 페이지라 직접 스크레이프 불가 → 문서화된 2단계 기법:
// ① 기사 페이지에서 서명(data-n-a-sg)·타임스탬프(data-n-a-ts) 추출
// ② batchexecute(Fbv4je/garturlreq) 호출 → garturlres에 원문 URL.
// 비공식 내부 API — 실패는 조용히 null(파비콘 폴백 유지). 형식 변경 시 이 함수만 수리.
async function decodeGoogleUrl(gUrl) {
    try {
        const m = gUrl.match(/articles\/([^?]+)/);
        if (!m) return null;
        const id = m[1];
        // DC IP(Render)에서 구글이 동의(consent) 리다이렉트/축소 페이지를 주는 경우 대비:
        // SOCS/CONSENT 쿠키로 동의 우회 + 브라우저형 헤더. 실패 지점은 warn 로그(운영 진단용).
        const commonHeaders = {
            'User-Agent': UA,
            'Accept-Language': 'en-US,en;q=0.9',
            Cookie: 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnPpwY; CONSENT=PENDING+987',
        };
        const pageRes = await fetch(`https://news.google.com/articles/${id}`, {
            headers: commonHeaders, signal: AbortSignal.timeout(6000),
        });
        if (!pageRes.ok) { console.warn('[news] decode: page', pageRes.status); return null; }
        const page = await pageRes.text();
        const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
        if (!sg || !ts) {
            console.warn('[news] decode: no sg/ts (len', page.length, 'consent:', page.includes('consent.google') ? 'Y' : 'N', ')');
            return null;
        }
        const inner = JSON.stringify(['garturlreq',
            [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
                'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
        const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
        const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
            method: 'POST',
            headers: { ...commonHeaders, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body, signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) { console.warn('[news] decode: batch', res.status); return null; }
        const text = await res.text();
        const um = text.match(/garturlres\\",\\"(https?:[^\\"]+)/) || text.match(/"garturlres","(https?:[^"]+)"/);
        if (!um) { console.warn('[news] decode: no garturlres (len', text.length, ')'); return null; }
        return um[1].replace(/\\u003d/gi, '=').replace(/\\\//g, '/');
    } catch (e) { console.warn('[news] decode: err', e.message); return null; }
}

// ── 기사 이미지 보강 (상위 max건) ─────────────────────────────────
// Google News 아이템: 원문 URL 디코드 성공 시 url/icon까지 원문 기준으로 교체(직행 링크).
// 이후 원문 페이지에서 og:image 추출. 전 과정 실패해도 파비콘 폴백이 있어 카드가 비지 않음.
async function enrichArticles(items, max = 12) {
    const targets = items.slice(0, max);
    await Promise.allSettled(targets.map(async (it) => {
        try {
            if (it.url.includes('news.google.com')) {
                const real = await decodeGoogleUrl(it.url);
                if (real) {
                    it.url = real;
                    it.id = sha1(real);
                    try {
                        it.icon = `https://www.google.com/s2/favicons?domain=${new URL(real).hostname}&sz=64`;
                    } catch { /* icon 기존값 유지 */ }
                } else {
                    return; // 디코드 실패 — 구글 페이지 스크레이프는 무의미
                }
            }
            const res = await fetch(it.url, {
                signal: AbortSignal.timeout(5000),
                headers: { 'User-Agent': UA },
            });
            if (!res.ok) return;
            const html = (await res.text()).slice(0, 200000); // 헤더 영역이면 충분 — 페이로드 상한
            const og = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
            if (og && og[1].startsWith('http')) it.image = og[1];
        } catch { /* 아이템별 격리 */ }
    }));
}

async function fetchFeed(url, opts) {
    const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'KDramaAnyLang/1.0 (+https://k-culture-five.vercel.app)' },
    });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    return parseRss(await res.text(), opts);
}

// 언어 1개 수집: Google News (+en은 Soompi 병합) → dedupe(url) → 최신순 → 40건 캡.
async function fetchNewsForLang(lang) {
    const feedUrl = LANG_FEEDS[lang];
    if (!feedUrl) return [];
    const jobs = [fetchFeed(feedUrl, { fallbackSource: 'Google News', lang })];
    if (lang === 'en') jobs.push(fetchFeed(SOOMPI_FEED, { fallbackSource: 'Soompi', lang }));
    const results = await Promise.allSettled(jobs);
    const merged = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const seen = new Set();
    const deduped = merged.filter((it) => {
        if (seen.has(it.url)) return false;
        seen.add(it.url);
        return true;
    });
    deduped.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    // Gemini 콘텐츠 필터(작품/배우 기사만) → 40건 캡 → 상위 12건 원문 디코드+og:image 보강
    const filtered = await filterContentNews(deduped.slice(0, 60));
    const capped = filtered.slice(0, MAX_ITEMS);
    await enrichArticles(capped);
    console.log('[news]', lang, 'items', capped.length,
        'decoded', capped.filter((it) => !it.url.includes('news.google.com')).length,
        'images', capped.filter((it) => it.image).length);
    return capped;
}

module.exports = { LANG_FEEDS, fetchNewsForLang };
