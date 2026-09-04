// ── K-DramaAnyLang 홈 Dari 존 featured 자동 선정 (2026-09-04 사용자 결정) ──
// 매일 KST 05시(시간별 reengagement cron에 체이닝) 6장 = 방영분 3 + 선공개 3.
//   · 방영분: 작품별 최신 스레드 중 커버 회차 마지막 방영일이 최근 3일 이내 → 3장 미달이면 7일 → 14일로 창 확장.
//             전편 일괄 공개작(회차 ≥6, 방영일 전부 동일)은 항상 14일 창(몰아보기 기간).
//   · 선공개: pre 스레드 중 같은 시즌 회차 스레드가 아직 없는 것. D-7 이내(premiereDate) 우선, 부족하면 나머지에서.
//   · 한쪽이 부족하면 다른 쪽으로 채워 6장 유지. 대상은 config/kc_featured.targetIds(월간 글로벌 OTT 목록) 안에서만
//     (비어 있으면 전체). featuredPin=true 포인터는 자리를 유지하고 배치가 건너뛴다(수동 고정).
//   · 랜덤은 날짜 시드 → 같은 날 재실행은 같은 결과(멱등). 킬 스위치 config/kc_featured.autoEnabled(false면 정지).
// 쓰는 필드: curation_threads/{id}.featured(1~6, 낮을수록 앞 — 클라 selectPointers 정렬) / featuredPin / premiereDate(pre).
const { kcultureDb } = require('../config/firebaseKculture');
const admin = require('firebase-admin');

const SLOTS_AIRED = 3;
const SLOTS_PRE = 3;
const TOTAL = SLOTS_AIRED + SLOTS_PRE;
const WINDOWS = [3, 7, 14];
const BATCH_WINDOW = 14;
const PRE_PRIORITY_DAYS = 7;
const DEFAULT_RUN_HOUR_KST = 5;

function kstParts(now) {
    const k = new Date(now.getTime() + 9 * 3600e3);
    return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours() };
}
function dayDiff(a, b) { // a,b 'YYYY-MM-DD' → a - b (일)
    return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400e3);
}
// mulberry32 — 날짜 문자열 시드
function seededRng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = (h >>> 0) || 1;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
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
        if (aired.length >= SLOTS_AIRED) break;
    }

    const rng = seededRng(`kc-featured:${today}`);
    const pinPre = pinned.filter((p) => p.pre), pinAired = pinned.filter((p) => !p.pre);
    let selPre = pinPre.concat(shuffle(preNear, rng), shuffle(preFar, rng)).slice(0, Math.max(SLOTS_PRE, pinPre.length));
    let selAired = pinAired.concat(shuffle(aired, rng)).slice(0, Math.max(SLOTS_AIRED, pinAired.length));
    // 교차 보충 — 한쪽이 부족하면 다른 쪽 잔여 후보로 6장 채움
    const restPre = pinPre.concat(shuffle(preNear, rng), shuffle(preFar, rng)).filter((p) => !selPre.includes(p));
    const restAired = shuffle(aired, rng).filter((p) => !selAired.includes(p));
    while (selPre.length + selAired.length < TOTAL && (restPre.length || restAired.length)) {
        if (selAired.length < SLOTS_AIRED || !restPre.length) { if (restAired.length) { selAired.push(restAired.shift()); continue; } }
        if (restPre.length) selPre.push(restPre.shift()); else if (restAired.length) selAired.push(restAired.shift());
    }
    const ordered = selAired.concat(selPre).slice(0, TOTAL); // 1~3 방영분, 4~6 선공개(클라는 세션 셔플)
    return { ordered, windowUsed, counts: { preCandidates: preAll.length, preNear: preNear.length, airedCandidates: aired.length, airedAll: airedAll.length, pinned: pinned.length } };
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
