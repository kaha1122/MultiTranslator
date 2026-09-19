// ── K-DramaAnyLang(kculture-f96d8) AdMob 보상형 SSV 콜백 — 포인트 지급 권위 ─────────
// [2026-09-16] PronunFit routes/admobSsv.js 구조 이식. 종전 클라 호출형 `/api/community/points/ad-reward`
//   (클라가 Rewarded 이벤트를 받고 스스로 "지급해 달라" 호출 — 시청 없이 호출하는 봇에 무방비)를 대체한다.
//   Google이 시청 완료를 확인한 뒤 서명된 콜백을 우리 서버로 직접 쏘고, 공개키로 서명 검증 후에만 지급.
//
// 콜백 URL (AdMob 콘솔 > K-DramaAnyLang Android/iOS 보상형 유닛(BonusePoint) > 서버 측 확인):
//   https://multitranslator.onrender.com/api/kdl/admob-ssv
//   (PronunFit 유닛은 /api/admob-ssv — 앱별 URL 분리, DB가 다르다)
//
// 지급 정책(POINTS_ECONOMY_V2 §9-1 → 2026-09-16 사용자 확정): **10pt/회 · 일 5회(UTC) · 60초 쿨다운 ·
//   잔액 10pt 미만일 때만 지급 · 실계정만(익명 제외)**. 잔액 게이트는 "잔량을 안 쓰고 광고만 연속으로 틀어
//   쌓아두기"를 막는 장치 — 클라도 같은 조건으로 버튼을 비활성화하지만 권위는 여기다.
// 멱등: kdl admobSsv/{transaction_id}.create() + 지급을 단일 트랜잭션(멱등만 먼저 커밋되면 지급 실패 시 재시도가 흡수돼 영구 유실).
// 클라: prepareRewardVideoAd({ ssv: { userId: uid, customData: '{"app":"kdl"}' } }) → user_id 로 도착.
const express = require('express');
const admin = require('firebase-admin');
const { kcultureDb, kcultureAuth } = require('../config/firebaseKculture');
const { verifySignature, isStale } = require('../lib/admobSsvVerify');
const L = require('../config/kdlAdRewardLimits');

const router = express.Router();
const utcDateStr = () => new Date().toISOString().slice(0, 10);

// 실계정 판정 — Firebase Auth 사용자의 providerData가 비어 있으면 익명. 지급은 드문 이벤트라 호출당 1회 조회 허용.
// 지급 자격 판정 — getUser 1콜로 두 가지를 함께 본다(SSV 콜백에는 ID 토큰이 없다).
//   'anonymous'  : 게스트(providerData 비어 있음) — 기존 정책 그대로 미지급.
//   'unverified' : 이메일/비번 계정인데 메일 확인 전(2026-09-19) — 미지급.
//                  소셜 계정은 대상 아님(Facebook은 emailVerified가 false로 오는 경우가 있어
//                  password 자격증명 보유 여부로 좁힌다 — KCulture 클라·rules와 같은 규약).
async function payoutBlockReason(uid) {
    if (!kcultureAuth) return null; // Auth 미구성(로컬) — 차단하지 않음
    try {
        const u = await kcultureAuth.getUser(uid);
        const providers = u.providerData || [];
        if (providers.length === 0) return 'anonymous';
        const hasPassword = providers.some((p) => p.providerId === 'password');
        if (hasPassword && !u.emailVerified) return 'unverified';
        return null;
    } catch { return 'anonymous'; } // 존재하지 않는 uid → 지급 불가 취급
}

async function applyReward({ txId, uid, meta }) {
    const ssvRef = kcultureDb.collection('admobSsv').doc(txId);
    const userRef = kcultureDb.collection('users').doc(uid);
    return kcultureDb.runTransaction(async (tx) => {
        const ssvSnap = await tx.get(ssvRef);
        if (ssvSnap.exists) return { duplicate: true };
        const userSnap = await tx.get(userRef);
        const base = { ...meta, uid, createdAt: admin.firestore.FieldValue.serverTimestamp() };
        if (!userSnap.exists) { tx.create(ssvRef, { ...base, outcome: 'user_not_found' }); return { outcome: 'user_not_found' }; }
        const u = userSnap.data();
        const points = Number(u.points) || 0;

        // 잔액 게이트 — 10pt 이상 보유 중이면 지급하지 않는다(광고는 이미 봤지만 클라가 같은 조건으로 버튼을 막으므로 정상 경로에선 도달 안 함).
        if (points >= L.MIN_BALANCE) { tx.create(ssvRef, { ...base, outcome: 'balance_high', points }); return { outcome: 'balance_high', points }; }
        const lastMs = u.lastAdRewardAt?.toMillis?.() || 0;
        if (Date.now() - lastMs < L.COOLDOWN_MS) { tx.create(ssvRef, { ...base, outcome: 'cooldown' }); return { outcome: 'cooldown' }; }
        const today = utcDateStr();
        const todayCount = u.adRewardCountDate === today ? (u.adRewardCount || 0) : 0;
        if (todayCount >= L.DAILY_CAP) { tx.create(ssvRef, { ...base, outcome: 'daily_cap' }); return { outcome: 'daily_cap' }; }

        // users 본문 write 1회(points 증가 + 광고 메타) — 기존 ad-reward와 같은 필드라 클라 게이트 계산이 그대로 통한다.
        tx.set(userRef, {
            points: admin.firestore.FieldValue.increment(L.AD_REWARD_AMOUNT),
            lastAdRewardAt: admin.firestore.FieldValue.serverTimestamp(),
            adRewardCountDate: today,
            adRewardCount: todayCount + 1,
        }, { merge: true });
        tx.set(userRef.collection('pointLedger').doc(), {
            type: 'adReward', amount: L.AD_REWARD_AMOUNT, via: 'ssv', txId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.create(ssvRef, { ...base, outcome: 'granted', granted: L.AD_REWARD_AMOUNT, count: todayCount + 1 });
        return { outcome: 'granted', granted: L.AD_REWARD_AMOUNT, count: todayCount + 1 };
    });
}

// AdMob은 GET으로 호출. "처리 완료"(중복·스킵 포함)=200, 일시 장애(키 조회·DB)=5xx(재시도 유도), 위조=403.
router.get('/api/kdl/admob-ssv', async (req, res) => {
    if (!kcultureDb) return res.status(503).send('db_unavailable');
    const rawQuery = (req.originalUrl.split('?')[1] || '');
    const q = req.query || {};
    const txId = String(q.transaction_id || '');
    const uid = String(q.user_id || '');
    if (!txId || !q.signature || !q.key_id) { console.warn('[KDL/AdMobSSV] malformed callback'); return res.status(400).send('malformed'); }

    let verified;
    try { verified = await verifySignature(rawQuery, q.key_id, q.signature); }
    catch (e) { console.error('[KDL/AdMobSSV] verify error (retryable):', e.message); return res.status(503).send('verify_unavailable'); }
    if (!verified.ok) {
        // 진단(2026-09-16): 실콜백이 bad_signature로 거절되는 사고 — 원문 쿼리를 남겨 로컬에서 구글 공개키로 재검증할 수 있게 한다(비밀 없음: 광고 메타·uid·서명만).
        console.warn(`[KDL/AdMobSSV] REJECT ${verified.reason} tx=${txId} uid=${uid} raw=${rawQuery.slice(0, 1200)}`);
        return res.status(403).send(verified.reason);
    }

    if (isStale(q.timestamp)) { console.warn(`[KDL/AdMobSSV] stale tx=${txId}`); return res.status(200).send('stale'); }
    if (!uid) { console.warn(`[KDL/AdMobSSV] no user_id tx=${txId} — ssv.userId 미설정 클라`); return res.status(200).send('no_user'); }
    const blocked = await payoutBlockReason(uid);
    if (blocked) { console.log(`[KDL/AdMobSSV] ${blocked} uid=${uid} tx=${txId} — skip`); return res.status(200).send(blocked); }

    try {
        const r = await applyReward({ txId, uid, meta: { adUnit: String(q.ad_unit || ''), adNetwork: String(q.ad_network || ''), rewardItem: String(q.reward_item || ''), customData: String(q.custom_data || '') } });
        if (r.duplicate) { console.log(`[KDL/AdMobSSV] duplicate tx=${txId}`); return res.status(200).send('duplicate'); }
        console.log(r.outcome === 'granted'
            ? `[KDL/AdMobSSV] GRANTED +${r.granted}pt to ${uid} (${r.count}/${L.DAILY_CAP}, tx=${txId})`
            : `[KDL/AdMobSSV] ${r.outcome} uid=${uid} tx=${txId}${r.points != null ? ` points=${r.points}` : ''}`);
        return res.status(200).send('ok');
    } catch (e) {
        console.error('[KDL/AdMobSSV] grant error (retryable):', e.message);
        return res.status(503).send('grant_failed');
    }
});

module.exports = router;
