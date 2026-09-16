// ── K-DramaAnyLang(kculture-f96d8) Pro 연간 구독 ───────────────────────────────
// 계획·결정: KCulture docs/SUBSCRIPTION_PLAN.md (2026-09-16). 광고 제거 전용, 포인트와 별개.
//   네이티브(iOS/Android) = RevenueCat 자동갱신 구독(entitlement `pro`, 상품 kdrama_pro_yearly)
//   웹 = 토스(₩31,000)·PayPal($22.99) **연 1회 단건, 자동갱신 없음** — 결제 시 pro.until을 +365일 연장.
//
// 자격 SSOT: users/{uid}.pro = { until(Timestamp), source:'rc'|'toss'|'paypal', productId, willRenew, updatedAt }
//   - 서버(admin)만 쓴다(firestore.rules에서 클라 write 차단). 클라 판정은 pro.until > now.
//   - users 본문 라이브 필드(points와 동일 예외) — 구독 이벤트는 드물어 render storm 아님.
//
// ⚠ 보안 원칙(communityPoints.js와 동일): 금액·기간 권위는 서버 SUB_PACKAGES. 결제 검증 성공 후 admin SDK로만 반영.
//   멱등: subPurchases/{purchaseId}(웹) · subEvents/{rcEventId}(웹훅) 로 이중 반영 차단.
// ⚠ RC 웹훅 app_user_id 신뢰 범위: KDL은 게스트(익명) 구매를 차단하고 RC appUserID=Firebase uid로 configure하므로
//   PronunFit의 "옛 익명 uid 고정" 사고 조건이 없다. 그래도 존재하지 않는 users 문서엔 쓰지 않고(로그만),
//   클라는 구매 직후 /confirm-iap(인증 uid + RC REST 재조회)로 즉시 반영해 웹훅 지연·오귀속을 보정한다.
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { requireAuthAny } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');
const { kcultureDb } = require('../config/firebaseKculture');

const router = express.Router();

// ── 서버 권위 상품 테이블(단일 출처) — 클라 sub.js 표시값은 여기와 수동 동기 ─────────
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SUB_PACKAGES = {
    kdrama_pro_yearly: { method: 'iap', usd: '22.99', name: 'K-DramaAnyLang Pro (1 year)' },
    sub_pp_yearly: { method: 'paypal', usd: '22.99', name: 'K-DramaAnyLang Pro (1 year)' },
    sub_toss_yearly: { method: 'toss', krw: 31000, name: 'K-DramaAnyLang Pro 1년' },
};
const RC_PRO_ENTITLEMENT = 'pro';
const RC_PRO_PRODUCTS = new Set(['kdrama_pro_yearly']);

// ── 자격증명(전부 KCULTURE_ 접두 — PronunFit 것과 분리) ─────────────────────────
const PAYPAL_CLIENT_ID = process.env.KCULTURE_PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.KCULTURE_PAYPAL_SECRET;
const PAYPAL_API = process.env.KCULTURE_PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const TOSS_SECRET_KEY = process.env.KCULTURE_TOSS_SECRET_KEY;
const TOSS_API = 'https://api.tosspayments.com/v1';
const tossAuthHeader = () => 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
const tossIsTest = () => !!TOSS_SECRET_KEY && TOSS_SECRET_KEY.startsWith('test_');
// RevenueCat — KDL 프로젝트 전용. 웹훅 Authorization 값·REST secret(v1) 둘 다 Render env.
const RC_WEBHOOK_AUTH = process.env.KCULTURE_RC_WEBHOOK_AUTH;
const RC_SECRET_KEY = process.env.KCULTURE_REVENUECAT_SECRET_KEY;
const RC_API = 'https://api.revenuecat.com/v1';
const ALLOW_INSECURE = process.env.ALLOW_INSECURE_WEBHOOKS === '1';

const newOrderId = () => `kdlsub_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
const ts = (ms) => admin.firestore.Timestamp.fromMillis(ms);
const untilMs = (pro) => pro?.until?.toMillis?.() || 0;
const isActive = (pro) => untilMs(pro) > Date.now();

async function getPayPalAccessToken() {
    const res = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: PAYPAL_CLIENT_ID, password: PAYPAL_SECRET },
    });
    return res.data.access_token;
}

// 공통 게이트 — 구독은 계정 종속이라 게스트(익명)·dev 차단.
function rejectGuest(req, res) {
    if (req.uid === 'dev-user') { res.status(403).json({ error: 'auth required' }); return true; }
    if (req.authProvider === 'anonymous') { res.status(403).json({ error: 'guest cannot subscribe', code: 'GUEST_NOT_ALLOWED' }); return true; }
    return false;
}

const publicPro = (pro) => pro ? ({
    until: untilMs(pro) || null, source: pro.source || null, productId: pro.productId || null,
    willRenew: !!pro.willRenew, active: isActive(pro),
}) : { until: null, source: null, productId: null, willRenew: false, active: false };

// ── 웹 단건 1년 부여(멱등) ─────────────────────────────────────────────────────
// 기준일 = max(now, 기존 until) → +365일(남은 기간 위에 누적). 기존 활성 자격이 RC 자동갱신이면 웹 결제를
// 받지 않는다(이중 결제 방지 — prepare/create-order 단계에서 409로 선차단, 여기선 최종 안전장치).
async function grantWebYear(uid, pkgId, purchaseId, meta) {
    const pkg = SUB_PACKAGES[pkgId];
    const purchaseRef = kcultureDb.collection('subPurchases').doc(purchaseId);
    const userRef = kcultureDb.collection('users').doc(uid);
    return kcultureDb.runTransaction(async (tx) => {
        const [pSnap, uSnap] = await Promise.all([tx.get(purchaseRef), tx.get(userRef)]);
        if (pSnap.exists && pSnap.data().status === 'granted') {
            return { already: true, until: pSnap.data().until?.toMillis?.() || null };
        }
        const cur = uSnap.exists ? uSnap.data().pro : null;
        const base = Math.max(Date.now(), isActive(cur) && cur.source !== 'rc' ? untilMs(cur) : 0);
        const until = base + YEAR_MS;
        tx.set(purchaseRef, {
            uid, packageId: pkgId, method: pkg.method, status: 'granted', until: ts(until), ...meta,
            grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(userRef, {
            pro: { until: ts(until), source: pkg.method, productId: pkgId, willRenew: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        }, { merge: true });
        return { already: false, until };
    });
}

// 웹 결제 시작 전 — 활성 RC 구독이면 웹 결제 불필요(스토어에서 자동갱신 중). 409.
async function blockIfStoreActive(uid, res) {
    const snap = await kcultureDb.collection('users').doc(uid).get();
    const pro = snap.exists ? snap.data().pro : null;
    if (isActive(pro) && pro.source === 'rc') {
        res.status(409).json({ error: 'active store subscription', code: 'ALREADY_SUBSCRIBED_STORE', pro: publicPro(pro) });
        return true;
    }
    return false;
}

// ── RevenueCat: 서버측 재조회 → users.pro 동기 ────────────────────────────────
// GET /v1/subscribers/{uid} → entitlements.pro.expires_date. 404 = 구독자 없음(정상). RC 자격이 없고 현재 pro가
// rc 소스면 만료 처리, 웹 소스면 건드리지 않는다(웹 단건은 RC가 모름).
async function syncFromRC(uid) {
    if (!RC_SECRET_KEY) throw Object.assign(new Error('RevenueCat not configured'), { status: 503 });
    let subscriber = null;
    try {
        const r = await axios.get(`${RC_API}/subscribers/${encodeURIComponent(uid)}`, {
            headers: { Authorization: `Bearer ${RC_SECRET_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000,
        });
        subscriber = r.data?.subscriber || null;
    } catch (err) {
        if (err.response?.status === 404) subscriber = null;
        else throw err;
    }
    const ent = subscriber?.entitlements?.[RC_PRO_ENTITLEMENT] || null;
    const expiresMs = ent?.expires_date ? Date.parse(ent.expires_date) : 0;
    const productId = ent?.product_identifier || null;
    const subInfo = productId ? subscriber?.subscriptions?.[productId] : null;
    const willRenew = !!subInfo && !subInfo.unsubscribe_detected_at && !subInfo.billing_issues_detected_at;

    const userRef = kcultureDb.collection('users').doc(uid);
    return kcultureDb.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return { changed: false, pro: null, reason: 'user_not_found' };
        const cur = snap.data().pro || null;
        let next = cur;
        if (expiresMs > Date.now()) {
            // RC 자격 활성 — 웹 단건이 더 길게 남아 있으면 그쪽을 유지(둘 중 긴 쪽).
            if (!(isActive(cur) && cur.source !== 'rc' && untilMs(cur) > expiresMs)) {
                next = { until: ts(expiresMs), source: 'rc', productId, willRenew };
            }
        } else if (cur && cur.source === 'rc' && isActive(cur)) {
            // RC가 만료라는데 우리 문서는 활성 — RC 기준으로 만료 반영(환불·취소 후 만료).
            next = { ...cur, until: ts(Math.max(expiresMs, 0) || Date.now()), willRenew: false };
        }
        const changed = JSON.stringify(publicPro(next)) !== JSON.stringify(publicPro(cur));
        if (changed) tx.set(userRef, { pro: { ...next, updatedAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
        return { changed, pro: next };
    });
}

// ── 상태 조회(+RC 재검증) — 앱 시작·[구매 복원]·설정 화면 진입 ─────────────────────
router.get('/api/community/sub/status', requireAuthAny, rateLimit('kc-sub-status', { perMinute: 10, perHour: 120 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    try {
        let pro = null;
        if (RC_SECRET_KEY && req.query.sync !== '0') {
            ({ pro } = await syncFromRC(req.uid));
        } else {
            const snap = await kcultureDb.collection('users').doc(req.uid).get();
            pro = snap.exists ? snap.data().pro : null;
        }
        res.json({ pro: publicPro(pro) });
    } catch (err) {
        console.error('[KC/Sub] status error:', err.response?.data || err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ── 네이티브 IAP 확정 — 구매 직후 클라 호출(인증 uid 권위 + RC REST 재조회) ──────────
router.post('/api/community/sub/confirm-iap', requireAuthAny, rateLimit('kc-sub-iap', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    if (rejectGuest(req, res)) return;
    const txId = String(req.body?.txId || '').trim().slice(0, 200);
    try {
        const { pro, changed } = await syncFromRC(req.uid);
        console.log(`[KC/Sub] confirm-iap: ${req.uid} active=${isActive(pro)} until=${untilMs(pro) ? new Date(untilMs(pro)).toISOString() : '-'} tx=${txId || '-'}${changed ? '' : ' (no change)'}`);
        if (!isActive(pro)) return res.status(402).json({ error: 'entitlement not active', pro: publicPro(pro) });
        res.json({ success: true, pro: publicPro(pro) });
    } catch (err) {
        console.error('[KC/Sub] confirm-iap error:', err.response?.data || err.message);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ── RevenueCat 웹훅 — 갱신·취소·만료를 앱이 꺼져 있어도 반영 ──────────────────────
// https://www.revenuecat.com/docs/integrations/webhooks  Authorization 헤더 = KCULTURE_RC_WEBHOOK_AUTH(fail-closed).
// 멱등: subEvents/{event.id}.create(). 처리 후 항상 200(RC 재전송 폭주 방지) — 실패는 로그+문서 status로 남긴다.
function verifyRcWebhook(req, res, next) {
    if (!RC_WEBHOOK_AUTH) {
        if (ALLOW_INSECURE) { console.warn('[KC/Sub] webhook auth not set — skipping (ALLOW_INSECURE_WEBHOOKS)'); return next(); }
        console.error('[KC/Sub] KCULTURE_RC_WEBHOOK_AUTH not set — rejecting webhook (fail-closed)');
        return res.status(503).json({ error: 'Webhook auth not configured' });
    }
    const token = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (token !== RC_WEBHOOK_AUTH) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

const RC_EVENTS_ACTIVATE = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
const RC_EVENTS_KEEP_UNTIL = new Set(['CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']); // 자격은 만료일까지 유지, willRenew만 false
const RC_EVENTS_EXPIRE = new Set(['EXPIRATION']);

router.post('/api/community/sub/rc-webhook', verifyRcWebhook, async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    const ev = req.body?.event || {};
    const type = ev.type;
    const uid = ev.app_user_id;
    const eventId = String(ev.id || `${type}_${uid}_${ev.event_timestamp_ms || ''}`);
    if (!type || !uid) return res.status(400).json({ error: 'missing event type or app_user_id' });

    const productId = ev.product_id || null;
    const isPro = RC_PRO_PRODUCTS.has(productId) || (Array.isArray(ev.entitlement_ids) && ev.entitlement_ids.includes(RC_PRO_ENTITLEMENT));
    if (!isPro) return res.json({ ok: true, ignored: 'not pro product' });
    if (type === 'TEST') return res.json({ ok: true, test: true });

    const evRef = kcultureDb.collection('subEvents').doc(eventId);
    try {
        await evRef.create({ uid, type, productId, store: ev.store || null, environment: ev.environment || null, expirationMs: ev.expiration_at_ms || null, receivedAt: admin.firestore.FieldValue.serverTimestamp(), status: 'received' });
    } catch (err) {
        if (err.code === 6 || /already exists/i.test(err.message)) return res.json({ ok: true, duplicate: true });
        console.error('[KC/Sub] webhook event write failed:', err.message);
        return res.status(500).json({ error: err.message });
    }

    try {
        const userRef = kcultureDb.collection('users').doc(uid);
        const result = await kcultureDb.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return { applied: false, reason: 'user_not_found' };
            const cur = snap.data().pro || null;
            const expMs = Number(ev.expiration_at_ms) || 0;
            let next = null;
            if (RC_EVENTS_ACTIVATE.has(type) && expMs > Date.now()) {
                // 웹 단건이 더 길게 남아 있으면 유지(긴 쪽 우선).
                if (isActive(cur) && cur.source !== 'rc' && untilMs(cur) > expMs) return { applied: false, reason: 'web_longer' };
                next = { until: ts(expMs), source: 'rc', productId, willRenew: true };
            } else if (RC_EVENTS_KEEP_UNTIL.has(type)) {
                if (!cur || cur.source !== 'rc') return { applied: false, reason: 'not_rc_source' };
                next = { ...cur, willRenew: false, ...(expMs ? { until: ts(expMs) } : {}) };
            } else if (RC_EVENTS_EXPIRE.has(type)) {
                if (!cur || cur.source !== 'rc') return { applied: false, reason: 'not_rc_source' };
                next = { ...cur, until: ts(expMs && expMs < Date.now() ? expMs : Date.now()), willRenew: false };
            } else {
                return { applied: false, reason: `unhandled:${type}` }; // TRANSFER·NON_RENEWING_PURCHASE 등 — 로그만
            }
            tx.set(userRef, { pro: { ...next, updatedAt: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
            return { applied: true, until: untilMs(next) };
        });
        await evRef.set({ status: result.applied ? 'applied' : 'skipped', reason: result.reason || null, processedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        console.log(`[KC/Sub] webhook ${type} ${uid} → ${result.applied ? `applied until=${new Date(result.until).toISOString()}` : `skipped(${result.reason})`}${ev.environment === 'SANDBOX' ? ' [SANDBOX]' : ''}`);
        res.json({ ok: true, ...result });
    } catch (err) {
        console.error('[KC/Sub] webhook apply error:', err.message);
        await evRef.set({ status: 'error', error: err.message }, { merge: true }).catch(() => {});
        res.json({ ok: false, error: err.message }); // 200 — 재전송 폭주 방지, 문서로 추적
    }
});

// ── Toss: 주문 준비(웹, ₩31,000 단건) ─────────────────────────────────────────
router.post('/api/community/sub/toss/prepare', requireAuthAny, rateLimit('kc-sub-toss-prepare', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    if (!TOSS_SECRET_KEY) return res.status(503).json({ error: 'Toss not configured' });
    if (rejectGuest(req, res)) return;
    const { packageId } = req.body || {};
    const pkg = SUB_PACKAGES[packageId];
    if (!pkg || pkg.method !== 'toss') return res.status(400).json({ error: `unknown toss package: ${packageId}` });
    try {
        if (await blockIfStoreActive(req.uid, res)) return;
        const orderId = newOrderId();
        await kcultureDb.collection('subOrders').doc(orderId).set({
            uid: req.uid, method: 'toss', packageId, amount: pkg.krw, currency: 'KRW', status: 'pending', test: tossIsTest(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ orderId, packageId, amount: pkg.krw, currency: 'KRW', orderName: pkg.name });
    } catch (err) {
        console.error('[KC/Sub] toss prepare error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

async function tossGetPayment(paymentKey) {
    const r = await axios.get(`${TOSS_API}/payments/${encodeURIComponent(paymentKey)}`, { headers: { Authorization: tossAuthHeader() }, timeout: 15000 });
    return r.data;
}

// ── Toss: 승인 + 1년 부여 ─────────────────────────────────────────────────────
router.post('/api/community/sub/toss/confirm', requireAuthAny, rateLimit('kc-sub-toss-confirm', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    if (!TOSS_SECRET_KEY) return res.status(503).json({ error: 'Toss not configured' });
    if (rejectGuest(req, res)) return;
    const paymentKey = String(req.body?.paymentKey || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const amount = Number(req.body?.amount);
    if (!paymentKey || !orderId || !Number.isFinite(amount)) return res.status(400).json({ error: 'missing fields' });
    if (paymentKey.length > 200 || orderId.length > 64) return res.status(400).json({ error: 'invalid fields' });

    const orderRef = kcultureDb.collection('subOrders').doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'unknown order' });
    const order = snap.data();
    if (order.uid !== req.uid) return res.status(403).json({ error: 'order owner mismatch' });
    if (order.status === 'done') return res.json({ success: true, until: order.until?.toMillis?.() || null, alreadyGranted: true });
    if (Number(order.amount) !== amount) {
        console.warn(`[KC/Sub] toss amount mismatch: client ${amount} vs order ${order.amount} (${orderId})`);
        return res.status(400).json({ error: 'amount mismatch' });
    }
    const pkg = SUB_PACKAGES[order.packageId];
    if (!pkg) return res.status(500).json({ error: 'package missing' });

    let payment;
    try {
        const r = await axios.post(`${TOSS_API}/payments/confirm`, { paymentKey, orderId, amount: order.amount }, {
            headers: { Authorization: tossAuthHeader(), 'Content-Type': 'application/json', 'Idempotency-Key': orderId }, timeout: 20000,
        });
        payment = r.data;
    } catch (err) {
        const d = err.response?.data;
        if (d?.code === 'ALREADY_PROCESSED_PAYMENT') {
            try { payment = await tossGetPayment(paymentKey); } catch (e2) {
                console.error('[KC/Sub] toss get after ALREADY_PROCESSED failed:', e2.response?.data || e2.message);
                return res.status(502).json({ error: 'payment lookup failed' });
            }
        } else {
            console.error('[KC/Sub] toss confirm error:', d || err.message);
            await orderRef.set({ status: 'failed', paymentKey, errorCode: d?.code || null, errorMessage: d?.message || err.message, failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            return res.status(402).json({ error: d?.message || 'payment confirm failed', code: d?.code || null });
        }
    }
    if (payment?.status !== 'DONE' || payment?.orderId !== orderId || Number(payment?.totalAmount) !== Number(order.amount) || (payment?.currency && payment.currency !== 'KRW')) {
        console.warn(`[KC/Sub] toss payment not acceptable: status=${payment?.status} total=${payment?.totalAmount} (${orderId})`);
        await orderRef.set({ status: 'failed', paymentKey, tossStatus: payment?.status || null, failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        return res.status(402).json({ error: `payment not completed: ${payment?.status || 'unknown'}` });
    }
    try {
        const result = await grantWebYear(req.uid, order.packageId, `toss_${paymentKey}`, {
            orderId, paymentKey, amount: payment.totalAmount, currency: 'KRW', tossMethod: payment.method || null, approvedAt: payment.approvedAt || null, test: tossIsTest(),
        });
        await orderRef.set({ status: 'done', paymentKey, until: ts(result.until), confirmedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        console.log(`[KC/Sub] toss granted: ${req.uid} until=${new Date(result.until).toISOString()} (${paymentKey}${result.already ? ', idempotent' : ''}${tossIsTest() ? ', TEST' : ''})`);
        res.json({ success: true, until: result.until, alreadyGranted: result.already });
    } catch (err) {
        console.error('[KC/Sub] toss grant error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── PayPal: 주문 생성($22.99 단건) ────────────────────────────────────────────
router.post('/api/community/sub/paypal/create-order', requireAuthAny, rateLimit('kc-sub-pp-create', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return res.status(503).json({ error: 'PayPal not configured' });
    if (rejectGuest(req, res)) return;
    const { packageId } = req.body || {};
    const pkg = SUB_PACKAGES[packageId];
    if (!pkg || pkg.method !== 'paypal') return res.status(400).json({ error: `unknown paypal package: ${packageId}` });
    try {
        if (await blockIfStoreActive(req.uid, res)) return;
        const token = await getPayPalAccessToken();
        const orderRes = await axios.post(`${PAYPAL_API}/v2/checkout/orders`, {
            intent: 'CAPTURE',
            purchase_units: [{ custom_id: req.uid, description: pkg.name, amount: { currency_code: 'USD', value: pkg.usd } }],
            application_context: { brand_name: 'K-DramaAnyLang', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
        }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
        res.json({ id: orderRes.data.id });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[KC/Sub] paypal create-order error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

// ── PayPal: 캡처 + 1년 부여 ───────────────────────────────────────────────────
router.post('/api/community/sub/paypal/capture', requireAuthAny, rateLimit('kc-sub-pp-capture', { perMinute: 10, perHour: 60 }), async (req, res) => {
    if (!kcultureDb) return res.status(503).json({ error: 'kculture Firestore not configured' });
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return res.status(503).json({ error: 'PayPal not configured' });
    if (rejectGuest(req, res)) return;
    const { orderId, packageId } = req.body || {};
    if (!orderId || !packageId) return res.status(400).json({ error: 'missing fields' });
    const pkg = SUB_PACKAGES[packageId];
    if (!pkg || pkg.method !== 'paypal') return res.status(400).json({ error: `unknown paypal package: ${packageId}` });
    try {
        const token = await getPayPalAccessToken();
        const capRes = await axios.post(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {}, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
        const data = capRes.data;
        const pu = data.purchase_units?.[0];
        const capture = pu?.payments?.captures?.[0];
        if (data.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') {
            return res.status(402).json({ error: `payment not completed: ${data.status}/${capture?.status}` });
        }
        if (capture.amount?.currency_code !== 'USD' || Number(capture.amount?.value) !== Number(pkg.usd)) {
            console.warn(`[KC/Sub] paypal amount mismatch: paid ${capture.amount?.value} ${capture.amount?.currency_code} expected ${pkg.usd} USD`);
            return res.status(400).json({ error: 'amount mismatch' });
        }
        const ownerUid = capture.custom_id || pu?.custom_id;
        if (ownerUid && ownerUid !== req.uid) return res.status(403).json({ error: 'order owner mismatch' });

        const result = await grantWebYear(req.uid, packageId, `pp_${capture.id}`, {
            paypalOrderId: orderId, captureId: capture.id, amount: capture.amount.value, currency: 'USD',
        });
        console.log(`[KC/Sub] paypal granted: ${req.uid} until=${new Date(result.until).toISOString()} (${capture.id}${result.already ? ', idempotent' : ''})`);
        res.json({ success: true, until: result.until, alreadyGranted: result.already });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[KC/Sub] paypal capture error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

module.exports = router;
module.exports.SUB_PACKAGES = SUB_PACKAGES;
