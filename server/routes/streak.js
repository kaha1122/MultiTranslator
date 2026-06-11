// Streak 마일스톤 보너스 클레임 (클라가 트리거, 서버가 검증·중복 차단)
// - 클라가 7/14/30/100일 도달 감지 시 즉시 호출
// - 2026-06-11: streakCurrent(클라가 본인 문서에 직접 쓰는 값) 신뢰 제거 —
//   dailyProgress 서브컬렉션에서 서버가 직접 재계산 (streakCurrent:100 위조로
//   전 마일스톤 1,800pt 무상 취득 가능하던 구멍 차단)
// - 동시성: bonusClaims/{uid}_streakN 원자 마커로 병렬 이중 지급 차단
const express = require('express');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { grantBonusPoints } = require('../utils/bonusPoints');
const { acquireClaim } = require('../utils/claimOnce');

const router = express.Router();

const MILESTONE_REWARDS = {
    7: 100,
    14: 200,
    30: 500,
    100: 1000,
};

// 서버 측 streak 재계산 — useStreak(클라)와 동일 정의:
// dailyProgress/{YYYY-MM-DD} 문서 중 count >= dailyGoal 또는 goalAchievedToday===true 인
// 날짜들의 "오늘/어제 앵커 연속 일수". 문서 ID는 클라 로컬 날짜라 서버(UTC)와 ±1일
// 편차 가능 → 앵커 탐색 범위를 서버 기준 -2일 ~ +1일로 넓혀 흡수.
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtUTC = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
async function computeServerStreak(uid, dailyGoalDefault) {
    const snap = await adminDb.collection('users').doc(uid).collection('dailyProgress').get();
    const achieved = new Set();
    snap.forEach(d => {
        const v = d.data() || {};
        const goal = v.dailyGoal || dailyGoalDefault;
        if ((v.count || 0) >= goal || v.goalAchievedToday === true) achieved.add(d.id);
    });
    const now = Date.now();
    let anchor = null;
    for (let off = 1; off >= -2; off--) {
        if (achieved.has(fmtUTC(now + off * DAY_MS))) { anchor = now + off * DAY_MS; break; }
    }
    if (anchor === null) return 0;
    let streak = 0;
    let t = anchor;
    while (achieved.has(fmtUTC(t))) { streak++; t -= DAY_MS; }
    return streak;
}

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

        // 서버 권위 재계산 — 클라가 쓴 streakCurrent는 검증에 사용하지 않음
        const currentStreak = await computeServerStreak(uid, data.dailyGoal || 3);
        if (currentStreak < milestone) {
            console.warn(`[Streak] claim rejected: server-computed ${currentStreak} < ${milestone} (client claimed ${data.streakCurrent || 0}) uid=${uid}`);
            return res.status(400).json({ error: 'streak_below_milestone', currentStreak, milestone });
        }

        // 동시성: 병렬 동시 클레임은 원자 마커로 한쪽만 진행
        if (!(await acquireClaim(`${uid}_${source}`, { uid, source }))) {
            return res.status(409).json({ error: 'already_claimed', source });
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
