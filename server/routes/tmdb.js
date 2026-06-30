// ── TMDB 프록시 + K-Contents discover/detail + 메타 Gemini 번역 ──────────
// K-DramaLingo 전용. TMDB 키는 서버 환경변수(TMDB_API_KEY/TMDB_ACCESS_TOKEN)에만 둔다.
// 인메모리 TTL 캐시로 TMDB 호출량 절감. 인증은 requireAuthAny(kculture/PronunFit 토큰 모두 허용).
const express = require('express');
const { requireAuthAny } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';          // v3 api_key (query)
const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN || '';    // v4 bearer (optional)

// 클라 2-letter lang → TMDB language 코드
const LANG_MAP = {
    ko: 'ko-KR', en: 'en-US', es: 'es-ES', ru: 'ru-RU', id: 'id-ID',
    'pt-BR': 'pt-BR', 'zh-CN': 'zh-CN', ja: 'ja-JP', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE',
};
const toTmdbLang = (l) => LANG_MAP[l] || l || 'en-US';

// 앱 메인 콘텐츠 언어 — 'ko' 하드코딩 금지, 반드시 이 상수 사용(server/config/contentLang.js).
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang');
// 사전번역 제목 조회용 kculture Firestore(있을 때만 — service account 없으면 null → 폴백은 TMDB만).
const { kcultureDb } = require('../config/firebaseKculture');

// 이미지 우선순위 선택: 콘텐츠 원어(original_language) → 영어. 없으면 null(호출측이 TMDB 기본값 유지).
function pickImageByLang(arr, originalLang) {
    const a = arr || [];
    const by = (l) => a.find((x) => x.iso_639_1 === l);
    return (by(originalLang) || by('en'))?.file_path || null;
}

// 리스트/검색 제목 현지화: ① 사용자 언어 번역제목(우리 Firestore titles/{id}/translations/{clientLang}.title)
//   ② 영어 폴백(TMDB가 원어=한국어로 폴백한 name===original 항목만, fetchEn()로 받음) ③ TMDB 원제 유지.
//   원어(ko)·영어 사용자는 그대로(원제 OK / TMDB en-US가 이미 최선). tv=name, movie=title 자동 판별. person은 건너뜀.
async function localizeTitles(results, { clientLang, fetchEn }) {
    if (!Array.isArray(results) || !results.length) return results;
    if (clientLang === PRIMARY_CONTENT_LANG || clientLang === 'en' || !clientLang) return results;

    const tkey = (r) => (r.title !== undefined ? 'title' : 'name');          // movie=title, tv=name
    const orig = (r) => (r.original_title !== undefined ? r.original_title : r.original_name) || '';
    const localizable = results.filter((r) => r.media_type !== 'person' && r.id);

    // ① 우리 Firestore 번역제목 batch read (getAll 1회)
    const fsTitle = new Map();
    if (kcultureDb && localizable.length) {
        try {
            const refs = localizable.map((r) => kcultureDb.doc(`titles/${r.id}/translations/${clientLang}`));
            const snaps = await kcultureDb.getAll(...refs);
            snaps.forEach((s, i) => { const t = s.exists && s.data()?.title; if (t) fsTitle.set(localizable[i].id, t); });
        } catch { /* Firestore 실패 → TMDB 원본 유지 */ }
    }

    // ② 영어 폴백: 번역제목 없고 TMDB가 원어로 폴백한 항목만(name===original) → 1회 en 조회
    const enTitle = new Map();
    const needEn = localizable.some((r) => !fsTitle.get(r.id) && r[tkey(r)] && r[tkey(r)] === orig(r));
    if (needEn && fetchEn) {
        try {
            const enList = await fetchEn();
            for (const e of (enList || [])) { const k = e.title !== undefined ? e.title : e.name; if (k) enTitle.set(e.id, k); }
        } catch { /* en 실패 → 원제 유지 */ }
    }

    // ③ 적용
    return results.map((r) => {
        if (r.media_type === 'person' || !r.id) return r;
        const fs = fsTitle.get(r.id);
        if (fs) return { ...r, [tkey(r)]: fs };
        if (r[tkey(r)] && r[tkey(r)] === orig(r)) {
            const en = enTitle.get(r.id);
            if (en && en !== orig(r)) return { ...r, [tkey(r)]: en };
        }
        return r;
    });
}

// ── 인메모리 TTL 캐시 ──────────────────────────────────────────────
const cache = new Map();
function getCache(k) {
    const e = cache.get(k);
    if (!e) return null;
    if (Date.now() > e.exp) { cache.delete(k); return null; }
    return e.v;
}
function setCache(k, v, ttlMs) {
    cache.set(k, { v, exp: Date.now() + ttlMs });
    // 단순 상한 — 1000개 초과 시 가장 오래된 것부터 제거
    if (cache.size > 1000) cache.delete(cache.keys().next().value);
}

async function tmdbFetch(path, params = {}) {
    if (!TMDB_KEY && !TMDB_TOKEN) throw new Error('TMDB key not configured');
    const usp = new URLSearchParams(params);
    if (TMDB_KEY) usp.set('api_key', TMDB_KEY);
    const url = `${TMDB_BASE}${path}?${usp.toString()}`;
    const headers = TMDB_TOKEN ? { Authorization: `Bearer ${TMDB_TOKEN}` } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`TMDB ${res.status}: ${t.slice(0, 200)}`);
    }
    return res.json();
}

const TMDB_RL = { perMinute: 60, perHour: 1000 };

// ── discover: 한국 콘텐츠 (최신/장르/랭킹/인기 모두 이 엔드포인트로) ──
router.get('/api/tmdb/discover', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        // kind: drama|movie|variety (없으면 media 파라미터 하위호환)
        const kind = req.query.kind;
        const media = (kind === 'movie' || (!kind && req.query.media === 'movie')) ? 'movie' : 'tv';
        const lang = toTmdbLang(req.query.lang);
        const sort = String(req.query.sort || 'popularity.desc');
        const page = Math.min(parseInt(req.query.page, 10) || 1, 500);
        const params = {
            language: lang,
            sort_by: sort,
            with_original_language: PRIMARY_CONTENT_LANG,
            page: String(page),
            include_adult: 'false',
        };
        // 콘텐츠 타입별 기본 장르 필터 (드라마=Drama / 예능=Reality·Talk) + 사용자 장르(AND)
        const genreParts = [];
        if (kind === 'drama') genreParts.push('18');
        else if (kind === 'variety') genreParts.push('10764|10767');
        if (req.query.genre) genreParts.push(String(req.query.genre));
        if (genreParts.length) params.with_genres = genreParts.join(',');
        if (req.query.provider) { // OTT 필터 (어디서 볼까)
            params.with_watch_providers = String(req.query.provider);
            params.watch_region = String(req.query.region || 'US').toUpperCase().slice(0, 2);
            params.with_watch_monetization_types = 'flatrate';
        }
        if (sort.startsWith('vote_average')) params['vote_count.gte'] = '200'; // 랭킹 신뢰도
        if (sort.startsWith('first_air_date') || sort.startsWith('primary_release_date')) {
            const today = new Date().toISOString().slice(0, 10);
            params[media === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte'] = today; // 미래작 제외
        }
        const key = `disc:${media}:${JSON.stringify(params)}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch(`/discover/${media}`, params); setCache(key, data, 30 * 60 * 1000); }

        // 이미지는 언어별로 바꾸지 않고 항상 메인 콘텐츠 언어판으로(제목만 언어별).
        // 사용자 언어 ≠ 메인 콘텐츠 언어면 메인 콘텐츠 언어로 한 번 더 받아 포스터를 id로 병합.
        let results = data.results || [];
        const primaryLang = toTmdbLang(PRIMARY_CONTENT_LANG);
        if (lang !== primaryLang && results.length) {
            const pParams = { ...params, language: primaryLang };
            const pKey = `disc:${media}:${JSON.stringify(pParams)}`;
            let pData = getCache(pKey);
            if (!pData) { pData = await tmdbFetch(`/discover/${media}`, pParams); setCache(pKey, pData, 30 * 60 * 1000); }
            const pMap = new Map((pData.results || []).map((r) => [r.id, r]));
            results = results.map((r) => {
                const p = pMap.get(r.id);
                return p ? { ...r, poster_path: p.poster_path ?? r.poster_path, backdrop_path: p.backdrop_path ?? r.backdrop_path } : r;
            });
        }

        // 제목 현지화: 우리 번역제목(Firestore) → 영어 → 한국어 원제. (en은 같은 discover를 en-US로 1회, 캐시)
        results = await localizeTitles(results, {
            clientLang: String(req.query.lang || 'en'),
            fetchEn: async () => {
                const enParams = { ...params, language: 'en-US' };
                const enKey = `disc:${media}:${JSON.stringify(enParams)}`;
                let ed = getCache(enKey);
                if (!ed) { ed = await tmdbFetch(`/discover/${media}`, enParams); setCache(enKey, ed, 30 * 60 * 1000); }
                return ed.results || [];
            },
        });
        res.json({ media, page: data.page, totalPages: data.total_pages, results });
    } catch (e) {
        console.error('[tmdb/discover]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── 장르 목록 ──
router.get('/api/tmdb/genres', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const media = req.query.media === 'movie' ? 'movie' : 'tv';
        const lang = toTmdbLang(req.query.lang);
        const key = `genres:${media}:${lang}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch(`/genre/${media}/list`, { language: lang }); setCache(key, data, 24 * 60 * 60 * 1000); }
        res.json({ genres: data.genres || [] });
    } catch (e) {
        console.error('[tmdb/genres]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── 상세 (credits/images/videos/watch providers/translations append) ──
router.get('/api/tmdb/title/:media/:id', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const media = req.params.media === 'movie' ? 'movie' : 'tv';
        const id = String(req.params.id).replace(/\D/g, '');
        if (!id) return res.status(400).json({ error: 'bad id' });
        const lang = toTmdbLang(req.query.lang);
        const key = `title:${media}:${id}:${lang}`;
        let data = getCache(key);
        if (!data) {
            data = await tmdbFetch(`/${media}/${id}`, {
                language: lang,
                append_to_response: 'credits,images,videos,watch/providers,translations',
                // 이미지 후보를 메인 콘텐츠 언어·영어·무언어로 받아둠(아래 우선순위 선택에 사용)
                include_image_language: `${PRIMARY_CONTENT_LANG},en,null`,
            });
            // 이미지는 언어별로 바꾸지 않고 콘텐츠 원어 → 영어 우선(없으면 TMDB 기본값 유지). 제목·줄거리만 언어별.
            const ol = data.original_language || PRIMARY_CONTENT_LANG;
            const poster = pickImageByLang(data.images?.posters, ol);
            const backdrop = pickImageByLang(data.images?.backdrops, ol);
            if (poster) data.poster_path = poster;
            if (backdrop) data.backdrop_path = backdrop;

            // 배우/스태프 이름: TMDB가 사용자 언어 이름이 없으면 원어(예: 한국어)로 폴백함(name===original_name).
            // 사용자가 콘텐츠 원어를 못 읽는 경우(원어≠사용자언어, 영어도 아님) → 영어(로마자) 이름으로 폴백.
            // (콘텐츠 원어 사용자·영어 사용자는 그대로 둠.)
            const origLang = toTmdbLang(ol);
            if (lang !== 'en-US' && lang !== origLang) {
                const cast = data.credits?.cast || [];
                const crew = data.credits?.crew || [];
                const needFix = [...cast, ...crew].some((p) => p.name && p.original_name && p.name === p.original_name);
                if (needFix) {
                    try {
                        const enCredits = await tmdbFetch(`/${media}/${id}/credits`, { language: 'en-US' });
                        const enName = new Map([...(enCredits.cast || []), ...(enCredits.crew || [])].map((p) => [p.id, p.name]));
                        const patch = (p) => {
                            if (p.name && p.original_name && p.name === p.original_name && enName.get(p.id)) p.name = enName.get(p.id);
                        };
                        cast.forEach(patch);
                        crew.forEach(patch);
                    } catch (e) { /* en 크레딧 실패 시 원래(원어) 이름 유지 */ }
                }
            }
            setCache(key, data, 6 * 60 * 60 * 1000);
        }
        res.json(data);
    } catch (e) {
        console.error('[tmdb/title]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── OTT 제공자 목록 (지역별) ──
router.get('/api/tmdb/providers', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const media = req.query.media === 'movie' ? 'movie' : 'tv';
        const region = String(req.query.region || 'US').toUpperCase().slice(0, 2);
        const key = `providers:${media}:${region}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch(`/watch/providers/${media}`, { watch_region: region }); setCache(key, data, 24 * 60 * 60 * 1000); }
        const providers = (data.results || [])
            .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path, priority: (p.display_priorities?.[region] ?? p.display_priority ?? 999) }))
            .sort((a, b) => a.priority - b.priority)
            .slice(0, 24);
        res.json({ region, providers });
    } catch (e) {
        console.error('[tmdb/providers]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── 검색 (한국 작품 + 인물) ──
router.get('/api/tmdb/search', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.json({ results: [] });
        const lang = toTmdbLang(req.query.lang);
        const page = Math.min(parseInt(req.query.page, 10) || 1, 100);
        const key = `search:${lang}:${page}:${q.toLowerCase()}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch('/search/multi', { language: lang, query: q, page: String(page), include_adult: 'false' }); setCache(key, data, 10 * 60 * 1000); }
        // tv/movie는 메인 콘텐츠 언어 원작만, person은 모두 유지
        let results = (data.results || []).filter((r) =>
            (r.media_type === 'tv' || r.media_type === 'movie') ? r.original_language === PRIMARY_CONTENT_LANG : r.media_type === 'person'
        );
        // 제목 현지화: 우리 번역제목(Firestore) → 영어 → 한국어 원제. (person은 helper가 건너뜀)
        results = await localizeTitles(results, {
            clientLang: String(req.query.lang || 'en'),
            fetchEn: async () => {
                const enKey = `search:en-US:${page}:${q.toLowerCase()}`;
                let ed = getCache(enKey);
                if (!ed) { ed = await tmdbFetch('/search/multi', { language: 'en-US', query: q, page: String(page), include_adult: 'false' }); setCache(enKey, ed, 10 * 60 * 1000); }
                return ed.results || [];
            },
        });
        res.json({ results, page: data.page, totalPages: data.total_pages });
    } catch (e) {
        console.error('[tmdb/search]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── 인물 상세 + 출연작(한국 작품) ──
router.get('/api/tmdb/person/:id', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const id = String(req.params.id).replace(/\D/g, '');
        if (!id) return res.status(400).json({ error: 'bad id' });
        const lang = toTmdbLang(req.query.lang);
        const key = `person:${id}:${lang}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch(`/person/${id}`, { language: lang, append_to_response: 'combined_credits' }); setCache(key, data, 6 * 60 * 60 * 1000); }
        // 출연작: 메인 콘텐츠 언어 작품 + 포스터 있는 것만, 중복 제거, 인기순
        const credits = [...(data.combined_credits?.cast || []), ...(data.combined_credits?.crew || [])];
        const seen = new Set();
        const works = credits
            .filter((c) => c.original_language === PRIMARY_CONTENT_LANG && c.poster_path && (c.media_type === 'tv' || c.media_type === 'movie'))
            .filter((c) => { const k = `${c.media_type}-${c.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        res.json({
            id: data.id, name: data.name, biography: data.biography,
            profile_path: data.profile_path, known_for_department: data.known_for_department,
            works,
        });
    } catch (e) {
        console.error('[tmdb/person]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── 컬렉션 검색 (영화 프랜차이즈/시리즈) ──
router.get('/api/tmdb/search-collection', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.json({ results: [] });
        const lang = toTmdbLang(req.query.lang);
        const page = Math.min(parseInt(req.query.page, 10) || 1, 100);
        const key = `searchcol:${lang}:${page}:${q.toLowerCase()}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch('/search/collection', { language: lang, query: q, page: String(page) }); setCache(key, data, 10 * 60 * 1000); }
        const results = (data.results || []).map((c) => ({
            id: c.id, name: c.name, poster_path: c.poster_path, backdrop_path: c.backdrop_path, overview: c.overview,
        }));
        res.json({ results, page: data.page, totalPages: data.total_pages });
    } catch (e) {
        console.error('[tmdb/search-collection]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// ── 컬렉션 상세 (수록 작품) ──
router.get('/api/tmdb/collection/:id', requireAuthAny, rateLimit('tmdb', TMDB_RL), async (req, res) => {
    try {
        const id = String(req.params.id).replace(/\D/g, '');
        if (!id) return res.status(400).json({ error: 'bad id' });
        const lang = toTmdbLang(req.query.lang);
        const key = `collection:${id}:${lang}`;
        let data = getCache(key);
        if (!data) { data = await tmdbFetch(`/collection/${id}`, { language: lang }); setCache(key, data, 6 * 60 * 60 * 1000); }
        // 수록 영화: 포스터 있는 것 + 개봉일 순. media_type 부여(클라 라우팅용)
        const parts = (data.parts || [])
            .filter((p) => p.poster_path)
            .map((p) => ({ ...p, media_type: 'movie' }))
            .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));
        res.json({ id: data.id, name: data.name, overview: data.overview, poster_path: data.poster_path, backdrop_path: data.backdrop_path, parts });
    } catch (e) {
        console.error('[tmdb/collection]', e.message);
        res.status(502).json({ error: 'tmdb_failed' });
    }
});

// 참고: TMDB 메타 번역은 별도 번역 호출 없이 append_to_response=translations 의 언어별 번역본을
//       클라이언트가 추출/캐시하고, 없으면 영어로 폴백한다(비용 0). Gemini는 커뮤니티 UGC 번역에만 사용.

module.exports = router;
