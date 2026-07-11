// ── TMDB K-Content "전체 메타" 영속 백필 (평가용 1회성, 멱등) ──────────────────
// 목적: 지금까지 번역(translations)만 저장돼 있고 실제 메타(포스터·장르·출연·평점·시즌…)는
//       매번 TMDB 라이브 조회인 구조를, titles/{id}.meta 에 영속 저장해 서빙 후보로 평가한다.
// 대상: 번역 백필을 거친 타이틀 집합 = titles 컬렉션에서 media 필드가 있는 문서.
// 저장: titles/{id} 에 { meta, metaCachedAt, metaSchemaVersion } merge (번역 마커·하위컬렉션 보존).
//       번역 텍스트(title/overview)는 이미 titles/{id}/translations/{lang} 에 있어 meta에 중복 저장 안 함.
// 멱등: metaCachedAt 있으면 skip(--force 시 재수집). 중단 후 재실행 안전.
const { kcultureDb } = require('../config/firebaseKculture');
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang'); // 'ko' 하드코딩 금지

const META_SCHEMA_VERSION = 1;

// 문서당 캡 (Firestore 1MB 한도 대비 — 상세 화면 표시에 충분한 상위 N개만)
const CAP_CAST = 40;
const CAP_CREW = 30;
const CAP_IMAGES = 15;   // posters/backdrops/logos 각각
const CAP_VIDEOS = 12;
const CAP_SEASONS = 60;

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';

// 클라 2-letter → TMDB language (routes/tmdb.js 와 동일 매핑)
const LANG_MAP = {
    ko: 'ko-KR', en: 'en-US', es: 'es-ES', ru: 'ru-RU', id: 'id-ID',
    'pt-BR': 'pt-BR', 'zh-CN': 'zh-CN', ja: 'ja-JP', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE',
};
const toTmdbLang = (l) => LANG_MAP[l] || l || 'en-US';

async function tmdb(path, params = {}) {
    if (!TMDB_KEY) throw new Error('TMDB_API_KEY not set');
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${path}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
    return r.json();
}

// 이미지 우선순위: 콘텐츠 원어 → 영어 (없으면 null → 호출측이 TMDB 기본값 유지). 규칙 #7.
function pickImageByLang(arr, originalLang) {
    const a = arr || [];
    const by = (l) => a.find((x) => x.iso_639_1 === l);
    return (by(originalLang) || by('en'))?.file_path || null;
}

const trimImages = (arr) => (arr || [])
    .slice(0, CAP_IMAGES)
    .map((x) => ({ file_path: x.file_path, iso_639_1: x.iso_639_1 || null, vote_average: x.vote_average || 0, aspect_ratio: x.aspect_ratio, width: x.width, height: x.height }));

// 예고편 등 YouTube 영상만 (embed 금지 규칙 → 클라는 <a href> 외부링크로 사용).
const trimVideos = (arr) => (arr || [])
    .filter((v) => v.site === 'YouTube' && v.key)
    .slice(0, CAP_VIDEOS)
    .map((v) => ({ key: v.key, name: v.name, type: v.type, site: v.site, official: !!v.official, iso_639_1: v.iso_639_1, published_at: v.published_at || null }));

const trimCast = (arr) => (arr || [])
    .slice(0, CAP_CAST)
    .map((c) => ({ id: c.id, name: c.name, original_name: c.original_name, character: c.character || '', profile_path: c.profile_path || null, order: c.order }));

// 감독·극본·제작(핵심 스태프)만 상위 N. 그 외 방대한 크루는 버림.
const KEY_JOBS = new Set(['Director', 'Writer', 'Screenplay', 'Creator', 'Producer', 'Executive Producer', 'Original Music Composer']);
const trimCrew = (arr) => (arr || [])
    .filter((c) => KEY_JOBS.has(c.job) || c.department === 'Directing' || c.department === 'Writing')
    .slice(0, CAP_CREW)
    .map((c) => ({ id: c.id, name: c.name, original_name: c.original_name, job: c.job, department: c.department, profile_path: c.profile_path || null }));

const trimSeasons = (arr) => (arr || [])
    .slice(0, CAP_SEASONS)
    .map((s) => ({ id: s.id, name: s.name, season_number: s.season_number, episode_count: s.episode_count, air_date: s.air_date || null, poster_path: s.poster_path || null, overview: s.overview || '' }));

const trimCompanies = (arr) => (arr || []).map((c) => ({ id: c.id, name: c.name, logo_path: c.logo_path || null, origin_country: c.origin_country || '' }));
const trimNetworks = (arr) => (arr || []).map((n) => ({ id: n.id, name: n.name, logo_path: n.logo_path || null, origin_country: n.origin_country || '' }));

// 상세 응답 → 저장용 정규화 메타. media(tv/movie) 공통 + 타입별 필드.
function buildMeta(media, d, poster, backdrop) {
    const base = {
        id: d.id,
        media,
        original_language: d.original_language || PRIMARY_CONTENT_LANG,
        title: d.title || d.name || '',
        original_title: d.original_title || d.original_name || '',
        overview: d.overview || '',
        tagline: d.tagline || '',
        status: d.status || '',
        homepage: d.homepage || '',
        poster_path: poster || d.poster_path || null,
        backdrop_path: backdrop || d.backdrop_path || null,
        genres: (d.genres || []).map((g) => ({ id: g.id, name: g.name })),
        origin_country: d.origin_country || (d.production_countries || []).map((c) => c.iso_3166_1),
        spoken_languages: (d.spoken_languages || []).map((l) => l.iso_639_1),
        vote_average: d.vote_average || 0,
        vote_count: d.vote_count || 0,
        popularity: d.popularity || 0,
        production_companies: trimCompanies(d.production_companies),
        credits: { cast: trimCast(d.credits?.cast), crew: trimCrew(d.credits?.crew) },
        images: { posters: trimImages(d.images?.posters), backdrops: trimImages(d.images?.backdrops), logos: trimImages(d.images?.logos) },
        videos: trimVideos(d.videos?.results),
        watch_providers: d['watch/providers']?.results || {},
        external_ids: d.external_ids || {},
        keywords: (d.keywords?.keywords || d.keywords?.results || []).map((k) => ({ id: k.id, name: k.name })),
    };
    if (media === 'tv') {
        return {
            ...base,
            first_air_date: d.first_air_date || null,
            last_air_date: d.last_air_date || null,
            episode_run_time: d.episode_run_time || [],
            number_of_seasons: d.number_of_seasons || 0,
            number_of_episodes: d.number_of_episodes || 0,
            in_production: !!d.in_production,
            networks: trimNetworks(d.networks),
            seasons: trimSeasons(d.seasons),
        };
    }
    return {
        ...base,
        release_date: d.release_date || null,
        runtime: d.runtime || 0,
        budget: d.budget || 0,
        revenue: d.revenue || 0,
        belongs_to_collection: d.belongs_to_collection
            ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name, poster_path: d.belongs_to_collection.poster_path || null }
            : null,
    };
}

// 단일 타이틀 메타 수집·저장. marker.media 로 tv/movie 판별.
async function cacheTitleMeta(id, { media, force = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const ref = kcultureDb.doc(`titles/${id}`);
    const snap = await ref.get();
    const marker = snap.exists ? snap.data() : {};
    const mediaType = media || marker.media;
    if (!mediaType) return { id, skipped: true, reason: 'no-media' }; // 번역 마커가 아닌 문서(리뷰만 있는 등)
    if (!force && marker.metaCachedAt) return { id, skipped: true, reason: 'cached' };

    const detail = await tmdb(`/${mediaType}/${id}`, {
        language: toTmdbLang(PRIMARY_CONTENT_LANG), // 원어(한국) 기준 base — 언어별 텍스트는 translations 하위에서
        append_to_response: 'credits,images,videos,watch/providers,external_ids,keywords',
        include_image_language: `${PRIMARY_CONTENT_LANG},en,null`,
    });
    const ol = detail.original_language || PRIMARY_CONTENT_LANG;
    const poster = pickImageByLang(detail.images?.posters, ol);
    const backdrop = pickImageByLang(detail.images?.backdrops, ol);

    const meta = buildMeta(mediaType, detail, poster, backdrop);
    const bytes = Buffer.byteLength(JSON.stringify(meta), 'utf8');

    await ref.set({
        media: mediaType,
        meta,
        metaBytes: bytes,
        metaCachedAt: new Date(),
        metaSchemaVersion: META_SCHEMA_VERSION,
    }, { merge: true });

    return { id, skipped: false, bytes, media: mediaType };
}

async function runPool(items, concurrency, fn) {
    let idx = 0;
    async function worker() { while (idx < items.length) { const i = idx++; await fn(items[i], i); } }
    await Promise.all(Array.from({ length: concurrency }, worker));
}

// 대상 열거: titles 컬렉션에서 media 필드 있는 문서(= 번역 백필 대상). listDocuments 아님(존재 문서만).
async function listTranslatedTitles() {
    const out = [];
    const snaps = await kcultureDb.collection('titles').get();
    snaps.forEach((s) => { const d = s.data() || {}; if (d.media) out.push({ id: s.id, media: d.media, hasMeta: !!d.metaCachedAt }); });
    return out;
}

async function runMetaBackfill({ concurrency = 6, force = false, limit = Infinity, onProgress } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const all = await listTranslatedTitles();
    const targets = all.slice(0, limit === Infinity ? all.length : limit);
    const stat = { total: targets.length, done: 0, skipped: 0, errors: 0, bytesSum: 0, bytesMax: 0, near1mb: 0, sizes: [] };

    await runPool(targets, concurrency, async (t, i) => {
        try {
            const r = await cacheTitleMeta(t.id, { media: t.media, force });
            if (r.skipped) stat.skipped++;
            else {
                stat.done++; stat.bytesSum += r.bytes; stat.sizes.push({ id: t.id, media: r.media, bytes: r.bytes });
                if (r.bytes > stat.bytesMax) stat.bytesMax = r.bytes;
                if (r.bytes > 900 * 1024) stat.near1mb++; // 1MB 한도 근접 경고
            }
        } catch (e) { stat.errors++; if (onProgress) onProgress({ error: `${t.id}: ${e.message}` }); }
        if (onProgress && (i % 20 === 0)) onProgress({ i: i + 1, total: targets.length, done: stat.done, skipped: stat.skipped, errors: stat.errors });
    });

    stat.bytesAvg = stat.done ? Math.round(stat.bytesSum / stat.done) : 0;
    stat.sizes.sort((a, b) => b.bytes - a.bytes);
    stat.top5 = stat.sizes.slice(0, 5);
    delete stat.sizes;
    return stat;
}

module.exports = { runMetaBackfill, cacheTitleMeta, listTranslatedTitles, buildMeta, META_SCHEMA_VERSION };
