// 보상광고 보너스 충전 — 1회 +5pt (사이드바 "보너스포인트 충전" 버튼)
// 어뷰즈 방어: 쿨다운 60s(lastAdRewardAt) + 일일 상한(adRewardCount/adRewardCountDate) + Pro/Premium 자동 skip
// 주: AdMob SSV 미적용 → 클라가 광고 시청 없이 호출 가능하나, 쿨다운+일일상한+소액(+5)으로 보수적 방어.
const express = require('express');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { grantBonusPoints } = require('../utils/bonusPoints');

const router = express.Router();

const AD_REWARD_AMOUNT = 5;
const COOLDOWN_MS = 60_000;     // 광고 1회 최소 간격
const DAILY_CAP = 5;           // 하루 충전 횟수 상한

// UTC 날짜 키 (어뷰즈 가드용 — 유저 TZ 정밀도 불필요)
function utcDateStr() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

router.post('/api/bonus/ad-reward', requireAuth, async (req, res) => {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const uid = req.uid;

    try {
        const userRef = adminDb.collection('users').doc(uid);
        const snap = await userRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'user_not_found' });
        const data = snap.data();

        // 쿨다운
        const lastMs = data.lastAdRewardAt?.toMillis?.() || 0;
        if (Date.now() - lastMs < COOLDOWN_MS) {
            return res.status(429).json({ error: 'cooldown', message: '잠시 후 다시 시도해주세요' });
        }

        // 일일 상한 (UTC 기준)
        const today = utcDateStr();
        const sameDay = data.adRewardCountDate === today;
        const todayCount = sameDay ? (data.adRewardCount || 0) : 0;
        if (todayCount >= DAILY_CAP) {
            return res.status(429).json({ error: 'daily_cap', message: '오늘 충전 한도에 도달했어요' });
        }

        // 보너스 부여 — Pro/Premium 자동 skip
        const result = await grantBonusPoints({ uid, amount: AD_REWARD_AMOUNT, source: 'adReward' });
        if (result.skipped) {
            return res.json({ success: false, skipped: true, reason: result.reason });
        }

        // 쿨다운/카운트 기록 (성공 시에만)
        await userRef.update({
            lastAdRewardAt: admin.firestore.FieldValue.serverTimestamp(),
            adRewardCountDate: today,
            adRewardCount: sameDay ? admin.firestore.FieldValue.increment(1) : 1,
        });

        console.log(`[AdReward] +${AD_REWARD_AMOUNT}pt to ${uid} (today ${todayCount + 1}/${DAILY_CAP})`);
        return res.json({ success: true, granted: AD_REWARD_AMOUNT });
    } catch (err) {
        console.error('[AdReward] error:', err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
