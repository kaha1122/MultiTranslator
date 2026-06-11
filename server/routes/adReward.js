// 보상광고 보너스 충전 — 1회 +10pt (사이드바 "보너스포인트 충전" 버튼)
//   (2026-06-09: native TTS 항상-차감 보정으로 +5→+10 상향)
// 어뷰즈 방어: 쿨다운 60s(lastAdRewardAt) + 일일 상한(adRewardCount/adRewardCountDate) + Pro/Premium 자동 skip
// 주: AdMob SSV 미적용 → 클라가 광고 시청 없이 호출 가능하나, 쿨다운+일일상한으로 보수적 방어.
const express = require('express');
const { admin, adminDb } = require('../config/firebase');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { grantBonusPoints } = require('../utils/bonusPoints');

const router = express.Router();

const AD_REWARD_AMOUNT = 10;
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
        const today = utcDateStr();

        // 2026-06-11 동시성: 쿨다운/일일캡 검사와 카운터 기록을 단일 트랜잭션으로 —
        // 이전엔 read 검사 후 별도 write라 N개 병렬 POST가 모두 통과해 캡 우회 가능(TOCTOU).
        // 슬롯 선점 후 grant — Pro skip/grant 실패 시 슬롯 1회 소모는 수용(60s 후 재시도 가능).
        let claim;
        try {
            claim = await adminDb.runTransaction(async (tx) => {
                const snap = await tx.get(userRef);
                if (!snap.exists) return { reject: 404, error: 'user_not_found' };
                const data = snap.data();

                const lastMs = data.lastAdRewardAt?.toMillis?.() || 0;
                if (Date.now() - lastMs < COOLDOWN_MS) {
                    return { reject: 429, error: 'cooldown', message: '잠시 후 다시 시도해주세요' };
                }
                const sameDay = data.adRewardCountDate === today;
                const todayCount = sameDay ? (data.adRewardCount || 0) : 0;
                if (todayCount >= DAILY_CAP) {
                    return { reject: 429, error: 'daily_cap', message: '오늘 충전 한도에 도달했어요' };
                }
                tx.update(userRef, {
                    lastAdRewardAt: admin.firestore.FieldValue.serverTimestamp(),
                    adRewardCountDate: today,
                    adRewardCount: todayCount + 1,
                });
                return { todayCount };
            });
        } catch (txErr) {
            console.error('[AdReward] transaction error:', txErr.message);
            return res.status(500).json({ error: 'transaction_failed' });
        }
        if (claim.reject) {
            return res.status(claim.reject).json({ error: claim.error, message: claim.message });
        }

        // 보너스 부여 — Pro/Premium 자동 skip
        const result = await grantBonusPoints({ uid, amount: AD_REWARD_AMOUNT, source: 'adReward' });
        if (result.skipped) {
            return res.json({ success: false, skipped: true, reason: result.reason });
        }

        console.log(`[AdReward] +${AD_REWARD_AMOUNT}pt to ${uid} (today ${claim.todayCount + 1}/${DAILY_CAP})`);
        return res.json({ success: true, granted: AD_REWARD_AMOUNT });
    } catch (err) {
        console.error('[AdReward] error:', err);
        return res.status(500).json({ error: err.message });
    }
});

// ── 일일 포인트 충전 (Trial 전용, 1일차 30 / 이후 +10) ─────────────────────────
// 2026-06-11: 클라이언트 트랜잭션(AuthContext.claimDailyTopUp)에서 서버로 이전 —
//   ① Firestore rules로 bonusPoints 클라 증가를 차단하기 위한 선행 작업(rules-prep)
//   ② 디바이스 시계 조작으로 매일 +10을 무한 재청구하던 구멍 차단(서버 날짜 검증)
// body: { date: 'YYYY-MM-DD' } — 클라 로컬 날짜 (로컬 자정 경계 UX 유지).
//   서버는 ±48h 범위 검증 + lastTopUpDate 단조 증가 강제 → 시계 점프 이득 0.
router.post('/api/bonus/daily-topup', requireAuth, rateLimit('daily-topup', { perMinute: 4, perHour: 20 }), async (req, res) => {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin not initialized' });
    const uid = req.uid;
    const clientDate = String(req.body?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clientDate)) {
        return res.status(400).json({ error: 'invalid_date' });
    }
    const clientMs = Date.parse(`${clientDate}T00:00:00Z`);
    if (!Number.isFinite(clientMs) || Math.abs(clientMs - Date.now()) > 48 * 3600 * 1000) {
        return res.status(400).json({ error: 'date_out_of_range' });
    }

    try {
        const result = await adminDb.runTransaction(async (tx) => {
            const ref = adminDb.collection('users').doc(uid);
            const snap = await tx.get(ref);
            if (!snap.exists) return { status: 404, body: { error: 'user_not_found' } };
            const d = snap.data();
            if ((d.tier || 'trial') !== 'trial') return { status: 200, body: { success: false, skipped: true } };
            // 단조 증가 가드 — 같은 날 재청구 + 시계 되돌리기 모두 차단
            if (d.lastTopUpDate && clientDate <= d.lastTopUpDate) {
                return { status: 200, body: { success: false, already: true } };
            }
            const amount = d.firstTopUpDone ? 10 : 30;
            tx.update(ref, {
                bonusPoints: admin.firestore.FieldValue.increment(amount),
                lastTopUpDate: clientDate,
                firstTopUpDone: true,
                lastTopUpAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return { status: 200, body: { success: true, granted: amount } };
        });
        if (result.body.success) console.log(`[DailyTopUp] +${result.body.granted}pt to ${uid} (${clientDate})`);
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[DailyTopUp] error:', err);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
