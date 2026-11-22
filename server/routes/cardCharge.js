// ── K-DramaAnyLang 카드 만들기 — 서버 차감 + 게스트 한도 + 카드 이력 (2026-11-22) ─────────────
// 카드는 사용자의 기기에서 그리지만(서버 렌더·저장 없음), 값과 한도는 서버가 판정한다.
//   · 값: 장수 기준 1장 config/points.cardCost pt(기본 2). 이미지의 값이 아니라 도구를 쓰는 값 — 배경이 무엇이든 같다.
//   · 게스트(익명 계정)는 통산 1장까지. 두 번째부터는 로그인(브라우저 저장소를 지워 50pt를 다시 받는 구멍 대응).
//     묶음처럼 한 번에 여러 장인 요청도 "통산 1장"을 넘으면 거절한다.
//   · Pro 구독은 무제한(비용 0).
//
// 흐름(클라 lib/card/useCardExport.js): ① dry:true로 미리 물어본다(한도·잔액·미검증) → ② 기기에서 그려 내보낸다
//   → ③ 내보내기에 성공했을 때만 dry 없이 다시 불러 실제로 차감한다(취소·실패는 무과금).
//   ③이 유실되면 그 카드는 무과금이 된다 — 기기 렌더 방식의 한계로 받아들인다(사용자 결정: 일반 사용자 기준으로 막는다).
//
// 함께 하는 일(같은 트랜잭션):
//   · users/{uid}/meta/cards.count += 장수   — 게스트 한도 판정용(users 본문 write 금지 규칙 → 서브컬렉션)
//   · card_stats/{작품ID}.count += 1         — 가이드 작성 큐가 읽는다(가이드 없는 작품에서 카드가 만들어지면 그 작품을 먼저 쓴다).
//                                              인물은 card_stats/person_{id}. Top 5는 고른 작품마다 +1.
//   · saveReview:true면 보관함/팬 문서에 paid 마커 — 카드에서 쓴 평가를 앱 평가로 저장하기 위한 것.
//     카드 값만 받고 Add to MY 값은 따로 받지 않는다(사용자 결정). 마커 규약은 routes/libraryAdd.js와 같다(paidVia:'card').
//
// 응답: 200 { ok:true, dry, cost(이번 요청 합계), points(잔액), made(통산 장수) }
//       402 { error:'insufficient', points } / 403 { error:'guest_limit' } / 400 잘못된 요청 / 404 users 문서 없음 / 503 admin 미설정.
const express = require('express');
const admin = require('firebase-admin');
const { requireAuthAny, requireVerifiedEmail } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');
const { kcultureDb } = require('../config/firebaseKculture');

const router = express.Router();

const DEFAULT_COST = 2;
const GUEST_MAX_CARDS = 1;
const MAX_COUNT = 6;          // 묶음 한 번에 최대 6장
const COST_TTL_MS = 5 * 60_000;
let costCache = { v: DEFAULT_COST, at: 0 };

async function getCardCost() {
    if (Date.now() - costCache.at < COST_TTL_MS) return costCache.v;
    try {
        const s = await kcultureDb.doc('config/points').get();
        const raw = s.exists ? s.data().cardCost : undefined;
        const v = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
        costCache = { v: Number.isFinite(v) && v >= 0 ? v : DEFAULT_COST, at: Date.now() };
    } catch (e) {
        console.warn('[KC/Card] config/points read failed, using default:', e.message);
        costCache.at = Date.now();
    }
    return costCache.v;
}

const isId = (v) => /^\d{1,12}$/.test(String(v ?? ''));
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

router.post('/api/community/card/charge', requireAuthAny, requireVerifiedEmail, rateLimit('kc-card', { perMinute: 30, perHour: 300 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    const b = req.body || {};
    const kind = ['title', 'person', 'top5'].includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: 'bad_kind' });
    const count = Math.floor(Number(b.count) || 1);
    if (count < 1 || count > MAX_COUNT) return res.status(400).json({ error: 'bad_count' });
    const dry = b.dry === true;
    const tpl = str(b.tpl, 20) || 'basic';

    // 카드 이력에 올릴 대상 — 작품/인물은 1건, Top 5는 고른 작품들(최대 5)
    let targets = [];
    if (kind === 'top5') {
        targets = (Array.isArray(b.items) ? b.items : []).filter((it) => isId(it?.id)).slice(0, 5)
            .map((it) => ({ key: String(it.id), titleId: Number(it.id), media: it.media === 'movie' ? 'movie' : 'tv' }));
    } else {
        if (!isId(b.id)) return res.status(400).json({ error: 'bad_id' });
        targets = kind === 'person'
            ? [{ key: `person_${b.id}`, personId: Number(b.id), media: 'person' }]
            : [{ key: String(b.id), titleId: Number(b.id), media: b.media === 'movie' ? 'movie' : 'tv' }];
    }
    const saveReview = b.saveReview === true && kind !== 'top5';
    const m = b.meta || {};
    const meta = { titleName: str(m.titleName, 200), posterPath: str(m.posterPath, 200) };

    const isGuest = req.authProvider === 'anonymous';
    const cost = await getCardCost();
    const userRef = kcultureDb.collection('users').doc(req.uid);
    const cardsRef = userRef.collection('meta').doc('cards');
    const libRef = saveReview ? userRef.collection(kind === 'person' ? 'fans' : 'library').doc(String(b.id)) : null;
    const ledgerRef = kcultureDb.collection('pointLedger').doc();
    const FV = admin.firestore.FieldValue;

    try {
        const out = await kcultureDb.runTransaction(async (tx) => {
            const snaps = await Promise.all([tx.get(userRef), tx.get(cardsRef), ...(libRef ? [tx.get(libRef)] : [])]);
            const [uSnap, cSnap, lSnap] = snaps;
            if (!uSnap.exists) return { reject: 404, error: 'user_not_found' };
            const cur = Number(uSnap.data().points) || 0;
            const made = cSnap.exists ? Number(cSnap.data().count) || 0 : 0;
            if (isGuest && made + count > GUEST_MAX_CARDS) return { reject: 403, error: 'guest_limit', made };
            const proUntil = uSnap.data().pro?.until?.toMillis?.() || 0;
            const isPro = proUntil > Date.now();
            const total = isPro ? 0 : cost * count;
            if (cur < total) return { reject: 402, error: 'insufficient', points: cur };
            if (dry) return { points: cur, cost: total, made };

            const now = FV.serverTimestamp();
            if (total > 0) tx.update(userRef, { points: FV.increment(-total) });
            tx.set(cardsRef, { count: FV.increment(count), lastAt: now }, { merge: true });
            tx.set(ledgerRef, {
                uid: req.uid, type: 'card', kind, tpl, count, delta: -total,
                ...(targets.length === 1 ? { tmdbId: String(b.id), media: targets[0].media } : {}),
                ...(isPro && cost > 0 ? { via: 'pro' } : {}), at: now,
            });
            for (const t of targets) {
                tx.set(kcultureDb.collection('card_stats').doc(t.key), {
                    count: FV.increment(1), lastAt: now, media: t.media,
                    ...(t.titleId ? { titleId: t.titleId } : {}), ...(t.personId ? { personId: t.personId } : {}),
                    ...(targets.length === 1 && meta.titleName ? { name: meta.titleName } : {}),
                }, { merge: true });
            }
            // 카드에서 쓴 평가를 앱 평가로 저장하기 위한 paid 마커 — 값은 카드 값에 포함(추가 차감 없음)
            if (libRef) {
                const lib = lSnap?.exists ? lSnap.data() : {};
                if (lib.paid !== true) {
                    if (kind === 'person') {
                        tx.set(libRef, {
                            paid: true, paidAt: now, paidCost: 0, paidVia: 'card',
                            ...(lib.personName ? {} : meta.titleName ? { personName: meta.titleName } : {}),
                            ...(lib.profilePath ? {} : meta.posterPath ? { profilePath: meta.posterPath } : {}),
                            ...(lib.addedAt ? {} : { addedAt: now }),
                            updatedAt: now,
                        }, { merge: true });
                    } else {
                        tx.set(libRef, {
                            paid: true, paidAt: now, paidCost: 0, paidVia: 'card',
                            state: lib.state ?? 'plan',
                            episodesWatched: lib.episodesWatched ?? 0,
                            favorite: lib.favorite ?? false,
                            unlisted: false,
                            media: lib.media || targets[0].media,
                            ...(lib.titleName ? {} : meta.titleName ? { titleName: meta.titleName } : {}),
                            ...(lib.posterPath ? {} : meta.posterPath ? { posterPath: meta.posterPath } : {}),
                            ...(lib.addedAt ? {} : { addedAt: now }),
                            updatedAt: now,
                        }, { merge: true });
                    }
                }
            }
            return { points: cur - total, cost: total, made: made + count };
        });
        if (out.reject) return res.status(out.reject).json({ error: out.error, ...(out.points != null ? { points: out.points } : {}) });
        if (!dry) console.log(`[KC/Card] ${req.uid} ${kind}/${tpl} x${count} -${out.cost}pt → ${out.points}${isGuest ? ' (guest)' : ''}`);
        return res.json({ ok: true, dry, cost: out.cost, points: out.points, made: out.made });
    } catch (err) {
        console.error('[KC/Card] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
