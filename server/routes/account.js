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

        // 6. Firebase Auth 계정 삭제 (필수 — 실패 시 재가입 불가하므로 fatal 처리)
        if (admin.apps.length) {
            try {
                await admin.auth().deleteUser(uid);
                console.log(`[DeleteAccount] Firebase Auth deleted: ${uid}`);
            } catch (authErr) {
                console.error(`[DeleteAccount] Firebase Auth deletion FAILED: ${uid}`, authErr.message);
                return res.status(500).json({
                    success: false,
                    error: `Firebase Auth 삭제 실패: ${authErr.message}`,
                    partialErrors: errors,
                });
            }
        } else {
            return res.status(500).json({
                success: false,
                error: 'Firebase Admin not initialized',
                partialErrors: errors,
            });
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

// ── 앱 설정 업데이트 (빌드 스크립트용) ─────────────────────────────────────────
router.post('/api/config/app', async (req, res) => {
    const authHeader = req.headers.authorization;
    const buildSecret = process.env.BUILD_SECRET;
    if (!buildSecret || authHeader !== `Bearer ${buildSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    const { latestNativeVersion } = req.body;
    if (!latestNativeVersion) return res.status(400).json({ error: 'latestNativeVersion required' });

    try {
        await adminDb.collection('config').doc('app').set(
            { latestNativeVersion, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );
        console.log(`[Config] latestNativeVersion updated to ${latestNativeVersion}`);
        res.json({ success: true, latestNativeVersion });
    } catch (err) {
        console.error('[Config] update error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 익명 → 기존 계정 데이터 마이그레이션 ─────────────────────────────────────
// 재방문 유저: 익명 계정 데이터를 기존 Google 계정으로 이전
router.post('/api/migrate-anonymous', requireAuth, async (req, res) => {
    const targetUid = req.uid; // 현재 로그인된 유저 (Google 계정)
    const { anonymousUid } = req.body;
    if (!anonymousUid) return res.status(400).json({ error: 'anonymousUid required' });
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });
    if (targetUid === anonymousUid) return res.status(400).json({ error: 'same uid' });

    const migrated = { savedCards: 0, subcollections: {} };

    try {
        // 1. savedCards: userId 필드를 targetUid로 업데이트
        const cardsSnap = await adminDb.collection('savedCards')
            .where('userId', '==', anonymousUid).get();
        if (!cardsSnap.empty) {
            const batch = adminDb.batch();
            cardsSnap.docs.forEach(d => batch.update(d.ref, { userId: targetUid }));
            await batch.commit();
            migrated.savedCards = cardsSnap.size;
        }

        // 2. users/{anonUid} 서브컬렉션 → users/{targetUid}로 복사
        const anonRef = adminDb.collection('users').doc(anonymousUid);
        const subcollections = await anonRef.listCollections();
        for (const sub of subcollections) {
            const docs = await sub.get();
            if (docs.empty) continue;
            const batch = adminDb.batch();
            let count = 0;
            docs.forEach(d => {
                const targetDocRef = adminDb
                    .collection('users').doc(targetUid)
                    .collection(sub.id).doc(d.id);
                batch.set(targetDocRef, d.data(), { merge: true });
                count++;
            });
            await batch.commit();
            migrated.subcollections[sub.id] = count;
        }

        // 3. users/{anonUid} 문서 → targetUid에 병합
        // 신규 계정: 익명의 모든 필드를 복사
        // 기존 계정(재설치 재로그인): 카운터만 합산, 나머지는 기존 값 유지
        const anonDoc = await anonRef.get();
        if (anonDoc.exists) {
            const anonData = anonDoc.data();
            const targetDoc = await adminDb.collection('users').doc(targetUid).get();
            const targetData = targetDoc.exists ? targetDoc.data() : {};
            const isExistingAccount = targetDoc.exists && targetData.createdAt;

            const mergeFields = {};

            if (isExistingAccount) {
                // ── 기존 계정: 카운터만 합산 (tier, 구독, 설정 등 보호) ──
                const counterKeys = [
                    'trialCardCount', 'savedCardCount', 'trialPronCount',
                    'translationGenerateCount', 'sceneGenerateCount',
                    'vocabGenerateCount', 'totalGenerateCount',
                ];
                for (const key of counterKeys) {
                    if ((anonData[key] || 0) > 0) {
                        mergeFields[key] = admin.firestore.FieldValue.increment(anonData[key] || 0);
                    }
                }
            } else {
                // ── 신규 계정: 익명의 모든 필드를 복사 (보호 필드 제외) ──
                const protectedKeys = ['uid', 'email', 'isAnonymous', 'createdAt', 'updatedAt'];
                for (const [key, value] of Object.entries(anonData)) {
                    if (!protectedKeys.includes(key) && value !== undefined && value !== null) {
                        mergeFields[key] = value;
                    }
                }
            }

            if (Object.keys(mergeFields).length > 0) {
                mergeFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                await adminDb.collection('users').doc(targetUid).set(mergeFields, { merge: true });
            }
        }

        // 4. 익명 계정 Firestore 정리 (서브컬렉션 + 메인 문서)
        for (const sub of subcollections) {
            const docs = await sub.listDocuments();
            if (docs.length > 0) {
                const batch = adminDb.batch();
                docs.forEach(d => batch.delete(d));
                await batch.commit();
            }
        }
        await anonRef.delete();

        // 5. 익명 Auth 계정 삭제
        if (admin.apps.length) {
            try {
                await admin.auth().deleteUser(anonymousUid);
            } catch (authErr) {
                // 이미 삭제됐거나 존재하지 않으면 무시
                if (authErr.code !== 'auth/user-not-found') {
                    console.warn(`[Migrate] anon Auth delete failed: ${authErr.message}`);
                }
            }
        }

        console.log(`[Migrate] ${anonymousUid} → ${targetUid}:`, migrated);
        res.json({ success: true, migrated });
    } catch (err) {
        console.error('[Migrate] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── [Admin] 이메일 기준 Auth 유저 조회/삭제 (테스트용, BUILD_SECRET 인증) ──────
router.post('/api/admin/delete-auth-by-email', async (req, res) => {
    const authHeader = req.headers.authorization;
    const buildSecret = process.env.BUILD_SECRET;
    if (!buildSecret || authHeader !== `Bearer ${buildSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });

    const { email, dryRun } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    try {
        const user = await admin.auth().getUserByEmail(email);
        const info = {
            uid: user.uid,
            email: user.email,
            providers: user.providerData.map(p => p.providerId),
            created: user.metadata.creationTime,
            lastSignIn: user.metadata.lastSignInTime,
        };

        if (dryRun) {
            return res.json({ success: true, action: 'dry-run', user: info });
        }

        await admin.auth().deleteUser(user.uid);
        console.log(`[Admin] Auth user deleted by email: ${email} (uid: ${user.uid})`);
        res.json({ success: true, action: 'deleted', user: info });
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            return res.json({ success: true, action: 'not-found', message: 'No Auth user with this email' });
        }
        console.error('[Admin] delete-auth-by-email error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
