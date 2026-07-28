// ── 카탈로그 제외 목록 (재유입 차단) ────────────────────────────────────────
// 사람이 "이 작품은 우리 카탈로그에 두지 않는다"고 판정해 삭제한 id를 기록해 둔다.
//
// ⚠ 이게 없으면 삭제가 무의미하다. 사전번역 배치(runBackfill·runIncremental·fill-missing-langs)는
//   **TMDB discover로 id를 열거**하므로, 지운 작품이 다음 실행에서 그대로 다시 만들어진다.
//   → processTitle 진입부에서 이 목록을 확인하고 즉시 건너뛴다(문서를 만들지 않는다).
//
// 저장 위치: `excluded_titles/{tmdbId}` — { reason, at }
//   문서 하나에 배열로 담지 않는 이유: 1MB 문서 한도와, 나중에 사유별 조회·해제가 필요해서.
//
// 캐시: 프로세스 메모리에 Set으로 1회 적재(TTL 10분). 배치가 수만 건을 돌 때 매번 읽지 않기 위함.
//   ⚠ 로드 실패 시에는 **비어 있는 것으로 간주**한다(fail-open). 차단 목록을 못 읽었다고 배치 전체를
//     멈추면 더 나쁘다 — 최악의 경우 지운 작품이 하나 되살아나고, 다음 실행에서 다시 걸린다.
const { kcultureDb } = require('../config/firebaseKculture');

const TTL = 10 * 60 * 1000;
let ids = new Set();
let loadedAt = 0;
let inflight = null;

async function load() {
    if (!kcultureDb) return ids;
    const snap = await kcultureDb.collection('excluded_titles').select().get();
    const next = new Set();
    snap.forEach((d) => next.add(String(d.id)));
    ids = next;
    loadedAt = Date.now();
    return ids;
}

async function ready() {
    if (loadedAt && Date.now() - loadedAt < TTL) return ids;
    if (!inflight) {
        inflight = load()
            .catch((e) => { console.warn('[excludedTitles] load 실패(차단 미적용으로 진행):', e.message); return ids; })
            .finally(() => { inflight = null; });
    }
    return inflight;
}

const isExcluded = (id) => ids.has(String(id));

// 삭제 스크립트가 등록할 때 쓴다. 캐시도 즉시 갱신해 같은 실행 안에서 바로 막히게 한다.
async function exclude(id, reason = 'manual') {
    await kcultureDb.doc(`excluded_titles/${id}`).set({ reason, at: new Date() }, { merge: true });
    ids.add(String(id));
}

module.exports = { ready, isExcluded, exclude, size: () => ids.size };
