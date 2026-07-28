// ── TMDB K-Content 메타 사전번역 코어 V2 — 한국어 피벗 (2026-07-28 전면 재작성) ──
// 백필 러너(rebuild-ko-pivot.js 등) + 신작 cron(cron-daily.js) 공용. **같은 파이프라인**을 쓴다 —
// 재구축만 별도 스크립트로 하면 cron이 구방식으로 신작을 만들어 오염이 재발하기 때문.
//
// V1(en 피벗 + TMDB 언어별 레코드 추출)을 버린 이유(2026-07-28 카탈로그 재정비):
//   TMDB translations 레코드는 신뢰할 수 없었다 — 제목란에 줄거리가 들어간 레코드, 제목만 빈
//   레코드(인니어 김부장), 원어(한글)가 그대로/조각으로 박힌 제목(실측 518편), "Temporada 1"류
//   수식 노이즈까지. 그래서 **소스를 하나로 고정**한다: 한국어 원제 + 한국어 줄거리.
//
// V2 파이프라인(작품당 TMDB 1회 + Gemini 최대 2회):
//   ① TMDB 상세(language=ko + translations append) → 원제(original_title)·ko 줄거리·en 줄거리·공식 제목들
//   ② 제목: ko = 원제 그대로. 그 외 11개 언어 = **엄격 검증을 통과한 TMDB 공식 제목 우선**
//      (Agent Kim Reactivated 같은 공식 제목은 검색 자산), 없거나 불합격이면 원제→Gemini 번역.
//   ③ 줄거리: 피벗 = ko 줄거리(없으면 en 줄거리 — 이 경우 ko 포함 전 언어를 en에서 한 번에 번역해
//      이중번역을 피한다). en 줄거리는 TMDB 공식이 있으면 그대로(사람 작성 보존), 없으면 ko→en.
//      나머지 10개 언어 = 피벗에서 Gemini 번역.
//   ④ 검증 게이트(저장 전): 원어 오염(titleTainted)·제목≒줄거리·길이·문자 체계. 불합격은 저장 안 함.
//      **오염된 제목은 절대 저장하지 않는다. 빈 제목은 안전하다**(클라·middleware가 영어 폴백).
//   ⑤ 저장: translations/{code} 전체 교체(과거 쓰레기 제거) + 마커 metaV:2.
//
// 멱등: metaV===2 && metaTranslated → skip. 부분 실패는 metaTranslated=false로 남아
//       cron의 runRetry가 자동 재시도. 중단·재실행 안전.
const { callGeminiText, callOnce } = require('../utils/geminiCall');
const { FALLBACK_MODEL } = require('../config/gemini');
const { kcultureDb } = require('../config/firebaseKculture');
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang'); // 메인 콘텐츠 언어 — 'ko' 하드코딩 금지
const { LANG_NAMES } = require('../config/langGuide'); // ISO → 정식 언어명(Gemini가 코드보다 명칭에 정확)
const { cacheTitleMeta } = require('./tmdbMetaBackfill'); // 신작의 meta(출연·연도…)도 함께 채움
// 사람이 삭제 판정한 작품의 재유입 차단 — discover 열거는 지운 id를 다음 실행에서 그대로 다시 물어온다.
const excluded = require('./excludedTitles');

// ISO 코드 → 정식 언어명. 지역코드(zh-CN 등)는 그대로, 없으면 베이스(zh)로 폴백, 최후 코드 그대로.
const nameOf = (code) => LANG_NAMES[code] || LANG_NAMES[String(code || '').split('-')[0]] || code;
const baseLang = (code) => String(code || '').split('-')[0];

// ── 원어 제목 오염 감지 ──────────────────────────────────────────────────────
// 다른 언어 문서에 **메인 콘텐츠 언어의 문자**가 새어 들어간 것을 잡는다. 경로: ① TMDB 공식 제목에
// 원어가 섞임("Go Baek (고백) - …") ② Gemini가 번역 안 하고 에코. 값이 있어서 "완비"로 보이는 게 악질.
// PRIMARY_CONTENT_LANG이 바뀌면 이 표에 한 줄만 추가한다(절대 규칙 #7).
const PRIMARY_SCRIPT = {
    ko: /[가-힣]/,          // 한글 음절
    ja: /[぀-ヿ]/,          // 히라가나·가타카나
    zh: /[一-鿿]/,          // 한자
}[baseLang(PRIMARY_CONTENT_LANG)] || null;

// 이 언어 문서에 들어가면 안 되는 텍스트인가(원어 자신은 당연히 예외).
function titleTainted(code, text) {
    if (!text || !PRIMARY_SCRIPT) return false;
    if (baseLang(code) === baseLang(PRIMARY_CONTENT_LANG)) return false;
    return PRIMARY_SCRIPT.test(text);
}

// ── 검증 게이트 ─────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 제목으로 저장해도 되는가. overviews: 이 제목과 나란히 놓일 줄거리들(자기 언어 + 소스) —
// "제목란에 줄거리" 데이터가 실재해서(2026-07-28 재정비의 발단) 접두 일치로 걸러낸다.
function validTitle(code, s, ...overviews) {
    const t = norm(s);
    if (!t || t.length > 80 || /\n/.test(String(s))) return false;
    if (titleTainted(code, t)) return false;
    // 25자 초과인데 어느 줄거리의 접두와 일치 → 제목이 아니라 줄거리 조각이다.
    // (짧은 제목이 우연히 줄거리 첫 단어와 겹치는 오탐을 25자 하한으로 방지)
    if (t.length > 25) {
        for (const ov of overviews) {
            const o = norm(ov);
            if (o && o.slice(0, t.length) === t) return false;
        }
    }
    return true;
}

// 언어별 문자 체계 기대치 — **Gemini 산출물에만** 적용(영어 에코·언어 뒤섞임 검출).
// 라틴계 언어는 구분 불가라 검사하지 않는다. TMDB 공식 텍스트는 검사하지 않는다(사람 작성 존중).
const SCRIPT_RE = {
    ko: /[가-힣]/,
    ja: /[぀-ヿ一-鿿]/,
    'zh-CN': /[一-鿿]/,
    ru: /[Ѐ-ӿ]/,
    ar: /[؀-ۿ]/,
};
function validOverview(code, s) {
    const t = norm(s);
    if (!t || t.length < 10) return false;
    if (titleTainted(code, t)) return false;          // 비원어 줄거리에 한글 잔류 금지
    const re = SCRIPT_RE[code];
    if (re && !re.test(t)) return false;              // ja/zh/ru/ar/ko는 해당 문자가 있어야 함
    return true;
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

// 번역 대상 = 12개 UI 언어 **전부**(en 포함 — SEO middleware·클라의 전 언어 폴백 소스).
// ⚠ 언어 추가 시: 여기에 한 줄 추가 + 필요하면 SCRIPT_RE에 문자 체계 한 줄.
//   스킵 게이트가 "전 타깃 제목·줄거리 보유" 기준이라 기존 완료 문서도 자동 재처리된다.
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
    { code: 'id', iso: 'id' }, // 2026-07-16 추가 — 광고 유입 75% 인도네시아
    { code: 'ar', iso: 'ar' }, // 2026-07-22 추가 — 12번째 UI 언어(MENA), RTL
    { code: 'en', iso: 'en' }, // 2026-07-27 추가 — 전 언어 폴백 소스라 저장 필요
];
const PRIMARY_CODE = TARGETS.find((t) => baseLang(t.code) === baseLang(PRIMARY_CONTENT_LANG))?.code || 'ko';

const TMDB_LANG = { ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN' };
const toTmdbLang = (l) => TMDB_LANG[baseLang(l)] || l || 'en-US';

async function tmdb(path, params = {}) {
    if (!TMDB_KEY) throw new Error('TMDB_API_KEY not set');
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${path}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
    return r.json();
}

// TMDB translations 배열에서 타깃 언어 레코드(exact region 우선 → iso)
function tmdbRecord(trs, t) {
    const exact = t.region && trs.find((x) => x.iso_639_1 === t.iso && x.iso_3166_1 === t.region);
    return (exact || trs.find((x) => x.iso_639_1 === t.iso))?.data || null;
}

// ── Gemini 묶음 번역 (작품당 1회 호출로 필요한 언어 전부) ─────────────────────
// 소스가 둘이다: 제목은 **항상 한국어 원제**, 줄거리는 피벗(한국어 또는 영어) — 따로 명시한다.
// overviewMode=false(줄거리 원본 자체가 없는 작품)면 제목만 요청해 모델이 줄거리를 지어내지 못하게 한다.
async function geminiMulti({ srcTitle, srcOverview, srcOverviewLang, codes, overviewMode }) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const targetList = codes.map((c) => `  - "${c}" → ${nameOf(c)}`).join('\n');
    const shape = overviewMode ? '{"title":"...","overview":"..."}' : '{"title":"..."}';
    const prompt = [
        `You are a professional translator localizing Korean movie/TV catalog metadata for a multilingual app.`,
        `Translate for EACH of these target languages:`,
        targetList,
        ``,
        `[Title rules]`,
        `- SOURCE TITLE below is in ${nameOf(PRIMARY_CONTENT_LANG)}. Translate it naturally for each target language.`,
        `- Write the title ENTIRELY in the writing system used by that target language.`,
        `  Never leave ${nameOf(PRIMARY_CONTENT_LANG)} characters inside a title — not even one word.`,
        `  Transliterate proper nouns and person names into the target script (Japanese → katakana, Chinese → hanzi, Latin-script languages → romanization).`,
        `- Do not invent a different title, and do not append qualifiers that are not in the source (no season numbers, no country names, no genre words).`,
        ...(overviewMode ? [
            ``,
            `[Overview rules]`,
            `- SOURCE OVERVIEW below is in ${srcOverviewLang}. Translate it naturally and idiomatically into each target language, faithfully preserving meaning, tone and nuance.`,
            `- Each overview MUST be written 100% in its target language. Do not add notes, commentary, or information not in the source.`,
        ] : []),
        ``,
        `- NEVER return, copy, or echo the source language where a translation is required. Returning source-language text is a FAILURE.`,
        `- Self-check before answering: if any value is still (even partly) in the source language, redo it fully in that target language.`,
        ``,
        `Return ONLY one JSON object whose keys are these EXACT codes [${codes.map((c) => `"${c}"`).join(', ')}],`,
        `each mapping to ${shape}. No markdown.`,
        ``,
        `SOURCE TITLE (${nameOf(PRIMARY_CONTENT_LANG)}): ${srcTitle}`,
        ...(overviewMode ? [`SOURCE OVERVIEW (${srcOverviewLang}): ${srcOverview}`] : []),
    ].join('\n');
    // raw 텍스트로 받아 첫 완결 JSON만 추출 (flash-lite 중복 블록 글리치에도 견고, 불필요 재시도 방지)
    const genConfig = { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' }; // 낮은 temp = 충실 번역(기본 ~1.0은 의역·에코 유발)
    const r = await callGeminiText(prompt, GEMINI_API_KEY, { label: 'tmdb-backfill', genConfig });
    if (r.error) return {};
    const parsed = parseFirstJsonObject(r.text);
    if (parsed) return parsed;
    // 안전 필터 차단(PROHIBITED_CONTENT)은 HTTP 200 + 빈 텍스트로 와서 "성공" 취급 → 폴백 모델 1회 직접 호출.
    // 공유 유틸(geminiCall)은 PronunFit 라우트도 쓰므로 건드리지 않는다.
    console.warn(`[tmdb-backfill] primary 응답 빈값/파싱불가 → ${FALLBACK_MODEL} 1회 폴백`);
    const fb = await callOnce(FALLBACK_MODEL, prompt, GEMINI_API_KEY, genConfig);
    if (fb.error) return {};
    return parseFirstJsonObject(fb.raw) || {};
}

// ── 본체: 작품 1편 처리 ─────────────────────────────────────────────────────
async function processTitle(media, id, { force = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    // ⚠ 삭제 판정된 작품은 여기서 끊는다 — force여도 예외 없음.
    //   id 열거가 TMDB discover 기반이라, 이 가드가 없으면 지운 작품이 다음 배치에서 그대로 부활한다.
    await excluded.ready();
    if (excluded.isExcluded(id)) return { id, skipped: true, excluded: true, langs: 0, geminiUsed: 0 };

    const markerRef = kcultureDb.doc(`titles/${id}`);
    const m = await markerRef.get();
    const md = m.exists ? m.data() : null;
    // 스킵 게이트 — V2 마커 기준. V1 문서(metaV 없음)는 전부 재처리 대상(카탈로그 재구축의 핵심).
    if (!force && md?.metaV === 2 && md.metaTranslated) return { id, skipped: true, langs: 0, geminiUsed: 0 };

    // ① 소스 확보 — 원어 기준 상세 + 공식 번역 레코드
    const detail = await tmdb(`/${media}/${id}`, {
        language: toTmdbLang(PRIMARY_CONTENT_LANG), append_to_response: 'translations',
    });
    const trs = detail.translations?.translations || [];
    const origTitle = norm(detail.original_title || detail.original_name);
    // 카탈로그 전제(2026-07-28 재정비): 원제 보유작만 남겼다. 원제가 없으면 침묵 생성하지 말고 드러낸다.
    if (!origTitle) throw new Error(`원제 없음 — ${media}/${id}`);

    // ko 줄거리 — 원어 요청 응답 → 없으면 translations 원어 레코드. **원어 문자가 없으면 불신**
    // (ko 자리에 영어가 박힌 오염 레코드 실재 → 그런 건 소스로 쓰지 않고 en 피벗으로 넘어간다).
    const koRec = tmdbRecord(trs, TARGETS.find((t) => t.code === PRIMARY_CODE));
    let koOv = norm(detail.overview) || norm(koRec?.overview);
    if (koOv && PRIMARY_SCRIPT && !PRIMARY_SCRIPT.test(koOv)) koOv = '';

    // en 줄거리 — TMDB 공식(사람 작성) 우선, 없으면 기존 저장분(과거 Gemini 생성 포함) 재사용.
    const enRec = tmdbRecord(trs, TARGETS.find((t) => t.code === 'en'));
    let enOv = norm(enRec?.overview);
    let enOvSrc = enOv ? 'tmdb' : null;
    if (!enOv) {
        try {
            const s = await kcultureDb.doc(`titles/${id}/translations/en`).get();
            const prev = s.exists ? norm(s.data()?.overview) : '';
            if (prev && !PRIMARY_SCRIPT?.test(prev)) { enOv = prev; enOvSrc = 'cache'; }
        } catch { /* 재사용 실패 — en도 Gemini 경로로 */ }
    }

    // 줄거리 피벗: ko 우선. ko가 없으면 en에서 **ko 포함 전 언어를 한 번에** 번역(이중번역 회피).
    const pivot = koOv ? { code: PRIMARY_CODE, langName: nameOf(PRIMARY_CONTENT_LANG), text: koOv }
        : enOv ? { code: 'en', langName: 'English', text: enOv } : null;

    // ② 조립 — 제목: 원제(ko) / 검증 통과한 공식 제목(그 외). 줄거리: ko·en은 확보분.
    const out = {};
    for (const t of TARGETS) {
        const rec = tmdbRecord(trs, t);
        let title = '', tSrc = null;
        if (t.code === PRIMARY_CODE) { title = origTitle; tSrc = 'orig'; }
        else {
            const cand = norm(rec?.title || rec?.name);
            // 엄격 검증: 오염·줄거리형·길이. 통과한 공식 제목은 검색 자산이라 Gemini보다 우선.
            if (cand && validTitle(t.code, cand, rec?.overview, koOv, enOv)) { title = cand; tSrc = 'official'; }
        }
        let overview = '', oSrc = null;
        if (t.code === PRIMARY_CODE && koOv) { overview = koOv; oSrc = 'tmdb'; }
        else if (t.code === 'en' && enOv) { overview = enOv; oSrc = enOvSrc; }
        out[t.code] = { title, overview, tSrc, oSrc };
    }

    // ③ Gemini — 제목이 없는 언어 ∪ (피벗 있으면) 줄거리가 없는 언어. 한 호출에 전부 얹는다.
    let geminiUsed = 0, geminiTried = false, geminiDead = false;
    for (let attempt = 0; attempt < 2; attempt++) {
        const need = TARGETS.filter((t) => !out[t.code].title || (pivot && !out[t.code].overview));
        if (!need.length) break;
        const g = await geminiMulti({
            srcTitle: origTitle,
            srcOverview: pivot?.text || '',
            srcOverviewLang: pivot?.langName || '',
            codes: need.map((t) => t.code),
            overviewMode: !!pivot,
        });
        geminiTried = true;
        // 응답이 통째로 비면 전면 장애(키 없음·API 오류·안전필터) — 미완으로 남겨 다음 실행이 재시도.
        if (!g || !Object.keys(g).length) { geminiDead = true; break; }
        let got = 0;
        for (const t of need) {
            const v = g[t.code];
            if (!v) continue;
            const cur = out[t.code];
            if (!cur.title) {
                const c = norm(v.title);
                if (validTitle(t.code, c, v.overview, pivot?.text)) { cur.title = c; cur.tSrc = 'gemini'; geminiUsed++; got++; }
            }
            if (pivot && !cur.overview) {
                const o = norm(v.overview);
                if (validOverview(t.code, o)) { cur.overview = o; cur.oSrc = 'gemini'; geminiUsed++; got++; }
            }
        }
        if (got === 0) break; // 진전 없으면 더 돌려도 무의미 — 마커 미완료로 남겨 다음 실행이 재시도
    }

    // ④ 제목 최후 폴백 — Gemini가 정상 응답했는데도 못 만든 언어는 검증된 영어 제목으로.
    //    원어 제목으로 채우면 절대 규칙 #7 위반 + 클라의 "빈 제목→영어 폴백" 보정 무력화라 영어만.
    //    전면 장애(geminiDead) 때는 적용 안 함 — 제대로 된 번역 기회를 지운다.
    const enT = out.en.title && !titleTainted('en', out.en.title) ? out.en.title : '';
    if (geminiTried && !geminiDead && enT) {
        for (const t of TARGETS) {
            if (!out[t.code].title) { out[t.code].title = enT; out[t.code].tSrc = 'en-fallback'; }
        }
    }

    // ⑤ 완료 판정 — 제목·줄거리 **둘 다** 본다(V1은 줄거리만 봐서 빈/오염 제목이 완료로 굳었다).
    const titlesDone = TARGETS.every((t) => out[t.code].title);
    const overviewsDone = !pivot || TARGETS.every((t) => out[t.code].overview); // 원본 없으면 빈 줄거리가 종착
    const metaNoTitle = !titlesDone && geminiTried && !geminiDead;              // 제목 영구 불가(빈 채 마감)
    const complete = titlesDone && overviewsDone && !!pivot;
    const done = overviewsDone && (titlesDone || metaNoTitle) && !geminiDead;

    // 검색 인덱스 — 번역 제목 접두 검색용(TMDB 검색은 번역 제목을 인덱싱하지 않음)
    const searchTitle = {}, searchLower = {};
    for (const t of TARGETS) {
        const ti = out[t.code].title;
        if (ti) { searchTitle[t.code] = ti; searchLower[t.code] = ti.toLowerCase(); }
    }

    // ⑥ 저장 — translations는 **전체 교체**(merge 아님: 과거 파이프라인의 쓰레기 필드까지 청소).
    //    단 Gemini 전면 장애(geminiDead) 때는 translations를 건드리지 않는다 — 이번 실행분이 대부분
    //    비어 있어, 교체하면 기존(불완전하나마 표시 가능한) 데이터를 빈 값으로 덮는다. 마커만
    //    metaTranslated=false로 남겨 다음 실행(cron runRetry 포함)이 온전히 다시 만든다.
    const batch = kcultureDb.batch();
    if (!geminiDead) {
        for (const t of TARGETS) {
            const v = out[t.code];
            batch.set(kcultureDb.doc(`titles/${id}/translations/${t.code}`), {
                title: v.title || '',
                overview: v.overview || '',
                source: `${v.tSrc || '-'}+${v.oSrc || '-'}`,   // 예: official+gemini · orig+tmdb · gemini+gemini
                translatedAt: new Date(),
            });
        }
    }
    batch.set(markerRef, geminiDead ? {
        // 장애 마킹만 — searchTitle·metaLangs 등 기존 값을 부분 결과로 덮지 않는다.
        media, metaTranslated: false, updatedAt: new Date(),
    } : {
        media,
        metaV: 2,                       // V2(한국어 피벗) 마커 — 스킵 게이트 기준
        metaTranslated: done,           // 부분실패는 false → cron runRetry가 자동 재시도
        metaComplete: complete,         // 전 언어 제목+줄거리 완비(감사/통계용)
        metaLangs: TARGETS.filter((t) => out[t.code].overview).map((t) => t.code),
        poster_path: detail.poster_path || md?.poster_path || null,
        searchTitle,
        searchLower,
        metaNoSource: !pivot,           // 줄거리 원본 자체가 없음(ko·en 모두) — 항상 기록해 복구도 자동
        metaNoTitle,                    // 제목 원본·번역 모두 불가 — 항상 기록해 복구도 자동
        updatedAt: new Date(),
    }, { merge: true });
    await batch.commit();

    // 신작(cron 유입)은 meta(출연·연도·평점…)가 없다 — 여기서 함께 채운다(middleware 연도 표기,
    // 상세 캐시 등이 쓴다). 실패는 무시 — 별도 meta 배치가 다음 기회에 처리.
    if (!md?.metaCachedAt) { try { await cacheTitleMeta(id, { media }); } catch { /* meta는 보조 */ } }

    return { id, skipped: false, langs: TARGETS.length, complete, geminiUsed };
}

// ── 열거·러너 (V1과 동일 동작 유지 — cron·연도 백필이 그대로 쓴다) ─────────────

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
    // partial = 일부 언어 누락(metaTranslated=false로 남음) → 재실행으로 메운다. 침묵 누락 방지 가시화.
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

// 부분 실패 재시도: metaTranslated=false 문서만 인덱스 쿼리로 집어 재처리(전체 스캔 아님 → 저비용).
// 단일필드 자동 인덱스라 복합인덱스 불필요. 미처리작(필드 없음)은 매칭 안 됨 → runIncremental 담당.
async function runRetry({ limit = 100, concurrency = 3 } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const snap = await kcultureDb.collection('titles')
        .where('metaTranslated', '==', false)
        .limit(limit)
        .get();
    const items = [];
    snap.forEach((d) => { const md = d.data()?.media; if (md) items.push({ media: md, id: d.id }); });
    const stat = { scanned: items.length, done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0 };
    await runPool(items, concurrency, async ({ media, id }) => {
        try { const r = await processTitle(media, id); if (r.skipped) stat.skipped++; else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; } }
        catch { stat.errors++; }
    });
    return stat;
}

// titleTainted·validTitle·validOverview: 러너/테스트가 같은 판정을 쓰도록 공개.
module.exports = {
    runBackfill, runIncremental, runRetry, processTitle, enumerateIds,
    TARGETS, titleTainted, validTitle, validOverview,
};
