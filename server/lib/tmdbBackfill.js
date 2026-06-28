// ── TMDB K-Content 메타 사전번역 코어 (백필 스크립트 + 신작 cron 공용) ──────────
// 작품별로: ① TMDB translations에서 언어별 번역 추출(무료) ② 없는 언어만 Gemini 묶음 번역
//           ③ kculture Firestore(titles/{id}/translations/{code})에 저장 + 마커.
// 멱등: 마커(titles/{id}.metaTranslated)가 있으면 skip → 재실행/중단복구 안전.
const { callGeminiText } = require('../utils/geminiCall');
const { kcultureDb } = require('../config/firebaseKculture');

// flash-lite가 JSON 뒤에 중복 블록을 붙이는 글리치 대응: 첫 번째 완결 {…} 객체만 추출.
function parseFirstJsonObject(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            if (--depth === 0) {
                try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
            }
        }
    }
    return null;
}

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 번역 대상 9개 (10개 UI 언어 중 영어=소스/폴백만 제외). 저장 키는 클라 lang 코드와 동일.
// ko(한국어): 원어라 대개 TMDB에 존재→무료 추출. 없는 작품만 영어→한국어 번역해 빈칸 메움
// (한국도 주요 고객층 — TMDB에 한국어 줄거리 누락 시에도 한국어 보장).
const TARGETS = [
    { code: 'ko', iso: 'ko' },
    { code: 'ja', iso: 'ja' },
    { code: 'zh-CN', iso: 'zh', region: 'CN' },
    { code: 'vi', iso: 'vi' },
    { code: 'fr', iso: 'fr' },
    { code: 'de', iso: 'de' },
    { code: 'es', iso: 'es' },
    { code: 'ru', iso: 'ru' },
    { code: 'pt-BR', iso: 'pt', region: 'BR' },
];

async function tmdb(path, params = {}) {
    if (!TMDB_KEY) throw new Error('TMDB_API_KEY not set');
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${path}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
    return r.json();
}

function extractTmdb(trs, t) {
    const exact = t.region && trs.find((x) => x.iso_639_1 === t.iso && x.iso_3166_1 === t.region);
    const byIso = trs.find((x) => x.iso_639_1 === t.iso);
    const d = (exact || byIso)?.data;
    if (d && d.overview && d.overview.trim()) return { title: d.title || d.name || '', overview: d.overview };
    return null;
}

function pickEnglish(detail, trs) {
    if (detail.overview && detail.overview.trim()) return { title: detail.title || detail.name || '', overview: detail.overview };
    const en = trs.find((x) => x.iso_639_1 === 'en')?.data;
    if (en?.overview) return { title: en.title || en.name || '', overview: en.overview };
    return null;
}

// 없는 언어들을 한 번의 Gemini 호출로 묶어 번역 (작품당 최대 1회 → 비용/호출 최소화)
async function geminiMulti(enTitle, enOverview, codes) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const prompt = [
        `Translate this Korean movie/TV metadata (given in English) into these language codes: ${codes.join(', ')}.`,
        'Keep proper nouns and names natural for each language. Do not add commentary.',
        `Return ONLY a JSON object mapping each code to {"title","overview"}. Example: {"${codes[0]}":{"title":"...","overview":"..."}}.`,
        '',
        `title: ${enTitle || ''}`,
        `overview: ${enOverview}`,
    ].join('\n');
    // raw 텍스트로 받아 첫 완결 JSON만 추출 (flash-lite 중복 블록 글리치에도 견고, 불필요 재시도 방지)
    const r = await callGeminiText(prompt, GEMINI_API_KEY, {
        label: 'tmdb-backfill',
        genConfig: { responseMimeType: 'application/json' },
    });
    if (r.error) return {};
    return parseFirstJsonObject(r.text) || {};
}

async function processTitle(media, id, { force = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const markerRef = kcultureDb.doc(`titles/${id}`);
    if (!force) {
        const m = await markerRef.get();
        if (m.exists && m.data()?.metaTranslated) return { id, skipped: true, langs: 0, geminiUsed: 0 };
    }

    const detail = await tmdb(`/${media}/${id}`, { language: 'en-US', append_to_response: 'translations' });
    const trs = detail.translations?.translations || [];
    const en = pickEnglish(detail, trs);

    const out = {};
    const missing = [];
    for (const t of TARGETS) {
        const ex = extractTmdb(trs, t);
        if (ex) out[t.code] = { ...ex, source: 'tmdb' };
        else missing.push(t);
    }

    let geminiUsed = 0;
    if (missing.length && en?.overview) {
        const g = await geminiMulti(en.title, en.overview, missing.map((m) => m.code));
        for (const m of missing) {
            const v = g[m.code];
            if (v && v.overview) { out[m.code] = { title: v.title || '', overview: v.overview, source: 'gemini' }; geminiUsed++; }
        }
    }

    const batch = kcultureDb.batch();
    for (const [code, v] of Object.entries(out)) {
        batch.set(kcultureDb.doc(`titles/${id}/translations/${code}`), {
            title: v.title || '', overview: v.overview || '', source: v.source, translatedAt: new Date(),
        });
    }
    batch.set(markerRef, { media, metaTranslated: true, metaLangs: Object.keys(out), updatedAt: new Date() }, { merge: true });
    await batch.commit();
    return { id, skipped: false, langs: Object.keys(out).length, geminiUsed };
}

// 연도 윈도우로 한국 작품 id 열거 (discover 500페이지/1만건 상한 우회)
async function* enumerateIds(media, yearFrom, yearTo) {
    const dateField = media === 'tv' ? 'first_air_date' : 'primary_release_date';
    for (let y = yearTo; y >= yearFrom; y--) {
        let page = 1, totalPages = 1;
        do {
            const d = await tmdb(`/discover/${media}`, {
                with_original_language: 'ko', sort_by: 'popularity.desc', include_adult: 'false',
                [`${dateField}.gte`]: `${y}-01-01`, [`${dateField}.lte`]: `${y}-12-31`, page: String(page),
            });
            totalPages = Math.min(d.total_pages || 1, 500);
            for (const it of (d.results || [])) yield { id: it.id };
            page++;
        } while (page <= totalPages);
    }
}

async function runPool(items, concurrency, fn) {
    let idx = 0;
    async function worker() { while (idx < items.length) { const i = idx++; await fn(items[i], i); } }
    await Promise.all(Array.from({ length: concurrency }, worker));
}

// 풀 백필 (1회성). 멱등이라 중단 후 재실행 가능.
async function runBackfill({ media = 'both', yearFrom = 1950, yearTo, concurrency = 4, force = false, limit = Infinity, onProgress } = {}) {
    if (!yearTo) yearTo = new Date().getFullYear();
    const medias = media === 'both' ? ['tv', 'movie'] : [media];
    const stat = { done: 0, skipped: 0, gemini: 0, errors: 0 };
    for (const m of medias) {
        const ids = [];
        for await (const it of enumerateIds(m, yearFrom, yearTo)) ids.push(it);
        const capped = ids.slice(0, limit === Infinity ? ids.length : limit);
        await runPool(capped, concurrency, async ({ id }, i) => {
            try {
                const r = await processTitle(m, id, { force });
                if (r.skipped) stat.skipped++; else { stat.done++; stat.gemini += r.geminiUsed; }
            } catch { stat.errors++; }
            if (onProgress && (i % 50 === 0)) onProgress({ media: m, total: capped.length, ...stat });
        });
        if (onProgress) onProgress({ media: m, total: capped.length, final: true, ...stat });
    }
    return stat;
}

// 신작 증분 (cron). 최근 N일 공개작만, 건수 제한.
async function runIncremental({ days = 14, maxTitles = 200, concurrency = 3 } = {}) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const items = [];
    for (const media of ['tv', 'movie']) {
        const dateField = media === 'tv' ? 'first_air_date' : 'primary_release_date';
        let page = 1, totalPages = 1;
        do {
            const d = await tmdb(`/discover/${media}`, {
                with_original_language: 'ko', sort_by: `${dateField}.desc`,
                [`${dateField}.gte`]: since, page: String(page),
            });
            totalPages = Math.min(d.total_pages || 1, 5);
            for (const it of (d.results || [])) items.push({ media, id: it.id });
            page++;
        } while (page <= totalPages && items.length < maxTitles);
    }
    const capped = items.slice(0, maxTitles);
    const stat = { scanned: capped.length, done: 0, skipped: 0, gemini: 0, errors: 0 };
    await runPool(capped, concurrency, async ({ media, id }) => {
        try { const r = await processTitle(media, id); if (r.skipped) stat.skipped++; else { stat.done++; stat.gemini += r.geminiUsed; } }
        catch { stat.errors++; }
    });
    return stat;
}

module.exports = { runBackfill, runIncremental, processTitle, TARGETS };
