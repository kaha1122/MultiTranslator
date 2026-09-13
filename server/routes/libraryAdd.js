// ── K-DramaAnyLang "Add to MY" — 작품당 1회 포인트 차감 + 보관함 paid 마커 (2026-09-13) ──────
// 정책(KCulture d:\자료\POINTS_ECONOMY_V2.md §10): 작품을 내 보관함에 담는 첫 순간 2pt(작품당 1회).
// 이후 상태·회차·평점·한줄평·일지 편집은 전부 무료. 하트(추천)는 이 라우트를 타지 않는다(무료).
//
// 왜 서버인가: 클라 spendPoints(번역)는 클라가 users.points를 직접 increment한다(보안 과제).
// Add to MY는 첫 **서버 차감 경로** — 차감과 library.paid 기록을 한 트랜잭션에 묶어
// "돈은 냈는데 마커가 없는" / "마커는 있는데 안 낸" 상태를 없앤다.
//
// 비용 권위: Firestore config/points.addToMyCost (없으면 DEFAULT_COST). 5분 메모리 캐시 — 운영 중
// 콘솔에서 값을 바꾸면 5분 내 반영(재배포 불필요). 클라 src/config/points.js ADD_TO_MY_COST는 표시용.
//
// 응답: 200 { ok:true, already:boolean, cost, points(잔액) } / 402 { error:'insufficient', points } /
//       400 잘못된 tmdbId / 404 users 문서 없음 / 503 admin 미설정.
// 멱등: library.paid===true면 already:true·무과금(중복 클릭·재시도 안전).
// users 본문 write: points는 "의도된 본문 라이브 필드"(CLAUDE.md §6-1 예외, communityPoints.js와 동일 근거).
const express = require('express');
const admin = require('firebase-admin');
const { requireAuthAny } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');
const { kcultureDb } = require('../config/firebaseKculture');

const router = express.Router();

const DEFAULT_COST = 2;
const COST_TTL_MS = 5 * 60_000;
let costCache = { v: DEFAULT_COST, at: 0 };

async function getAddToMyCost() {
    if (Date.now() - costCache.at < COST_TTL_MS) return costCache.v;
    try {
        const s = await kcultureDb.doc('config/points').get();
        const v = s.exists ? Number(s.data().addToMyCost) : NaN;
        costCache = { v: Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST, at: Date.now() };
    } catch (e) {
        console.warn('[KC/AddToMy] config/points read failed, using default:', e.message);
        costCache.at = Date.now();
    }
    return costCache.v;
}

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

router.post('/api/community/library/add', requireAuthAny, rateLimit('kc-lib-add', { perMinute: 20, perHour: 200 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    const tmdbId = String(req.body?.tmdbId ?? '').trim();
    if (!/^\d{1,12}$/.test(tmdbId)) return res.status(400).json({ error: 'bad_tmdb_id' });
    const media = req.body?.media === 'movie' ? 'movie' : 'tv';
    const m = req.body?.meta || {};
    const meta = {
        titleName: str(m.titleName, 200),
        posterPath: str(m.posterPath, 200),
        totalEpisodes: num(m.totalEpisodes),
        runtimeMin: num(m.runtimeMin),
        tmdbRating: num(m.tmdbRating),
    };

    const cost = await getAddToMyCost();
    const userRef = kcultureDb.collection('users').doc(req.uid);
    const libRef = userRef.collection('library').doc(tmdbId);
    const ledgerRef = kcultureDb.collection('pointLedger').doc();
    const FV = admin.firestore.FieldValue;

    try {
        const out = await kcultureDb.runTransaction(async (tx) => {
            const [uSnap, lSnap] = await Promise.all([tx.get(userRef), tx.get(libRef)]);
            if (!uSnap.exists) return { reject: 404, error: 'user_not_found' };
            const lib = lSnap.exists ? lSnap.data() : {};
            const cur = Number(uSnap.data().points) || 0;
            if (lib.paid === true) return { already: true, points: cur };
            if (cur < cost) return { reject: 402, error: 'insufficient', points: cur };

            const now = FV.serverTimestamp();
            tx.set(libRef, {
                paid: true, paidAt: now, paidCost: cost,
                // 하트로만 생긴 문서(state null)나 새 문서는 '볼 예정'으로 시작 — 모달에서 바로 바꿀 수 있다.
                state: lib.state ?? 'plan',
                episodesWatched: lib.episodesWatched ?? 0,
                favorite: lib.favorite ?? false,
                unlisted: false,
                media: lib.media || media,
                ...(lib.titleName ? {} : meta.titleName ? { titleName: meta.titleName } : {}),
                ...(lib.posterPath ? {} : meta.posterPath ? { posterPath: meta.posterPath } : {}),
                ...(lib.totalEpisodes != null ? {} : meta.totalEpisodes ? { totalEpisodes: meta.totalEpisodes } : {}),
                ...(lib.runtimeMin ? {} : meta.runtimeMin ? { runtimeMin: meta.runtimeMin } : {}),
                ...(lib.tmdbRating ? {} : meta.tmdbRating ? { tmdbRating: meta.tmdbRating } : {}),
                ...(lib.addedAt ? {} : { addedAt: now }),
                updatedAt: now,
            }, { merge: true });
            if (cost > 0) tx.update(userRef, { points: FV.increment(-cost) });
            tx.set(ledgerRef, { uid: req.uid, type: 'add_to_my', tmdbId, media, delta: -cost, at: now });
            return { already: false, points: cur - cost };
        });
        if (out.reject) return res.status(out.reject).json({ error: out.error, ...(out.points != null ? { points: out.points } : {}) });
        if (!out.already) console.log(`[KC/AddToMy] ${req.uid} ${media}/${tmdbId} -${cost}pt → ${out.points}`);
        return res.json({ ok: true, already: out.already, cost, points: out.points });
    } catch (err) {
        console.error('[KC/AddToMy] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
