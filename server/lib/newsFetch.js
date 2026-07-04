// ── K-DramaAnyLang 뉴스 수집 (Google News RSS 언어별 + Soompi 영어 스파인) ────
// 표시 규범: 헤드라인+출처+시간+원문 링크만(전문 미저장·미표시 — 애그리게이터 표준).
// Google News RSS는 비공식(무SLA) → 방어적 파싱 + 언어별 격리(한 피드 실패가 전체를 못 죽임).
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

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
            // Google News: <source>가 매체명. 제목 꼬리 " - 매체명"은 중복이라 제거.
            let source = String(it.source?.['#text'] ?? it.source ?? '').trim() || fallbackSource;
            let title = rawTitle;
            if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
            const publishedAt = it.pubDate ? new Date(it.pubDate).toISOString() : null;
            out.push({ id: sha1(url), title, url, source: source || 'News', publishedAt, lang });
        } catch { /* 개별 아이템 파손 무시 */ }
    }
    return out;
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
    return deduped.slice(0, MAX_ITEMS);
}

module.exports = { LANG_FEEDS, fetchNewsForLang };
