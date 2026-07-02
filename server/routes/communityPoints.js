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
const PACKAGES = {
    pt_pp_150: { method: 'paypal', points: 150, usd: '0.99', name: 'K-DramaAnyLang 150 Points' },
};

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

module.exports = router;
