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
// 신작 성인물 자동 판정 — 규칙은 scripts/flag-adult-titles.js와 **같은 모듈을 공유**한다(복제 금지).
const adultRules = require('./adultRules');
// 규칙이 못 잡는 완곡어 제목을 문맥으로 판정(신작 전용, 작품당 1회). 실패 시 규칙 결과 유지.
const { judgeAdultAI } = require('./adultJudge');

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
function validOverview(code, s, srcLen = Infinity) {
    const t = norm(s);
    // 최소 길이 5 — 10으로 잡았다가 실패 사례(2026-07-28): 원문 줄거리가 한 문장인 작품의 중국어
    // 번역("真的，真的恭喜你" 8자)이 거부돼 영구 partial이 됐다. CJK는 라틴계보다 밀도가 높다.
    if (!t || t.length < 5) return false;
    // 한글 잔류 — **미세 잔류는 허용**(2026-07-29). 전부 거부로 잡았더니 인명 하나("유리博士")가
    // 한글로 남은 99% 정상 번역이 통째로 거부돼 영구 partial 루프가 됐다(122871 터닝메카드 실측).
    // 짧고 노출이 큰 제목은 계속 전면 금지지만, 줄거리의 고유명사 몇 글자는 공식 en 원문의
    // 괄호 한글과 같은 급으로 취급한다. 실질 미번역(한글 다량)만 거른다.
    if (PRIMARY_SCRIPT && baseLang(code) !== baseLang(PRIMARY_CONTENT_LANG)) {
        const h = (t.match(new RegExp(PRIMARY_SCRIPT.source, 'g')) || []).length;
        if (h > 15 || h > t.length * 0.2) return false;
    }
    // 문자 체계 기대치는 **출력·원문 둘 다 40자 이상일 때만** 적용(2026-07-29).
    //   · 출력<40: "ITZY VLOG"류 라틴 고유명사 번역은 ja/ru에서도 라틴 그대로가 정답
    //     (136513 실측 — 누락 언어가 정확히 SCRIPT_RE 대상 4개였다)
    //   · 원문<40: "엔하이픈 컴백쇼 DIMENSION : DILEMMA 사전녹화!"(28자)처럼 고유명사가 지배하는
    //     짧은 원문은 출력이 40자를 넘어도 대부분 라틴이라 검사가 성립하지 않는다(137854 실측)
    //   긴 원문→긴 출력의 영어 에코(진짜 미번역)는 여전히 걸린다.
    const re = SCRIPT_RE[code];
    if (re && t.length >= 40 && srcLen >= 40 && !re.test(t)) return false;
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
            // 2026-07-29 추가 — 인명 하나를 한글로 남기는 사례 실측("유리博士") → 줄거리에도 음역 지시.
            `- Transliterate ALL proper nouns (person names, group names, show titles) into the target script or romanization — never leave ${nameOf(PRIMARY_CONTENT_LANG)} characters inside an overview.`,
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
    // 숨김 작품은 번역하지 않는다 (2026-07-31 — 게이트 도입 다음날 발견한 구멍).
    //   숨김 문서는 metaTranslated:false로 남는데 그게 정확히 runRetry의 재시도 조건이라,
    //   다음 cron이 숨긴 성인물에 11개 언어 번역을 채우고 있었다(45건 중 18건 실측 — merge:true
    //   덕에 hidden은 유지돼 노출 사고는 없었지만 "숨김 = 번역 비용 0" 설계가 깨진다).
    //   구제 경로는 그대로다: allow 반영 시 hidden=false가 되므로 이 가드를 통과해 runRetry가 채운다.
    //   force여도 건너뛴다 — 숨김 문서를 번역할 정당한 경우가 없다(구제가 먼저다).
    if (md?.hidden === true) return { id, skipped: true, hiddenSkip: true, langs: 0, geminiUsed: 0 };
    // 스킵 게이트 — V2 마커 기준. V1 문서(metaV 없음)는 전부 재처리 대상(카탈로그 재구축의 핵심).
    if (!force && md?.metaV === 2 && md.metaTranslated) return { id, skipped: true, langs: 0, geminiUsed: 0 };

    // ① 소스 확보 — 원어 기준 상세 + 공식 번역 레코드
    //   keywords + 한국 등급(movie=release_dates / tv=content_ratings)을 같은 호출에 얹는다 —
    //   아래 성인물 게이트가 쓰는 신호이고, append이므로 **TMDB 호출 수는 그대로 1회**다.
    //   ⚠ 이 append를 지우면 게이트가 조용히 무력화된다(kws·certs가 빈 배열 → 규칙 불발 = 통과).
    const detail = await tmdb(`/${media}/${id}`, {
        language: toTmdbLang(PRIMARY_CONTENT_LANG),
        append_to_response: `translations,keywords,${media === 'movie' ? 'release_dates' : 'content_ratings'}`,
    });
    const trs = detail.translations?.translations || [];
    const origTitle = norm(detail.original_title || detail.original_name);

    // ①-b 성인물 자동 판정 게이트 (2026-07-30) ────────────────────────────────
    // **사전번역보다 앞에 둔다** — 성인물에 Gemini 11개 언어 번역 비용을 쓰지 않기 위해서다.
    //   이 게이트가 없던 동안 신작 성인물은 번역까지 다 되고 앱·sitemap에 노출됐다.
    //
    // 대상은 **신작(문서가 아직 없는 작품)뿐**이다 — 기존 카탈로그 재판정은 수동 배치
    // (scripts/flag-adult-titles.js)의 일이다. 자동이 기존 1.8만 편을 건드리면 사람이 검수해
    // 유지 결정한 작품까지 규칙으로 덮을 수 있다.
    //
    // 삭제가 아니라 **숨김**이다. 오탐이면 플래그만 내리면 복구되고, 문서를 metaTranslated=false로
    // 남기므로 구제(allow) 후 다음 cron runRetry가 11개 언어를 자동으로 채운다.
    //
    // 판정 정책(2026-07-31): 사람 판정(manual) 제외 전부 **Gemini 단일 판정** — 규칙·어휘는
    // 적확도가 낮아 게이트에서 뺐다(Gemini 호출 실패 시 비상 폴백으로만). adultRules.judgeNewTitle 주석 참조.
    if (!md) {
        const j = adultRules.judgeNewTitle(media, detail, {
            manual: adultRules.loadManual(),
            allTitles: [origTitle, detail.title, detail.name].filter(Boolean).join(' '),
        });
        let ai = null;
        if (j.ai) {
            ai = await judgeAdultAI(media, detail, { koTitle: origTitle });
            if (ai?.verdict === 'adult') {
                // **명백한 성인물만 숨긴다**(2026-07-30 사용자 결정). 애매하면 노출이 기본값 —
                // 중간 등급을 두면 메타가 빈 정상 작품이 그 칸에 쌓여 사실상 숨김이 되기 때문.
                j.hide = true;
                j.reason = `ai:adult(${ai.confidence.toFixed(2)})`;
                j.by = 'auto:ai';
            } else if (!ai && j.suspect) {
                // Gemini 호출 자체가 실패(재시도+폴백 모델까지 전부) — 판정자가 부재중이다.
                // 규칙·어휘가 의심 신호를 낸 작품만 보수적으로 숨겨 검수 대기로 보낸다.
                // "AI를 못 불렀다"를 "노출해도 된다"로 해석하지 않기 위한 비상 잠금장치.
                j.hide = true;
                j.reason = `fallback:${j.suspect}`;
                j.by = 'auto:cron';
            }
        }
        if (j.hide) {
            const reason = j.reason;
            await markerRef.set({
                media,
                hidden: true,
                hiddenReason: reason,
                // 사람 미검수 큐 마커 — apply-adult-verdicts가 'manual'로 바꾼다.
                //   auto:ai(문맥 판정) / auto:cron(규칙·수동목록)
                hiddenBy: j.by || 'auto:cron',
                isVideo: detail.video === true,   // 유통 형태 기록(차단 근거는 아님 — 판정 힌트·감사용)
                // AI 판정 결과를 그대로 남긴다 — 재실행 시 재호출을 막고(멱등), 검수 화면이
                // "왜 숨겼는지"를 사람 말로 보여줄 수 있다.
                ...(ai ? { adultAI: { ...ai, model: 'gemini', at: new Date() } } : {}),
                metaTranslated: false,        // 구제되면 runRetry가 자동으로 번역을 채운다
                poster_path: detail.poster_path || null,
                // 원제만 남긴다 — 번역을 하지 않았으므로 검색 인덱스도 만들지 않는다.
                ...(origTitle ? { searchTitle: { [PRIMARY_CODE]: origTitle } } : {}),
                updatedAt: new Date(),
            }, { merge: true });
            console.log(`[tmdb-backfill] 🚫 자동 숨김 ${media}/${id} 「${origTitle || detail.title || detail.name || ''}」 ${reason}`);
            return { id, skipped: true, adultHidden: true, reason, langs: 0, geminiUsed: 0 };
        }
    }

    // 카탈로그 전제(2026-07-28 재정비): 원제 보유작만 남겼다. 원제가 없으면 침묵 생성하지 말고 드러낸다.
    if (!origTitle) throw new Error(`원제 없음 — ${media}/${id}`);

    // ko 줄거리 — 원어 요청 응답 → 없으면 translations 원어 레코드. **원어 문자가 없으면 불신**
    // (ko 자리에 영어가 박힌 오염 레코드 실재 → 그런 건 소스로 쓰지 않고 en 피벗으로 넘어간다).
    const koRec = tmdbRecord(trs, TARGETS.find((t) => t.code === PRIMARY_CODE));
    let koOv = norm(detail.overview) || norm(koRec?.overview);
    if (koOv && PRIMARY_SCRIPT && !PRIMARY_SCRIPT.test(koOv)) koOv = '';
    if (koOv.length < 5) koOv = ''; // 쓰레기 소스 차단 — 아래 en과 동일 사유

    // en 줄거리 — TMDB 공식(사람 작성) 우선, 없으면 기존 저장분(과거 Gemini 생성 포함) 재사용.
    const enRec = tmdbRecord(trs, TARGETS.find((t) => t.code === 'en'));
    let enOv = norm(enRec?.overview);
    if (enOv.length < 5) enOv = ''; // TMDB en 레코드에 "."(1자)만 있는 쓰레기 실재(44615) —
                                    // 피벗으로 삼으면 11개 언어 번역이 전부 실패해 영구 partial이 된다
    let enOvSrc = enOv ? 'tmdb' : null;
    if (!enOv) {
        try {
            const s = await kcultureDb.doc(`titles/${id}/translations/en`).get();
            const prev = s.exists ? norm(s.data()?.overview) : '';
            if (prev.length >= 5 && !PRIMARY_SCRIPT?.test(prev)) { enOv = prev; enOvSrc = 'cache'; }
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
                if (validOverview(t.code, o, pivot.text.length)) { cur.overview = o; cur.oSrc = 'gemini'; geminiUsed++; got++; }
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
        // 제목 출처 맵 + 갱신 대기 플래그 — refreshOfficialTitles가 이 두 필드만 보고 대상을 고른다.
        // TMDB는 신작의 언어별 공식 제목을 **방영 후에 뒤늦게 채운다**. 그때 우리 Gemini 제목을
        // 공식 제목으로 갈아끼우기 위한 것이고, 이 맵이 없으면 대상을 찾으려 매번 11개 서브문서를
        // 다 읽어야 한다(작품당 11 read × 1.8만 = 20만 read).
        metaTitleSrc: Object.fromEntries(TARGETS.map((t) => [t.code, out[t.code].tSrc || '-'])),
        metaOfficialPending: TARGETS.some((t) => t.code !== PRIMARY_CODE && out[t.code].tSrc !== 'official'),
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
                // ⚠ include_video (2026-07-30) — TMDB discover의 기본값은 false이고, 그러면
                //   `video:true`(direct-to-video) 작품이 응답에서 통째로 빠진다. 한국 소프트코어
                //   에로물이 정확히 그 자리에 있어서 **판정 대상조차 되지 못했다**
                //   (1015975 「의자매 섹스 스캔들」: original_language=ko·KR 19+인데 카탈로그 밖).
                //   실측 2019~2026 한국영화 6,177 → 6,629건(+452, 6.8%)이 이 플래그로 가려져 있었다.
                //   → 열거는 켜고, 유입분은 게이트의 Gemini 판정이 성인물만 가려 숨긴다
                //     (전량 숨김은 K-pop 공연물 645편 오탐으로 철회 — adultRules.judgeNewTitle 주석).
                include_video: 'true',
                [`${dateField}.gte`]: `${y}-01-01`, [`${dateField}.lte`]: `${y}-12-31`, page: String(page),
            });
            totalPages = Math.min(d.total_pages || 1, 500);
            // name: 연도별 러너(backfill-by-year.js) 로그 표시용 — runBackfill은 id만 사용(무해 additive)
            // 모수 조건(2026-07-30): original_language=PRIMARY_CONTENT_LANG(discover 파라미터) +
            //   **원제 있음**. 원제 없는 엔트리는 processTitle이 어차피 throw하므로 여기서 거른다.
            for (const it of (d.results || [])) {
                if (!norm(it.original_title || it.original_name)) continue;
                yield { id: it.id, name: it.name || it.title || '' };
            }
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
    // adultHidden = 신작 성인물 자동 숨김(게이트 적중). 0이 아니면 호출측이 숨김 인덱스를 재생성한다.
    const stat = { done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0, adultHidden: 0 };
    for (const m of medias) {
        const ids = [];
        for await (const it of enumerateIds(m, yearFrom, yearTo)) ids.push(it);
        const capped = ids.slice(0, limit === Infinity ? ids.length : limit);
        await runPool(capped, concurrency, async ({ id }, i) => {
            try {
                const r = await processTitle(m, id, { force });
                if (r.skipped) { stat.skipped++; if (r.adultHidden) stat.adultHidden++; }
                else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; }
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
                include_video: 'true',   // enumerateIds와 동일 사유 — direct-to-video 누락 방지
                [`${dateField}.gte`]: since, page: String(page),
            });
            totalPages = Math.min(d.total_pages || 1, 5);
            // 모수: original_language=ko(위 파라미터) + 원제 있음
            for (const it of (d.results || [])) {
                if (!norm(it.original_title || it.original_name)) continue;
                items.push({ media, id: it.id });
            }
            page++;
        } while (page <= totalPages && items.length < maxTitles);
    }
    const capped = items.slice(0, maxTitles);
    const stat = { scanned: capped.length, done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0, adultHidden: 0 };
    await runPool(capped, concurrency, async ({ media, id }) => {
        try {
            const r = await processTitle(media, id);
            if (r.skipped) { stat.skipped++; if (r.adultHidden) stat.adultHidden++; }
            else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; }
        } catch { stat.errors++; }
    });
    return stat;
}

// ── 공식 제목 뒤늦은 반영 (A안, 2026-07-29) ─────────────────────────────────
// TMDB는 신작의 **언어별 공식 제목을 방영 후에 뒤늦게 채운다.** 우리는 그때까지 없는 언어를
// 원제→Gemini로 만들어 두는데, 나중에 공식 제목이 등록되면 그걸로 갈아끼워야 한다.
// 예: 「오싹한 연애」(2026, 298610)의 ja·id가 현재 우리 생성분 — TMDB에 아직 없어서.
//
// ⚠ **processTitle로는 안 된다.** 그 함수는 metaV=2 + 전 언어 완비면 skip한다(정상 동작).
//   실제로 298610은 discover가 물어와도 skip돼 제목이 영원히 갱신되지 않는다.
//   그래서 제목만 손대는 별도 경로가 필요하다 — Gemini는 부르지 않는다.
//
// 비용: 루트 스캔 1회(필드 마스크, 1.8만 read ≈ $0.011) + 대상당 TMDB 1회. Gemini 0.
//   서브문서는 **실제로 교체되는 언어만** 읽고 쓴다(대개 0~2개).
//
// 대상 선정: 최근 days 이내 방영·개봉 + 방영 중(Returning Series/In Production)
//   구작은 제외한다 — 표본 실측(2026-07-29) 결과 우리 제목의 83%는 TMDB에 그 언어가 아예 없고,
//   수년 지난 마이너 한국 작품의 번역이 새로 채워질 가능성은 낮다. 신작에만 실효가 있다.
async function refreshOfficialTitles({ days = 400, maxTitles = 300, concurrency = 6, dry = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음');
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const AIRING = new Set(['Returning Series', 'In Production', 'Planned', 'Post Production']);

    const snap = await kcultureDb.collection('titles')
        .select('media', 'searchTitle', 'searchLower', 'metaOfficialPending', 'titleCheckedAt',
            'meta.first_air_date', 'meta.release_date', 'meta.status')
        .get();

    const cand = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        if (x.media !== 'tv' && x.media !== 'movie') return;
        // 이미 전 언어가 공식이면 볼 것이 없다. 필드가 없는 구(舊) 문서는 판정 불가 → 대상에 포함.
        if (x.metaOfficialPending === false) return;
        const date = (x.meta?.first_air_date || x.meta?.release_date || '');
        if (!(date >= since || AIRING.has(x.meta?.status))) return;
        cand.push({
            id: d.id, media: x.media, st: x.searchTitle || {}, sl: x.searchLower || {},
            // 오래 안 본 것부터 — 매 실행이 같은 앞자리만 반복하지 않게 회전시킨다.
            at: x.titleCheckedAt?.toMillis?.() || 0,
        });
    });
    cand.sort((a, b) => a.at - b.at);
    const capped = cand.slice(0, maxTitles);

    const stat = { candidates: cand.length, scanned: capped.length, upgraded: 0, langs: 0, errors: 0, changes: [] };
    let idx = 0;
    async function worker() {
        while (idx < capped.length) {
            const p = capped[idx++];
            try {
                const detail = await tmdb(`/${p.media}/${p.id}`, { language: 'en-US', append_to_response: 'translations' });
                const trs = detail.translations?.translations || [];
                const koOv = null; // validTitle의 줄거리 접두 검사용 — 여기선 제목만 보므로 생략
                const ups = [];    // [{code, title}]
                let pending = false;
                for (const t of TARGETS) {
                    if (t.code === PRIMARY_CODE) continue;      // 원제는 갱신 대상이 아니다
                    const rec = tmdbRecord(trs, t);
                    const cand2 = norm(rec?.title || rec?.name || '');
                    const ours = norm(p.st[t.code] || '');
                    if (!cand2 || !validTitle(t.code, cand2, rec?.overview, koOv)) { pending = true; continue; }
                    if (cand2 !== ours) ups.push({ code: t.code, title: cand2 });
                }
                if (!dry && ups.length) {
                    // 교체되는 언어의 기존 source만 읽어 줄거리 출처(oSrc)를 보존한다.
                    const refs = ups.map((u) => kcultureDb.doc(`titles/${p.id}/translations/${u.code}`));
                    const cur = await kcultureDb.getAll(...refs);
                    const batch = kcultureDb.batch();
                    const st = {}, sl = {}, tsrc = {};
                    ups.forEach((u, k) => {
                        const oSrc = String(cur[k]?.data()?.source || '-').split('+')[1] || '-';
                        batch.set(refs[k], { title: u.title, source: `official+${oSrc}`, titleRefreshedAt: new Date() }, { merge: true });
                        st[u.code] = u.title; sl[u.code] = u.title.toLowerCase(); tsrc[u.code] = 'official';
                    });
                    batch.set(kcultureDb.doc(`titles/${p.id}`), {
                        searchTitle: st, searchLower: sl, metaTitleSrc: tsrc,   // merge:true → 맵 키 병합
                        metaOfficialPending: pending, titleCheckedAt: new Date(),
                    }, { merge: true });
                    await batch.commit();
                } else if (!dry) {
                    // 바뀐 게 없어도 확인 시각·pending은 남긴다(회전 + 다음 실행 대상 축소).
                    await kcultureDb.doc(`titles/${p.id}`).set(
                        { metaOfficialPending: pending, titleCheckedAt: new Date() }, { merge: true },
                    );
                }
                if (ups.length) {
                    stat.upgraded++; stat.langs += ups.length;
                    if (stat.changes.length < 20) {
                        stat.changes.push(`${p.id}: ${ups.map((u) => `${u.code}="${u.title}"`).join(' ')}`);
                    }
                }
            } catch (e) {
                stat.errors++;
                if (stat.errors <= 3) console.warn(`[refreshOfficialTitles] ${p.id}: ${e.message}`);
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return stat;
}

// 부분 실패 재시도: metaTranslated=false 문서만 인덱스 쿼리로 집어 재처리(전체 스캔 아님 → 저비용).
// 단일필드 자동 인덱스라 복합인덱스 불필요. 미처리작(필드 없음)은 매칭 안 됨 → runIncremental 담당.
async function runRetry({ limit = 100, concurrency = 3 } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    // select — media·hidden만 받는다(마스크 없으면 문서 전문이 내려와 이그레스 낭비).
    const snap = await kcultureDb.collection('titles')
        .where('metaTranslated', '==', false)
        .select('media', 'hidden')
        .limit(limit)
        .get();
    const items = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        // 숨김 작품 제외 — metaTranslated:false로 남는 게 숨김의 정상 상태라 매 실행 큐에 잡힌다.
        // processTitle에도 가드가 있지만, 여기서 걸러야 limit(재시도 예산)을 잡아먹지 않는다.
        if (x.hidden === true) return;
        if (x.media) items.push({ media: x.media, id: d.id });
    });
    const stat = { scanned: items.length, done: 0, partial: 0, skipped: 0, gemini: 0, errors: 0, adultHidden: 0 };
    await runPool(items, concurrency, async ({ media, id }) => {
        try {
            const r = await processTitle(media, id);
            if (r.skipped) { stat.skipped++; if (r.adultHidden) stat.adultHidden++; }
            else { stat.done++; stat.gemini += r.geminiUsed; if (!r.complete) stat.partial++; }
        } catch { stat.errors++; }
    });
    return stat;
}

// titleTainted·validTitle·validOverview: 러너/테스트가 같은 판정을 쓰도록 공개.
module.exports = {
    runBackfill, runIncremental, runRetry, refreshOfficialTitles, processTitle, enumerateIds,
    TARGETS, titleTainted, validTitle, validOverview,
};
