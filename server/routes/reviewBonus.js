// 리뷰 보상 캠페인 — 1인 1회 100pt
// 정책: Apple App Store Guideline 5.6.1 (incentivized reviews 금지) → iOS 비노출은 클라이언트 가드
// 어뷰즈: 1회 제한 (reviewBonusClaimedAt) + 익명 차단 + Pro/Premium 자동 skip
const express = require('express');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { grantBonusPoints } = require('../utils/bonusPoints');
const { acquireClaim, releaseClaim } = require('../utils/claimOnce');

const router = express.Router();

const REVIEW_BONUS_AMOUNT = 100;

// ── [Client] 리뷰 보상 클레임 ─────────────────────────────────────────────────
router.post('/api/review-bonus/claim', requireAuth, async (req, res) => {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const uid = req.uid;

    try {
        const userRef = adminDb.collection('users').doc(uid);
        const snap = await userRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'user_not_found' });
        const data = snap.data();

        // 익명 차단 — 가입한 사용자만 가능
        if (data.isAnonymous === true) {
            return res.status(403).json({ error: 'anonymous_not_allowed', message: '가입 후 이용해주세요' });
        }

        // 1회 제한
        if (data.reviewBonusClaimedAt) {
            return res.status(409).json({ error: 'already_claimed', message: '이미 받으셨어요' });
        }

        // 2026-06-11 동시성: 위 read 검사만으론 병렬 요청이 모두 통과(TOCTOU) →
        // 원자적 클레임 마커로 한쪽만 진행
        const claimId = `${uid}_reviewBonus`;
        if (!(await acquireClaim(claimId, { uid, source: 'reviewBonus' }))) {
            return res.status(409).json({ error: 'already_claimed', message: '이미 받으셨어요' });
        }

        // 보너스 부여 — grantBonusPoints가 Pro/Premium 자동 skip
        const result = await grantBonusPoints({
            uid,
            amount: REVIEW_BONUS_AMOUNT,
            source: 'reviewBonus',
            meta: { platform: data.platform || 'unknown' },
        });

        // Pro/Premium skip된 경우는 claimedAt 기록 안 함 (tier 변경 시 재시도 가능)
        if (result.skipped) {
            await releaseClaim(claimId); // 재시도 허용 의미 보존
            return res.json({
                success: false,
                skipped: true,
                reason: result.reason,
                message: 'Pro/Premium 사용자는 이미 모든 혜택을 보유하고 있어요',
            });
        }

        // 성공 시에만 claimedAt 기록
        await userRef.update({
            reviewBonusClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[ReviewBonus] +${REVIEW_BONUS_AMOUNT}pt to ${uid}`);
        return res.json({ success: true, granted: REVIEW_BONUS_AMOUNT });
    } catch (err) {
        console.error('[ReviewBonus] claim error:', err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
