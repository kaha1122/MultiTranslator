// ── 숨김 작품(성인 에로물 + 카탈로그 삭제작) 필터 ──────────────────────────
// K-DramaAnyLang 전용. 앱 표면(검색·탐색·상세·인물·컬렉션)에서 제외할 id를 메모리 Set으로 들고 있다.
// 판정·쓰기는 스크립트가 하고, 여기서는 **읽고 거르기만** 한다.
//
// 왜 필요한가 (2026-07-27 실측)
//   TMDB의 `adult` 플래그는 한국 소프트코어물을 성인물로 분류하지 않는다 — 확인한 13편이 전부
//   `adult:false`에 장르는 Romance/Drama였다. 그래서 discover·search에 `include_adult=false`를
//   넣어도 그대로 통과한다. 스토어 연령등급 설문(성적 콘텐츠)과 직결되므로 우리가 따로 거른다.
//
// ⚠ 우리 DB에서 지우는 것과 앱에서 감추는 것은 별개의 일이다.
//   검색·탐색은 TMDB 프록시라, `titles/{id}`를 지워도 TMDB가 계속 결과에 실어 보낸다
//   (2026-07-28 실측: 지운 「B타임의 정사 3」이 검색에 그대로 노출). 화면에서 감추는 수단은
//   이 메모리 Set이 유일하다 — 서버가 모르는 id는 지운 성인물이라도 그대로 노출된다.
//
// ── 읽기 경로 = 파생 인덱스 1 read (2026-07-30) ─────────────────────────────
// 원본은 두 목록이고, 둘 다 **문서당 1건**으로 유지된다:
//   ① titles.hidden == true   — 카탈로그에 두고 숨기는 작품(성인물 등)
//   ② excluded_titles/{id}    — 카탈로그에서 삭제한 작품(재유입 차단용, { reason, at })
//   문서당 1건인 이유는 사유별 조회·개별 해제가 필요해서다(lib/excludedTitles.js 주석 참조).
//   그 요구는 유효하므로 원본 모양은 건드리지 않는다.
//
// 문제는 소비자가 나중에 바뀐 것이었다. 원래 이 파일은 ①(매칭 문서만 = 수백 건)만 읽었고 그 기준으로
// TTL 30분을 잡았는데, 2026-07-28 "지운 작품이 검색에 노출" 긴급 수정이 ②의 **전량 스캔**을 같은
// TTL에 얹었다. 단발 스크립트용 읽기가 상시 서버의 30분 주기 읽기가 된 것 — 6,037건 × 48회/일 ≈
// 하루 29만 read(무료 한도 5만의 6배)로, Render 로그의 `[hiddenTitles] … 2832ms` 줄이 그 청구서였다.
//
// → 읽기 전용 **파생 인덱스**(`kdl_index/hidden_titles*`, 두 목록의 합집합 id 배열)를 두고 여기서는
//   그것만 읽는다. 재적재가 6,037 read·2.8초 → **1 read·수십 ms**.
//   인덱스는 빌드 산출물이다 — 목록을 바꾼 스크립트가 rebuildIndex()로 통째로 다시 만든다.
//   증분(arrayUnion) 대신 통째 재생성인 이유: 원본과 어긋날 여지를 아예 없애고, 삭제 해제(id 제거)도
//   같은 경로로 반영되기 때문. 스크립트는 1회 전량 스캔이라 비용이 무의미하다.
//
// TTL은 이제 **백스톱일 뿐**이다. 실제 반영은 목록을 바꾼 스크립트가
// `POST /api/kdl/hidden-titles/refresh`(routes/tmdb.js)로 즉시 알린다 → 반영 지연 0.
// TTL이 담당하는 건 그 알림이 실패했거나 콘솔에서 손으로 문서를 고친 경우의 보험뿐이다.
//   ⚠ 로드 실패 시에는 **거르지 않는다(fail-open)** — 필터는 보조 장치이지 서비스 경로가 아니다.
const { kcultureDb } = require('../config/firebaseKculture');

const TTL = 12 * 60 * 60 * 1000;   // 12시간 — 무효화 알림이 실패했을 때만 쓰이는 백스톱
const INDEX_PATH = 'kdl_index/hidden_titles';
// 문서 1MB 한도 대비 안전선. id 7~8자 × 20k ≈ 180KB(한도의 18%) — 5배 이상 마진.
// KDL_HIDDEN_CHUNK로 낮춰 **다중 청크 경로를 실제로 돌려볼 수 있다**(2026-07-30 검증에 사용).
// 목록이 20k를 넘기 전에는 1청크라 그 경로가 프로덕션에서 실행되지 않으므로, 테스트 수단을 남겨 둔다.
const CHUNK = Math.max(1, parseInt(process.env.KDL_HIDDEN_CHUNK, 10) || 20000);

let ids = new Set();
let loadedAt = 0;
let inflight = null;

const indexPath = (n) => (n === 0 ? INDEX_PATH : `${INDEX_PATH}_${n}`);

// ── 원본 스캔 — 인덱스 재생성과 인덱스 부재 시 폴백에만 쓴다(비싸다: 문서 수만큼 read) ──
// ⚠ select()를 인자 없이 부르지 말 것 — admin SDK 버전에 따라 거부된다.
async function loadFromSource() {
    const [hid, exc] = await Promise.all([
        kcultureDb.collection('titles').where('hidden', '==', true).select('hidden').get(),
        kcultureDb.collection('excluded_titles').select('reason').get(),
    ]);
    const next = new Set();
    hid.forEach((d) => next.add(String(d.id)));
    exc.forEach((d) => next.add(String(d.id)));
    return { ids: next, hidden: hid.size, excluded: exc.size, reads: hid.size + exc.size };
}

// 인덱스 읽기 — 없으면 null(호출측이 원본 스캔으로 폴백). 통상 1 read.
async function loadFromIndex() {
    const head = await kcultureDb.doc(indexPath(0)).get();
    if (!head.exists) return null;
    const d = head.data() || {};
    const chunks = Math.max(1, Number(d.chunks) || 1);
    const next = new Set((d.ids || []).map(String));
    if (chunks > 1) {
        const refs = [];
        for (let i = 1; i < chunks; i++) refs.push(kcultureDb.doc(indexPath(i)));
        const snaps = await kcultureDb.getAll(...refs);
        snaps.forEach((s) => (s.data()?.ids || []).forEach((x) => next.add(String(x))));
    }
    return { ids: next, reads: chunks, at: d.at?.toDate?.() || null };
}

async function load() {
    if (!kcultureDb) { console.warn('[hiddenTitles] kcultureDb 없음 — 필터 미적용'); return ids; }
    const t0 = Date.now();

    let idx = null;
    try { idx = await loadFromIndex(); } catch (e) {
        console.warn(`[hiddenTitles] 인덱스 읽기 실패 → 원본 스캔 폴백: ${e.message}`);
    }
    if (idx) {
        ids = idx.ids;
        loadedAt = Date.now();
        // 적재마다 1줄 남긴다 — 0이면 "필터가 왜 안 먹지"를 로그 한 줄로 판별할 수 있다.
        const at = idx.at ? `, 인덱스 갱신 ${idx.at.toISOString().slice(0, 16)}Z` : '';
        console.log(`[hiddenTitles] ${ids.size}건 로드 (인덱스 ${idx.reads} read, ${Date.now() - t0}ms${at})`);
        return ids;
    }

    // 인덱스 부재 — 동작은 유지하되(fail-safe) 비싸므로 크게 경고한다.
    const s = await loadFromSource();
    ids = s.ids;
    loadedAt = Date.now();
    console.warn(`[hiddenTitles] ${ids.size}건 로드 (⚠ 인덱스 없음 → 원본 스캔: 숨김 ${s.hidden} + 삭제 ${s.excluded}, `
        + `${s.reads} read, ${Date.now() - t0}ms) — 'node scripts/refresh-hidden-filter.js'로 인덱스를 생성하세요`);
    return ids;
}

// 파생 인덱스 통째 재생성. 목록을 바꾼 스크립트(delete-titles·flag-adult-titles·apply-adult-verdicts)와
// 무효화 라우트(rebuild:true)가 호출한다. 원본 전량 스캔 1회 + 청크 write 1 batch.
async function rebuildIndex() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const t0 = Date.now();
    const s = await loadFromSource();
    const all = [...s.ids].sort();
    const chunks = Math.max(1, Math.ceil(all.length / CHUNK));

    // 청크 수가 줄어든 경우 잔여 청크를 지운다 — 안 지우면 해제한 id가 되살아난다.
    let prevChunks = 1;
    try {
        const h = await kcultureDb.doc(indexPath(0)).get();
        if (h.exists) prevChunks = Math.max(1, Number(h.data()?.chunks) || 1);
    } catch { /* 없으면 1로 간주 */ }

    const batch = kcultureDb.batch();
    for (let i = 0; i < chunks; i++) {
        // merge 없이 set — 이전 ids를 남기지 않고 통째로 갈아끼운다.
        batch.set(kcultureDb.doc(indexPath(i)), {
            ids: all.slice(i * CHUNK, (i + 1) * CHUNK),
            ...(i === 0 ? { chunks, count: all.length, hidden: s.hidden, excluded: s.excluded, at: new Date() } : {}),
        });
    }
    for (let i = chunks; i < prevChunks; i++) batch.delete(kcultureDb.doc(indexPath(i)));
    await batch.commit();

    ids = s.ids;
    loadedAt = Date.now();
    const out = { count: all.length, hidden: s.hidden, excluded: s.excluded, chunks, reads: s.reads, ms: Date.now() - t0 };
    console.log(`[hiddenTitles] 인덱스 재생성 ${out.count}건 (숨김 ${out.hidden} + 삭제 ${out.excluded}, `
        + `${chunks}청크, ${out.reads} read, ${out.ms}ms)`);
    return out;
}

// 백그라운드 갱신 — 만료됐어도 **현재 Set으로 즉시 응답**하고 뒤에서 채운다(요청 지연 0).
function ensureFresh() {
    if (Date.now() - loadedAt < TTL || inflight) return;
    inflight = load()
        .catch((e) => { console.warn('[hiddenTitles] load 실패(필터 미적용으로 진행):', e.message); })
        .finally(() => { inflight = null; });
}

// 최초 1회는 기다린다 — 서버 기동 직후 첫 요청이 필터 없이 나가는 것을 막는다.
async function ready() {
    if (loadedAt) { ensureFresh(); return; }
    if (!inflight) {
        inflight = load()
            .catch((e) => { console.warn('[hiddenTitles] 초기 load 실패:', e.message); })
            .finally(() => { inflight = null; });
    }
    await inflight;
}

// 즉시 재적재(무효화). 진행 중 적재가 있으면 먼저 끝내고 새로 읽는다 —
// 그 적재는 목록 변경 **전**에 시작됐을 수 있어 결과를 신뢰할 수 없다.
async function reload() {
    if (inflight) await inflight.catch(() => {});
    loadedAt = 0;
    inflight = load()
        .catch((e) => { console.warn('[hiddenTitles] reload 실패(직전 목록 유지):', e.message); })
        .finally(() => { inflight = null; });
    await inflight;
    return ids.size;
}

function isHidden(id) {
    return ids.has(String(id));
}

// TMDB 결과 배열에서 숨김 작품 제거. person(media_type='person')은 대상이 아니므로 그대로 통과.
function filterHidden(list) {
    if (!Array.isArray(list) || !ids.size) return list || [];
    return list.filter((r) => (r?.media_type === 'person' ? true : !ids.has(String(r?.id))));
}

module.exports = { ready, isHidden, filterHidden, rebuildIndex, reload, size: () => ids.size, TTL };
