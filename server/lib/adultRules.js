// ── 성인 에로물 판정 규칙 (단일 출처) ───────────────────────────────────────
// K-DramaAnyLang 전용. 두 소비자가 **같은 함수**를 쓴다:
//   ① scripts/flag-adult-titles.js  — 전체 카탈로그 수동 재판정(사람 검수 리포트 생성)
//   ② lib/tmdbBackfill.js processTitle — 신작 자동 판정(cron, 사전번역 앞단)
// ⚠ 규칙을 두 곳에 복제하지 말 것 — 갈라지면 같은 작품이 경로에 따라 다르게 판정된다
//   (`BOT_UA`·`itemPathOf`가 실제로 그렇게 어긋났던 전례).
//
// 왜 TMDB의 include_adult로 안 되는가 (2026-07-27 실측)
//   한국 소프트코어물 13편이 **전부 `adult:false`**였고 장르는 Romance/Drama/(없음)였다.
//   TMDB의 adult는 사실상 하드코어 포르노 전용이라 우리 카탈로그에는 무력하다.
//
// 이 모듈은 **순수 함수만** 담는다(네트워크·Firestore 없음). TMDB 조회가 필요한 쪽은
// classifyRemote에 fetch 함수를 주입한다 — 스크립트와 서버가 각자의 tmdb()를 쓰기 때문.
const path = require('path');
const fs = require('fs');

// ── 판정 기준 ───────────────────────────────────────────────────────────────
// ⚠ 키워드는 강·약으로 나눈다 (2026-07-27 전수 dry-run에서 오탐 발견)
//   초안은 erotic 계열을 전부 무조건 숨김으로 잡았는데, 그 결과 「아가씨」(vote 4401, 칸 초청작)
//   「하녀」(384) 「섬」(371) 「나쁜 남자」(306) 「사마리아」(267) 「뫼비우스」(265)가 전부 숨겨졌다.
//   `eroticism`은 **한국 예술영화에 흔히 붙는 주제 태그**라 성인물 판별에 쓸 수 없다.
//   반면 `softcore`는 실측상 정확도가 높다(vote 70·59·45짜리도 전부 실제 에로물).
//   → STRONG은 하한을 높게(100) 둬서 어지간한 평점수에도 숨기고,
//     WEAK은 일반 하한(10)을 적용해 상업 개봉작을 살린다.
const KW_STRONG = /^(softcore|sexploitation|pornograph)/i;          // 성인물 전용 태그 — 정확도 높음
const KW_WEAK = /^(erotic|erotica|erotic movie|nudity|sex film)/i;  // 예술영화에도 붙음 — 표본 조건 필수
const STRONG_FLOOR = 100;  // softcore인데 평점수 100 이상이면 사람 눈으로 확인(검수 목록에 남김)
const ADULT_CERTS = new Set(['18', '19', '19+', '청소년관람불가', 'R18', 'X']);
const VOTE_FLOOR = 10;     // 이 미만 = 상업 개봉작으로 보기 어려움(실측: 정상 개봉작 최소 267)

// ── 제목 어휘 — **자동 숨김에 쓰지 않는다. 검수 후보 추출 전용.** ────────────
// 배경: 「여대생: 스폰 찾기」처럼 TMDB에 키워드·등급·제작사·러닝타임이 **전부 비어 있는** 성인물이
//   R3(보류)로 빠져 검색에 노출됐다. 남은 신호는 제목뿐이다.
// 그런데 제목 매칭만으로 숨기면 오탐이 난다(실측):
//   「핑크퐁! 호기의 탐정사무소」·「공정사회」 ← '정사'가 부분문자열로 걸림(아래 lookbehind로 차단)
//   「원나잇 푸드트립: 원픽로드」 ← 정상 예능 / 「정사」(1998 이재용) ← 정상 개봉작
//   「Secret Garden」·「아내가 결혼했다」 ← 정상작
// → 적중분은 HTML 리포트 섹션으로만 올리고, 사람이 체크한 것만 adult-manual.json의 hide로 간다.
// 🚨 cron 자동 판정에서 이 어휘를 차단 근거로 쓰면 정상작이 대량으로 숨겨진다. 절대 금지.
// 2026-07-30 추가(사용자 지시): 가슴(기존 '가슴 큰'에서 확장) · 대물 · 은밀한.
//   ⚠ 이 셋은 정상작과 충돌한다 — 「대물」(2010 SBS)·「은밀하게 위대하게」(2013)·「가슴에 남는…」.
//   기존 카탈로그 1.8만 편에는 **적용되지 않는다**(수동 배치에서는 예나 지금이나 리포트 전용이고,
//   자동 게이트는 문서가 없는 신작에만 발화한다). 따라서 이미 등재된 그 작품들은 안전하다.
//   앞으로 들어오는 신작에서 오탐이 나면 adult-manual.json의 allow로 구제한다("1차 자동 제외 후
//   사람이 하나하나 판단"이라는 운영 방침).
const TITLE_LEX = /(노출|젖어|젖은|애무|(?<![탐공])정사(?!회)|섹스|야동|19금|스폰서?\s*찾|몸종|유부녀|새엄마|형수님|처제|시누이|올케|안마방|룸싸롱|색녀|음란|후배위|가슴|대물|은밀한|밤일|욕정|스와핑|불륜|외도|맨살|아랫도리|성인영화|에로)/;
const titleHit = (s) => (TITLE_LEX.exec(String(s || '')) || [])[0] || null;

const matchKw = (kws, re) => (kws || []).find((k) => re.test(String(k || '')));
// 성인 등급이 실제로 무엇이었는지 반환 — 사유 표기용(certs[0]을 쓰면 ['15','19'] 같은 경우
// "cert:15"로 잘못 찍혀 검수 때 혼란을 준다).
const adultCert = (certs) => (certs || []).map((c) => String(c).trim()).find((c) => ADULT_CERTS.has(c));

// 공통 판정 — 로컬(meta)·원격(TMDB) 양쪽이 같은 규칙을 쓰도록 한 곳에 모은다.
// certs를 못 구한 경로(로컬 선판정)는 null을 넘기면 등급 규칙은 건너뛴다.
// 반환: { verdict: 'hide'|'suspect', reason } 또는 null(판정 없음 = 유지)
// ignoreVotes: 평점 참여수 조건을 무시한다 — **신작 전용**(2026-07-30 사용자 결정).
//   R1-약·R2는 "표본이 없다(vote<10) = 상업 개봉작이 아니다"를 전제로 하는데, 신작은 정의상
//   vote가 0이라 그 전제가 성립하지 않는다(아직 아무도 안 봤으니까). 신작에서는 조건이 항상 참이라
//   있으나 마나이므로 명시적으로 끄고, 대신 오탐은 사람 검수(allow)로 구제한다.
//   ⚠ 구작(수동 전체 재판정)에는 절대 켜지 말 것 — 「씨받이」(KR 19, vote 267)류 정상 성인영화가
//     전부 숨겨진다. vote 조건이 그것들을 살리는 유일한 축이다.
function decideBy(kws, certs, votes, { ignoreVotes = false } = {}) {
    const lt = (floor) => ignoreVotes || votes < floor;
    const strong = matchKw(kws, KW_STRONG);
    if (strong && lt(STRONG_FLOOR)) return { verdict: 'hide', reason: `kw:${strong}+vote${votes}` };
    const weak = matchKw(kws, KW_WEAK);
    if (weak && lt(VOTE_FLOOR)) return { verdict: 'hide', reason: `kw:${weak}+vote${votes}` };
    if (certs) {
        const c = adultCert(certs);
        if (c && lt(VOTE_FLOOR)) return { verdict: 'hide', reason: `cert:${c}+vote${votes}` };
        if (!certs.length && lt(3)) return { verdict: 'suspect', reason: `no-cert+vote${votes}` };
    }
    return null;
}

// TMDB 상세 응답에서 판정 신호 추출. append_to_response에 keywords + 등급이 있어야 한다:
//   movie → 'keywords,release_dates' · tv → 'keywords,content_ratings'
// 없으면 kws/certs가 빈 배열이 되어 R1·R2가 모두 불발한다(= 유지). 조용히 통과하므로
// 호출측이 append를 빠뜨리지 않는 게 중요하다.
function extractSignals(media, detail) {
    const d = detail || {};
    const kws = (d.keywords?.keywords || d.keywords?.results || []).map((k) => String(k?.name || '')).filter(Boolean);
    let certs = [];
    if (media === 'movie') {
        const kr = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'KR');
        certs = (kr?.release_dates || []).map((x) => x.certification).filter(Boolean);
    } else {
        const cr = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'KR');
        if (cr?.rating) certs = [cr.rating];
    }
    return { kws, certs: [...new Set(certs)], votes: Number(d.vote_count || 0) };
}

// 이미 받아 둔 상세로 판정(추가 TMDB 호출 0). cron 자동 판정이 쓰는 경로.
//   ⚠ hide만 자동 반영한다. 'suspect'(등급·표본 없음)는 **자동으로 숨기지 않는다** —
//     전수의 절반 가까이가 여기 걸리고 대부분 무명 독립영화·다큐다(정밀도 우선).
function judgeDetail(media, detail) {
    const sig = extractSignals(media, detail);
    const d = decideBy(sig.kws, sig.certs, sig.votes);
    return { hide: d?.verdict === 'hide', verdict: d?.verdict || 'keep', reason: d?.reason || '', ...sig };
}

// ── 신작 게이트 정책 (2026-07-30) ───────────────────────────────────────────
// cron이 **문서를 새로 만들기 직전**에 부른다. 여기서 hide면 사전번역(Gemini 11개 언어)을 아예
// 하지 않고 hidden=true로 문서만 만든다 — 비용을 쓰지 않고 노출도 0.
//
// 운영 방침: **1차로 자동 제외하고, 사람이 나중에 하나하나 판단한다.**
//   그래서 구작(수동 재판정)보다 공격적이다 — 오탐은 노출 사고가 아니라 "검수 대기"일 뿐이고,
//   구제는 adult-manual.json의 allow 한 줄이면 된다. 반대로 놓친 성인물은 스토어 심사 리스크다.
//
// 판정 순서(위에서 걸리면 종료):
//   ① manual.allow  — 사람 판정이 규칙보다 항상 우선. 무조건 노출.
//   ② manual.hide   — 사람이 지정한 성인물.
//   ③ video:true    — TMDB의 direct-to-video 플래그. **전량 숨김**(사용자 결정).
//        discover는 include_video 기본값이 false라 이 작품군을 응답에서 통째로 빼왔고, 그래서
//        우리 카탈로그에 한 번도 들어온 적이 없다(「의자매 섹스 스캔들」 1015975가 그 사례).
//        한국 소프트코어 에로물이 사는 자리가 정확히 여기다 → 열거는 켜되(include_video=true)
//        판정 없이 일단 전부 감춘다. 정상 단편·다큐가 섞이면 검수에서 allow로 올린다.
//   ④ 제목 어휘     — 키워드·등급이 텅 빈 성인물의 유일한 신호(메타데이터 없는 저품질 엔트리).
//   ⑤ R1·R2 규칙    — vote 조건 제외(ignoreVotes)로 적용.
// 'suspect'는 자동 숨김하지 않는다(전수의 절반이 여기 걸린다 — 무명 독립영화·다큐).
function judgeNewTitle(media, detail, { manual, allTitles = '' } = {}) {
    const id = String(detail?.id ?? '');
    const man = manual || { hide: new Set(), allow: new Set() };
    if (man.allow.has(id)) return { hide: false, reason: 'manual:allow' };
    if (man.hide.has(id)) return { hide: true, reason: 'manual:hide' };
    if (detail?.video === true) return { hide: true, reason: 'video:direct' };

    const names = [allTitles, detail?.original_title, detail?.original_name, detail?.title, detail?.name]
        .filter(Boolean).join(' ');
    const hit = titleHit(names);
    if (hit) return { hide: true, reason: `title:${hit}` };

    const sig = extractSignals(media, detail);
    const d = decideBy(sig.kws, sig.certs, sig.votes, { ignoreVotes: true });
    if (d?.verdict === 'hide') return { hide: true, reason: d.reason };
    return { hide: false, reason: d?.reason || '' };
}

// TMDB를 직접 조회해 판정(등급 확인 필요할 때). tmdbFn(path, params) → json 을 주입받는다.
async function classifyRemote(media, id, tmdbFn) {
    const append = media === 'movie' ? 'keywords,release_dates' : 'keywords,content_ratings';
    const d = await tmdbFn(`/${media}/${id}`, { language: 'en-US', append_to_response: append });
    const sig = extractSignals(media, d);
    const info = {
        title: d.title || d.name || '',
        year: String(d.release_date || d.first_air_date || '').slice(0, 4),
        overview: d.overview || '',
        votes: sig.votes, certs: sig.certs, kws: sig.kws,
    };
    const d2 = decideBy(sig.kws, sig.certs, sig.votes);
    return d2 ? { ...d2, info } : { verdict: 'keep', reason: '', info };
}

// ── 수동 보정 — 규칙보다 **항상 우선** ──────────────────────────────────────
// scripts/adult-manual.json { hide: ["123"], allow: ["456"] }
//   allow = 규칙이 걸었지만 사람이 정상작으로 판정(오탐 구제) · hide = 규칙이 놓친 성인물
// ⚠ 이 파일이 없거나 못 읽히면 **빈 Set으로 폴백**한다. 그 상태로 자동 판정이 돌면 사람이
//   구제해 둔 작품이 다시 숨겨지므로, 서버에서는 로드 실패를 경고로 남긴다.
const MANUAL_FILE = path.join(__dirname, '..', 'scripts', 'adult-manual.json');
function loadManual(file = MANUAL_FILE) {
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { hide: new Set((j.hide || []).map(String)), allow: new Set((j.allow || []).map(String)) };
    } catch { return { hide: new Set(), allow: new Set() }; }
}

module.exports = {
    KW_STRONG, KW_WEAK, STRONG_FLOOR, ADULT_CERTS, VOTE_FLOOR, TITLE_LEX,
    titleHit, matchKw, adultCert, decideBy, extractSignals, judgeDetail, judgeNewTitle, classifyRemote,
    loadManual, MANUAL_FILE,
};
