const express = require('express');
const axios = require('axios');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;
const TOSS_AUTH_HEADER = () => 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
const REVENUECAT_SECRET_KEY = process.env.REVENUECAT_SECRET_KEY;
const REVENUECAT_API = 'https://api.revenuecat.com/v1';

// ── 전화번호 중복 체크 ──────────────────────────────────────────────────────
router.post('/api/check-phone', requireAuth, async (req, res) => {
    const { phoneNumber, userId } = req.body;
    if (!phoneNumber || !userId) return res.status(400).json({ error: 'phoneNumber and userId required' });
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    try {
        const snapshot = await adminDb.collection('users')
            .where('phoneNumber', '==', phoneNumber)
            .where('phoneVerified', '==', true)
            .get();

        const otherUser = snapshot.docs.find(doc => doc.id !== userId);
        res.json({ isDuplicate: !!otherUser });
    } catch (err) {
        console.error('[CheckPhone] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 회원탈퇴 ─────────────────────────────────────────────────────────────────
router.post('/api/delete-account', requireAuth, async (req, res) => {
    const uid = req.uid;
    const errors = [];

    try {
        // 1. Firestore에서 사용자 정보 조회 (빌링키, 전화번호 등)
        let userData = null;
        if (adminDb) {
            const userDoc = await adminDb.collection('users').doc(uid).get();
            userData = userDoc.exists ? userDoc.data() : null;
        }

        // 2. TossPayments 빌링키 폐기 (구독 중이면)
        if (userData?.tossBillingKey) {
            try {
                await axios.post(
                    'https://api.tosspayments.com/v1/billing/authorizations/revoke',
                    { billingKey: userData.tossBillingKey },
                    { headers: { Authorization: TOSS_AUTH_HEADER() } }
                );
                console.log(`[DeleteAccount] billing key revoked: ${uid}`);
            } catch (tossErr) {
                errors.push(`TossPayments: ${tossErr.response?.data?.message || tossErr.message}`);
            }
        }

        // 3. RevenueCat subscriber 삭제
        if (REVENUECAT_SECRET_KEY) {
            try {
                await axios.delete(
                    `${REVENUECAT_API}/subscribers/${uid}`,
                    { headers: { Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`, 'Content-Type': 'application/json' } }
                );
                console.log(`[DeleteAccount] RevenueCat subscriber deleted: ${uid}`);
            } catch (rcErr) {
                errors.push(`RevenueCat: ${rcErr.response?.data?.message || rcErr.message}`);
            }
        }

        // 4. Firestore verifiedPhones 삭제
        if (adminDb && userData?.phoneNumber) {
            try {
                await adminDb.collection('verifiedPhones').doc(userData.phoneNumber).delete();
            } catch (phoneErr) {
                errors.push(`verifiedPhones: ${phoneErr.message}`);
            }
        }

        // 5. Firestore users 문서 + 서브컬렉션 전체 삭제
        if (adminDb) {
            try {
                const userRef = adminDb.collection('users').doc(uid);
                // 서브컬렉션 재귀 삭제
                const subcollections = await userRef.listCollections();
                for (const sub of subcollections) {
                    const docs = await sub.listDocuments();
                    const batch = adminDb.batch();
                    docs.forEach(doc => batch.delete(doc));
                    if (docs.length > 0) await batch.commit();
                    console.log(`[DeleteAccount] subcollection '${sub.id}' deleted (${docs.length} docs): ${uid}`);
                }
                // savedCards 컬렉션의 해당 유저 문서도 삭제
                try {
                    await adminDb.collection('savedCards').doc(uid).delete();
                } catch {}
                // 메인 문서 삭제
                await userRef.delete();
                console.log(`[DeleteAccount] Firestore user doc deleted: ${uid}`);
            } catch (dbErr) {
                errors.push(`Firestore user: ${dbErr.message}`);
            }
        }

        // 6. Firebase Auth 계정 삭제
        if (admin.apps.length) {
            try {
                await admin.auth().deleteUser(uid);
                console.log(`[DeleteAccount] Firebase Auth deleted: ${uid}`);
            } catch (authErr) {
                errors.push(`Firebase Auth: ${authErr.message}`);
            }
        }

        if (errors.length > 0) {
            console.warn(`[DeleteAccount] partial errors for ${uid}:`, errors);
        }
        console.log(`[DeleteAccount] completed: ${uid}`);
        res.json({ success: true, errors: errors.length > 0 ? errors : undefined });
    } catch (err) {
        console.error('[DeleteAccount] fatal error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
