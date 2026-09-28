// ── PronunFit 웹 포인트 일회성 구매 (2026-09-28) ─────────────────────────────
// 국내: 토스페이먼츠 결제창 v2 일반결제(카드) / 해외: PayPal Orders(CAPTURE).
// 앱 인앱결제(pronunfit_points_200 → +1000pt, confirm-point-purchase)와 같은 포인트 풀(users.bonusPoints)과
// 같은 구매 기록 컬렉션(pointPurchases)을 쓴다. 웹 구매는 문서 id 접두어로 구분(toss_{paymentKey} · pp_{captureId}).
//
// 흐름(K-DramaAnyLang communityPoints.js의 검증된 패턴을 PronunFit 기본 Firestore로 이식):
//   Toss  : /toss/prepare(서버가 pointOrders/{pfpt_…}에 uid·금액 고정) → 결제창 → successUrl 복귀
//           → /toss/confirm(주문·소유자·금액 대조 → 승인 API(Idempotency-Key) → DONE·금액 재검증 → 멱등 적립)
//   PayPal: /paypal/create-order(custom_id=uid) → 승인 → /paypal/capture(COMPLETED·금액·소유자 검증 → 멱등 적립)
//
// ⚠ 보안 원칙(돈이 실린 포인트):
//   - 금액·지급량의 유일한 권위는 아래 PACKAGES(클라 전송값 신뢰 안 함). 클라 표시는 /status 응답을 그대로 쓴다.
//   - 게스트(익명) 차단 — 기기를 잃으면 복구 불가라 유료 포인트를 귀속시키지 않는다.
//   - 키가 없으면 503(fail-closed).
//
// 공개 게이트(심사 기간 대응 — 2026-09-28 사용자 결정 "상품·가격·약관만 노출, 결제 버튼은 준비 중"):
//   - Toss   : 라이브 키(live_)면 전원 결제 가능. 테스트 키(test_)면 WEB_POINTS_TESTER_UIDS에 있는 계정만.
//              → 계약 전 production에서 테스트 카드로 포인트가 지급되는 경로를 막는다.
//   - PayPal : WEB_POINTS_PAYPAL_ENABLED=1이면 전원, 아니면 테스터만. (구독과 같은 PayPal 앱 자격증명·모드 사용)
//   클라는 /status의 available로 버튼 활성/“결제 준비 중”을 정한다 — 키 교체·공개는 Render env만으로(재배포 불필요).
//
// 라이브 전환 시 확인: 일반결제 MID가 구독(빌링) MID와 다르면 그 MID의 웹훅도 /api/toss-webhook으로 등록하고
//   서명 시크릿이 같은지 확인(webhook.js verifyTossWebhook은 TOSS_WEBHOOK_SECRET 하나만 검증한다).
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { admin, adminDb } = require('../config/firebase');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// ── 서버 권위 패키지 테이블 ──────────────────────────────────────────────────
// 앱 스토어 가격과 동일(2026-09-28 사용자 결정 "앱과 같아야 함"): pronunfit_points_200 = $0.99 기준, 국내 ₩1,200
//   (claude-memory changes-0607-session3 — Play 국가별 가격 튜닝값). 지급량은 IAP와 같은 1000pt(webhook.js POINTS_AMOUNT).
//   ⚠ 스토어 가격을 바꾸면 여기와 약관 표기를 같이 바꾼다.
const POINTS = 1000;
const PACKAGES = {
    pf_pt_toss_1000: { method: 'toss', points: POINTS, krw: 1200, name: 'PronunFit 1,000 Points' },
    pf_pt_pp_1000: { method: 'paypal', points: POINTS, usd: '0.99', name: 'PronunFit 1,000 Points' },
};

// ── 토스페이먼츠(일반결제) — 구독 빌링 키(TOSS_SECRET_KEY)와 분리. 클라이언트 키는 /status로 내려준다(공개 키). ──
const TOSS_SECRET_KEY = process.env.TOSS_POINTS_SECRET_KEY || '';
const TOSS_CLIENT_KEY = process.env.TOSS_POINTS_CLIENT_KEY || '';
const TOSS_API = 'https://api.tosspayments.com/v1';
const tossAuthHeader = () => 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
const tossIsTest = () => TOSS_SECRET_KEY.startsWith('test_');
// orderId 규칙: 영문·숫자·`-_=` 6~64자. 접두어 pfpt_ — toss-webhook이 포인트 주문을 구독과 구분하는 기준이다.
const newTossOrderId = () => `pfpt_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;

// ── PayPal — 구독과 같은 PronunFit 앱 자격증명 ───────────────────────────────
const PAYPAL_CLIENT_ID = process.env.VITE_PAYPAL_CLIENT_ID || '';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || '';
const PAYPAL_IS_LIVE = process.env.PAYPAL_MODE === 'live';
const PAYPAL_API = PAYPAL_IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const PAYPAL_OPEN = process.env.WEB_POINTS_PAYPAL_ENABLED === '1';

const TESTERS = new Set(String(process.env.WEB_POINTS_TESTER_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean));

const tossAvailable = (uid) => !!TOSS_SECRET_KEY && !!TOSS_CLIENT_KEY && (!tossIsTest() || TESTERS.has(uid));
const paypalAvailable = (uid) => !!PAYPAL_CLIENT_ID && !!PAYPAL_SECRET && (PAYPAL_OPEN || TESTERS.has(uid));

// ── 인증: requireAuth와 같되 익명 여부(sign_in_provider)까지 싣는다(requireAuth는 uid만 싣는다) ──
async function requireUser(req, res, next) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authorization header required' });
    if (!admin.apps.length) return res.status(503).json({ error: 'auth not configured' });
    try {
        const decoded = await admin.auth().verifyIdToken(h.slice(7));
        req.uid = decoded.uid;
        req.isAnonymous = decoded.firebase?.sign_in_provider === 'anonymous';
        next();
    } catch (err) {
        console.error('[PF/WebPoints] token verify failed:', err.message);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
const guestBlocked = (req, res) => {
    if (!req.isAnonymous) return false;
    res.status(403).json({ error: 'guest cannot purchase', code: 'GUEST_NOT_ALLOWED' });
    return true;
};

// ── 멱등 적립 — confirm-point-purchase(webhook.js)와 같은 스키마를 한 트랜잭션으로 ──
async function creditPoints(uid, pkgId, purchaseId, meta) {
    const pkg = PACKAGES[pkgId];
    const purchaseRef = adminDb.collection('pointPurchases').doc(purchaseId);
    const userRef = adminDb.collection('users').doc(uid);
    return adminDb.runTransaction(async (tx) => {
        const pSnap = await tx.get(purchaseRef);
        if (pSnap.exists && pSnap.data().status === 'granted') return { already: true, points: pSnap.data().amount || pkg.points };
        const now = admin.firestore.FieldValue.serverTimestamp();
        tx.set(userRef, { bonusPoints: admin.firestore.FieldValue.increment(pkg.points), bonusLastGrantedAt: now }, { merge: true });
        tx.set(userRef.collection('bonusEvents').doc(), {
            source: 'pointPurchase', amount: pkg.points, meta: { purchaseId, via: 'web', method: pkg.method }, createdAt: now,
        });
        tx.set(purchaseRef, {
            uid, status: 'granted', source: 'web', productId: pkgId, amount: pkg.points, ...meta, grantedAt: now,
        }, { merge: true });
        return { already: false, points: pkg.points };
    });
}

// ── 상태: 상품·가격(표시용 단일 출처) + 결제수단별 가용 여부 ─────────────────────────
router.get('/api/points/web/status', requireUser, async (req, res) => {
    const toss = PACKAGES.pf_pt_toss_1000;
    const pp = PACKAGES.pf_pt_pp_1000;
    const tOk = tossAvailable(req.uid);
    const pOk = paypalAvailable(req.uid);
    res.json({
        guest: !!req.isAnonymous,
        toss: { packageId: 'pf_pt_toss_1000', points: toss.points, amount: toss.krw, currency: 'KRW',
            available: tOk, clientKey: tOk ? TOSS_CLIENT_KEY : null, test: tossIsTest() },
        paypal: { packageId: 'pf_pt_pp_1000', points: pp.points, amount: pp.usd, currency: 'USD',
            available: pOk, clientId: pOk ? PAYPAL_CLIENT_ID : null, test: !PAYPAL_IS_LIVE },
    });
});

// ── Toss: 주문 준비 ──────────────────────────────────────────────────────────
router.post('/api/points/toss/prepare', requireUser, rateLimit('pf-points-toss-prepare', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'Firestore not configured' });
    if (guestBlocked(req, res)) return;
    if (!tossAvailable(req.uid)) return res.status(503).json({ error: 'toss points not available', code: 'NOT_AVAILABLE' });
    const pkgId = 'pf_pt_toss_1000';
    const pkg = PACKAGES[pkgId];
    try {
        const orderId = newTossOrderId();
        await adminDb.collection('pointOrders').doc(orderId).set({
            uid: req.uid, method: 'toss', packageId: pkgId, points: pkg.points,
            amount: pkg.krw, currency: 'KRW', status: 'pending', test: tossIsTest(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ orderId, amount: pkg.krw, currency: 'KRW', orderName: pkg.name, points: pkg.points });
    } catch (err) {
        console.error('[PF/WebPoints] toss prepare error:', err.message);
        res.status(500).json({ error: 'prepare failed' });
    }
});

async function tossGetPayment(paymentKey) {
    const r = await axios.get(`${TOSS_API}/payments/${encodeURIComponent(paymentKey)}`, {
        headers: { Authorization: tossAuthHeader() }, timeout: 15000,
    });
    return r.data;
}

// ── Toss: 승인 + 적립 ─────────────────────────────────────────────────────────
// 검증 순서: 주문 존재 → 소유자 → 금액(서버 주문 == 복귀 URL amount) → 승인 API → 응답 DONE·주문번호·금액·통화 → 멱등 적립.
router.post('/api/points/toss/confirm', requireUser, rateLimit('pf-points-toss-confirm', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!adminDb) return res.status(503).json({ error: 'Firestore not configured' });
    if (!TOSS_SECRET_KEY) return res.status(503).json({ error: 'toss not configured' });
    if (guestBlocked(req, res)) return;
    const paymentKey = String(req.body?.paymentKey || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const amount = Number(req.body?.amount);
    if (!paymentKey || !orderId || !Number.isFinite(amount)) return res.status(400).json({ error: 'missing fields' });
    if (paymentKey.length > 200 || orderId.length > 64 || !orderId.startsWith('pfpt_')) return res.status(400).json({ error: 'invalid fields' });

    const orderRef = adminDb.collection('pointOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'unknown order' });
    const order = snap.data();
    if (order.uid !== req.uid) return res.status(403).json({ error: 'order owner mismatch' });
    if (order.status === 'done') return res.json({ success: true, points: order.points, alreadyGranted: true });
    if (Number(order.amount) !== amount) {
        console.warn(`[PF/WebPoints] toss amount mismatch: client ${amount} vs order ${order.amount} (${orderId})`);
        return res.status(400).json({ error: 'amount mismatch' });
    }

    let payment;
    try {
        const r = await axios.post(`${TOSS_API}/payments/confirm`, { paymentKey, orderId, amount: order.amount }, {
            headers: { Authorization: tossAuthHeader(), 'Content-Type': 'application/json', 'Idempotency-Key': orderId },
            timeout: 20000,
        });
        payment = r.data;
    } catch (err) {
        const d = err.response?.data;
        if (d?.code === 'ALREADY_PROCESSED_PAYMENT') {
            try { payment = await tossGetPayment(paymentKey); } catch (e2) {
                console.error('[PF/WebPoints] toss lookup after ALREADY_PROCESSED failed:', e2.response?.data || e2.message);
                return res.status(502).json({ error: 'payment lookup failed' });
            }
        } else {
            console.error('[PF/WebPoints] toss confirm error:', d || err.message);
            await orderRef.set({ status: 'failed', paymentKey, errorCode: d?.code || null, errorMessage: d?.message || err.message,
                failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            return res.status(402).json({ error: d?.message || 'payment confirm failed', code: d?.code || null });
        }
    }

    if (payment?.status !== 'DONE' || payment?.orderId !== orderId || Number(payment?.totalAmount) !== Number(order.amount)
        || (payment?.currency && payment.currency !== 'KRW')) {
        console.warn(`[PF/WebPoints] toss payment not acceptable: status=${payment?.status} total=${payment?.totalAmount} (${orderId})`);
        await orderRef.set({ status: 'failed', paymentKey, tossStatus: payment?.status || null,
            failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return res.status(402).json({ error: `payment not completed: ${payment?.status || 'unknown'}` });
    }

    try {
        const result = await creditPoints(req.uid, order.packageId, `toss_${paymentKey}`, {
            method: 'toss', orderId, paymentKey, price: payment.totalAmount, currency: 'KRW',
            tossMethod: payment.method || null, approvedAt: payment.approvedAt || null, test: tossIsTest(),
        });
        await orderRef.set({ status: 'done', paymentKey, tossMethod: payment.method || null,
            confirmedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        console.log(`[PF/WebPoints] toss credited: ${req.uid} +${result.points}pt (${orderId}${result.already ? ', idempotent' : ''}${tossIsTest() ? ', TEST' : ''})`);
        res.json({ success: true, points: result.points, alreadyGranted: result.already });
    } catch (err) {
        console.error('[PF/WebPoints] toss credit error:', err.message);
        res.status(500).json({ error: 'credit failed' });
    }
});

// ── PayPal ───────────────────────────────────────────────────────────────────
async function getPayPalAccessToken() {
    const r = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: PAYPAL_CLIENT_ID, password: PAYPAL_SECRET },
        timeout: 15000,
    });
    return r.data.access_token;
}

router.post('/api/points/paypal/create-order', requireUser, rateLimit('pf-points-pp-create', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (guestBlocked(req, res)) return;
    if (!paypalAvailable(req.uid)) return res.status(503).json({ error: 'paypal points not available', code: 'NOT_AVAILABLE' });
    const pkg = PACKAGES.pf_pt_pp_1000;
    try {
        const token = await getPayPalAccessToken();
        const r = await axios.post(`${PAYPAL_API}/v2/checkout/orders`, {
            intent: 'CAPTURE',
            purchase_units: [{ custom_id: req.uid, description: pkg.name, amount: { currency_code: 'USD', value: pkg.usd } }],
            // 디지털 재화 — 배송지 수집 안 함 + "지금 결제"
            application_context: { brand_name: 'PronunFit', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
        }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        res.json({ id: r.data.id });
    } catch (err) {
        console.error('[PF/WebPoints] paypal create-order error:', err.response?.data || err.message);
        res.status(500).json({ error: 'create-order failed' });
    }
});

router.post('/api/points/paypal/capture', requireUser, rateLimit('pf-points-pp-capture', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (guestBlocked(req, res)) return;
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return res.status(503).json({ error: 'paypal not configured' });
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId || orderId.length > 64) return res.status(400).json({ error: 'missing fields' });
    const pkg = PACKAGES.pf_pt_pp_1000;
    try {
        const token = await getPayPalAccessToken();
        const r = await axios.post(`${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {},
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        const data = r.data;
        const pu = data.purchase_units?.[0];
        const capture = pu?.payments?.captures?.[0];
        if (data.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
            return res.status(402).json({ error: `payment not completed: ${data.status}/${capture?.status}` });
        }
        if (capture.amount?.currency_code !== 'USD' || Number(capture.amount?.value) !== Number(pkg.usd)) {
            console.warn(`[PF/WebPoints] paypal amount mismatch: ${capture.amount?.value} ${capture.amount?.currency_code}`);
            return res.status(400).json({ error: 'amount mismatch' });
        }
        const owner = capture.custom_id || pu?.custom_id;
        if (owner !== req.uid) return res.status(403).json({ error: 'order owner mismatch' });

        const result = await creditPoints(req.uid, 'pf_pt_pp_1000', `pp_${capture.id}`, {
            method: 'paypal', paypalOrderId: orderId, captureId: capture.id, price: capture.amount.value, currency: 'USD',
            test: !PAYPAL_IS_LIVE,
        });
        console.log(`[PF/WebPoints] paypal credited: ${req.uid} +${result.points}pt (${capture.id}${result.already ? ', idempotent' : ''})`);
        res.json({ success: true, points: result.points, alreadyGranted: result.already });
    } catch (err) {
        console.error('[PF/WebPoints] paypal capture error:', err.response?.data || err.message);
        res.status(500).json({ error: 'capture failed' });
    }
});

// ── Toss 웹훅 — 포인트 주문 취소/환불 처리 (webhook.js의 /api/toss-webhook이 pfpt_ 주문을 여기로 넘긴다) ──
// 구독 로직(무료 등급 강등·빌링키 폐기)을 절대 타지 않게 하는 것이 목적. 환불 정책(미사용분만)은 운영자가
// 토스 콘솔에서 판단해 취소하고, 여기서는 지급분을 회수한다(0 미만으로는 내리지 않음). 멱등.
async function handleTossPointsWebhook(data) {
    const { status, orderId, paymentKey } = data || {};
    // 전액 취소만 회수. 부분 취소는 ₩1,200 단일 상품에서 쓰지 않는 경로라 로그만 남기고 사람이 처리한다.
    if (status === 'PARTIAL_CANCELED') console.warn(`[PF/WebPoints] toss PARTIAL_CANCELED ${orderId} — 수동 확인 필요(자동 회수 안 함)`);
    if (status !== 'CANCELED') return { handled: true, ignored: status };
    const orderRef = adminDb.collection('pointOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return { handled: true, missing: true };
    const order = orderSnap.data();
    const pk = paymentKey || order.paymentKey;
    const purchaseRef = adminDb.collection('pointPurchases').doc(`toss_${pk}`);
    const userRef = adminDb.collection('users').doc(order.uid);
    const result = await adminDb.runTransaction(async (tx) => {
        const [pSnap, uSnap] = await Promise.all([tx.get(purchaseRef), tx.get(userRef)]);
        if (!pSnap.exists || pSnap.data().status !== 'granted') return { reclaimed: 0 };
        const cur = Number(uSnap.exists ? uSnap.data().bonusPoints || 0 : 0);
        const reclaim = Math.min(cur, Number(pSnap.data().amount || order.points || 0));
        const now = admin.firestore.FieldValue.serverTimestamp();
        tx.set(userRef, { bonusPoints: cur - reclaim }, { merge: true });
        tx.set(userRef.collection('bonusEvents').doc(), { source: 'pointRefund', amount: -reclaim, meta: { orderId, paymentKey: pk }, createdAt: now });
        tx.set(purchaseRef, { status: 'refunded', refundedAt: now, reclaimed: reclaim }, { merge: true });
        tx.set(orderRef, { status: 'canceled', canceledAt: now }, { merge: true });
        return { reclaimed: reclaim };
    });
    console.log(`[PF/WebPoints] toss ${status} ${orderId}: reclaimed ${result.reclaimed}pt from ${order.uid}`);
    return { handled: true, ...result };
}

module.exports = router;
module.exports.handleTossPointsWebhook = handleTossPointsWebhook;
