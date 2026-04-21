const express = require('express');
const axios = require('axios');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth, requireCronAuth } = require('../middleware/auth');

const router = express.Router();

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;
const TOSS_AUTH_HEADER = () => 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
const REVENUECAT_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY;
const REVENUECAT_API = 'https://api.revenuecat.com/v1';

// ── TossPayments 빌링키 발급 + 첫 결제 ──────────────────────────────────────
router.post('/api/toss-confirm-billing', requireAuth, async (req, res) => {
    const { authKey, customerKey, tier, planId, months = 1, userEmail, currency = 'KRW' } = req.body;
    if (!authKey || !customerKey || !tier) {
        return res.status(400).json({ error: 'authKey, customerKey, tier are required' });
    }

    const AMOUNTS = {
        pro_1: 4990, pro_3: 13990,
        premium_1: 16990, premium_3: 35000,
        pro: 4990, premium: 16990,
        pro_1_usd: 349, pro_3_usd: 899,
        premium_1_usd: 1099, premium_3_usd: 2499,
    };
    const ORDER_NAMES = {
        pro_1: 'PronunFit Pro 1개월', pro_3: 'PronunFit Pro 3개월',
        premium_1: 'PronunFit Premium 1개월', premium_3: 'PronunFit Premium 3개월',
        pro: 'PronunFit Pro', premium: 'PronunFit Premium',
        pro_1_usd: 'PronunFit Pro 1 Month', pro_3_usd: 'PronunFit Pro 3 Months',
        premium_1_usd: 'PronunFit Premium 1 Month', premium_3_usd: 'PronunFit Premium 3 Months',
    };
    const resolvedPlanId = planId || tier;
    const amountRaw = AMOUNTS[resolvedPlanId];
    const isUSD = currency === 'USD';
    const amount = isUSD ? amountRaw / 100 : amountRaw;
    if (!amount) return res.status(400).json({ error: `Unknown plan: ${resolvedPlanId}` });

    // 이메일 인증 확인 (서버 측 이중 체크)
    if (admin.apps.length) {
        try {
            const firebaseUser = await admin.auth().getUser(customerKey);
            if (!firebaseUser.emailVerified) {
                return res.status(403).json({ error: 'Email verification required before subscription' });
            }
        } catch (checkErr) {
            console.error('[TossBilling] emailVerified check failed:', checkErr.message);
        }
    }

    // 전화번호 인증 확인 (서버 측 이중 체크 — KRW 결제만)
    if (!isUSD && adminDb) {
        try {
            const userDoc = await adminDb.collection('users').doc(customerKey).get();
            if (!userDoc.exists || !userDoc.data()?.phoneVerified) {
                return res.status(403).json({ error: 'Phone verification required before subscription' });
            }
        } catch (checkErr) {
            console.error('[TossBilling] phoneVerified check failed:', checkErr.message);
        }
    }

    // 이중 결제 방지: RevenueCat 활성 구독이 있으면 Toss 결제 차단
    if (adminDb) {
        try {
            const userDoc = await adminDb.collection('users').doc(customerKey).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            if ((userData.tier === 'pro' || userData.tier === 'premium') && userData.tierSource === 'revenuecat') {
                const expiresAt = userData.subscriptionExpiresAt?.toDate ? userData.subscriptionExpiresAt.toDate() : null;
                if (expiresAt && expiresAt > new Date()) {
                    return res.status(409).json({ error: 'Active subscription exists on app store. Please cancel it first.' });
                }
            }
        } catch (checkErr) {
            console.error('[TossBilling] duplicate subscription check failed:', checkErr.message);
        }
    }

    try {
        // 1단계: authKey로 빌링키 발급
        const billingRes = await axios.post(
            `https://api.tosspayments.com/v1/billing/authorizations/${authKey}`,
            { customerKey },
            { headers: { Authorization: TOSS_AUTH_HEADER() } }
        );
        const { billingKey } = billingRes.data;

        // 2단계: 빌링키로 결제
        const orderId = `order_${Date.now()}_${customerKey.slice(0, 8)}`;
        const orderName = ORDER_NAMES[resolvedPlanId] || `PronunFit ${tier}`;
        const paymentRes = await axios.post(
            `https://api.tosspayments.com/v1/billing/${billingKey}`,
            {
                customerKey,
                amount,
                orderId,
                orderName,
                customerEmail: userEmail || undefined,
                ...(isUSD && { currency: 'USD' }),
            },
            { headers: { Authorization: TOSS_AUTH_HEADER() } }
        );
        const paymentData = paymentRes.data;
        const traceId = paymentRes.headers['x-tosspayments-trace-id'] || null;

        // 3단계: orders 컬렉션에 주문 정보 저장
        if (adminDb) {
            await adminDb.collection('orders').doc(orderId).set({
                orderId,
                paymentKey: paymentData.paymentKey || null,
                traceId,
                userId: customerKey,
                planId: resolvedPlanId,
                orderName,
                status: paymentData.status || 'DONE',
                amount,
                currency: isUSD ? 'USD' : 'KRW',
                method: paymentData.method || null,
                cardNumber: paymentData.card?.number || null,
                cardType: paymentData.card?.cardType || null,
                receiptUrl: paymentData.receipt?.url || null,
                type: 'initial',
                requestedAt: paymentData.requestedAt || null,
                approvedAt: paymentData.approvedAt || null,
                canceledAt: null,
                cancelReason: null,
                cancelAmount: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        // 4단계: Firestore 유저 업데이트
        const resolvedMonths = parseInt(months) || 1;

        let baseDate = new Date();
        if (adminDb) {
            const userDoc = await adminDb.collection('users').doc(customerKey).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            const existingTier = userData.tier;
            const existingExpiry = userData.subscriptionExpiresAt;
            // 동일 tier 내 재결제: 잔여기간 합산 / 다른 tier로 업그레이드: 즉시 리셋
            if (existingExpiry && existingTier === tier) {
                const existingDate = existingExpiry.toDate ? existingExpiry.toDate() : new Date(existingExpiry);
                if (existingDate > baseDate) baseDate = existingDate;
            }
        }
        const expiresAt = new Date(baseDate);
        expiresAt.setMonth(expiresAt.getMonth() + resolvedMonths);

        if (adminDb) {
            const updateData = {
                tier,
                planId: resolvedPlanId,
                subscriptionMonths: resolvedMonths,
                subscriptionCurrency: isUSD ? 'USD' : 'KRW',
                tossBillingKey: billingKey,
                tossCustomerKey: customerKey,
                tossOrderId: orderId,
                tierSource: 'toss',
                autoRenew: true,
                tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                subscriptionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
                subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            };
            await adminDb.collection('users').doc(customerKey).update(updateData);
            console.log(`[Toss] billing confirmed: ${customerKey} → ${resolvedPlanId} (${resolvedMonths}mo, expires ${expiresAt.toISOString().slice(0,10)})`);
        }

        // Toss 결제 유저의 tier는 Firestore(tierSource:'toss')로 관리
        // RevenueCat 프로모션 부여 불필요 (앱은 onSnapshot으로 Firestore tier를 직접 감지)

        res.json({ success: true, orderId });
    } catch (err) {
        const detail = err.response?.data;
        console.error('[Toss] confirm-billing error:', detail || err.message);
        res.status(500).json({ error: detail?.message || err.message });
    }
});

// ── 구독 취소 (Toss + PayPal 통합) ──────────────────────────────────────────
router.post('/api/cancel-subscription', requireAuth, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

        const userDoc = await adminDb.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // PayPal 구독 취소
        if (userData.tierSource === 'paypal' && userData.paypalSubscriptionId) {
            const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
                ? 'https://api-m.paypal.com'
                : 'https://api-m.sandbox.paypal.com';
            const tokenRes = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                auth: { username: process.env.VITE_PAYPAL_CLIENT_ID, password: process.env.PAYPAL_SECRET },
            });
            await axios.post(
                `${PAYPAL_API}/v1/billing/subscriptions/${userData.paypalSubscriptionId}/cancel`,
                { reason: 'User requested cancellation' },
                { headers: { Authorization: `Bearer ${tokenRes.data.access_token}`, 'Content-Type': 'application/json' } }
            );
            console.log(`[PayPal] subscription cancelled: ${userId} (${userData.paypalSubscriptionId})`);
        }

        // Firestore 업데이트 (Toss/PayPal 공통)
        await adminDb.collection('users').doc(userId).update({
            autoRenew: false,
            autoRenewPausedAt: admin.firestore.FieldValue.serverTimestamp(),
            autoRenewPauseCount: admin.firestore.FieldValue.increment(1),
            tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Cancel] auto-renew disabled: ${userId} (tierSource: ${userData.tierSource || 'toss'})`);

        res.json({ success: true });
    } catch (err) {
        console.error('[Cancel] cancel-subscription error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RevenueCat 구독 상태 확인 (웹/앱 공용) ──────────────────────────────────
// 웹에서 RevenueCat 구독 유저의 만기/갱신 상태를 서버 경유로 확인
router.post('/api/check-subscription', requireAuth, async (req, res) => {
    const uid = req.uid;
    if (!REVENUECAT_SECRET_KEY) return res.status(500).json({ error: 'RevenueCat not configured' });

    try {
        const rcRes = await axios.get(
            `${REVENUECAT_API}/subscribers/${uid}`,
            { headers: { Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );
        const subscriber = rcRes.data?.subscriber;
        const entitlements = subscriber?.entitlements || {};

        let tier = null;
        let expiresDate = null;
        let willRenew = false;
        let productId = null;

        const proEnt = entitlements['Pro'];
        const premiumEnt = entitlements['Premium'];
        const active = premiumEnt || proEnt;

        if (active) {
            const expires = new Date(active.expires_date);
            if (expires > new Date()) {
                tier = premiumEnt ? 'premium' : 'pro';
                expiresDate = active.expires_date;
                willRenew = active.unsubscribe_detected_at == null;
                productId = active.product_identifier;
            }
        }

        // Firestore 동기화
        if (adminDb) {
            const updateData = { tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp() };
            if (tier) {
                updateData.tier = tier;
                updateData.tierSource = 'revenuecat';
                if (expiresDate) updateData.subscriptionExpiresAt = admin.firestore.Timestamp.fromDate(new Date(expiresDate));
                if (productId) {
                    updateData.planId = productId;
                    updateData.subscriptionMonths = productId.includes('_3') ? 3 : 1;
                }
                updateData.autoRenew = willRenew;
            } else {
                // 활성 구독 없음 → Firestore가 pro/premium이면 다운그레이드
                const userDoc = await adminDb.collection('users').doc(uid).get();
                const userData = userDoc.exists ? userDoc.data() : {};
                if ((userData.tier === 'pro' || userData.tier === 'premium') && userData.tierSource === 'revenuecat') {
                    // Firestore subscriptionExpiresAt이 아직 유효하면 RC promo 미반영/일시 miss일 수 있으므로 다운그레이드 보류
                    // 실제 만기는 클라이언트 '구독 만료 체크' useEffect 또는 RC EXPIRATION webhook이 처리
                    const expiresRaw = userData.subscriptionExpiresAt;
                    const expiresAt = expiresRaw?.toDate?.()
                        ?? (expiresRaw ? new Date(expiresRaw) : null);
                    if (expiresAt && new Date() < expiresAt) {
                        console.log(`[CheckSubscription] ${uid}: no RC entitlement but Firestore expiry valid (${expiresAt.toISOString()}) — skip downgrade`);
                    } else {
                        updateData.tier = 'trial';
                        updateData.autoRenew = false;
                    }
                }
            }
            await adminDb.collection('users').doc(uid).update(updateData);
        }

        res.json({ success: true, tier, expiresDate, willRenew, productId });
    } catch (err) {
        // 404 = RevenueCat에 구독자 없음 → 정상 (구독한 적 없음)
        if (err.response?.status === 404) {
            return res.json({ success: true, tier: null, expiresDate: null });
        }
        console.error('[CheckSubscription] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Cron: 자동 갱신 ─────────────────────────────────────────────────────────
router.post('/api/cron/renew-subscriptions', requireCronAuth, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    const AMOUNTS = {
        pro_1: 4990, pro_3: 13990,
        premium_1: 16990, premium_3: 35000,
    };
    const ORDER_NAMES = {
        pro_1: 'PronunFit Pro 1개월', pro_3: 'PronunFit Pro 3개월',
        premium_1: 'PronunFit Premium 1개월', premium_3: 'PronunFit Premium 3개월',
    };

    try {
        const now = admin.firestore.Timestamp.now();
        const snapshot = await adminDb.collection('users')
            .where('autoRenew', '==', true)
            .where('subscriptionExpiresAt', '<=', now)
            .get();

        let renewed = 0, failed = 0;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const { tossBillingKey, tossCustomerKey, planId, subscriptionMonths, tierSource } = data;
            // RevenueCat 구독은 Toss cron에서 갱신하지 않음
            if (tierSource === 'revenuecat') {
                console.log(`[Cron] SKIP ${doc.id} — RevenueCat subscription`);
                continue;
            }
            if (!tossBillingKey || !planId) {
                failed++;
                continue;
            }

            const amount = AMOUNTS[planId];
            if (!amount) { failed++; continue; }

            const months = subscriptionMonths || (planId.endsWith('_3') ? 3 : 1);
            try {
                const orderId = `renew_${Date.now()}_${doc.id.slice(0, 8)}`;
                const orderName = ORDER_NAMES[planId] || `PronunFit ${planId}`;
                const renewRes = await axios.post(
                    `https://api.tosspayments.com/v1/billing/${tossBillingKey}`,
                    {
                        customerKey: tossCustomerKey || doc.id,
                        amount,
                        orderId,
                        orderName,
                    },
                    { headers: { Authorization: TOSS_AUTH_HEADER() } }
                );
                const renewData = renewRes.data;
                const renewTraceId = renewRes.headers['x-tosspayments-trace-id'] || null;

                // orders 컬렉션에 갱신 주문 저장
                await adminDb.collection('orders').doc(orderId).set({
                    orderId,
                    paymentKey: renewData.paymentKey || null,
                    traceId: renewTraceId,
                    userId: doc.id,
                    planId,
                    orderName,
                    status: renewData.status || 'DONE',
                    amount,
                    currency: 'KRW',
                    method: renewData.method || null,
                    cardNumber: renewData.card?.number || null,
                    cardType: renewData.card?.cardType || null,
                    receiptUrl: renewData.receipt?.url || null,
                    type: 'renewal',
                    requestedAt: renewData.requestedAt || null,
                    approvedAt: renewData.approvedAt || null,
                    canceledAt: null,
                    cancelReason: null,
                    cancelAmount: null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                const currentExpiry = data.subscriptionExpiresAt.toDate
                    ? data.subscriptionExpiresAt.toDate() : new Date(data.subscriptionExpiresAt);
                const newExpiry = new Date(currentExpiry);
                newExpiry.setMonth(newExpiry.getMonth() + months);

                await adminDb.collection('users').doc(doc.id).update({
                    subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(newExpiry),
                    tossOrderId: orderId,
                    lastRenewedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Cron] renewed: ${doc.id} → ${planId} (expires ${newExpiry.toISOString().slice(0,10)})`);
                renewed++;
            } catch (chargeErr) {
                console.error(`[Cron] charge failed for ${doc.id}:`, chargeErr.response?.data?.message || chargeErr.message);
                try {
                    await axios.post(
                        `https://api.tosspayments.com/v1/billing/authorizations/revoke`,
                        { billingKey: tossBillingKey },
                        { headers: { Authorization: TOSS_AUTH_HEADER() } }
                    );
                } catch (_) {}
                await adminDb.collection('users').doc(doc.id).update({
                    tier: 'trial',
                    autoRenew: false,
                    planId: null,
                    subscriptionMonths: null,
                    tossBillingKey: null,
                    tossCustomerKey: null,
                    subscriptionExpiresAt: null,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                failed++;
            }
        }

        console.log(`[Cron] renew-subscriptions done: ${renewed} renewed, ${failed} failed`);
        res.json({ success: true, renewed, failed, total: snapshot.size });
    } catch (err) {
        console.error('[Cron] renew-subscriptions error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
