// ── 추천 카운터 정합 맞추기 — 주간 표를 던진 사람을 역대 누적에도 반영 ─────────────────
// 사용: node scripts/reconcile-recommend-all.js [--apply]   (기본은 dry-run)
//
// 배경(2026-09-07 사용자 지적): 홈 순위 카드의 ♥가 **이번 주 표만** 던지고 누적(favorite)은 건드리지 않아
// 같은 작품이 「이번 주 13 · 역대 7」처럼 어긋나 보였다. 클라 쪽은 같은 날 `tapRecommend`로 동작을 통일했고
// (표를 켜면 누적도 함께 켜짐 · 누적은 내리지 않음), 이 스크립트는 **그 이전에 쌓인 표**를 같은 규칙으로 소급한다.
//
// 규칙: `users/{uid}/recVotes/{주차}_{media}_{titleId}` 가 있는데 `users/{uid}/library/{titleId}.favorite` 가
//       true가 아니면 → favorite을 켜고 `titles/_recommend/stats/all.counts[{key}]` 를 +1 한다.
//       **역대를 줄이는 처리는 없다**(누적은 내리지 않는다는 규칙과 동일). 이미 favorite인 사람은 건드리지 않는다.
//
// 안전장치: dry-run이 기본 · 작품별 변화량을 먼저 출력 · 쓰기는 배치(400건 단위) · 재실행해도 멱등
//          (두 번째 실행에서는 favorite이 이미 true라 대상이 0건이 된다).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { kcultureDb } = require('../config/firebaseKculture');

const APPLY = process.argv.includes('--apply');
const ALL_DOC = 'titles/_recommend/stats/all';
const chunk = (arr, n) => arr.reduce((a, x, i) => ((i % n) ? a[a.length - 1].push(x) : a.push([x]), a), []);

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');

    // 1) 주간 표 전수 — (uid, 작품) 쌍을 모은다
    const votes = await kcultureDb.collectionGroup('recVotes').get();
    const pairs = [];
    votes.docs.forEach((d) => {
        const x = d.data();
        const uid = d.ref.parent.parent.id;
        if (!uid || !x.titleId) return;
        pairs.push({ uid, titleId: String(x.titleId), media: x.media || 'tv', key: `${x.media || 'tv'}_${x.titleId}` });
    });
    // 같은 사람이 여러 주에 던진 표는 1회로
    const uniq = new Map();
    pairs.forEach((p) => uniq.set(`${p.uid}|${p.key}`, p));
    const rows = [...uniq.values()];
    console.log(`recVotes ${votes.size}건 → (사용자,작품) 고유 ${rows.length}쌍`);

    // 2) 각 쌍의 보관함 문서를 읽어 favorite 여부 확인
    const need = [];
    for (const grp of chunk(rows, 200)) {
        const snaps = await kcultureDb.getAll(...grp.map((p) => kcultureDb.doc(`users/${p.uid}/library/${p.titleId}`)));
        snaps.forEach((s, i) => { if (s.get('favorite') !== true) need.push({ ...grp[i], exists: s.exists }); });
    }
    const delta = {};
    need.forEach((p) => { delta[p.key] = (delta[p.key] || 0) + 1; });

    // 3) 현재 역대 값과 나란히 보고
    const allSnap = await kcultureDb.doc(ALL_DOC).get();
    const counts = (allSnap.data() || {}).counts || {};
    const meta = (allSnap.data() || {}).meta || {};
    console.log(`\n누적 반영이 빠진 표: ${need.length}건 (작품 ${Object.keys(delta).length}개)\n`);
    console.log('작품            역대(현재) → 역대(예정)   보관함문서');
    Object.entries(delta).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
        const cur = counts[k] || 0;
        const missing = need.filter((p) => p.key === k && !p.exists).length;
        console.log(`  ${k.padEnd(14)} ${String(cur).padStart(3)} → ${String(cur + n).padStart(3)}   (+${n}, 신규 생성 ${missing})`);
    });

    if (!APPLY) { console.log('\n[dry-run] 쓰기 없음 — 적용하려면 --apply'); process.exit(0); }

    // 4) 적용 — 보관함 favorite 켜기(없으면 생성) + 역대 카운트 증가
    let wrote = 0;
    for (const grp of chunk(need, 400)) {
        const batch = kcultureDb.batch();
        grp.forEach((p) => {
            const ref = kcultureDb.doc(`users/${p.uid}/library/${p.titleId}`);
            const base = {
                favorite: true,
                recCounted: true, // 역대에 이미 셌다는 표식 — My 탭에서 빼도 남아 재추천 시 이중 계상을 막는다
                media: p.media,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (!p.exists) {
                const m = meta[p.key] || {};
                Object.assign(base, {
                    titleName: m.titleName || '',
                    posterPath: m.posterPath || null,
                    state: null,
                    episodesWatched: 0,
                    addedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            batch.set(ref, base, { merge: true });
        });
        await batch.commit();
        wrote += grp.length;
    }
    const inc = {};
    Object.entries(delta).forEach(([k, n]) => { inc[`counts.${k}`] = admin.firestore.FieldValue.increment(n); });
    inc.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await kcultureDb.doc(ALL_DOC).update(inc);
    console.log(`\n적용 완료 — 보관함 ${wrote}건 favorite=true, 역대 카운트 ${Object.keys(delta).length}개 작품 증가`);
    process.exit(0);
})().catch((e) => { console.error('[reconcile] FAIL', e); process.exit(1); });
