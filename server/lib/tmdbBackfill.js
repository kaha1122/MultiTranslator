// ── TMDB K-Content 메타 사전번역 코어 (백필 스크립트 + 신작 cron 공용) ──────────
// 작품별로: ① TMDB translations에서 언어별 번역 추출(무료) ② 없는 언어만 Gemini 묶음 번역
//           ③ kculture Firestore(titles/{id}/translations/{code})에 저장 + 마커.
// 멱등: 마커(titles/{id}.metaTranslated)가 있으면 skip → 재실행/중단복구 안전.
const { callGeminiText } = require('../utils/geminiCall');
const { kcultureDb } = require('../config/firebaseKculture');
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang'); // 메인 콘텐츠 언어 — 'ko' 하드코딩 금지
const { LANG_NAMES } = require('../config/langGuide'); // ISO → 정식 언어명(Gemini가 코드보다 명칭에 정확)

// ISO 코드 → 정식 언어명. 지역코드(zh-CN 등)는 그대로, 없으면 베이스(zh)로 폴백, 최후 코드 그대로.
const nameOf = (code) => LANG_NAMES[code] || LANG_NAMES[String(code || '').split('-')[0]] || code;

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

// TMDB translations에서 줄거리가 있는 아무 번역본 1개(원본 피벗 최후수단).
function anyNativeOverview(trs) {
    for (const x of trs) {
        const d = x.data;
        if (d && d.overview && d.overview.trim()) return { iso: x.iso_639_1, title: d.title || d.name || '', overview: d.overview };
    }
    return null;
}

// 번역 피벗 소스 선택: 영어 우선(가장 안전) → 원어(PRIMARY_CONTENT_LANG, 보통 ko) → TMDB에 있는 아무 언어.
// 영어 메타가 없는 마이너 한국 작품도 원어(한국어) 줄거리로 9개 언어를 채울 수 있게 함(영어 피벗 한계 해소).
function pickSource(en, trs) {
    if (en?.overview) return { langName: 'English', title: en.title || '', overview: en.overview };
    const primary = trs.find((x) => x.iso_639_1 === PRIMARY_CONTENT_LANG && x.data?.overview?.trim())?.data;
    if (primary) return { langName: nameOf(PRIMARY_CONTENT_LANG), title: primary.title || primary.name || '', overview: primary.overview };
    const any = anyNativeOverview(trs);
    if (any) return { langName: nameOf(any.iso), title: any.title, overview: any.overview };
    return null;
}

// 없는 언어들을 한 번의 Gemini 호출로 묶어 번역 (작품당 최대 1회 → 비용/호출 최소화).
// 프롬프트는 커뮤니티 UGC 번역(routes/community.js)의 강화 규칙과 동일 철학:
//   ① ISO 코드가 아닌 "정식 언어명" 제시(Gemini가 코드보다 명칭에 정확) ② 원문 에코 금지 + self-check
//   ③ temperature 0.3(기본 ~1.0은 의역·드리프트·원문 에코 유발). 단 출력 키는 코드 계약 유지(processTitle이 g[code]로 읽음).
// srcLangName: 원본 줄거리의 언어명(영어/한국어 등) — 피벗이 영어가 아닐 수 있어 명시.
async function geminiMulti(srcTitle, srcOverview, codes, srcLangName = 'English') {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const targetList = codes.map((c) => `  - "${c}" → ${nameOf(c)}`).join('\n');
    const prompt = [
        `You are a professional translator localizing movie/TV catalog metadata for a multilingual app.`,
        `The SOURCE text below is in ${srcLangName}. Translate it into EACH of these target languages:`,
        targetList,
        ``,
        `[Rules — apply to every target language]`,
        `- Each translation MUST be written 100% in that target language.`,
        `- NEVER return, copy, paraphrase, or echo the source language. Returning the source language is a FAILURE.`,
        `- Translate the overview naturally and idiomatically, faithfully preserving meaning, tone and nuance. Do not add notes, commentary, or information not in the source.`,
        `- Title: translate it naturally for each language; keep proper nouns and person names natural. Do not invent a title.`,
        `- Self-check before answering: if any value is still (even partly) in the source language, redo it fully in that target language.`,
        ``,
        `Return ONLY one JSON object whose keys are these EXACT codes [${codes.map((c) => `"${c}"`).join(', ')}],`,
        `each mapping to {"title":"...","overview":"..."}. No markdown.`,
        ``,
        `SOURCE title: ${srcTitle || ''}`,
        `SOURCE overview: ${srcOverview}`,
    ].join('\n');
    // raw 텍스트로 받아 첫 완결 JSON만 추출 (flash-lite 중복 블록 글리치에도 견고, 불필요 재시도 방지)
    const r = await callGeminiText(prompt, GEMINI_API_KEY, {
        label: 'tmdb-backfill',
        // 번역 충실도 → 낮은 temperature(기본 ~1.0은 의역·드리프트·원문 에코 유발). 0.3 = 충실+자연스러움 균형(UGC와 동일).
        genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' },
    });
    if (r.error) return {};
    return parseFirstJsonObject(r.text) || {};
}

// 검색 인덱스 저비용 보강: 이미 번역 완료된 작품(스킵 대상)에 searchLower/searchTitle 맵이 없을 때,
// 저장돼 있는 번역 subcollection(titles/{id}/translations/{code}.title)만으로 인덱스를 재구성(Gemini 재호출 0).
// 포스터는 검색 카드 썸네일용으로 TMDB 1회(무료)만 조회. 한 번 채우면 다음 실행부터 재조회 안 함.
async function fillSearchIndex(media, id, markerRef) {
    const snap = await kcultureDb.collection(`titles/${id}/translations`).get();
    const searchTitle = {}, searchLower = {};
    snap.forEach((d) => {
        const ti = (d.data()?.title || '').trim();
        if (ti) { searchTitle[d.id] = ti; searchLower[d.id] = ti.toLowerCase(); }
    });
    let poster_path = null;
    try { const det = await tmdb(`/${media}/${id}`, { language: 'en-US' }); poster_path = det.poster_path || null; } catch { /* 포스터 실패는 무시(제목 폴백 카드) */ }
    await markerRef.set({ poster_path, searchTitle, searchLower, searchIndexedAt: new Date() }, { merge: true });
}

async function processTitle(media, id, { force = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const markerRef = kcultureDb.doc(`titles/${id}`);
    if (!force) {
        const m = await markerRef.get();
        if (m.exists && m.data()?.metaTranslated) {
            // 이미 번역 완료. 검색 인덱스만 없으면 저비용 보강(Gemini 없이 — 기존 번역제목 재사용).
            if (!m.data()?.searchLower) { try { await fillSearchIndex(media, id, markerRef); } catch { /* 보강 실패는 무시 */ } }
            return { id, skipped: true, langs: 0, geminiUsed: 0 };
        }
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

    // 번역 원본(피벗): 영어 → 원어(ko) → 아무 TMDB 네이티브. 영어 없는 마이너작도 누락 안 되게.
    const src = pickSource(en, trs);

    let geminiUsed = 0;
    if (missing.length && src) {
        // 빠진 언어를 한 번에 번역. flash-lite 일시 오류·부분 JSON 글리치 대비 최대 2회까지
        // "아직도 빠진 언어만" 재시도(이미 받은 언어는 재호출 안 함 → 비용 최소·누락 방지).
        for (let attempt = 0; attempt < 2; attempt++) {
            const still = missing.filter((m) => !out[m.code]?.overview);
            if (!still.length) break;
            const g = await geminiMulti(src.title, src.overview, still.map((m) => m.code), src.langName);
            let got = 0;
            for (const m of still) {
                const v = g[m.code];
                if (v && v.overview) { out[m.code] = { title: v.title || '', overview: v.overview, source: 'gemini' }; geminiUsed++; got++; }
            }
            if (got === 0) break; // 진전 없으면(키없음/전면실패) 더 돌려도 무의미 — 마커 미완료로 남겨 다음 실행이 재시도
        }
    }

    // ⚠ 완료 게이트: 9개 타깃이 모두 채워졌을 때만 metaTranslated=true.
    //   일부만 성공(Gemini 일시 실패 등) → metaTranslated=false로 남겨 다음 실행이 자동 재시도(멱등 skip 안 됨).
    //   단, 번역 원본(영어/원어/네이티브 어느 것)도 전혀 없으면(번역 불가·영구) done 처리하되 사유 기록 → 무한 재시도 방지.
    const complete = TARGETS.every((t) => out[t.code]?.overview);
    const noSource = !src;
    const done = complete || noSource;

    // 검색 인덱스: 사용자 언어 번역제목 접두 검색용 맵(marker doc). TMDB 검색은 번역제목을 인덱싱하지
    //   않으므로(원제·영문·별칭만) 이 맵으로 보완. searchLower=소문자 접두매칭 키, searchTitle=표시용.
    const searchTitle = {}, searchLower = {};
    for (const [code, v] of Object.entries(out)) {
        const ti = (v.title || '').trim();
        if (ti) { searchTitle[code] = ti; searchLower[code] = ti.toLowerCase(); }
    }

    const batch = kcultureDb.batch();
    for (const [code, v] of Object.entries(out)) {
        batch.set(kcultureDb.doc(`titles/${id}/translations/${code}`), {
            title: v.title || '', overview: v.overview || '', source: v.source, translatedAt: new Date(),
        });
    }
    batch.set(markerRef, {
        media,
        metaTranslated: done,           // 완료(또는 원본없음)일 때만 → 부분실패는 false로 재시도 대상
        metaComplete: complete,         // 9개 타깃 전부 채움 여부(감사/통계용)
        metaLangs: Object.keys(out),
        poster_path: detail.poster_path || null,  // 검색 카드 썸네일용
        searchTitle,                    // {code: 번역제목} — 검색결과 표시
        searchLower,                    // {code: 번역제목 소문자} — 접두 범위질의 키
        ...(noSource && !complete ? { metaNoSource: true } : {}),
        updatedAt: new Date(),
    }, { merge: true });
    await batch.commit();
    return { id, skipped: false, langs: Object.keys(out).length, complete, geminiUsed };
}

// 연도 윈도우로 한국 작품 id 열거 (discover 500페이지/1만건 상한 우회)
async function* enumerateIds(media, yearFrom, yearTo) {
    const dateField = media === 'tv' ? 'first_air_date' : 'primary_release_date';
    for (let y = yearTo; y >= yearFrom; y--) {
        let page = 1, totalPages = 1;
        do {
            const d = await tmdb(`/discover/${media}`, {
                with_original_language: PRIMARY_CONTENT_LANG, sort_by: 'popularity.desc', include_adult: 'false',
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
    // partial = 일부 언어 누락(metaTranslated=false로 남음) → 운영자가 재실행으로 메워야 함. 침묵 누락 방지 가시화.
    const stat = { done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0 };
    for (const m of medias) {
        const ids = [];
        for await (const it of enumerateIds(m, yearFrom, yearTo)) ids.push(it);
        const capped = ids.slice(0, limit === Infinity ? ids.length : limit);
        await runPool(capped, concurrency, async ({ id }, i) => {
            try {
                const r = await processTitle(m, id, { force });
                if (r.skipped) stat.skipped++; else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; }
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
                with_original_language: PRIMARY_CONTENT_LANG, sort_by: `${dateField}.desc`,
                [`${dateField}.gte`]: since, page: String(page),
            });
            totalPages = Math.min(d.total_pages || 1, 5);
            for (const it of (d.results || [])) items.push({ media, id: it.id });
            page++;
        } while (page <= totalPages && items.length < maxTitles);
    }
    const capped = items.slice(0, maxTitles);
    const stat = { scanned: capped.length, done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0 };
    await runPool(capped, concurrency, async ({ media, id }) => {
        try { const r = await processTitle(media, id); if (r.skipped) stat.skipped++; else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; } }
        catch { stat.errors++; }
    });
    return stat;
}

module.exports = { runBackfill, runIncremental, processTitle, TARGETS };
