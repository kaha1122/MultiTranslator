// Streak 마일스톤 보너스 클레임 (Option B: 클라가 트리거, 서버는 중복만 차단)
// - 클라가 7/14/30/100일 도달 감지 시 즉시 호출
// - 서버: earnedMilestones 중복 차단 + grantBonusPoints가 Pro/Premium 자동 skip
// - streakCurrent는 클라가 Firestore에 기록한 값 신뢰 (단, 마일스톤보다 작으면 거부)
const express = require('express');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { grantBonusPoints } = require('../utils/bonusPoints');

const router = express.Router();

const MILESTONE_REWARDS = {
    7: 100,
    14: 200,
    30: 500,
    100: 1000,
};

router.post('/api/streak/claim', requireAuth, async (req, res) => {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const uid = req.uid;
    const milestone = Number(req.body?.milestone);

    if (!MILESTONE_REWARDS[milestone]) {
        return res.status(400).json({ error: 'invalid_milestone' });
    }

    const source = `streak${milestone}`;
    const amount = MILESTONE_REWARDS[milestone];

    try {
        const userRef = adminDb.collection('users').doc(uid);
        const snap = await userRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'user_not_found' });
        const data = snap.data();

        if (data.isAnonymous === true) {
            return res.status(403).json({ error: 'anonymous_not_allowed' });
        }

        const earned = Array.isArray(data.earnedMilestones) ? data.earnedMilestones : [];
        if (earned.includes(source)) {
            return res.status(409).json({ error: 'already_claimed', source });
        }

        const currentStreak = Number(data.streakCurrent || 0);
        if (currentStreak < milestone) {
            return res.status(400).json({ error: 'streak_below_milestone', currentStreak, milestone });
        }

        const result = await grantBonusPoints({
            uid,
            amount,
            source,
            meta: { streakValue: currentStreak },
        });

        if (result.skipped) {
            // Pro/Premium도 마일스톤은 기록 (재청구 방지) — 단 등급 변경 시 재시도 막힘
            await userRef.update({
                earnedMilestones: admin.firestore.FieldValue.arrayUnion(source),
            });
            return res.json({ success: false, skipped: true, reason: result.reason });
        }

        await userRef.update({
            earnedMilestones: admin.firestore.FieldValue.arrayUnion(source),
        });

        console.log(`[Streak] +${amount}pt to ${uid} (${source})`);
        return res.json({ success: true, granted: amount, source });
    } catch (err) {
        console.error('[Streak] claim error:', err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
