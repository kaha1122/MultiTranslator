// 친구 추천 (Referral) 캠페인 — 코드 발급 + 코드 입력 + 보상 부여
const express = require('express');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { grantBonusPoints } = require('../utils/bonusPoints');

const router = express.Router();

// 6자 random 코드 — 모호 문자(0/1/I/O/L) 제외
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31자
const CODE_PREFIX = 'PFIT-';
const REFERRAL_BONUS_AMOUNT = 100;
const REFERRAL_LIFETIME_LIMIT = 20; // A의 평생 추천 한도

function genRandomCode() {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return CODE_PREFIX + s;
}

async function generateUniqueCode(maxAttempts = 5) {
    for (let i = 0; i < maxAttempts; i++) {
        const code = genRandomCode();
        const dupSnap = await adminDb.collection('users').where('referralCode', '==', code).limit(1).get();
        if (dupSnap.empty) return code;
    }
    throw new Error('failed to generate unique referral code');
}

// ── [Client] 자기 referralCode 발급/조회 (lazy 생성) ──────────────────────────
// Body: { } — 인증된 사용자에게 코드 부여 (없으면 새로 생성, 있으면 그대로 반환)
router.post('/api/referral/ensure-code', requireAuth, async (req, res) => {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const uid = req.uid;
    try {
        const userRef = adminDb.collection('users').doc(uid);
        const snap = await userRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'user not found' });

        const data = snap.data();

        // 익명 사용자 차단 — 등록 사용자만 코드 발급
        if (data.isAnonymous === true) {
            return res.status(403).json({ error: 'anonymous_not_allowed', message: '가입 후 이용해주세요' });
        }

        // 이미 있으면 그대로 반환
        if (data.referralCode) {
            return res.json({ success: true, code: data.referralCode, alreadyExisted: true });
        }

        // 신규 생성 — 충돌 검사 후 저장
        const code = await generateUniqueCode();
        await userRef.update({
            referralCode: code,
            referralCodeCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true, code, alreadyExisted: false });
    } catch (err) {
        console.error('[Referral] ensure-code error:', err);
        return res.status(500).json({ error: err.message });
    }
});

// ── [Client] 친구 코드 입력 → 양쪽 100pt 부여 ─────────────────────────────────
// Body: { code: "PFIT-XXXXXX" }
router.post('/api/referral/apply', requireAuth, async (req, res) => {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const uid = req.uid;
    const rawCode = (req.body?.code || '').trim().toUpperCase();

    if (!/^PFIT-[A-Z2-9]{6}$/.test(rawCode)) {
        return res.status(400).json({ error: 'invalid_format', message: '코드 형식이 올바르지 않습니다' });
    }

    try {
        const myRef = adminDb.collection('users').doc(uid);
        const mySnap = await myRef.get();
        if (!mySnap.exists) return res.status(404).json({ error: 'user_not_found' });
        const myData = mySnap.data();

        // 익명 사용자 차단 — 본인 계정으로만 신청 가능
        if (myData.isAnonymous === true) {
            return res.status(403).json({ error: 'anonymous_not_allowed', message: '가입 후 이용해주세요' });
        }

        // 이미 추천받은 사람 차단 (1회 제한)
        if (myData.referredBy) {
            return res.status(409).json({ error: 'already_redeemed', message: '이미 추천받으셨어요' });
        }

        // 자기 자신 추천 차단
        if (myData.referralCode === rawCode) {
            return res.status(400).json({ error: 'self_referral', message: '자기 자신은 추천할 수 없습니다' });
        }

        // 추천인 A 조회
        const refQuery = await adminDb.collection('users').where('referralCode', '==', rawCode).limit(1).get();
        if (refQuery.empty) {
            return res.status(404).json({ error: 'invalid_code', message: '유효하지 않은 코드입니다' });
        }
        const referrerDoc = refQuery.docs[0];
        const referrerUid = referrerDoc.id;
        const referrerData = referrerDoc.data();

        // A의 평생 추천 한도 검사
        const aTotalReferred = referrerData.referralStats?.totalReferred || 0;
        if (aTotalReferred >= REFERRAL_LIFETIME_LIMIT) {
            return res.status(429).json({
                error: 'referrer_limit_reached',
                message: '추천인의 한도가 가득 찼습니다',
            });
        }

        // ── 양쪽 처리 ──────────────────────────────────────────────────────
        // 1. B(나) 에게 100pt 부여 + referredBy set (immutable)
        await grantBonusPoints({
            uid,
            amount: REFERRAL_BONUS_AMOUNT,
            source: 'referralWelcome',
            meta: { referrerUid, referrerCode: rawCode },
        });
        await myRef.update({
            referredBy: rawCode,
            referredByUid: referrerUid,
            referredAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 2. A(추천인) 에게 100pt 부여 — Pro/Premium 자동 skip (grantBonusPoints 내부)
        const aGrant = await grantBonusPoints({
            uid: referrerUid,
            amount: REFERRAL_BONUS_AMOUNT,
            source: 'referralReferrer',
            meta: { referredUid: uid },
        });

        // 3. A의 통계 업데이트 (skip 여부와 무관하게 카운트)
        const earnedDelta = aGrant?.skipped ? 0 : REFERRAL_BONUS_AMOUNT;
        await adminDb.collection('users').doc(referrerUid).update({
            'referralStats.totalReferred': admin.firestore.FieldValue.increment(1),
            'referralStats.totalEarnedPoints': admin.firestore.FieldValue.increment(earnedDelta),
            'referralStats.lastReferredAt': admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[Referral] ${uid} redeemed code ${rawCode} (referrer=${referrerUid}, aGrant=${aGrant?.skipped ? 'skipped' : 'granted'})`);
        return res.json({
            success: true,
            granted: REFERRAL_BONUS_AMOUNT,
            referrerSkipped: !!aGrant?.skipped,
        });
    } catch (err) {
        console.error('[Referral] apply error:', err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
