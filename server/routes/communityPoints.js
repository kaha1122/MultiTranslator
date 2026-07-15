// ── K-DramaAnyLang(kculture-f96d8) 포인트 일회성 구매 — PayPal 단일 ─────────────
// 전 세계(한국 포함) PayPal Orders(Checkout, 일회성)로 통일.
// requireAuthAny(kculture 토큰 허용) + kcultureDb(admin) 로 서버측 결제검증 후 points 적립.
//
// ⚠ 보안 원칙(돈이 실린 포인트):
//   - 금액·지급 포인트의 유일한 권위는 서버 PACKAGES 테이블(클라 전송값 신뢰 안 함).
//   - 적립은 반드시 결제 검증(capture COMPLETED + 금액/통화/소유자 일치) 성공 후 서버 admin SDK로만.
//   - 멱등: pointPurchases/{captureId} 문서로 이중적립 차단.
//
// ⚠ users.points 본문 write: CLAUDE.md §6은 "서버는 users 본문 write 금지(titles/*만)"이나,
//   points는 명시된 "의도된 본문 라이브 필드"이며 구매는 드문 이벤트(클라 spendPoints/일일무료와
//   동일 빈도의 단일 write→단일 스냅샷)라 render storm 아님. 유료 적립은 서버 권위가 필수라 여기서만 예외.
//
// (2026-07: Toss 단일화 폐기 — 국내 MID 계약 미완. PayPal로 전 세계 통일. Toss 경로는 git 이력 참조.)
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const { requireAuthAny } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');
const { kcultureDb } = require('../config/firebaseKculture');

const router = express.Router();

// ── 서버 권위 패키지 테이블(단일 출처) ───────────────────────────────────────
// 금액/포인트는 절대 클라 body에서 도출하지 않는다.
// 2026-07-05: 150pt→1,000pt/$0.99 통일(웹 PayPal·네이티브 IAP) — 보상형 광고 5회=150pt와
// $1이 등가면 구매 유인이 없어 6.7배 가치로 조정. POINTS_ENABLED=false 기간이라 유통 주문 0.
const PACKAGES = {
    pt_pp_1000: { method: 'paypal', points: 1000, usd: '0.99', name: 'K-DramaAnyLang 1,000 Points' },
    kdrama_points_1000: { method: 'iap', points: 1000, usd: '0.99', name: 'K-DramaAnyLang 1,000 Points (IAP)' },
};

// ── 보상형 광고 지급 정책(서버 권위) ─────────────────────────────────────────
const AD_REWARD_AMOUNT = 30;      // 시청 1회 지급
const AD_COOLDOWN_MS = 60_000;    // 60초 쿨다운
const AD_DAILY_CAP = 5;           // 일 5회(UTC) → 일 최대 +150pt
const utcDateStr = () => new Date().toISOString().slice(0, 10);

// PayPal — KCulture 전용 자격증명. 없으면 라우트 503.
const PAYPAL_CLIENT_ID = process.env.KCULTURE_PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.KCULTURE_PAYPAL_SECRET;
const PAYPAL_API = process.env.KCULTURE_PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

async function getPayPalAccessToken() {
    const res = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: PAYPAL_CLIENT_ID, password: PAYPAL_SECRET },
    });
    return res.data.access_token;
}

// ── 멱등 적립: pointPurchases/{purchaseId} 생성 + users/{uid}.points increment (트랜잭션) ──
async function creditPoints(uid, pkgId, purchaseId, meta) {
    const pkg = PACKAGES[pkgId];
    const purchaseRef = kcultureDb.collection('pointPurchases').doc(purchaseId);
    const userRef = kcultureDb.collection('users').doc(uid);
    return kcultureDb.runTransaction(async (tx) => {
        const pSnap = await tx.get(purchaseRef);
        if (pSnap.exists && pSnap.data().status === 'granted') {
            return { already: true, points: pSnap.data().points || pkg.points };
        }
        tx.set(purchaseRef, {
            uid,
            packageId: pkgId,
            points: pkg.points,
            status: 'granted',
            ...meta,
            grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(userRef, { points: admin.firestore.FieldValue.increment(pkg.points) }, { merge: true });
        return { already: false, points: pkg.points };
    });
}

function assertReady(res) {
    if (!kcultureDb) {
        res.status(503).json({ error: 'kculture Firestore not configured (service account missing)' });
        return false;
    }
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
        res.status(503).json({ error: 'PayPal not configured' });
        return false;
    }
    return true;
}

// ── PayPal: 주문 생성 ─────────────────────────────────────────────────────────
// 금액은 서버 PACKAGES에서만. custom_id에 uid를 실어 capture 때 소유자 검증.
router.post('/api/community/points/paypal/create-order', requireAuthAny, rateLimit('kc-points-pp-create', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!assertReady(res)) return;
    const { packageId } = req.body || {};
    const pkg = PACKAGES[packageId];
    if (!pkg || pkg.method !== 'paypal') return res.status(400).json({ error: `unknown paypal package: ${packageId}` });

    try {
        const token = await getPayPalAccessToken();
        const orderRes = await axios.post(
            `${PAYPAL_API}/v2/checkout/orders`,
            {
                intent: 'CAPTURE',
                purchase_units: [{
                    custom_id: req.uid,
                    description: pkg.name,
                    amount: { currency_code: 'USD', value: pkg.usd },
                }],
                // 디지털 재화(포인트) — 배송주소 수집 안 함 + "지금 결제" 버튼으로 입력 최소화.
                application_context: {
                    brand_name: 'K-DramaAnyLang',
                    shipping_preference: 'NO_SHIPPING',
                    user_action: 'PAY_NOW',
                },
            },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        res.json({ id: orderRes.data.id });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[KC/Points] paypal create-order error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

// ── PayPal: 주문 캡처(승인) + 적립 ───────────────────────────────────────────
router.post('/api/community/points/paypal/capture', requireAuthAny, rateLimit('kc-points-pp-capture', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!assertReady(res)) return;
    const { orderId, packageId } = req.body || {};
    if (!orderId || !packageId) return res.status(400).json({ error: 'missing fields' });
    const pkg = PACKAGES[packageId];
    if (!pkg || pkg.method !== 'paypal') return res.status(400).json({ error: `unknown paypal package: ${packageId}` });

    try {
        const token = await getPayPalAccessToken();
        const capRes = await axios.post(
            `${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
            {},
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        const data = capRes.data;
        const pu = data.purchase_units?.[0];
        const capture = pu?.payments?.captures?.[0];

        // 검증: 완료 상태 + 금액/통화 일치 + 소유자(custom_id) 일치
        if (data.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
            return res.status(402).json({ error: `payment not completed: ${data.status}/${capture?.status}` });
        }
        const paidValue = capture.amount?.value;
        const paidCurrency = capture.amount?.currency_code;
        if (paidCurrency !== 'USD' || Number(paidValue) !== Number(pkg.usd)) {
            console.warn(`[KC/Points] paypal amount mismatch: paid ${paidValue} ${paidCurrency} expected ${pkg.usd} USD`);
            return res.status(400).json({ error: 'amount mismatch' });
        }
        const ownerUid = capture.custom_id || pu?.custom_id;
        if (ownerUid && ownerUid !== req.uid) {
            return res.status(403).json({ error: 'order owner mismatch' });
        }

        // 멱등키: capture.id(캡처 1건 = 적립 1회)
        const result = await creditPoints(req.uid, packageId, `pp_${capture.id}`, {
            method: 'paypal',
            paypalOrderId: orderId,
            captureId: capture.id,
            amount: paidValue,
            currency: 'USD',
        });
        console.log(`[KC/Points] paypal credited: ${req.uid} +${result.points}pt (${capture.id}${result.already ? ', idempotent' : ''})`);
        res.json({ success: true, points: result.points });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[KC/Points] paypal capture error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

// ── 보상형 광고 지급 (네이티브 AdMob rewarded — 클라가 시청 완료 후 claim) ──────
// AdMob SSV 미적용(PronunFit adReward.js와 동일 스탠스) — 클라가 시청 없이 호출할 수는
// 있으나 쿨다운(60s)+일일캡(5회)+rateLimit 3중 방어로 손실 상한이 일 150pt로 명확.
// 단일 트랜잭션에서 쿨다운/캡 검사와 지급을 함께 수행(슬롯 선점·지급 분리 창 제거).
// ⚠ assertReady() 미사용 — PayPal env와 무관(kcultureDb만 필요).
router.post('/api/community/points/ad-reward', requireAuthAny, rateLimit('kc-ad-reward', { perMinute: 4, perHour: 40 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    const userRef = kcultureDb.collection('users').doc(req.uid);
    const today = utcDateStr();
    try {
        const claim = await kcultureDb.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { reject: 404, error: 'user_not_found' };
            const d = snap.data();
            const lastAt = d.lastAdRewardAt?.toMillis?.() || 0;
            if (Date.now() - lastAt < AD_COOLDOWN_MS) return { reject: 429, error: 'cooldown' };
            const todayCount = d.adRewardCountDate === today ? (d.adRewardCount || 0) : 0;
            if (todayCount >= AD_DAILY_CAP) return { reject: 429, error: 'daily_cap' };
            tx.update(userRef, {
                lastAdRewardAt: admin.firestore.FieldValue.serverTimestamp(),
                adRewardCountDate: today,
                adRewardCount: todayCount + 1,
                points: admin.firestore.FieldValue.increment(AD_REWARD_AMOUNT),
            });
            return { todayCount };
        });
        if (claim.reject) return res.status(claim.reject).json({ error: claim.error });
        console.log(`[KC/Points] ad-reward: ${req.uid} +${AD_REWARD_AMOUNT}pt (${claim.todayCount + 1}/${AD_DAILY_CAP})`);
        return res.json({ success: true, granted: AD_REWARD_AMOUNT, remainingToday: AD_DAILY_CAP - (claim.todayCount + 1) });
    } catch (err) {
        console.error('[KC/Points] ad-reward error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── 네이티브 IAP(RevenueCat consumable) 적립 확정 ───────────────────────────
// 영수증 검증 없음(PronunFit confirm-point-purchase와 동일) — 적립 대상은 인증된
// req.uid 권위 + pointPurchases/{iap_txId} 멱등으로 이중적립 차단.
// RevenueCat 웹훅 대조(webhook_seen 패턴)는 RC 프로젝트 생성 후 선택 과제.
router.post('/api/community/points/confirm-iap', requireAuthAny, rateLimit('kc-points-iap', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    const txId = String(req.body?.txId || '').trim();
    if (!txId || txId.length > 200) return res.status(400).json({ error: 'txId required' });
    try {
        const result = await creditPoints(req.uid, 'kdrama_points_1000', `iap_${txId}`, { method: 'iap', txId });
        console.log(`[KC/Points] iap credited: ${req.uid} +${result.points}pt (${txId}${result.already ? ', idempotent' : ''})`);
        return res.json({ success: true, points: result.points, alreadyGranted: result.already });
    } catch (err) {
        console.error('[KC/Points] confirm-iap error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
