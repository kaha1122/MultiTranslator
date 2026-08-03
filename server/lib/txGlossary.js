// ── UGC 번역 품질용 "최근 방영작" 용어집 (K-DramaAnyLang 전용, 2026-08-04) ────
// /api/community/translate 프롬프트에 주입할 고유명사 확정 표기를 만든다.
//
// 왜 필요한가 (2026-08-03 사용자 결정 — 김부장 "Chef Kim" 사고)
//   라운지·EN 토글(compose) 글은 작품 컨텍스트가 원천적으로 없어(라운지: 작품 특정 불가,
//   compose: cachePath 미전송) Gemini가 「김부장」을 임의 번역했다. 최근 화제작의 공식 제목은
//   titles/{id}.searchTitle에 12개 언어로 이미 저장돼 있으므로, 그걸 프롬프트에 못박아준다.
//
// 설계 — 상시 주입이 아니라 **매칭 게이트 주입**:
//   서버가 원문 텍스트를 쥐고 있으므로, 12개 언어 제목·배우명과 문자열 대조해 **실제로 등장하는
//   항목만** 주입한다. 프롬프트가 짧게 유지되고("아파트" 같은 일반명사 제목이 상시 노출되는 위험 억제),
//   "이 글에 실제로 있다"를 서버가 확인했으므로 지시를 훨씬 강하게 쓸 수 있다.
//
// 풀(pool) = curation_threads 최근 30일(= Dari On-Air가 다룬 현재 방영작, 실측 ~12편).
//   구작·미커버 작품은 여기 안 걸린다 — 단 작품 상세에 달린 글(코멘트·평가)은 cachePath로 작품이
//   특정되므로 routes/community.js의 buildTranslationContext가 그 작품의 캐스트 표를 별도 주입한다
//   (castContextLines — 풀과 무관하게 모든 작품에 작동).
//
// 배우명 확정 표기는 personNames.js(앱 크레딧 표시용과 같은 모듈)를 재사용 —
//   번역문 속 배우 표기가 앱 크레딧 화면 표기와 자동으로 일치한다.
//
// 실패는 전부 fail-open(용어집 없이 번역 — 번역 자체를 막지 않는다). hiddenTitles.js와 같은
// SWR 캐시 패턴: TTL 만료여도 현재 데이터로 즉시 응답하고 뒤에서 갱신.
const { kcultureDb } = require('../config/firebaseKculture');
const { fetchPersonLite, pickPersonName, romanizeKorean } = require('./personNames');

const TTL = 6 * 60 * 60 * 1000;      // 6시간 — 풀 소스(curation_threads)는 하루 1~2건 변동
const POOL_DAYS = 30;                 // "최근 방영작"의 정의(사용자 결정)
const MAX_SHOWS = 20;                 // 폭주 방지(실측 12편)
const CAST_PER_SHOW = 8;              // 매칭 대상 배우 수(주연급)
const HANGUL_RE = /\p{Script=Hangul}/u;

let shows = [];                       // [{ id, titles:{lang:title}, aliases:[{k(소문자), d(표시형)}], cast:[{pid,name,character}] }]
let loadedAt = 0;
let inflight = null;

// ── 적재 — curation_threads 1쿼리 + titles getAll(필드 마스크) ────────────────
async function load() {
    if (!kcultureDb) return shows;
    const t0 = Date.now();
    const since = new Date(Date.now() - POOL_DAYS * 86400000);
    const snap = await kcultureDb.collection('curation_threads')
        .orderBy('createdAt', 'desc').limit(60).get();
    const ids = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        const at = x.createdAt?.toDate?.() || null;
        const tid = String(x.titleId || '');
        if (tid && at && at >= since && !ids.includes(tid)) ids.push(tid);
    });
    const pick = ids.slice(0, MAX_SHOWS);
    if (!pick.length) { shows = []; loadedAt = Date.now(); return shows; }

    // 문서 통읽기 금지 — meta는 수십 KB(김부장 실측 15KB). 필요한 3필드만.
    const refs = pick.map((id) => kcultureDb.doc(`titles/${id}`));
    const docs = await kcultureDb.getAll(...refs, { fieldMask: ['searchTitle', 'searchLower', 'meta.credits.cast'] });
    const next = [];
    for (const d of docs) {
        if (!d.exists) continue;
        const x = d.data() || {};
        const titles = x.searchTitle || {};
        const lowers = x.searchLower || {};
        // 별칭 = 12개 언어 제목(소문자) dedup. 표시형은 원 케이스 유지(프롬프트에 그대로 인용).
        const seen = new Set();
        const aliases = [];
        for (const [lang, low] of Object.entries(lowers)) {
            const k = String(low || '').trim().toLowerCase();
            if (!k || seen.has(k)) continue;
            // 너무 짧은 별칭은 오매칭 소음 — 한글 2자·기타 4자 미만 제외("동궁"은 통과, "IU"류 차단)
            if (HANGUL_RE.test(k) ? k.length < 2 : k.length < 4) continue;
            seen.add(k);
            aliases.push({ k, d: titles[lang] || low });
        }
        next.push({
            id: d.id,
            titles,
            aliases,
            cast: (x.meta?.credits?.cast || []).slice(0, CAST_PER_SHOW)
                .filter((c) => c?.id && c?.name)
                .map((c) => ({ pid: c.id, name: c.name, character: c.character || '' })),
        });
    }
    shows = next;
    loadedAt = Date.now();
    // 인물 표기 선워밍(fire-and-forget) — 매칭 시 fetchPersonLite가 7일 메모 HIT하도록
    prewarmPersons(next).catch(() => { /* best-effort */ });
    console.log(`[txGlossary] ${shows.length}편 로드 (스레드 ${ids.length}작품/30일, ${Date.now() - t0}ms)`);
    return shows;
}

async function prewarmPersons(list) {
    const pids = [...new Set(list.flatMap((s) => s.cast.map((c) => c.pid)))];
    for (let i = 0; i < pids.length; i += 8) {
        await Promise.all(pids.slice(i, i + 8).map((pid) => fetchPersonLite(pid)));
    }
}

// 백그라운드 갱신 — 만료여도 현재 데이터로 즉시 응답(요청 지연 0). 최초 1회만 대기.
async function ready() {
    if (loadedAt) {
        if (Date.now() - loadedAt >= TTL && !inflight) {
            inflight = load().catch((e) => console.warn('[txGlossary] 갱신 실패(직전 풀 유지):', e.message))
                .finally(() => { inflight = null; });
        }
        return;
    }
    if (!inflight) {
        inflight = load().catch((e) => console.warn('[txGlossary] 초기 로드 실패(용어집 미적용):', e.message))
            .finally(() => { inflight = null; });
    }
    await inflight;
}

// ── 매칭 — 원문에 실제로 등장하는 제목·배우만 추출 (순수 인메모리, ~0ms) ──────
// anchoredTitleId: cachePath로 특정된 작품 — 그 작품은 컨텍스트(캐스트 표)가 따로 주입되므로 제외.
// 2자 한글 배우명(지성·하니류)은 일반명사와 겹치기 쉬워 **그 배우의 작품이 같은 글에서 제목 매칭됐거나
// anchored일 때만** 잡는다(2026-08-03 설계 — "지성"=知性 오매칭 방지). 3자 이상은 단독 매칭 허용.
function matchText(text, { anchoredTitleId = null } = {}) {
    const tl = String(text || '').toLowerCase();
    if (!tl || !shows.length) return { titleHits: [], actorHits: [] };
    const anchored = anchoredTitleId ? String(anchoredTitleId) : null;

    const titleHits = [];
    const contextIds = new Set(anchored ? [anchored] : []);
    for (const s of shows) {
        const hit = s.aliases.find((a) => tl.includes(a.k));
        if (!hit) continue;
        contextIds.add(s.id);
        if (s.id !== anchored) titleHits.push({ show: s, alias: hit.d });
    }

    const actorHits = [];
    const seenPid = new Set();
    for (const s of shows) {
        if (s.id === anchored) continue; // anchored 작품 배우는 캐스트 표가 담당
        for (const c of s.cast) {
            if (seenPid.has(c.pid) || !text.includes(c.name)) continue;
            const hangul = HANGUL_RE.test(c.name);
            const okAlone = hangul ? c.name.length >= 3 : c.name.length >= 5;
            if (!okAlone && !contextIds.has(s.id)) continue;
            seenPid.add(c.pid);
            actorHits.push({ show: s, actor: c });
        }
    }
    return { titleHits: titleHits.slice(0, 4), actorHits: actorHits.slice(0, 4) };
}

// 배우 1명의 타깃 언어 확정 표기 — 뷰어 표기 → 로마자 → RR 생성(personNames 3단) → 원명
async function renderName(pid, name, targetLang) {
    try {
        const lite = await fetchPersonLite(pid);
        const picked = pickPersonName(lite, targetLang);
        if (picked) return picked;
    } catch { /* TMDB 실패 — 폴백 진행 */ }
    return romanizeKorean(name) || name;
}

// ── 프롬프트 라인 조립 ───────────────────────────────────────────────────────
// ⚠ OVERRIDES 문구 필수 — 기본 규칙의 "확신 없으면 원문 유지"가 이겨서 확정 표기가 무시되는
//   회귀를 dari.js에서 이미 겪었다(2026-08-02 55ac746). 같은 우선권 문구를 쓴다.
async function buildGlossaryLines({ titleHits, actorHits }, targetLang, targetName) {
    if (!titleHits.length && !actorHits.length) return [];
    const lines = ['', '[Name glossary — verified proper nouns detected in this text]'];
    for (const { show, alias } of titleHits) {
        const t = show.titles[targetLang] || show.titles.en || alias;
        const ko = show.titles.ko;
        lines.push(`- The text mentions 「${alias}」 — this is the recently-airing Korean show${ko && ko !== alias ? ` 「${ko}」` : ''}. `
            + `If (and only if) the mention refers to this show, render its title exactly as "${t}" — NEVER translate the title literally or invent a new translation. `
            + `This OVERRIDES every other rule about keeping titles unchanged.`);
    }
    for (const { show, actor } of actorHits) {
        const rendered = await renderName(actor.pid, actor.name, targetLang);
        lines.push(`- The text mentions 「${actor.name}」 — Korean actor (cast of 「${show.titles.ko || show.titles.en || '?'}」`
            + `${actor.character ? `, plays ${actor.character}` : ''}). `
            + `If it refers to this actor, the established ${targetName} rendering is "${rendered}" — use exactly that; NEVER substitute a different real person's name. `
            + `This OVERRIDES every other rule about keeping names unchanged.`);
    }
    return lines;
}

// ── 캐스트 표(작품 특정 scope용) — buildTranslationContext가 호출 ─────────────
// 풀과 무관하게 **모든 작품**에 작동(호출측이 그 작품의 meta.credits.cast를 넘긴다).
// "부장님이 미쳤다" 같은 이름 없는 지칭은 문자열 매칭으로 못 잡지만, 캐스트 표가 있으면
// Gemini가 배역·성별을 알고 옮긴다(대명사 정확도 포함). 표기는 pickPersonName —
// 최근 풀 작품은 선워밍돼 메모 HIT, 그 외 작품은 첫 요청에 TMDB 병렬 1RTT(무과금·7일 메모).
async function castContextLines(cast, targetLang) {
    const top = (cast || []).filter((c) => c?.id && c?.name).slice(0, 6);
    if (!top.length) return [];
    const parts = await Promise.all(top.map(async (c) => {
        const rendered = await renderName(c.id, c.name, targetLang);
        const nm = rendered && rendered !== c.name ? `${c.name} = "${rendered}"` : `"${c.name}"`;
        return c.character ? `${nm} (plays ${c.character})` : nm;
    }));
    return [
        `- Main cast: ${parts.join(' · ')}.`,
        `- When the text mentions these actors, or refers to their characters even indirectly (by role, job title, or nickname), use the renderings above consistently — never a different spelling, never a different real person. Keep the characters' Latin-script names as given in Latin-script targets; otherwise transliterate them consistently. This OVERRIDES every other rule about keeping names unchanged.`,
    ];
}

module.exports = { ready, matchText, buildGlossaryLines, castContextLines, poolSize: () => shows.length };
