const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { admin, adminDb } = require('../config/firebase');

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

        console.log(`[Webhook] ${eventType} for ${appUserId}`);

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
                const updateData = {
                    tier,
                    planId: productId,
                    subscriptionMonths: months,
                    autoRenew: true,
                    tierSource: 'revenuecat',
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                if (expiresAt) {
                    // 기존 만기일이 더 미래이면 덮어쓰지 않음 (Retry 순서 역전 방지)
                    const existingExpires = rcUserData.subscriptionExpiresAt?.toDate
                        ? rcUserData.subscriptionExpiresAt.toDate() : null;
                    const newExpires = new Date(expiresAt);
                    if (!existingExpires || newExpires > existingExpires) {
                        updateData.subscriptionExpiresAt = admin.firestore.Timestamp.fromMillis(expiresAt);
                    }
                }
                await adminDb.collection('users').doc(appUserId).update(updateData);
                console.log(`[Webhook] ${appUserId} → ${tier} (${eventType})`);
                break;
            }

            // ── 자동 갱신 취소 (만료일까지 서비스 유지) ──
            case 'CANCELLATION': {
                await adminDb.collection('users').doc(appUserId).update({
                    autoRenew: false,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Webhook] ${appUserId} → autoRenew off (CANCELLATION)`);
                break;
            }

            // ── 구독 만료 / 환불 ──
            case 'EXPIRATION':
            case 'BILLING_ISSUE': {
                await adminDb.collection('users').doc(appUserId).update({
                    tier: 'trial',
                    autoRenew: false,
                    planId: null,
                    subscriptionMonths: null,
                    subscriptionExpiresAt: null,
                    tierSource: null,
                    tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                console.log(`[Webhook] ${appUserId} → trial (${eventType})`);
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

module.exports = router;
