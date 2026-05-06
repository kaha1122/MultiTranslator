const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { admin, adminDb } = require('../config/firebase');
const { sendSubscriptionPush } = require('../utils/sendPush');

const router = express.Router();

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;
const TOSS_WEBHOOK_SECRET = process.env.TOSS_WEBHOOK_SECRET;
const TOSS_AUTH_HEADER = () => 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');

// RevenueCat Webhook Authorization 헤더 검증
const REVENUECAT_WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH;

const verifyWebhook = (req, res, next) => {
    if (!REVENUECAT_WEBHOOK_AUTH) {
        // 인증키 미설정 시 경고하고 통과 (개발 편의)
        console.warn('[Webhook] REVENUECAT_WEBHOOK_AUTH not set — skipping auth');
        return next();
    }
    const authHeader = req.headers['authorization'] || '';
    // RevenueCat이 "Bearer xxx" 또는 "xxx" 형식으로 보낼 수 있으므로 둘 다 허용
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token !== REVENUECAT_WEBHOOK_AUTH) {
        console.warn('[Webhook] Unauthorized:', authHeader?.slice(0, 20));
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// ── RevenueCat Webhook ──────────────────────────────────────────────────────
// https://www.revenuecat.com/docs/integrations/webhooks
router.post('/api/revenuecat-webhook', verifyWebhook, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    try {
        const event = req.body;
        const eventType = event?.event?.type;
        const appUserId = event?.event?.app_user_id;

        if (!eventType || !appUserId) {
            return res.status(400).json({ error: 'Missing event type or app_user_id' });
        }

        // ⚠ Sandbox 이벤트 차단 — TestFlight / Apple 리뷰어 / 베타 테스터의 sandbox 결제가
        //   production Firestore에 tier=pro로 부정 승격되던 결함 (2026-05-06 사고).
        //   environment: "SANDBOX" | "PRODUCTION" — RevenueCat이 webhook payload에 명시.
        const environment = event?.event?.environment;
        if (environment === 'SANDBOX') {
            console.log(`[Webhook] SKIP sandbox ${eventType} for ${appUserId}`);
            return res.status(200).json({ skipped: 'sandbox', eventType });
        }

        console.log(`[Webhook] ${eventType} for ${appUserId} (env: ${environment || 'unknown'})`);

        // entitlement에서 tier 결정
        const entitlements = event?.event?.entitlement_ids || [];
        let tier = null;
        if (entitlements.includes('Premium')) tier = 'premium';
        else if (entitlements.includes('Pro')) tier = 'pro';

        const productId = event?.event?.product_id || '';
        const months = productId.includes('_3') ? 3 : 1;

        switch (eventType) {
            // ── 구독 시작 / 갱신 ──
            case 'INITIAL_PURCHASE':
            case 'RENEWAL':
            case 'PRODUCT_CHANGE':
            case 'UNCANCELLATION': {
                if (!tier) break;

                // 이중 결제 방지: Toss 활성 구독이 있으면 RevenueCat으로 덮어쓰지 않음
                const rcUserDoc = await adminDb.collection('users').doc(appUserId).get();
                const rcUserData = rcUserDoc.exists ? rcUserDoc.data() : {};
                if (rcUserData.tierSource === 'toss' && rcUserData.autoRenew === true) {
                    const tossExpires = rcUserData.subscriptionExpiresAt?.toDate ? rcUserData.subscriptionExpiresAt.toDate() : null;
                    if (tossExpires && tossExpires > new Date()) {
                        console.log(`[Webhook] SKIP ${appUserId} — active Toss subscription (expires ${tossExpires.toISOString().slice(0,10)})`);
                        break;
                    }
                }

                const expiresAt = event?.event?.expiration_at_ms;
                const purchasedAt = event?.event?.purchased_at_ms;
                const updateData = {
                    tier,
                    planId: productId,
                    subscriptionMonths: months,
                    autoRenew: true,
                    tierSource: 'revenuecat',
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    hasEverSubscribed: true,
                    lifecycleStage: 'subscriber',
                };
                if (purchasedAt) {
                    updateData.subscriptionStartedAt = admin.firestore.Timestamp.fromMillis(purchasedAt);
                }
                if (expiresAt) {
                    updateData.subscriptionExpiresAt = admin.firestore.Timestamp.fromMillis(expiresAt);
                }
                await adminDb.collection('users').doc(appUserId).update(updateData);
                console.log(`[Webhook] ${appUserId} → ${tier} (${eventType})`);
                // Push: RENEWAL만 알림 (INITIAL_PURCHASE는 앱 내 성공 팝업으로 충분)
                if (eventType === 'RENEWAL') {
                    sendSubscriptionPush(appUserId, 'renewal').catch(() => {});
                }
                break;
            }

            // ── 자동 갱신 취소 (만료일까지 서비스 유지) ──
            case 'CANCELLATION': {
                await adminDb.collection('users').doc(appUserId).update({
                    autoRenew: false,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Webhook] ${appUserId} → autoRenew off (CANCELLATION)`);
                sendSubscriptionPush(appUserId, 'cancellation').catch(() => {});
                break;
            }

            // ── 구독 만료 / 환불 ──
            case 'EXPIRATION':
            case 'BILLING_ISSUE': {
                // subscriptionExpiresAt, subscriptionMonths, subscriptionStartedAt는 이력 보존을 위해 유지
                await adminDb.collection('users').doc(appUserId).update({
                    tier: 'trial',
                    autoRenew: false,
                    planId: null,
                    tierSource: null,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Webhook] ${appUserId} → trial (${eventType})`);
                sendSubscriptionPush(appUserId, eventType === 'BILLING_ISSUE' ? 'billingIssue' : 'expiration').catch(() => {});
                break;
            }

            // ── 환불 → 즉시 다운그레이드 ──
            case 'NON_RENEWING_PURCHASE':
            case 'SUBSCRIBER_ALIAS':
                // 무시해도 되는 이벤트
                break;

            default:
                console.log(`[Webhook] Unhandled event: ${eventType}`);
        }

        // RevenueCat은 200 응답을 기대
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('[Webhook] Error:', err.message);
        // 5xx 반환 시 RevenueCat이 재시도하므로 200 반환
        res.status(200).json({ success: false, error: err.message });
    }
});

// ── TossPayments Webhook ─────────────────────────────────────────────────────
// https://docs.tosspayments.com/guides/webhook
// 토스페이먼츠 대시보드 → 개발정보 → Webhook URL에 등록:
//   https://<server-domain>/api/toss-webhook

const verifyTossWebhook = (req, res, next) => {
    if (!TOSS_WEBHOOK_SECRET) {
        console.warn('[TossWebhook] TOSS_WEBHOOK_SECRET not set — skipping signature verification');
        return next();
    }
    // 토스 서명 검증: HMAC-SHA256(시크릿, timestamp + body)
    const timestamp = req.headers['toss-timestamp'];
    const signature = req.headers['toss-signature'];
    if (!timestamp || !signature) {
        console.warn('[TossWebhook] Missing signature headers');
        return res.status(401).json({ error: 'Missing signature' });
    }
    const payload = `${timestamp}${JSON.stringify(req.body)}`;
    const expected = crypto.createHmac('sha256', TOSS_WEBHOOK_SECRET).update(payload).digest('base64');
    if (signature !== expected) {
        console.warn('[TossWebhook] Signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
    }
    next();
};

router.post('/api/toss-webhook', verifyTossWebhook, async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    try {
        const { eventType, data } = req.body;
        console.log(`[TossWebhook] ${eventType}`, JSON.stringify(data).slice(0, 300));

        if (!eventType || !data) {
            return res.status(400).json({ error: 'Missing eventType or data' });
        }

        switch (eventType) {
            // ── 결제 상태 변경 (승인/취소/환불 등) ──
            case 'PAYMENT_STATUS_CHANGED': {
                const { status, customerKey, orderId, cancels, totalAmount } = data;
                console.log(`[TossWebhook] PAYMENT status=${status}, orderId=${orderId}, customerKey=${customerKey}`);

                // customerKey 또는 orderId로 유저 조회
                let userRef, userDoc;
                if (customerKey) {
                    userRef = adminDb.collection('users').doc(customerKey);
                    userDoc = await userRef.get();
                }
                // customerKey로 못 찾으면 orderId로 검색
                if (!userDoc?.exists && orderId) {
                    const snap = await adminDb.collection('users')
                        .where('tossOrderId', '==', orderId).limit(1).get();
                    if (!snap.empty) {
                        userDoc = snap.docs[0];
                        userRef = userDoc.ref;
                        console.log(`[TossWebhook] Found user by orderId: ${userDoc.id}`);
                    }
                }
                if (!userRef || !userDoc?.exists) {
                    console.warn(`[TossWebhook] User not found: customerKey=${customerKey}, orderId=${orderId}`);
                    break;
                }

                if (status === 'CANCELED') {
                    // 전액 환불 → trial 다운그레이드 + 빌링키 폐기
                    const cancelReason = cancels?.[cancels.length - 1]?.cancelReason || 'Unknown';
                    const cancelAmount = cancels?.[cancels.length - 1]?.cancelAmount || 0;

                    await userRef.update({
                        tier: 'trial',
                        autoRenew: false,
                        planId: null,
                        subscriptionMonths: null,
                        subscriptionExpiresAt: null,
                        tierSource: null,
                        tossBillingKey: null,
                        tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastCancelReason: cancelReason,
                        lastCanceledAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    // orders 컬렉션 업데이트
                    if (orderId) {
                        const orderRef = adminDb.collection('orders').doc(orderId);
                        const orderDoc = await orderRef.get();
                        if (orderDoc.exists) {
                            await orderRef.update({
                                status: 'CANCELED',
                                canceledAt: admin.firestore.FieldValue.serverTimestamp(),
                                cancelReason,
                                cancelAmount,
                            });
                        }
                    }

                    // 빌링키 폐기
                    const userData = userDoc.data();
                    if (userData.tossBillingKey) {
                        try {
                            await axios.post(
                                'https://api.tosspayments.com/v1/billing/authorizations/revoke',
                                { billingKey: userData.tossBillingKey },
                                { headers: { Authorization: TOSS_AUTH_HEADER() } }
                            );
                        } catch (revokeErr) {
                            console.error('[TossWebhook] Billing key revoke failed:', revokeErr.message);
                        }
                    }
                    console.log(`[TossWebhook] ${customerKey} → trial (FULL REFUND: ${cancelAmount}, reason: ${cancelReason})`);
                    sendSubscriptionPush(userDoc.id, 'expiration').catch(() => {});

                } else if (status === 'PARTIAL_CANCELED') {
                    // 부분 환불 → tier 유지, 로그만 기록
                    const cancelReason = cancels?.[cancels.length - 1]?.cancelReason || 'Unknown';
                    const cancelAmount = cancels?.[cancels.length - 1]?.cancelAmount || 0;
                    await userRef.update({
                        lastCancelReason: `부분환불: ${cancelAmount} - ${cancelReason}`,
                        lastCanceledAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    // orders 컬렉션 업데이트
                    if (orderId) {
                        const orderRef = adminDb.collection('orders').doc(orderId);
                        const orderDoc = await orderRef.get();
                        if (orderDoc.exists) {
                            await orderRef.update({
                                status: 'PARTIAL_CANCELED',
                                canceledAt: admin.firestore.FieldValue.serverTimestamp(),
                                cancelReason,
                                cancelAmount,
                            });
                        }
                    }
                    console.log(`[TossWebhook] ${customerKey} → PARTIAL REFUND: ${cancelAmount}, tier kept`);

                } else if (status === 'DONE') {
                    // 결제 승인 → confirm-billing에서 이미 처리하므로 로그만
                    console.log(`[TossWebhook] Payment confirmed: ${customerKey}, amount=${totalAmount}`);

                } else if (status === 'ABORTED' || status === 'EXPIRED') {
                    console.log(`[TossWebhook] Payment ${status}: ${customerKey}, orderId=${orderId}`);
                }
                break;
            }

            // ── 취소 상태 변경 ──
            case 'CANCEL_STATUS_CHANGED': {
                const { cancelStatus, customerKey, orderId } = data;
                console.log(`[TossWebhook] CANCEL status=${cancelStatus}, orderId=${orderId}`);

                if (cancelStatus === 'DONE' && customerKey) {
                    // 취소 완료 확인 → PAYMENT_STATUS_CHANGED에서 이미 처리하므로 로그만
                    console.log(`[TossWebhook] Cancel confirmed for ${customerKey}`);
                }
                break;
            }

            // ── 빌링키 삭제 ──
            case 'BILLING_DELETED': {
                const bkCustomerKey = data.customerKey;
                let bkRef, bkDoc;
                if (bkCustomerKey) {
                    bkRef = adminDb.collection('users').doc(bkCustomerKey);
                    bkDoc = await bkRef.get();
                }
                if (!bkDoc?.exists && data.billingKey) {
                    const snap = await adminDb.collection('users')
                        .where('tossBillingKey', '==', data.billingKey).limit(1).get();
                    if (!snap.empty) {
                        bkDoc = snap.docs[0];
                        bkRef = bkDoc.ref;
                    }
                }
                if (!bkRef || !bkDoc?.exists) break;
                const userRef = bkRef;
                const userDoc = bkDoc;

                await userRef.update({
                    autoRenew: false,
                    tossBillingKey: null,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[TossWebhook] ${customerKey} → billingKey deleted, autoRenew off`);
                break;
            }

            default:
                console.log(`[TossWebhook] Unhandled event: ${eventType}`);
        }

        // 토스는 200 응답을 기대
        res.status(200).json({ success: true });
    } catch (err) {
        console.error('[TossWebhook] Error:', err.message);
        // 5xx 반환 시 토스가 재시도하므로 200 반환
        res.status(200).json({ success: false, error: err.message });
    }
});

// ── PayPal Webhook ─────────────────────────────────────────────────────────
// PayPal Developer Dashboard → Webhooks에 등록:
//   https://<server-domain>/api/paypal-webhook
// 이벤트: BILLING.SUBSCRIPTION.ACTIVATED, CANCELLED, EXPIRED, SUSPENDED
//         PAYMENT.SALE.COMPLETED

const PAYPAL_CLIENT_ID = process.env.VITE_PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

// PayPal Plan ID → 내부 planId 매핑
const PAYPAL_PLAN_MAP = {
    [process.env.VITE_PAYPAL_PLAN_PRO_1]: { tier: 'pro', planId: 'pro_1', months: 1 },
    [process.env.VITE_PAYPAL_PLAN_PRO_3]: { tier: 'pro', planId: 'pro_3', months: 3 },
    [process.env.VITE_PAYPAL_PLAN_PREMIUM_1]: { tier: 'premium', planId: 'premium_1', months: 1 },
    [process.env.VITE_PAYPAL_PLAN_PREMIUM_3]: { tier: 'premium', planId: 'premium_3', months: 3 },
};

// PayPal OAuth2 Access Token 취득
async function getPayPalAccessToken() {
    const res = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: PAYPAL_CLIENT_ID, password: PAYPAL_SECRET },
    });
    return res.data.access_token;
}

// PayPal Webhook 서명 검증
async function verifyPayPalWebhook(req) {
    if (!PAYPAL_WEBHOOK_ID) return true; // 개발 중에는 스킵
    try {
        const token = await getPayPalAccessToken();
        const res = await axios.post(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
            auth_algo: req.headers['paypal-auth-algo'],
            cert_url: req.headers['paypal-cert-url'],
            transmission_id: req.headers['paypal-transmission-id'],
            transmission_sig: req.headers['paypal-transmission-sig'],
            transmission_time: req.headers['paypal-transmission-time'],
            webhook_id: PAYPAL_WEBHOOK_ID,
            webhook_event: req.body,
        }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
        return res.data.verification_status === 'SUCCESS';
    } catch (e) {
        console.error('[PayPalWebhook] Signature verification failed:', e.message);
        return false;
    }
}

router.post('/api/paypal-webhook', async (req, res) => {
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    try {
        // 서명 검증
        const valid = await verifyPayPalWebhook(req);
        if (!valid) {
            console.warn('[PayPalWebhook] Invalid signature — rejecting');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const event = req.body;
        const eventType = event?.event_type;
        const resource = event?.resource;

        console.log(`[PayPalWebhook] ${eventType}`, JSON.stringify(resource).slice(0, 300));

        if (!eventType || !resource) {
            return res.status(400).json({ error: 'Missing event_type or resource' });
        }

        switch (eventType) {
            // ── 구독 활성화 ──
            case 'BILLING.SUBSCRIPTION.ACTIVATED': {
                const subscriptionId = resource.id;
                const paypalPlanId = resource.plan_id;
                const customId = resource.custom_id; // 우리 앱의 Firebase UID
                if (!customId) {
                    console.warn('[PayPalWebhook] No custom_id (Firebase UID) in subscription');
                    break;
                }

                const planInfo = PAYPAL_PLAN_MAP[paypalPlanId];
                if (!planInfo) {
                    console.warn(`[PayPalWebhook] Unknown plan: ${paypalPlanId}`);
                    break;
                }

                // 이중 결제 방지: Toss/RevenueCat 활성 구독 확인
                const userDoc = await adminDb.collection('users').doc(customId).get();
                const userData = userDoc.exists ? userDoc.data() : {};
                if ((userData.tier === 'pro' || userData.tier === 'premium') &&
                    userData.tierSource !== 'paypal' && userData.autoRenew === true) {
                    const existingExpires = userData.subscriptionExpiresAt?.toDate?.();
                    if (existingExpires && existingExpires > new Date()) {
                        console.log(`[PayPalWebhook] SKIP ${customId} — active ${userData.tierSource} subscription`);
                        break;
                    }
                }

                const nextBilling = resource.billing_info?.next_billing_time;
                const updateData = {
                    tier: planInfo.tier,
                    planId: planInfo.planId,
                    subscriptionMonths: planInfo.months,
                    autoRenew: true,
                    tierSource: 'paypal',
                    paypalSubscriptionId: subscriptionId,
                    paypalPlanId,
                    subscriptionCurrency: 'USD',
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    subscriptionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
                    hasEverSubscribed: true,
                    lifecycleStage: 'subscriber',
                };
                if (nextBilling) {
                    updateData.subscriptionExpiresAt = admin.firestore.Timestamp.fromDate(new Date(nextBilling));
                }
                await adminDb.collection('users').doc(customId).update(updateData);
                console.log(`[PayPalWebhook] ${customId} → ${planInfo.tier} (ACTIVATED, plan=${planInfo.planId})`);
                break;
            }

            // ── 갱신 결제 성공 ──
            case 'PAYMENT.SALE.COMPLETED': {
                const billingAgreementId = resource.billing_agreement_id;
                if (!billingAgreementId) break;

                // subscriptionId로 유저 조회
                const snap = await adminDb.collection('users')
                    .where('paypalSubscriptionId', '==', billingAgreementId).limit(1).get();
                if (snap.empty) {
                    console.warn(`[PayPalWebhook] User not found for subscription: ${billingAgreementId}`);
                    break;
                }
                const userDoc = snap.docs[0];
                const userData = userDoc.data();
                const months = userData.subscriptionMonths || 1;

                // 만기일 연장
                const currentExpiry = userData.subscriptionExpiresAt?.toDate?.() || new Date();
                const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
                const newExpiry = new Date(baseDate);
                newExpiry.setMonth(newExpiry.getMonth() + months);

                await userDoc.ref.update({
                    subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(newExpiry),
                    lastRenewedAt: admin.firestore.FieldValue.serverTimestamp(),
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[PayPalWebhook] ${userDoc.id} → renewed (expires ${newExpiry.toISOString().slice(0,10)})`);
                sendSubscriptionPush(userDoc.id, 'renewal').catch(() => {});
                break;
            }

            // ── 구독 취소 (만료일까지 서비스 유지) ──
            case 'BILLING.SUBSCRIPTION.CANCELLED': {
                const customId = resource.custom_id;
                if (!customId) break;
                await adminDb.collection('users').doc(customId).update({
                    autoRenew: false,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[PayPalWebhook] ${customId} → autoRenew off (CANCELLED)`);
                sendSubscriptionPush(customId, 'cancellation').catch(() => {});
                break;
            }

            // ── 구독 만료 / 정지 ──
            case 'BILLING.SUBSCRIPTION.EXPIRED':
            case 'BILLING.SUBSCRIPTION.SUSPENDED': {
                const customId = resource.custom_id;
                if (!customId) break;
                await adminDb.collection('users').doc(customId).update({
                    tier: 'trial',
                    autoRenew: false,
                    planId: null,
                    tierSource: null,
                    paypalSubscriptionId: null,
                    paypalPlanId: null,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[PayPalWebhook] ${customId} → trial (${eventType})`);
                sendSubscriptionPush(customId, eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' ? 'billingIssue' : 'expiration').catch(() => {});
                break;
            }

            default:
                console.log(`[PayPalWebhook] Unhandled: ${eventType}`);
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('[PayPalWebhook] Error:', err.message);
        res.status(200).json({ success: false, error: err.message });
    }
});

// ── PayPal 구독 활성화 확인 (클라이언트에서 onApprove 후 호출) ──────────────
router.post('/api/paypal-activate', async (req, res) => {
    const { subscriptionId, userId, planId } = req.body;
    if (!subscriptionId || !userId || !planId) {
        return res.status(400).json({ error: 'subscriptionId, userId, planId required' });
    }
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    try {
        const token = await getPayPalAccessToken();
        const subRes = await axios.get(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const sub = subRes.data;

        if (sub.status !== 'ACTIVE' && sub.status !== 'APPROVED') {
            return res.status(400).json({ error: `Subscription not active: ${sub.status}` });
        }

        const planInfo = PAYPAL_PLAN_MAP[sub.plan_id];
        if (!planInfo) {
            return res.status(400).json({ error: `Unknown plan: ${sub.plan_id}` });
        }

        const nextBilling = sub.billing_info?.next_billing_time;
        const updateData = {
            tier: planInfo.tier,
            planId: planInfo.planId,
            subscriptionMonths: planInfo.months,
            autoRenew: true,
            tierSource: 'paypal',
            paypalSubscriptionId: subscriptionId,
            paypalPlanId: sub.plan_id,
            subscriptionCurrency: 'USD',
            tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            subscriptionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (nextBilling) {
            updateData.subscriptionExpiresAt = admin.firestore.Timestamp.fromDate(new Date(nextBilling));
        }
        await adminDb.collection('users').doc(userId).update(updateData);
        console.log(`[PayPal] Activated: ${userId} → ${planInfo.tier} (${planInfo.planId})`);

        res.json({ success: true, tier: planInfo.tier });
    } catch (err) {
        console.error('[PayPal] Activate error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
