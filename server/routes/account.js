const express = require('express');
const axios = require('axios');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { grantBonusPoints } = require('../utils/bonusPoints');

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

    // 플랫폼별 버전 분리 (iOS / Android 독립 운영) + 레거시 latestNativeVersion 호환
    const { latestIOSVersion, latestAndroidVersion, latestNativeVersion } = req.body;
    if (!latestIOSVersion && !latestAndroidVersion && !latestNativeVersion) {
        return res.status(400).json({ error: 'latestIOSVersion, latestAndroidVersion, or latestNativeVersion required' });
    }

    try {
        const updateData = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (latestIOSVersion) updateData.latestIOSVersion = latestIOSVersion;
        if (latestAndroidVersion) updateData.latestAndroidVersion = latestAndroidVersion;
        if (latestNativeVersion) updateData.latestNativeVersion = latestNativeVersion; // 레거시
        await adminDb.collection('config').doc('app').set(updateData, { merge: true });
        console.log('[Config] updated:', JSON.stringify(updateData));
        res.json({ success: true, ...updateData });
    } catch (err) {
        console.error('[Config] update error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 익명 → 기존 계정 데이터 마이그레이션 ─────────────────────────────────────
// 재방문 유저: 익명 계정 데이터를 기존 Google 계정으로 이전
router.post('/api/migrate-anonymous', requireAuth, async (req, res) => {
    const targetUid = req.uid; // 현재 로그인된 유저 (Google 계정)
    const { anonymousUid, isNewUser: clientIsNewUser } = req.body;
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
        // 기존 계정(재설치 재로그인): 카운터 합산 + 디바이스/세션/푸시 필드 병합
        const anonDoc = await anonRef.get();
        let mergedFieldKeys = [];
        let anonSnapshotForArchive = null;
        let isExistingAccountForArchive = false;
        if (anonDoc.exists) {
            const anonData = anonDoc.data();
            anonSnapshotForArchive = anonData;
            const targetDoc = await adminDb.collection('users').doc(targetUid).get();
            const targetData = targetDoc.exists ? targetDoc.data() : {};

            // ── 분기 판정 (2026-05-17 D2 패치) ──
            // 1순위: 클라이언트가 명시한 isNewUser 시그널 (Firebase additionalInfo.isNewUser
            //        또는 createUserWithEmail/signInWithEmail/credential-already-in-use 등으로 확정 가능)
            // 2순위: 기존 추측 — targetData.createdAt 존재 여부 (AuthContext 자동 setDoc과 race 위험)
            // 클라이언트가 명시적으로 false/true를 보내면 그대로 채택, 미전송(undefined)이면 fallback.
            let isExistingAccount;
            if (clientIsNewUser === true) {
                isExistingAccount = false;
            } else if (clientIsNewUser === false) {
                isExistingAccount = true;
            } else {
                isExistingAccount = !!(targetDoc.exists && targetData.createdAt);
            }
            isExistingAccountForArchive = !!isExistingAccount;

            const mergeFields = {};

            if (isExistingAccount) {
                // ── 기존 계정 분기 ──
                // (a) 카운터: 합산
                //   2026-05-17 D5 패치: freeTalkCredits/pronCredits/proPronCount/totalFreeTalkCount/
                //     activeDayCount/totalGoalAchievedDays 추가 — 익명에서 적립한 영구 크레딧과
                //     누적 활동/목표달성 카운터를 실계정에 합산하지 않으면 사용자 자산 손실.
                const counterKeys = [
                    'trialCardCount', 'savedCardCount', 'trialPronCount',
                    'translationGenerateCount', 'sceneGenerateCount',
                    'vocabGenerateCount', 'listenGenerateCount', 'totalGenerateCount',
                    'bonusPoints',
                    'freeTalkCredits', 'pronCredits',
                    'proPronCount', 'totalFreeTalkCount',
                    'activeDayCount', 'totalGoalAchievedDays',
                ];
                for (const key of counterKeys) {
                    if ((anonData[key] || 0) > 0) {
                        mergeFields[key] = admin.firestore.FieldValue.increment(anonData[key] || 0);
                    }
                }

                // (b) FCM 토큰: Instance ID prefix 기반 dedup 머지 (2026-05-18 fix)
                //   기존 arrayUnion은 같은 단말의 회전된 옛 토큰 + 새 토큰을 둘 다 누적시켜
                //   재설치 후 기존 계정 로그인 시 같은 단말에 알림 2번 발화하는 결함 있었음.
                //   FCM 토큰의 콜론(:) 앞부분이 Instance ID = 같은 단말 식별자. 같은 prefix의
                //   target 토큰은 옛 토큰으로 보고 익명 토큰으로 교체. 다른 단말은 prefix 달라 보존.
                if (Array.isArray(anonData.fcmTokens) && anonData.fcmTokens.length > 0) {
                    const existing = Array.isArray(targetData.fcmTokens) ? targetData.fcmTokens.filter(Boolean) : [];
                    const anonValid = anonData.fcmTokens.filter(Boolean);
                    const anonPrefixes = new Set(anonValid.map(t => t.split(':')[0]));
                    const cleaned = existing.filter(t => !anonPrefixes.has(t.split(':')[0]));
                    const merged = [...new Set([...cleaned, ...anonValid])]; // 중복 문자열 제거
                    mergeFields.fcmTokens = merged;
                }
                // FCM 메타: anon이 더 최근이면 채택
                if (anonData.fcmTokenUpdatedAt) {
                    const aMs = anonData.fcmTokenUpdatedAt?.toMillis?.() || 0;
                    const tMs = targetData.fcmTokenUpdatedAt?.toMillis?.() || 0;
                    if (aMs > tMs) mergeFields.fcmTokenUpdatedAt = anonData.fcmTokenUpdatedAt;
                }

                // (c) lastActiveAt: 더 최근 timestamp 우선
                if (anonData.lastActiveAt) {
                    const aMs = anonData.lastActiveAt?.toMillis?.() || 0;
                    const tMs = targetData.lastActiveAt?.toMillis?.() || 0;
                    if (aMs > tMs) mergeFields.lastActiveAt = anonData.lastActiveAt;
                }

                // (c2) 2026-05-17 D4 패치: streak / 누적 활동 max-merge
                //   streakCurrent: 단순 max — 익명에서 더 길게 쌓았으면 그 값 유지.
                //     (정밀한 연속성 계산은 useStreak가 dailyProgress 서브컬렉션에서 재계산하므로
                //      여기서는 보수적으로 max를 채택해 표시 손실만 방지.)
                //   streakLongest: 단순 max — 역대 최장 기록은 큰 값이 진실.
                //   streakUpdatedAt: 더 최근.
                if ((anonData.streakCurrent || 0) > (targetData.streakCurrent || 0)) {
                    mergeFields.streakCurrent = anonData.streakCurrent;
                }
                if ((anonData.streakLongest || 0) > (targetData.streakLongest || 0)) {
                    mergeFields.streakLongest = anonData.streakLongest;
                }
                if (anonData.streakUpdatedAt) {
                    const aMs = anonData.streakUpdatedAt?.toMillis?.() || 0;
                    const tMs = targetData.streakUpdatedAt?.toMillis?.() || 0;
                    if (aMs > tMs) mergeFields.streakUpdatedAt = anonData.streakUpdatedAt;
                }
                // lastActiveDay: 'YYYY-MM-DD' 문자열 — 더 최근(사전순 max) 채택
                if (anonData.lastActiveDay && (!targetData.lastActiveDay || anonData.lastActiveDay > targetData.lastActiveDay)) {
                    mergeFields.lastActiveDay = anonData.lastActiveDay;
                }

                // (d) dailyProgress: 날짜 키별 max(count) 머지
                if (anonData.dailyProgress && typeof anonData.dailyProgress === 'object') {
                    const merged = { ...(targetData.dailyProgress || {}) };
                    let changed = false;
                    for (const [date, val] of Object.entries(anonData.dailyProgress)) {
                        const tv = merged[date];
                        const aCount = val?.count || 0;
                        const tCount = tv?.count || 0;
                        if (!tv || aCount > tCount) {
                            merged[date] = val;
                            changed = true;
                        }
                    }
                    if (changed) mergeFields.dailyProgress = merged;
                }

                // (e) reengagementSentAt: dN 키별 더 최근 timestamp 머지
                if (anonData.reengagementSentAt && typeof anonData.reengagementSentAt === 'object') {
                    const merged = { ...(targetData.reengagementSentAt || {}) };
                    let changed = false;
                    for (const [k, v] of Object.entries(anonData.reengagementSentAt)) {
                        const tv = merged[k];
                        const aMs = v?.toMillis?.() || 0;
                        const tMs = tv?.toMillis?.() || 0;
                        if (aMs > tMs) {
                            merged[k] = v;
                            changed = true;
                        }
                    }
                    if (changed) mergeFields.reengagementSentAt = merged;
                }

                // (f) "target에 없을 때만 anon 값으로 채움" 필드들
                //     디바이스/세션/지오/유저 선호 — target의 명시적 값이 있으면 그대로 유지
                const fillIfMissingKeys = [
                    'sourceLang', 'targetLang', 'targetLangs',
                    'geoCountry', 'geoCity', 'geoRegion', 'phoneCountry',
                    'platform', 'deviceLang',
                    'currentNativePlatform', 'firstNativePlatform',
                    'lifecycleStage',
                    'reengagementOptOut', 'subscriptionAlertOptOut',
                    'featuresSeen',
                    'defaultLevel', 'userLevel',
                    'hasCompletedOnboarding',
                    'dailyGoal', // 2026-05-17 D4: 익명에서 설정한 일일 목표 보존
                ];
                for (const key of fillIfMissingKeys) {
                    if (anonData[key] !== undefined && anonData[key] !== null
                        && (targetData[key] === undefined || targetData[key] === null)) {
                        mergeFields[key] = anonData[key];
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
                mergedFieldKeys = Object.keys(mergeFields);
            }
        }

        // 3.5 anon doc 삭제 직전 감사 스냅샷 — 사고 복구 + 회귀 진단용
        // 키: targetUid 우선(신규 UID 기반 검색), 30일 후 expiresAt TTL로 자동 삭제
        // (Firestore Console에서 migrationArchive 컬렉션의 expiresAt 필드에 TTL 정책 활성화 필요)
        if (anonSnapshotForArchive) {
            try {
                const archiveId = `${targetUid}_${anonymousUid}_${Date.now()}`;
                const expiresAt = admin.firestore.Timestamp.fromMillis(
                    Date.now() + 30 * 24 * 60 * 60 * 1000
                );
                await adminDb.collection('migrationArchive').doc(archiveId).set({
                    targetUid,
                    anonymousUid,
                    isExistingAccount: isExistingAccountForArchive,
                    anonSnapshot: anonSnapshotForArchive,
                    mergedFieldKeys,
                    savedCardsCount: migrated.savedCards,
                    subcollectionCounts: migrated.subcollections,
                    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                    expiresAt,
                });
            } catch (archiveErr) {
                // 아카이브 실패는 마이그레이션 자체를 막지 않음 (best-effort)
                console.warn(`[Migrate] archive failed: ${archiveErr.message}`);
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

// ── [Admin] migrationArchive에서 누락 필드 backfill (2026-05-17) ────────────
// 과거 race condition으로 "기존 계정"으로 오판되어 학습 이력(streak, credits 등)이
// 누락된 사고를 복구. archive에 보관된 anonSnapshot을 보강된 머지 룰로 재적용.
//
// body: { targetUid: string, anonymousUid?: string, dryRun?: boolean, forceFields?: string[] }
//   - targetUid: 복구 대상 (현 실계정 UID)
//   - anonymousUid: 특정 archive 지정 (생략 시 targetUid의 모든 archive 합산)
//   - dryRun: true면 어떤 필드를 어떻게 set할지만 반환
//   - forceFields: 지정하면 해당 필드만 복구. 미지정 시 누락 위험 학습 이력 풀세트.
router.post('/api/admin/restore-from-archive', async (req, res) => {
    const authHeader = req.headers.authorization;
    const buildSecret = process.env.BUILD_SECRET;
    if (!buildSecret || authHeader !== `Bearer ${buildSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    const { targetUid, anonymousUid, dryRun, forceFields } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'targetUid required' });

    try {
        // 1. archive 조회
        let archiveQuery = adminDb.collection('migrationArchive')
            .where('targetUid', '==', targetUid);
        if (anonymousUid) archiveQuery = archiveQuery.where('anonymousUid', '==', anonymousUid);
        const archives = await archiveQuery.get();
        if (archives.empty) {
            return res.status(404).json({ error: 'no archive found', targetUid, anonymousUid: anonymousUid || null });
        }

        // 2. 가장 최근 archive 1개만 사용 (archivedAt desc)
        //    여러 익명 UID를 거쳐온 경우라도 가장 마지막 마이그레이션이 유일한 진실의 원천.
        const latest = archives.docs
            .sort((a, b) => {
                const aMs = a.data().archivedAt?.toMillis?.() || 0;
                const bMs = b.data().archivedAt?.toMillis?.() || 0;
                return bMs - aMs;
            })[0];
        const archiveData = latest.data();
        const anonSnapshot = archiveData.anonSnapshot || {};

        // 3. 현재 target 문서 조회
        const targetDoc = await adminDb.collection('users').doc(targetUid).get();
        if (!targetDoc.exists) return res.status(404).json({ error: 'target user not found' });
        const targetData = targetDoc.data();

        // 4. 복구 대상 필드 — 보강된 머지 룰과 동일
        const counterKeys = forceFields || [
            'trialCardCount', 'savedCardCount', 'trialPronCount',
            'translationGenerateCount', 'sceneGenerateCount',
            'vocabGenerateCount', 'listenGenerateCount', 'totalGenerateCount',
            'bonusPoints',
            'freeTalkCredits', 'pronCredits',
            'proPronCount', 'totalFreeTalkCount',
            'activeDayCount', 'totalGoalAchievedDays',
        ];

        const plan = { counters: {}, streak: {}, fill: {}, skipped: [] };
        const mergeFields = {};

        // archive가 신규 가입(isExistingAccount=false)였다면 이미 모든 필드가 복사됐어야 함 →
        // 그래도 누락된 게 있으면 복구. 기존 계정(true)이었다면 카운터 increment로 처리.
        const wasExisting = archiveData.isExistingAccount === true;

        for (const key of counterKeys) {
            const anonVal = anonSnapshot[key] || 0;
            const targetVal = targetData[key] || 0;
            if (anonVal <= 0) continue;
            if (wasExisting) {
                // 기존 계정 분기였다면: archive 시점에 increment가 적용됐는지 확인 어려움 →
                // mergedFieldKeys로 검증 후 미적용 키만 increment
                const wasMerged = (archiveData.mergedFieldKeys || []).includes(key);
                if (!wasMerged) {
                    mergeFields[key] = admin.firestore.FieldValue.increment(anonVal);
                    plan.counters[key] = { mode: 'increment', amount: anonVal };
                } else {
                    plan.skipped.push(`${key} (already merged)`);
                }
            } else {
                // 신규 가입 분기였다면: anonData 전체가 복사됐어야 함 → target에 값이 없으면 set
                if (targetVal === 0 || targetVal === undefined || targetVal === null) {
                    mergeFields[key] = anonVal;
                    plan.counters[key] = { mode: 'set', value: anonVal };
                } else {
                    plan.skipped.push(`${key} (target=${targetVal}, anon=${anonVal})`);
                }
            }
        }

        // streak: max-merge
        if ((anonSnapshot.streakCurrent || 0) > (targetData.streakCurrent || 0)) {
            mergeFields.streakCurrent = anonSnapshot.streakCurrent;
            plan.streak.streakCurrent = anonSnapshot.streakCurrent;
        }
        if ((anonSnapshot.streakLongest || 0) > (targetData.streakLongest || 0)) {
            mergeFields.streakLongest = anonSnapshot.streakLongest;
            plan.streak.streakLongest = anonSnapshot.streakLongest;
        }
        if (anonSnapshot.streakUpdatedAt) {
            const aMs = anonSnapshot.streakUpdatedAt?.toMillis?.() || 0;
            const tMs = targetData.streakUpdatedAt?.toMillis?.() || 0;
            if (aMs > tMs) {
                mergeFields.streakUpdatedAt = anonSnapshot.streakUpdatedAt;
                plan.streak.streakUpdatedAt = '(timestamp)';
            }
        }
        if (anonSnapshot.lastActiveDay && (!targetData.lastActiveDay || anonSnapshot.lastActiveDay > targetData.lastActiveDay)) {
            mergeFields.lastActiveDay = anonSnapshot.lastActiveDay;
            plan.streak.lastActiveDay = anonSnapshot.lastActiveDay;
        }

        // fillIfMissing: 언어/온보딩/dailyGoal
        const fillKeys = ['sourceLang', 'targetLang', 'targetLangs', 'defaultLevel', 'userLevel', 'hasCompletedOnboarding', 'dailyGoal'];
        for (const key of fillKeys) {
            const anonVal = anonSnapshot[key];
            if (anonVal !== undefined && anonVal !== null
                && (targetData[key] === undefined || targetData[key] === null)) {
                mergeFields[key] = anonVal;
                plan.fill[key] = anonVal;
            }
        }

        const fieldKeysToSet = Object.keys(mergeFields);

        if (dryRun) {
            return res.json({
                success: true,
                action: 'dry-run',
                targetUid,
                anonymousUid: archiveData.anonymousUid,
                archivedAt: archiveData.archivedAt,
                wasExisting,
                plan,
                fieldKeysToSet,
            });
        }

        if (fieldKeysToSet.length === 0) {
            return res.json({ success: true, action: 'noop', message: 'nothing to restore', plan });
        }

        mergeFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        mergeFields.restoredFromArchiveAt = admin.firestore.FieldValue.serverTimestamp();
        await adminDb.collection('users').doc(targetUid).set(mergeFields, { merge: true });

        // 복구 이력 기록 (별도 컬렉션 — 회귀 추적용)
        await adminDb.collection('migrationArchive').doc(latest.id).update({
            restoredAt: admin.firestore.FieldValue.serverTimestamp(),
            restoredFields: fieldKeysToSet,
        });

        console.log(`[Restore] ${targetUid}: ${fieldKeysToSet.length} fields restored from archive ${latest.id}`);
        res.json({
            success: true,
            action: 'restored',
            targetUid,
            anonymousUid: archiveData.anonymousUid,
            wasExisting,
            plan,
            fieldKeysToSet,
        });
    } catch (err) {
        console.error('[Restore] error:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
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

// ── [Admin] 기존 savedCards에 serialNumber 일괄 부여 (1회성 마이그레이션) ──
// 각 user의 savedCards를 createdAt asc로 정렬하여 1부터 순차 배정.
// serialNumber가 이미 있는 카드는 skip (재실행 안전).
// 요청 body: { dryRun?: boolean }
router.post('/api/admin/assign-card-serials', async (req, res) => {
    const authHeader = req.headers.authorization;
    const buildSecret = process.env.BUILD_SECRET;
    if (!buildSecret || authHeader !== `Bearer ${buildSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adminDb) return res.status(500).json({ error: 'Firestore not initialized' });

    const dryRun = req.body?.dryRun === true;
    const stats = { usersProcessed: 0, cardsAssigned: 0, cardsSkipped: 0, savedCountFixed: 0 };

    try {
        const usersSnap = await adminDb.collection('users').get();
        for (const userDoc of usersSnap.docs) {
            const uid = userDoc.id;
            // orderBy를 서버에서 하면 복합 인덱스 필요 → 1회성이라 메모리 정렬로 회피
            const cardsSnap = await adminDb.collection('savedCards')
                .where('userId', '==', uid)
                .get();
            const activeCards = cardsSnap.docs
                .filter(d => !d.data().isDeleted)
                .sort((a, b) => {
                    const at = a.data().createdAt?.toMillis?.() ?? 0;
                    const bt = b.data().createdAt?.toMillis?.() ?? 0;
                    return at - bt; // asc: 오래된 것이 먼저
                });
            if (activeCards.length === 0) continue;

            // 시작점 보호: 이미 serialNumber가 있는 카드(신규 로직으로 생성됨)의 최댓값과
            // 유저 문서의 cardSerialMax 중 더 큰 값부터 이어서 부여 → 번호 충돌 방지.
            const existingMaxSerial = activeCards
                .map(c => c.data().serialNumber)
                .filter(s => typeof s === 'number')
                .reduce((m, s) => Math.max(m, s), 0);
            const currentCounter = userDoc.data().cardSerialMax || 0;
            let serialMax = Math.max(currentCounter, existingMaxSerial);
            const cardsToAssign = [];
            for (const c of activeCards) {
                if (c.data().serialNumber != null) { stats.cardsSkipped++; continue; }
                serialMax++;
                cardsToAssign.push({ ref: c.ref, serial: serialMax });
                stats.cardsAssigned++;
            }

            // savedCardCount 정합성 검사 (실제 활성 카드 수와 불일치 시 보정)
            const actualSavedCount = activeCards.length;
            const currentSavedCount = userDoc.data().savedCardCount || 0;
            const needRecount = actualSavedCount !== currentSavedCount;

            if (cardsToAssign.length === 0 && !needRecount) continue;
            stats.usersProcessed++;
            if (needRecount) stats.savedCountFixed++;

            if (!dryRun) {
                if (cardsToAssign.length > 0) {
                    // 500건씩 배치 분할 (Firestore 한도)
                    for (let i = 0; i < cardsToAssign.length; i += 400) {
                        const batch = adminDb.batch();
                        const chunk = cardsToAssign.slice(i, i + 400);
                        for (const { ref, serial } of chunk) {
                            batch.update(ref, { serialNumber: serial });
                        }
                        // 마지막 청크에 user 카운터도 함께 업데이트
                        if (i + 400 >= cardsToAssign.length) {
                            const userUpdates = { cardSerialMax: serialMax };
                            if (needRecount) userUpdates.savedCardCount = actualSavedCount;
                            batch.update(userDoc.ref, userUpdates);
                        }
                        await batch.commit();
                    }
                } else if (needRecount) {
                    // serialNumber 배정은 불필요하지만 savedCardCount 보정만 필요한 케이스
                    await userDoc.ref.update({ savedCardCount: actualSavedCount });
                }
            }
        }
        console.log(`[AssignSerials] dryRun=${dryRun}`, stats);
        res.json({ success: true, dryRun, stats });
    } catch (err) {
        console.error('[AssignSerials] error:', err);
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

// ── [Admin] 보너스 포인트 수동 부여 (테스트/캠페인 보정용, BUILD_SECRET 인증) ──
// body: { uidOrEmail: string, amount: number, source?: string, meta?: object }
router.post('/api/admin/grant-bonus', async (req, res) => {
    const authHeader = req.headers.authorization;
    const buildSecret = process.env.BUILD_SECRET;
    if (!buildSecret || authHeader !== `Bearer ${buildSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });

    const { uidOrEmail, amount, source, meta } = req.body;
    if (!uidOrEmail || typeof amount !== 'number') {
        return res.status(400).json({ error: 'uidOrEmail and amount(number) required' });
    }

    try {
        // email인 경우 uid 조회
        let uid = uidOrEmail;
        if (uidOrEmail.includes('@')) {
            const authUser = await admin.auth().getUserByEmail(uidOrEmail);
            uid = authUser.uid;
        }

        const result = await grantBonusPoints({
            uid,
            amount,
            source: source || 'admin_manual',
            meta: meta || {},
        });

        // 부여 후 잔여 조회
        const userSnap = await adminDb.collection('users').doc(uid).get();
        const newBalance = userSnap.data()?.bonusPoints || 0;

        res.json({ success: true, uid, granted: amount, newBalance, source: result.source });
    } catch (err) {
        console.error('[Admin grant-bonus] error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
