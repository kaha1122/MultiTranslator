// ── TMDB K-Content 메타 사전번역 코어 (백필 스크립트 + 신작 cron 공용) ──────────
// 작품별로: ① TMDB translations에서 언어별 번역 추출(무료) ② 없는 언어만 Gemini 묶음 번역
//           ③ kculture Firestore(titles/{id}/translations/{code})에 저장 + 마커.
// 멱등: 마커(titles/{id}.metaTranslated)가 있으면 skip → 재실행/중단복구 안전.
//
// ⚠ 제목(title)은 줄거리(overview)와 **독립적으로** 결손될 수 있다 — TMDB translations 레코드가
//   줄거리만 담고 name이 빈 경우가 흔하다. 2026-07-28 이전 버전은 그런 언어를 "추출 성공"으로 처리해
//   Gemini 대상에서 빼고, 완료 게이트도 줄거리만 검사해서 **title:'' 문서가 완료로 굳었다**.
//   재실행은 물론 --force로도 복구되지 않는 상태였다(실측 약 6.7%, 인니어 김부장 사례).
//   지금은 ① 제목만 없는 언어도 Gemini 대상 ② 완료 게이트가 제목까지 검사 ③ 스킵 게이트가
//   searchTitle 맵으로 제목 결손을 감지 → **어느 러너로 방문하든 자동 복구**된다.
const { callGeminiText, callOnce } = require('../utils/geminiCall');
const { FALLBACK_MODEL } = require('../config/gemini');
const { kcultureDb } = require('../config/firebaseKculture');
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang'); // 메인 콘텐츠 언어 — 'ko' 하드코딩 금지
const { LANG_NAMES } = require('../config/langGuide'); // ISO → 정식 언어명(Gemini가 코드보다 명칭에 정확)
// 사람이 삭제 판정한 작품의 재유입 차단 — discover 열거는 지운 id를 다음 실행에서 그대로 다시 물어온다.
const excluded = require('./excludedTitles');

// ISO 코드 → 정식 언어명. 지역코드(zh-CN 등)는 그대로, 없으면 베이스(zh)로 폴백, 최후 코드 그대로.
const nameOf = (code) => LANG_NAMES[code] || LANG_NAMES[String(code || '').split('-')[0]] || code;

// ── 원어 제목 오염 감지 (2026-07-28) ──────────────────────────────────────────
// 다른 언어 문서에 **메인 콘텐츠 언어의 제목이 그대로 새어 들어간 것**을 문자 체계로 잡는다.
// 경로 두 개: ① TMDB는 language=en-US 요청에도 영어 제목이 없으면 원제를 돌려준다(옛 코드가 이걸
// translations/en.title에 저장 → en은 전 언어 폴백 소스라 12개 로케일로 번짐) ② Gemini가 제목을
// 번역하지 않고 그대로 에코. 빈 제목과 달리 **값이 있어서 "완비"로 보이는 게** 이 오염의 악질적인 점.
// PRIMARY_CONTENT_LANG이 바뀌면 이 표에 한 줄만 추가한다(절대 규칙 #7 — 'ko' 하드코딩 금지).
const PRIMARY_SCRIPT = {
    ko: /[가-힣]/,                    // 한글 음절
    ja: /[぀-ゟ゠-ヿ]/,       // 히라가나·가타카나
    zh: /[一-鿿]/,                    // 한자
}[String(PRIMARY_CONTENT_LANG).split('-')[0]] || null;

// 이 언어 문서에 들어가면 안 되는 제목인가(원어 자신은 당연히 예외).
function titleTainted(code, title) {
    if (!title || !PRIMARY_SCRIPT) return false;
    if (String(code).split('-')[0] === String(PRIMARY_CONTENT_LANG).split('-')[0]) return false;
    return PRIMARY_SCRIPT.test(title);
}

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

// 번역 대상 = 12개 UI 언어 **전부**. 저장 키는 클라 lang 코드와 동일.
// ⚠ 언어 추가 시: 여기에 한 줄 추가만 하면 됨 — 스킵 게이트가 metaLangs 기준이라 기존 완료
//   문서도 자동 재처리되고, 저장 번역 재사용으로 새 언어만 Gemini/TMDB로 채운다(2026-07-16 id 추가).
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
    { code: 'id', iso: 'id' }, // 2026-07-16 추가 — 광고 유입 75% 인도네시아, 클라 UI locale 승격과 동시
    { code: 'ar', iso: 'ar' }, // 2026-07-22 추가 — 12번째 UI 언어(MENA), 클라 RTL 지원과 동시 승격
    // en: 2026-07-27 추가 — 오래 "소스/폴백이니 저장 불필요"로 제외했으나 **저장은 필요**했다.
    //   ① SEO: middleware.js의 폴백 순서가 {lang} → en → 포기라, translations/en이 없으면 미번역 언어가
    //      영어로 내려가지 못하고 크롤러에게 사이트 공통 셸이 나간다. /en/* 자체도 x-default인데 주입 0이었다.
    //   ② 화면: TMDB에 영어 줄거리가 없는 작품이 **약 40%**(2026-07-27 표본 40편 실측) — 영어 사용자는
    //      그 작품들의 줄거리를 아예 못 보고 있었다. 여기 채우면 클라(metaCache)가 그걸 읽어 표시한다.
    //   비용: 60%는 TMDB에서 무료 추출(아래 en 보강 가드), 나머지만 Gemini가 같은 호출에 한 언어 더 얹는다.
    { code: 'en', iso: 'en' },
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
        // 2026-07-28 추가 — 실측 518편에서 제목에 원어(한글)가 통째로/조각으로 남아 있었다.
        // ja "サッカー野球 말고" · zh-CN "뽕숭아学堂" · id "Panggil! K-캅 Film" 같은 결과물이 실제로 저장돼 있었다.
        `- Title script: write the title ENTIRELY in the writing system used by that target language.`,
        `  Never leave source-language characters (e.g. Hangul) inside a title — not even one word.`,
        `  Transliterate proper nouns into the target script (Japanese → katakana, Chinese → hanzi, Latin-script languages → romanization).`,
        `- Self-check before answering: if any value is still (even partly) in the source language, redo it fully in that target language.`,
        ``,
        `Return ONLY one JSON object whose keys are these EXACT codes [${codes.map((c) => `"${c}"`).join(', ')}],`,
        `each mapping to {"title":"...","overview":"..."}. No markdown.`,
        ``,
        `SOURCE title: ${srcTitle || ''}`,
        `SOURCE overview: ${srcOverview}`,
    ].join('\n');
    // raw 텍스트로 받아 첫 완결 JSON만 추출 (flash-lite 중복 블록 글리치에도 견고, 불필요 재시도 방지)
    const genConfig = { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' }; // 번역 충실도 → 낮은 temperature(기본 ~1.0은 의역·드리프트·원문 에코 유발). 0.3 = 충실+자연스러움 균형(UGC와 동일).
    const r = await callGeminiText(prompt, GEMINI_API_KEY, { label: 'tmdb-backfill', genConfig });
    if (r.error) return {};
    const parsed = parseFirstJsonObject(r.text);
    if (parsed) return parsed;
    // 안전 필터 차단(PROHIBITED_CONTENT)은 HTTP 200 + 빈 텍스트로 와서 callGeminiText가 "성공" 취급
    // → 내부 폴백 승격을 안 탐. 폴백 모델은 같은 프롬프트를 통과시킴을 확인(2026-07-09) → 여기서 폴백 1회 직접 호출.
    // 공유 유틸(geminiCall)은 PronunFit 라우트도 쓰므로 건드리지 않고 kculture 전용 경로에서만 처리.
    console.warn(`[tmdb-backfill] primary 응답 빈값/파싱불가 → ${FALLBACK_MODEL} 1회 폴백`);
    const fb = await callOnce(FALLBACK_MODEL, prompt, GEMINI_API_KEY, genConfig);
    if (fb.error) return {};
    return parseFirstJsonObject(fb.raw) || {};
}

// 검색 인덱스 저비용 보강: 이미 번역 완료된 작품(스킵 대상)에 searchLower/searchTitle 맵이 없을 때,
// 저장돼 있는 번역 subcollection(titles/{id}/translations/{code}.title)만으로 인덱스를 재구성(Gemini 재호출 0).
// 포스터는 검색 카드 썸네일용으로 TMDB 1회(무료)만 조회. 한 번 채우면 다음 실행부터 재조회 안 함.
// 반환: searchTitle 맵({code: 제목}) — 호출측 스킵 게이트가 **제목 결손 검출기**로 그대로 쓴다.
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
    return searchTitle;
}

// 진짜 영어 제목만 고른다 — detail은 language=en-US 요청이라 **영어 제목이 없으면 TMDB가 원제를
// 그대로 돌려준다**. 그 값을 en 제목으로 저장하면 translations/en에 원어(한국어) 제목이 박히고,
// en은 전 언어의 폴백 소스(클라 metaCache·middleware)라 오염이 12개 로케일로 번진다(2026-07-28).
// 영어 원작(original_language=en)은 원제가 곧 영어 제목이므로 예외.
function pickEnglishTitle(detail, trs) {
    const orig = (detail.original_title || detail.original_name || '').trim();
    const shown = (detail.title || detail.name || '').trim();
    if ((detail.original_language || '') === 'en') return shown || orig;
    // ⚠ 여기서 오염을 걸러야 한다. TMDB의 영어 제목에도 원어가 섞여 있는 경우가 실제로 있고
    //   (예: "Go Baek (고백) - …", "K-캅 The Movie"), 이 값은 아래에서 **전 언어의 제목 폴백 원본**으로
    //   쓰인다. 걸러내지 않으면 폴백이 오염을 다시 심고 → 다음 스캔이 또 잡아 무한 재처리가 된다.
    //   비우면 Gemini가 원제에서 깨끗한 영어 제목을 만든다.
    const clean = (s) => (s && !titleTainted('en', s) ? s : '');
    if (shown && shown !== orig) { const c = clean(shown); if (c) return c; }
    const rec = trs.find((x) => x.iso_639_1 === 'en')?.data;
    const fromRec = (rec?.title || rec?.name || '').trim();
    if (fromRec && fromRec !== orig) { const c = clean(fromRec); if (c) return c; }
    return ''; // 쓸 만한 영어 제목 없음 → 아래 Gemini가 만든다
}

async function processTitle(media, id, { force = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    // ⚠ 삭제 판정된 작품은 여기서 끊는다 — force여도 예외 없음.
    //   id 열거가 TMDB discover 기반이라, 이 가드가 없으면 지운 작품이 다음 배치에서 그대로 부활한다.
    await excluded.ready();
    if (excluded.isExcluded(id)) return { id, skipped: true, excluded: true, langs: 0, geminiUsed: 0 };
    const markerRef = kcultureDb.doc(`titles/${id}`);
    if (!force) {
        const m = await markerRef.get();
        const md = m.exists ? m.data() : null;
        if (md?.metaTranslated) {
            // 스킵 게이트는 **언어 목록 + 제목 보유** 둘 다 본다.
            //   · 언어: 타깃 전부(metaLangs)를 보유해야 완료. TARGETS에 새 언어가 추가되면 기존 완료
            //     문서도 자동 재처리 대상이 된다(아래 저장 번역 재사용으로 새 언어만 채움).
            //   · 제목: searchTitle 맵은 **빈 제목을 제외하고** 만들어지므로(아래 인덱스 생성부)
            //     그 자체가 정확한 제목 결손 검출기다 — 추가 읽기 0. 2026-07-28 추가: 예전 게이트가
            //     줄거리만 봐서 title:'' 문서가 완료로 굳었고, 재실행·--force로도 영원히 안 채워졌다.
            const langs = md.metaLangs || [];
            const hasAllLangs = TARGETS.every((t) => langs.includes(t.code));
            // 검색 인덱스가 없는 구(舊) 문서는 서브컬렉션에서 재구성한 뒤 판정(Gemini 없이 — 기존 번역제목 재사용).
            let st = md.searchTitle;
            if (hasAllLangs && !md.searchLower) { try { st = await fillSearchIndex(media, id, markerRef); } catch { /* 보강 실패는 무시 — 아래에서 미보유로 판정 */ } }
            // 제목은 **있기만 해선 안 되고 오염되지 않아야** 한다 — 원제가 박힌 문서는 값이 있어서
            // 예전 판정으로는 영원히 "완비"였다(2026-07-28). metaNoTitle = 깨끗한 제목을 못 만든
            // 영구 케이스(아래 완료 게이트에서 기록) → 무한 재처리 방지.
            const hasAllTitles = !!md.metaNoTitle || (st ? TARGETS.every((t) => st[t.code] && !titleTainted(t.code, st[t.code])) : false);
            if ((hasAllLangs && hasAllTitles) || md.metaNoSource) {
                return { id, skipped: true, langs: 0, geminiUsed: 0 };
            }
        }
    }

    const detail = await tmdb(`/${media}/${id}`, { language: 'en-US', append_to_response: 'translations' });
    const trs = detail.translations?.translations || [];
    const en = pickEnglish(detail, trs);
    const enTitle = pickEnglishTitle(detail, trs); // 원제 오염 없는 진짜 영어 제목(없으면 '')

    const out = {};
    const missing = [];
    for (const t of TARGETS) {
        const ex = extractTmdb(trs, t);
        if (ex) {
            // TMDB 번역 레코드가 줄거리만 있고 제목이 빈 경우가 흔함(특히 ko) — 타깃이 원어면 원제가 곧 그 언어 제목.
            if (!ex.title && t.iso === detail.original_language) ex.title = detail.original_title || detail.original_name || '';
            if (!ex.title && t.code === 'en') ex.title = enTitle; // en은 detail에서 바로(Gemini 절약)
            out[t.code] = { ...ex, source: 'tmdb' };
        }
        else missing.push(t);
    }

    // en 보강 — 'en'은 번역 대상이기 이전에 **추출 대상**이다.
    // detail은 language=en-US로 받았으므로 영어 줄거리가 있으면 detail.overview에 이미 들어 있다
    // (pickEnglish가 detail → translations의 en 레코드 순으로 집는다). extractTmdb가 놓친 경우를 여기서 메워
    // Gemini를 태우지 않는다. 영어가 아예 없는 작품(실측 약 40%)만 missing에 남아 아래 Gemini 루프가
    // 피벗(원어)에서 영어를 만들어 채운다 — 다른 언어와 같은 호출에 얹히므로 추가 호출은 없다.
    if (!out.en?.overview && en?.overview) {
        out.en = { title: enTitle, overview: en.overview, source: 'tmdb' }; // ⚠ en.title 그대로 쓰면 원제 오염
        const i = missing.findIndex((t) => t.code === 'en');
        if (i >= 0) missing.splice(i, 1);
    }

    // 기존 저장 번역 재사용 — 언어 추가 재처리(위 게이트)나 force 재실행에서 이미 번역된 언어의
    // Gemini 재호출을 방지. 서브컬렉션 문서를 읽어 채우면 아래 Gemini 루프의 still 필터가 자동 제외.
    // ⚠ 이미 out에 있는 언어(이번 실행에서 TMDB로 확보)는 덮지 않는다 — 덮으면 cached 플래그가 붙어
    //   제목 보강분이 저장에서 빠진다.
    const needFetch = missing.filter((t) => !out[t.code]?.overview);
    if (needFetch.length) {
        try {
            const snaps = await kcultureDb.getAll(...needFetch.map((t) => kcultureDb.doc(`titles/${id}/translations/${t.code}`)));
            snaps.forEach((s, i) => {
                const d = s.exists ? s.data() : null;
                if (d?.overview) out[needFetch[i].code] = { title: d.title || '', overview: d.overview, source: d.source || 'cache', cached: true };
            });
        } catch { /* 재사용 실패 — 전량 신규 경로(TMDB/Gemini)로 진행 */ }
    }

    // ⭐ 제목이 없거나 **원어로 오염된** 언어를 Gemini 대상에 올린다(2026-07-28).
    //   TMDB translations 레코드가 줄거리만 담고 name이 빈 경우가 있는데(id·zh-CN·en 등에서 실측),
    //   예전엔 "추출 성공"으로 처리돼 missing에 안 들어가 **제목이 영원히 빈 채로 굳었다**.
    //   오염(원제가 박힌 문서)도 값이 있다는 이유로 통과했다. 둘 다 여기서 잡는다.
    //   줄거리는 TMDB 원문을 그대로 두고 제목만 채운다(아래 병합부).
    for (const t of TARGETS) {
        const ti = out[t.code]?.title;
        if (out[t.code]?.overview && (!ti || titleTainted(t.code, ti)) && !missing.includes(t)) missing.push(t);
    }

    // 번역 원본(피벗): 영어 → 원어(ko) → 아무 TMDB 네이티브. 영어 없는 마이너작도 누락 안 되게.
    const src = pickSource(en, trs);

    let geminiUsed = 0;
    let geminiTried = false, geminiDead = false; // 아래 제목 폴백의 안전장치(전면 장애 구분)
    if (missing.length && src) {
        // 빠진 언어를 한 번에 번역. flash-lite 일시 오류·부분 JSON 글리치 대비 최대 2회까지
        // "아직도 빠진 언어만" 재시도(이미 받은 언어는 재호출 안 함 → 비용 최소·누락 방지).
        for (let attempt = 0; attempt < 2; attempt++) {
            // 줄거리가 없는 언어 + **제목이 없거나 오염된 언어** 둘 다 대상(같은 호출에 얹히므로 추가 비용 0).
            const still = missing.filter((m) => !out[m.code]?.overview || !out[m.code]?.title || titleTainted(m.code, out[m.code].title));
            if (!still.length) break;
            const g = await geminiMulti(src.title, src.overview, still.map((m) => m.code), src.langName);
            geminiTried = true;
            // 응답이 통째로 비면 전면 장애(키 없음·API 오류·안전필터) — 언어별 실패와 구분해 기록한다.
            // 이 경우 아래 영어 제목 폴백을 **적용하지 않는다**(장애 때 영어로 굳히면 제대로 된 번역
            // 제목을 받을 기회가 영영 사라진다 — 미완으로 남겨 다음 실행이 재시도하게 둔다).
            if (!g || !Object.keys(g).length) { geminiDead = true; break; }
            let got = 0;
            for (const m of still) {
                const v = g[m.code];
                if (!v) continue;
                const cur = out[m.code];
                // 모델이 제목을 번역 안 하고 원어를 그대로 에코하는 경우가 있다 → 받지 않는다(오염 재생산 방지).
                const gTitle = titleTainted(m.code, v.title) ? '' : (v.title || '');
                if (cur?.overview) {
                    // 제목만 결손·오염 — 사람이 쓴 TMDB 줄거리를 Gemini 것으로 갈아치우지 않는다. 제목만 채우고
                    // cached 플래그를 떼어(새 객체) 저장 대상으로 되돌린다.
                    if (gTitle) { out[m.code] = { title: gTitle, overview: cur.overview, source: `${cur.source}+gemini-title` }; geminiUsed++; got++; }
                } else if (v.overview) {
                    out[m.code] = { title: gTitle, overview: v.overview, source: 'gemini' }; geminiUsed++; got++;
                }
            }
            if (got === 0) break; // 진전 없으면(키없음/전면실패) 더 돌려도 무의미 — 마커 미완료로 남겨 다음 실행이 재시도
        }
    }

    // ── 제목 마감 ────────────────────────────────────────────────────────────
    // 규칙 하나로 요약: **오염된 제목은 절대 저장하지 않는다. 빈 제목은 저장해도 안전하다.**
    //   빈 제목 → 클라(metaCache)·middleware가 영어로 폴백하므로 화면·SEO 모두 정상.
    //   원어 제목 → 폴백 자체를 무력화해 화면에 한국어가 그대로 뜬다(이번 버그의 실제 증상).
    // 폴백 원본은 영어 제목: TMDB의 진짜 영어 제목 → 이번 실행에서 Gemini가 만든 영어 제목 순.
    const fallbackTitle = enTitle
        || (out.en?.title && !titleTainted('en', out.en.title) ? out.en.title : '');
    // geminiDead(전면 장애)면 손대지 않는다 — 미완으로 남겨 다음 실행이 제대로 재시도.
    if (geminiTried && !geminiDead) {
        for (const t of TARGETS) {
            const v = out[t.code];
            if (!v?.overview) continue;
            if (v.title && !titleTainted(t.code, v.title)) continue; // 이미 깨끗함
            out[t.code] = {
                title: fallbackTitle,
                overview: v.overview,
                source: `${v.source}${fallbackTitle ? '+en-title' : '+no-title'}`,
            };
        }
    }

    // ⚠ 완료 게이트: 타깃 전 언어가 모두 채워졌을 때만 metaTranslated=true.
    //   일부만 성공(Gemini 일시 실패 등) → metaTranslated=false로 남겨 다음 실행이 자동 재시도(멱등 skip 안 됨).
    //   단, 번역 원본(영어/원어/네이티브 어느 것)도 전혀 없으면(번역 불가·영구) done 처리하되 사유 기록 → 무한 재시도 방지.
    //   2026-07-28: 게이트에 **제목**을 추가. 예전엔 줄거리만 봐서 title:''·원제 오염 문서가 완료로 굳었다.
    //   위 마감을 거쳤는데도 제목이 빈 언어가 남으면 = 영어 제목도 Gemini 제목도 못 만든 작품 →
    //   metaNoTitle로 기록해 완료 처리한다(빈 제목은 안전한 종착 상태 · 스킵 게이트가 이 마커를
    //   인정 → 무한 재처리 방지). Gemini 전면 장애(geminiDead) 때는 마킹하지 않아 다음 실행이 재시도한다.
    const titlesDone = TARGETS.every((t) => !out[t.code]?.overview || out[t.code].title);
    const noTitleSource = !titlesDone && geminiTried && !geminiDead;
    const complete = TARGETS.every((t) => out[t.code]?.overview) && (titlesDone || noTitleSource);
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
        if (v.cached) continue; // 기존 저장 번역 재사용분 — 동일 내용 재기록 생략(쓰기 절약)
        batch.set(kcultureDb.doc(`titles/${id}/translations/${code}`), {
            title: v.title || '', overview: v.overview || '', source: v.source, translatedAt: new Date(),
        });
    }
    batch.set(markerRef, {
        media,
        metaTranslated: done,           // 완료(또는 원본없음)일 때만 → 부분실패는 false로 재시도 대상
        metaComplete: complete,         // 타깃 전 언어 채움 여부(감사/통계용)
        metaLangs: Object.keys(out),
        poster_path: detail.poster_path || null,  // 검색 카드 썸네일용
        searchTitle,                    // {code: 번역제목} — 검색결과 표시
        searchLower,                    // {code: 번역제목 소문자} — 접두 범위질의 키
        ...(noSource && !complete ? { metaNoSource: true } : {}),
        metaNoTitle: noTitleSource,     // 제목 원본 없음(영구) — 스킵 게이트가 인정. 조건부가 아니라 항상
                                        // 기록한다 — 나중에 TMDB에 제목이 생기면 false로 덮여 자동 복구되게.

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
            // name: 연도별 러너(backfill-by-year.js) 로그 표시용 — runBackfill은 id만 사용(무해 additive)
            for (const it of (d.results || [])) yield { id: it.id, name: it.name || it.title || '' };
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

// 부분 실패 재시도 (delta B): metaTranslated=false 인 문서만 인덱스 쿼리로 집어 재처리.
// - 왜 필요: processTitle 완료 게이트가 9언어 전부 채워야 true → Gemini 일시오류로 일부만 성공하면 false로 남음.
//   그 문서들만 O(결과수)로 재시도(전체 25k 스캔 아님 → 저비용). where('metaTranslated','==',false)는
//   단일필드 자동 인덱스라 복합인덱스 불필요. 미처리작(필드 없음)은 매칭 안 됨 → runIncremental/주간 sweep 담당.
// - force=false로 호출: 재처리 중 이미 true된 건 markerRef.get()으로 skip(경합 안전).
async function runRetry({ limit = 100, concurrency = 3 } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const snap = await kcultureDb.collection('titles')
        .where('metaTranslated', '==', false)
        .limit(limit)
        .get();
    const items = [];
    snap.forEach((d) => { const m = d.data()?.media; if (m) items.push({ media: m, id: d.id }); });
    const stat = { scanned: items.length, done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0 };
    await runPool(items, concurrency, async ({ media, id }) => {
        try { const r = await processTitle(media, id); if (r.skipped) stat.skipped++; else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; } }
        catch { stat.errors++; }
    });
    return stat;
}

// titleTainted: 보수 스크립트(fill-missing-langs.js)가 **같은 판정**으로 대상을 고르게 공개.
module.exports = { runBackfill, runIncremental, runRetry, processTitle, enumerateIds, TARGETS, titleTainted };
