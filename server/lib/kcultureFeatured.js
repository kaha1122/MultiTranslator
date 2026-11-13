// ── K-DramaAnyLang 홈 Dari 존 featured 자동 선정 (2026-09-04 사용자 결정) ──
// 매일 KST 09시(시간별 reengagement cron에 체이닝) 6장.
// 🔄 **2026-10-23 사용자 결정 — 선정 시각 05시 → 09시**:
//   선정이 **스레드 개설 배치(클라우드 루틴, KST 07:3x)보다 앞서** 돌아 **그날 연 스레드를 구조적으로 못 봤다.**
//   두 잡은 서로를 모르고, 05시는 reengagement 체이닝 슬롯에서 온 임의값이라 상대 순서가 설계된 적이 없다.
//   실측(2026-10-23): 닥터X `293610_s1e6` 생성 07:41:28 KST — 05시 배치보다 2h41m 늦어 후보 풀에 부재.
//   동시에 구 스레드 `_s1e4`는 마지막 방영 10/17로 창(3일)을 벗어나 **그날 밤 방영하는 작품이 하루 종일 홈에서 빠졌다.**
//   → 09시로 옮기면 그날 개설분이 같은 날 후보에 들어온다(Render Cron `pronunfit-reengagement-push`는 `0 * * * *` 매시 정각이라 발화 보장).
//   ⚠ featured 선정은 **푸시 발송과 무관**하다 — 같은 시간별 트리거에 fire-and-forget으로 얹혀만 있다(reengagement.js ③).
//     따라서 시각 변경이 재방문·소감 푸시에 영향을 주지 않는다.
//   ⚠ 부작용: 후보 풀이 커지므로 방영 중 작품이 많은 날은 **선공개(PRE_MAX)가 밀린다** — 「방영분 우선 충원」의 설계상 귀결.
// 🔄 **2026-11-13 사용자 결정 — 선정은 무작위가 아니다(오늘 개설분 → 최근 방영순)**:
//   종전 구현은 후보가 6편을 넘으면 날짜 시드 **무작위 추첨**이었다 — "무작위"는 원래 **슬라이드 순서**에만 쓰기로 한 것을
//   선정 자체로 오해한 것(사용자 정정). 실측 11/13: 후보 10편 중 오늘 방영·오늘 개설한 닥터X [EP 11-12]가 떨어지고
//   14일 전 일괄 공개작이 1번에 걸렸다. 새 규칙:
//   ① **오늘(KST) 개설된 스레드**가 먼저 — 회차 스레드와 선공개 스레드를 같은 조건으로(오늘 연 선공개도 방영분에 밀리지 않는다).
//   ② 남는 자리는 방영분 후보를 **마지막 방영일이 최근인 순**(같으면 개설 최신순)으로.
//   ③ 그래도 남으면 선공개를 첫 방송이 가까운 순으로 — 선공개 합계 상한 PRE_MAX(3)는 유지.
//   순서 무작위는 클라가 세션마다 섞는다(KCulture src/lib/curation.js ③) — 서버 featured 번호는 선정 우선순위일 뿐.
// 🔄 **2026-10-03 사용자 결정 — 방영분 우선 충원으로 변경**(종전 "방영분 3 + 선공개 3" 고정 분할 폐지):
//     "방영중 숫자를 먼저 채우고 그다음에 선공개로 3개까지 채운다."
//   · 방영분: 작품별 최신 스레드 중 커버 회차 마지막 방영일이 최근 3일 이내 → **3장**(AIRED_WINDOW_MIN) 미달이면
//             7일 → 14일로 창 확장. 전편 일괄 공개작(회차 ≥6, 방영일 전부 동일)은 항상 14일 창(몰아보기 기간).
//             **상한은 TOTAL(6)** — 방영 중인 작품이 많으면 6장을 전부 가져갈 수 있다.
//   · 선공개: pre 스레드 중 같은 시즌 회차 스레드가 아직 없는 것. D-7 이내(premiereDate) 우선, 부족하면 나머지에서.
//             **남는 자리만 채우고 상한은 PRE_MAX(3)** — 종전의 교차 보충(선공개가 6장까지 번지던 동작)은 폐지.
//   · ⚠ 방영분이 적고 선공개도 3장이면 featured가 6장 미만일 수 있다 — 빈 자리는 클라(selectPointers ②)가
//     최신순으로 채우므로 캐러셀은 6장을 유지한다. 대상은 config/kc_featured.targetIds(월간 글로벌 OTT 목록) 안에서만
//     (비어 있으면 전체). featuredPin=true 포인터는 자리를 유지하고 배치가 건너뛴다(수동 고정).
//   · 선정은 결정적 → 같은 날 재실행은 같은 결과(멱등). 킬 스위치 config/kc_featured.autoEnabled(false면 정지).
// 쓰는 필드: curation_threads/{id}.featured(1~6, 낮을수록 앞 — 클라 selectPointers 정렬) / featuredPin / premiereDate(pre).
const { kcultureDb } = require('../config/firebaseKculture');
const admin = require('firebase-admin');

const TOTAL = 6;              // 홈 Dari 캐러셀 슬롯 수(실질 상한)
const PRE_MAX = 3;            // 선공개 상한 — "선공개로 3개까지"(2026-10-03 사용자 결정)
const AIRED_WINDOW_MIN = 3;   // 방영분 창 확장 기준: 이 수를 못 채우면 3→7→14일로 넓힌다(선정 상한이 아니다)
const WINDOWS = [3, 7, 14];
const BATCH_WINDOW = 14;
const PRE_PRIORITY_DAYS = 7;
const DEFAULT_RUN_HOUR_KST = 9;   // 2026-10-23: 05 → 09 (스레드 개설 배치 07:3x 이후로 이동 — 상단 주석)
                                  // config/kc_featured.runHourKst 가 저장돼 있으면 그 값이 이긴다(2026-11-13 현재 저장값 8).

function kstParts(now) {
    const k = new Date(now.getTime() + 9 * 3600e3);
    return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}
function dayDiff(a, b) { // a,b 'YYYY-MM-DD' → a - b (일)
    return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400e3);
}
const kstDateOf = (t) => (t ? new Date(t + 9 * 3600e3).toISOString().slice(0, 10) : null);
const seasonOf = (tid) => Number(String(tid || '').match(/^dari_s(\d+)/)?.[1] || 1);
const ms = (ts) => (ts?.toMillis?.() ? ts.toMillis() : (typeof ts === 'number' ? ts : Date.parse(ts) || 0));
// 커버 회차 중 **이미 방영된** 마지막 회차의 방영일(오늘 포함). [EP 11-12]에서 11화만 방영됐어도 11화 날짜로 후보가 된다.
function lastAirOf(p, today) { const d = (p.episodes || []).map((e) => e.airDate).filter((x) => x && x <= today).sort(); return d.length ? d[d.length - 1] : null; }
function isBatchRelease(p) { const d = (p.episodes || []).map((e) => e.airDate).filter(Boolean); return (p.episodes || []).length >= 6 && d.length >= 6 && new Set(d).size === 1; }

async function getFeaturedConfig() {
    try {
        const snap = await kcultureDb.doc('config/kc_featured').get();
        const d = snap.exists ? (snap.data() || {}) : {};
        return {
            autoEnabled: d.autoEnabled !== false, // 기본 ON
            targetIds: Array.isArray(d.targetIds) ? d.targetIds.map(String) : [],
            runHourKst: Number.isInteger(d.runHourKst) ? d.runHourKst : DEFAULT_RUN_HOUR_KST,
            lastRunDate: d.lastRunDate || null,
        };
    } catch { return { autoEnabled: true, targetIds: [], runHourKst: DEFAULT_RUN_HOUR_KST, lastRunDate: null }; }
}

// 후보 산출 + 선정(순수 함수 — 테스트·dry 용). all = 포인터 배열, today = KST 'YYYY-MM-DD'
function selectFeatured(all, today, targetIds = []) {
    const targets = new Set(targetIds.map(String));
    const inTarget = (p) => !targets.size || targets.has(String(p.titleId));
    const tv = all.filter((p) => (p.media || 'tv') === 'tv');
    const pinned = all.filter((p) => p.featuredPin === true);
    const pinnedIds = new Set(pinned.map((p) => p.id));

    // 선공개 후보 — 같은 시즌 회차 스레드가 생겼거나(첫 방송 개설) 첫 방송일이 지났으면 제외
    const premiered = new Set(tv.filter((p) => !p.pre).map((p) => `${p.titleId}_s${seasonOf(p.tid)}`));
    const preAll = tv.filter((p) => p.pre && inTarget(p) && !pinnedIds.has(p.id)
        && !premiered.has(`${p.titleId}_s${seasonOf(p.tid)}`)
        && !(p.premiereDate && p.premiereDate < today));
    const preNear = preAll.filter((p) => p.premiereDate && dayDiff(p.premiereDate, today) <= PRE_PRIORITY_DAYS);
    const preFar = preAll.filter((p) => !preNear.includes(p));

    // 방영분 후보 — 작품별 최신 스레드 1개, 마지막 방영일 ≤ 오늘
    const latest = new Map();
    for (const p of tv) {
        if (p.pre || !inTarget(p) || pinnedIds.has(p.id)) continue;
        const cur = latest.get(p.titleId);
        if (!cur || ms(p.createdAt) > ms(cur.createdAt)) latest.set(p.titleId, p);
    }
    const airedAll = [...latest.values()].map((p) => ({ p, last: lastAirOf(p, today), batch: isBatchRelease(p) }))
        .filter((x) => x.last); // 방영된 회차가 하나도 없으면(순수 선개설) 제외
    let aired = []; let windowUsed = WINDOWS[0];
    for (const w of WINDOWS) {
        windowUsed = w;
        aired = airedAll.filter((x) => dayDiff(today, x.last) <= (x.batch ? BATCH_WINDOW : w)).map((x) => x.p);
        if (aired.length >= AIRED_WINDOW_MIN) break;
    }

    // ── 선정(2026-11-13): 핀 → 오늘 개설분 → 방영분 최근 방영순 → 선공개 첫 방송 임박순 ──
    const pinPre = pinned.filter((p) => p.pre), pinAired = pinned.filter((p) => !p.pre);
    const freeSlots = Math.max(0, TOTAL - pinned.length);
    const openedToday = (p) => kstDateOf(ms(p.createdAt)) === today;
    const lastOf = new Map(airedAll.map((x) => [x.p.id, x.last]));
    // 방영분 순위: 마지막 방영일 최근순 → 개설 최신순
    const byRecentAir = (x, y) => String(lastOf.get(y.id) || '').localeCompare(String(lastOf.get(x.id) || '')) || (ms(y.createdAt) - ms(x.createdAt));
    // 선공개 순위: 첫 방송 임박순(날짜 없는 것은 뒤) → 개설 최신순
    const byNearPremiere = (x, y) => String(x.premiereDate || '9999').localeCompare(String(y.premiereDate || '9999')) || (ms(y.createdAt) - ms(x.createdAt));
    // ① 오늘 개설분 — 회차 스레드는 작품별 최신 스레드이면 방영 전이어도 포함(오늘 열었다 = 오늘의 화제), 선공개는 preAll 조건 그대로.
    const todayAired = [...latest.values()].filter(openedToday).sort(byRecentAir);
    const preBudget = Math.max(0, PRE_MAX - pinPre.length);
    const todayPre = preAll.filter(openedToday).sort(byNearPremiere).slice(0, preBudget);
    const todayPick = todayAired.concat(todayPre).slice(0, freeSlots);
    const todayIds = new Set(todayPick.map((p) => p.id));
    // ② 방영분 최근 방영순
    const restAired = aired.filter((p) => !todayIds.has(p.id)).sort(byRecentAir).slice(0, Math.max(0, freeSlots - todayPick.length));
    // ③ 선공개 — 남는 자리, 합계 PRE_MAX까지
    const preUsed = todayPick.filter((p) => p.pre).length;
    const preRoom = Math.min(preBudget - preUsed, freeSlots - todayPick.length - restAired.length);
    const restPre = preAll.filter((p) => !todayIds.has(p.id)).sort(byNearPremiere).slice(0, Math.max(0, preRoom));
    const ordered = pinAired.concat(pinPre, todayPick, restAired, restPre);
    return { ordered, windowUsed, counts: { preCandidates: preAll.length, preNear: preNear.length, airedCandidates: aired.length, airedAll: airedAll.length, pinned: pinned.length, preMax: PRE_MAX, preRoom: Math.max(0, preRoom), openedToday: todayPick.length, slotsUsed: ordered.length } };
}

async function runFeaturedDaily(now = new Date(), { dryRun = false, force = false } = {}) {
    if (!kcultureDb) return null;
    const cfg = await getFeaturedConfig();
    const { date: today, hour } = kstParts(now);
    if (!force) {
        if (!cfg.autoEnabled) return { skipped: 'disabled' };
        if (hour !== cfg.runHourKst) return { skipped: 'hour', hour };
        if (cfg.lastRunDate === today) return { skipped: 'done', today };
    }
    const snap = await kcultureDb.collection('curation_threads').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const { ordered, windowUsed, counts } = selectFeatured(all, today, cfg.targetIds);
    const selectedIds = new Set(ordered.map((p) => p.id));
    const cleared = all.filter((p) => p.featured != null && !selectedIds.has(p.id)).map((p) => p.id);
    const result = { today, windowUsed, counts, featured: ordered.map((p, i) => ({ rank: i + 1, id: p.id, title: p.title, pre: !!p.pre })), cleared, dryRun };
    if (dryRun) return result;
    const batch = kcultureDb.batch();
    cleared.forEach((id) => batch.update(kcultureDb.doc(`curation_threads/${id}`), { featured: admin.firestore.FieldValue.delete() }));
    ordered.forEach((p, i) => batch.update(kcultureDb.doc(`curation_threads/${p.id}`), { featured: i + 1, featuredAt: today }));
    batch.set(kcultureDb.doc('config/kc_featured'), { lastRunDate: today, lastResult: result.featured.map((f) => f.id), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    return result;
}

module.exports = { runFeaturedDaily, selectFeatured, getFeaturedConfig, kstParts };
