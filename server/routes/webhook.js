const express = require('express');
const { admin, adminDb } = require('../config/firebase');

const router = express.Router();

// RevenueCat Webhook Authorization 헤더 검증
const REVENUECAT_WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH;

const verifyWebhook = (req, res, next) => {
    if (!REVENUECAT_WEBHOOK_AUTH) {
        // 인증키 미설정 시 경고하고 통과 (개발 편의)
        console.warn('[Webhook] REVENUECAT_WEBHOOK_AUTH not set — skipping auth');
        return next();
    }
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${REVENUECAT_WEBHOOK_AUTH}`) {
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
                    updateData.subscriptionExpiresAt = admin.firestore.Timestamp.fromMillis(expiresAt);
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

module.exports = router;
