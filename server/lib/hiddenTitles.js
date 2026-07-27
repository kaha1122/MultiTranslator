// ── 숨김 작품(성인 에로물) 필터 ─────────────────────────────────────────────
// K-DramaAnyLang 전용. `titles/{id}.hidden === true` 인 작품을 앱 표면(검색·탐색·인물·컬렉션)에서
// 제외한다. 판정과 플래그 쓰기는 scripts/flag-adult-titles.js가 하고, 여기서는 **읽고 거르기만** 한다.
//
// 왜 필요한가 (2026-07-27 실측)
//   TMDB의 `adult` 플래그는 한국 소프트코어물을 성인물로 분류하지 않는다 — 확인한 13편이 전부
//   `adult:false`에 장르는 Romance/Drama였다. 그래서 discover·search에 `include_adult=false`를
//   넣어도 그대로 통과한다. 스토어 연령등급 설문(성적 콘텐츠)과 직결되므로 우리가 따로 거른다.
//
// 왜 메모리 Set인가
//   요청마다 Firestore를 치면 크롤·검색 트래픽이 그대로 읽기 과금이 된다. 대상은 수백~수천 건이라
//   id만 담으면 메모리가 무시할 수준이고, 갱신은 플래그 배치가 돌 때뿐이라 TTL 재적재로 충분하다.
//   ⚠ 로드 실패 시에는 **거르지 않는다(fail-open)** — 필터는 보조 장치이지 서비스 경로가 아니다.
const { kcultureDb } = require('../config/firebaseKculture');

const TTL = 30 * 60 * 1000;   // 30분 — 플래그 배치 반영 지연 허용치
let ids = new Set();
let loadedAt = 0;
let inflight = null;

async function load() {
    if (!kcultureDb) { console.warn('[hiddenTitles] kcultureDb 없음 — 필터 미적용'); return ids; }
    const t0 = Date.now();
    // ⚠ select()를 인자 없이 부르지 말 것 — admin SDK 버전에 따라 거부된다.
    //   필드 하나를 명시해도 전송량은 같고(문서당 수십 바이트) 호환성만 얻는다.
    const snap = await kcultureDb.collection('titles').where('hidden', '==', true).select('hidden').get();
    const next = new Set();
    snap.forEach((d) => next.add(String(d.id)));
    ids = next;
    loadedAt = Date.now();
    // 기동/갱신 때마다 남긴다 — 0이면 "필터가 왜 안 먹지"를 로그 한 줄로 판별할 수 있다.
    console.log(`[hiddenTitles] ${ids.size}건 로드 (${Date.now() - t0}ms)`);
    return ids;
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

function isHidden(id) {
    return ids.has(String(id));
}

// TMDB 결과 배열에서 숨김 작품 제거. person(media_type='person')은 대상이 아니므로 그대로 통과.
function filterHidden(list) {
    if (!Array.isArray(list) || !ids.size) return list || [];
    return list.filter((r) => (r?.media_type === 'person' ? true : !ids.has(String(r?.id))));
}

module.exports = { ready, isHidden, filterHidden, size: () => ids.size };
