// AdMob 보상형 광고 SSV(Server-Side Verification) 콜백 수신 — 지급 권위 엔드포인트
//
// [2026-09-16 도입 배경] AdMob 계정 정지(2026-08-15, 무효 트래픽)의 재발 방지 3탄.
//   기존 구조는 클라가 RewardAdPluginEvents.Rewarded 를 받으면 스스로 서버에 "보상 주세요"를
//   호출했다 → 광고를 실제로 보지 않은 봇/에뮬레이터/조작 클라도 토큰만 있으면 포인트를
//   긁어갈 수 있었고(adReward.js 주석의 "SSV 미적용" 구멍), 쿨다운 60s + 일일캡 5회만이
//   유일한 방어였다. SSV 는 Google 이 광고 시청 완료를 확인한 뒤 우리 서버로 직접 서명된
//   콜백을 쏘고, 우리는 Google 공개키로 서명을 검증한 뒤에만 지급한다 → 클라 주장 배제.
//
// 콜백 URL (AdMob 콘솔 > 각 보상형 광고 단위 > 서버 측 확인):
//   https://multitranslator.onrender.com/api/admob-ssv
//
// 검증 절차(공식): 쿼리스트링에서 '&signature=' 앞부분이 서명 대상 원문이고, signature 는
//   base64url ECDSA(P-256, SHA-256), 검증키는 key_id 로 verifier-keys.json 에서 찾는다.
//   ⚠ Express 가 파싱한 req.query 로 원문을 재조립하면 인코딩 차이로 서명이 깨진다 —
//     반드시 req.originalUrl 의 raw 쿼리를 그대로 써야 한다.
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { admin, adminDb } = require('../config/firebase');
const L = require('../config/adRewardLimits');

const router = express.Router();

const { verifySignature, MAX_AGE_MS } = require('../lib/admobSsvVerify'); // [2026-09-16] KDL과 공유하도록 분리

function utcDateStr() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 지급 — transaction_id 멱등 기록과 보상 write 를 단일 트랜잭션으로 묶는다.
//   (멱등 기록을 먼저 커밋하고 지급을 나중에 하면, 지급 실패 시 AdMob 재시도가 중복으로
//    걸러져 보상이 영구 유실된다.)
async function applyReward({ txId, uid, type, date, meta }) {
    const ssvRef = adminDb.collection('admobSsv').doc(txId);
    const userRef = adminDb.collection('users').doc(uid);
    const dailyRef = type === 'pron' ? userRef.collection('dailyProgress').doc(date) : null;

    return adminDb.runTransaction(async (tx) => {
        const ssvSnap = await tx.get(ssvRef);
        if (ssvSnap.exists) return { duplicate: true };

        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) return { outcome: 'user_not_found' };
        const u = userSnap.data();

        const base = { ...meta, uid, type, createdAt: admin.firestore.FieldValue.serverTimestamp() };

        // Pro/Premium 은 애초에 광고 미노출 대상 — 도달했다면 tier 전환 race 이므로 기록만 남기고 skip.
        const tier = u.tier || 'trial';
        if (tier === 'pro' || tier === 'premium') {
            tx.create(ssvRef, { ...base, outcome: 'skipped_tier', tier });
            return { outcome: 'skipped_tier' };
        }

        if (type === 'pron') {
            const dSnap = await tx.get(dailyRef);
            const d = dSnap.exists ? dSnap.data() : {};
            const lastMs = d.lastPronAdAt?.toMillis?.() || 0;
            if (Date.now() - lastMs < L.COOLDOWN_MS) {
                tx.create(ssvRef, { ...base, outcome: 'cooldown' });
                return { outcome: 'cooldown' };
            }
            const grants = d.pronBonusGrants || 0;
            if (grants >= L.PRON_ALLOWANCE_CAP) {
                tx.create(ssvRef, { ...base, outcome: 'daily_cap' });
                return { outcome: 'daily_cap' };
            }
            tx.set(dailyRef, {
                pronBonus: admin.firestore.FieldValue.increment(L.PRON_ALLOWANCE),
                pronBonusGrants: grants + 1,
                lastPronAdAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            tx.create(ssvRef, { ...base, outcome: 'granted', granted: L.PRON_ALLOWANCE });
            return { outcome: 'granted', granted: L.PRON_ALLOWANCE, unit: 'pron' };
        }

        // type === 'bonus' — 보너스 포인트 +20
        const lastMs = u.lastAdRewardAt?.toMillis?.() || 0;
        if (Date.now() - lastMs < L.COOLDOWN_MS) {
            tx.create(ssvRef, { ...base, outcome: 'cooldown' });
            return { outcome: 'cooldown' };
        }
        const today = utcDateStr();
        const todayCount = u.adRewardCountDate === today ? (u.adRewardCount || 0) : 0;
        if (todayCount >= L.DAILY_CAP) {
            tx.create(ssvRef, { ...base, outcome: 'daily_cap' });
            return { outcome: 'daily_cap' };
        }
        // users 본문 write 1회로 통합 (발열 규칙6: onSnapshot 재렌더 유발 write 최소화).
        //   광고 메타 필드는 PROFILE_VOLATILE_FIELDS 로 재렌더에서 제외되고, bonusPoints 변화만 반영된다.
        tx.set(userRef, {
            bonusPoints: admin.firestore.FieldValue.increment(L.AD_REWARD_AMOUNT),
            bonusLastGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastAdRewardAt: admin.firestore.FieldValue.serverTimestamp(),
            adRewardCountDate: today,
            adRewardCount: todayCount + 1,
        }, { merge: true });
        // 이력 — grantBonusPoints 와 동일 스키마(bonusEvents)로 남겨 기존 집계/조회 호환.
        tx.set(userRef.collection('bonusEvents').doc(), {
            source: 'adReward',
            amount: L.AD_REWARD_AMOUNT,
            meta: { ...meta, via: 'ssv' },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.create(ssvRef, { ...base, outcome: 'granted', granted: L.AD_REWARD_AMOUNT });
        return { outcome: 'granted', granted: L.AD_REWARD_AMOUNT, unit: 'points', count: todayCount + 1 };
    });
}

// AdMob 은 GET 으로 호출한다. 200 이 아니면 재시도하므로, "처리 완료"(중복/스킵 포함)는 200,
//   일시 장애(키 조회 실패/DB 오류)만 5xx 로 돌려 재시도를 유도한다. 위조는 403(재시도 무의미).
router.get('/api/admob-ssv', async (req, res) => {
    const rawQuery = (req.originalUrl.split('?')[1] || '');
    const q = req.query || {};
    const txId = String(q.transaction_id || '');
    const uid = String(q.user_id || '');

    if (!txId || !q.signature || !q.key_id) {
        console.warn('[AdMobSSV] malformed callback');
        return res.status(400).send('malformed');
    }

    let verified;
    try {
        verified = await verifySignature(rawQuery, q.key_id, q.signature);
    } catch (e) {
        console.error('[AdMobSSV] verify error (retryable):', e.message);
        return res.status(503).send('verify_unavailable'); // 키 조회 실패 → AdMob 재시도
    }
    if (!verified.ok) {
        console.warn(`[AdMobSSV] REJECT ${verified.reason} tx=${txId} uid=${uid}`);
        return res.status(403).send(verified.reason);
    }

    // 서명 통과 이후에만 페이로드를 신뢰한다.
    const ts = Number(q.timestamp || 0);
    if (Number.isFinite(ts) && ts > 0 && Math.abs(Date.now() - ts) > MAX_AGE_MS) {
        console.warn(`[AdMobSSV] stale callback tx=${txId} age=${Math.round((Date.now() - ts) / 1000)}s`);
        return res.status(200).send('stale'); // 재시도 무의미 → 200 으로 종료
    }
    if (!uid) {
        console.warn(`[AdMobSSV] no user_id tx=${txId} — ssv.userId 미설정 클라`);
        return res.status(200).send('no_user');
    }

    // custom_data: 클라가 prepareRewardVideoAd 에 실어 보낸 JSON {t:'bonus'|'pron', d:'YYYY-MM-DD'}
    let type = 'bonus';
    let date = '';
    try {
        const cd = JSON.parse(String(q.custom_data || '{}'));
        if (cd?.t === 'pron') type = 'pron';
        date = String(cd?.d || '');
    } catch { /* 파싱 실패 → 기본값(bonus) */ }
    if (type === 'pron' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.warn(`[AdMobSSV] pron callback without valid date tx=${txId}`);
        return res.status(200).send('bad_date');
    }

    try {
        const r = await applyReward({
            txId, uid, type, date,
            meta: {
                adUnit: String(q.ad_unit || ''),
                adNetwork: String(q.ad_network || ''),
                rewardItem: String(q.reward_item || ''),
            },
        });
        if (r.duplicate) {
            console.log(`[AdMobSSV] duplicate tx=${txId} (재시도 흡수)`);
            return res.status(200).send('duplicate');
        }
        if (r.outcome === 'granted') {
            console.log(`[AdMobSSV] GRANTED ${r.granted} ${r.unit} to ${uid} (type=${type}, tx=${txId})`);
        } else {
            console.log(`[AdMobSSV] ${r.outcome} uid=${uid} type=${type} tx=${txId}`);
        }
        return res.status(200).send('ok');
    } catch (e) {
        console.error('[AdMobSSV] grant error (retryable):', e.message);
        return res.status(503).send('grant_failed'); // 트랜잭션 실패 → AdMob 재시도로 복구
    }
});

module.exports = router;
