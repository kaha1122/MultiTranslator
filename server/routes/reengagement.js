// Re-engagement push cron route
// 매시간 실행 (Render Cron: '0 * * * *') — 각 실행은 "지금 local 10시인 국가" 유저만 처리
//
// 정책:
//   - lifecycleStage in ('starter', null/undefined)  → D1, D3, D5 발송 (Message A)
//   - lifecycleStage in ('engaged', 'subscriber')    → D2, D4, D6 발송 (Message B)
// 공통 제외:
//   - fcmTokens 비어있음
//   - reengagementOptOut === true
//   - tier === 'admin'
//   - createdAt 24h 이내 (D0 신규 — onboarding 트랙)
//   - 같은 윈도우 이미 발송됨 (idempotency: reengagementSentAt[d1At..d6At])
//
// iOS는 환경변수 REENGAGEMENT_IOS_ENABLED='true'로 명시 활성화 필요 (기본 비활성)

const express = require('express');
const router = express.Router();
const { admin, adminDb } = require('../config/firebase');
const { requireCronAuth } = require('../middleware/auth');
const { sendReengagementPush } = require('../utils/sendPush');
const { effectiveCountry, getLocalHour, countriesAtLocalHour10 } = require('../utils/countryTimezone');

const Timestamp = admin.firestore.Timestamp;
const FieldValue = admin.firestore.FieldValue;

// 윈도우 정의 — lastActiveAt이 [N+1일 전 자정, N일 전 자정) 안에 있을 때 D{N} 발송
// 즉 'D1' = "딱 1일 전에 활동했고 그 이후로 활동 없음" (오늘이 4/30이면 lastActiveAt이 4/29 어느 시점)
function getWindowRange(windowName, now = new Date()) {
    const N = parseInt(windowName.slice(1), 10);
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const lo = new Date(startOfToday); lo.setDate(lo.getDate() - N);
    const hi = new Date(startOfToday); hi.setDate(hi.getDate() - (N - 1));
    return { lo, hi };
}

const FIELD_BY_WINDOW = { D1: 'd1At', D2: 'd2At', D3: 'd3At', D4: 'd4At', D5: 'd5At', D6: 'd6At' };

// 한 cron 실행에서 처리할 최대 유저 수 (윈도우당). FCM rate limit + Firestore read 비용 가드
const MAX_PER_WINDOW = 500;

// 기 발송 여부 — 같은 윈도우 필드가 이미 채워져 있으면 skip
function alreadySent(userData, windowName) {
    const field = FIELD_BY_WINDOW[windowName];
    return !!userData?.reengagementSentAt?.[field];
}

// 메시지 타입 + 윈도우 정책 결정
// returns null이면 발송 대상 아님
function decideTarget(userData) {
    const stage = userData.lifecycleStage; // 'starter' | 'engaged' | 'subscriber' | undefined
    if (!stage || stage === 'starter') return { type: 'reengagement_starter', windows: ['D1', 'D3', 'D5'] };
    if (stage === 'engaged' || stage === 'subscriber') return { type: 'reengagement_engaged', windows: ['D2', 'D4', 'D6'] };
    return null;
}

// 공통 제외 정책 (윈도우 무관)
function shouldSkipUser(userData, opts = {}) {
    if (!Array.isArray(userData.fcmTokens) || userData.fcmTokens.length === 0) return 'no-tokens';
    if (userData.reengagementOptOut === true) return 'opted-out';
    if (userData.tier === 'admin') return 'admin';

    // D0 신규 제외 — createdAt 24h 이내 → onboarding 트랙
    const createdAt = userData.createdAt;
    if (createdAt?.toMillis) {
        const ageMs = Date.now() - createdAt.toMillis();
        if (ageMs < 24 * 60 * 60 * 1000) return 'd0-new';
    }

    // iOS 가드 (env 플래그) — 1차 비활성
    const iosEnabled = process.env.REENGAGEMENT_IOS_ENABLED === 'true';
    if (!iosEnabled && userData.currentNativePlatform === 'ios') return 'ios-disabled';

    return null;
}

// 한 윈도우 처리 — 후보 쿼리 + 필터 + 발송
async function processWindow(windowName, country, now, opts) {
    const { lo, hi } = getWindowRange(windowName, now);
    const tsLo = Timestamp.fromDate(lo);
    const tsHi = Timestamp.fromDate(hi);

    // 'in' 쿼리는 최대 10개. 호출 측에서 country chunk 단위로 호출되므로 단일 country로 좁힘
    let snap;
    try {
        snap = await adminDb.collection('users')
            .where('geoCountry', '==', country)
            .where('lastActiveAt', '>=', tsLo)
            .where('lastActiveAt', '<', tsHi)
            .limit(MAX_PER_WINDOW)
            .get();
    } catch (e) {
        // 인덱스 누락 등
        return { window: windowName, country, error: e.message, sent: 0, skipped: 0, candidates: 0 };
    }

    let sent = 0;
    let failedSend = 0;
    const skipReasons = {};
    const candidates = snap.size;
    const sentUids = [];

    for (const doc of snap.docs) {
        const data = doc.data();

        const skip = shouldSkipUser(data);
        if (skip) {
            skipReasons[skip] = (skipReasons[skip] || 0) + 1;
            continue;
        }

        const target = decideTarget(data);
        if (!target || !target.windows.includes(windowName)) {
            skipReasons['stage-mismatch'] = (skipReasons['stage-mismatch'] || 0) + 1;
            continue;
        }

        if (alreadySent(data, windowName)) {
            skipReasons['already-sent'] = (skipReasons['already-sent'] || 0) + 1;
            continue;
        }

        // onlyUid 필터 (admin trigger)
        if (opts.onlyUid && doc.id !== opts.onlyUid) {
            skipReasons['only-uid-filter'] = (skipReasons['only-uid-filter'] || 0) + 1;
            continue;
        }

        const result = await sendReengagementPush(doc.id, {
            doc: data,
            type: target.type,
            window: windowName,
            dryRun: opts.dryRun,
        });

        if (result.ok) {
            if (!opts.dryRun) {
                // idempotency — 발송 성공 시에만 sentAt 기록
                const field = FIELD_BY_WINDOW[windowName];
                try {
                    await doc.ref.update({
                        [`reengagementSentAt.${field}`]: FieldValue.serverTimestamp(),
                    });
                } catch (e) {
                    console.warn(`[Reengagement] sentAt update failed for ${doc.id}:`, e.message);
                }
            }
            sent += 1;
            sentUids.push(doc.id);
        } else {
            failedSend += 1;
            skipReasons[result.reason || 'send-failed'] = (skipReasons[result.reason || 'send-failed'] || 0) + 1;
        }
    }

    return {
        window: windowName,
        country,
        candidates,
        sent,
        failed: failedSend,
        skipped: skipReasons,
        sentUids: opts.dryRun ? sentUids : undefined, // dryRun일 때만 uid 노출
    };
}

// geoCountry 없는 유저 처리 — deviceLang fallback으로 effective country 추정 후 시간대 매칭
// Firestore 인덱스 한계상 별도 collection scan 필요. 가벼운 limit + lastActiveAt 윈도우만 큰 컷
async function processNoGeoCountry(windowName, now, opts) {
    const { lo, hi } = getWindowRange(windowName, now);
    const tsLo = Timestamp.fromDate(lo);
    const tsHi = Timestamp.fromDate(hi);

    let snap;
    try {
        // geoCountry 미존재만 정확히 잡으려면 별도 인덱스가 필요해서, 단순화: lastActiveAt 윈도우 + JS 필터
        snap = await adminDb.collection('users')
            .where('lastActiveAt', '>=', tsLo)
            .where('lastActiveAt', '<', tsHi)
            .limit(MAX_PER_WINDOW)
            .get();
    } catch (e) {
        return { window: windowName, country: '__nogeo', error: e.message, sent: 0, skipped: 0, candidates: 0 };
    }

    let sent = 0;
    let failedSend = 0;
    const skipReasons = {};
    let candidates = 0;
    const sentUids = [];

    for (const doc of snap.docs) {
        const data = doc.data();

        // geoCountry 있으면 해당 국가 슬롯에서 처리되므로 여기선 skip (중복 방지)
        if (data.geoCountry && String(data.geoCountry).trim()) continue;

        candidates += 1;

        // deviceLang → effective country → local hour 10 매칭 확인
        const effCountry = effectiveCountry(data);
        if (getLocalHour(effCountry, now) !== 10) {
            skipReasons['not-local-10'] = (skipReasons['not-local-10'] || 0) + 1;
            continue;
        }

        const skip = shouldSkipUser(data);
        if (skip) {
            skipReasons[skip] = (skipReasons[skip] || 0) + 1;
            continue;
        }

        const target = decideTarget(data);
        if (!target || !target.windows.includes(windowName)) {
            skipReasons['stage-mismatch'] = (skipReasons['stage-mismatch'] || 0) + 1;
            continue;
        }

        if (alreadySent(data, windowName)) {
            skipReasons['already-sent'] = (skipReasons['already-sent'] || 0) + 1;
            continue;
        }

        if (opts.onlyUid && doc.id !== opts.onlyUid) {
            skipReasons['only-uid-filter'] = (skipReasons['only-uid-filter'] || 0) + 1;
            continue;
        }

        const result = await sendReengagementPush(doc.id, {
            doc: data,
            type: target.type,
            window: windowName,
            dryRun: opts.dryRun,
        });

        if (result.ok) {
            if (!opts.dryRun) {
                const field = FIELD_BY_WINDOW[windowName];
                try {
                    await doc.ref.update({
                        [`reengagementSentAt.${field}`]: FieldValue.serverTimestamp(),
                    });
                } catch {}
            }
            sent += 1;
            sentUids.push(doc.id);
        } else {
            failedSend += 1;
            skipReasons[result.reason || 'send-failed'] = (skipReasons[result.reason || 'send-failed'] || 0) + 1;
        }
    }

    return {
        window: windowName,
        country: '__nogeo',
        candidates,
        sent,
        failed: failedSend,
        skipped: skipReasons,
        sentUids: opts.dryRun ? sentUids : undefined,
    };
}

// onlyUid 모드 — 단일 유저 강제 발송 (forceWindow로 idempotency 우회 가능)
async function processOnlyUid(uid, opts) {
    const userSnap = await adminDb.collection('users').doc(uid).get();
    if (!userSnap.exists) return { error: 'user-not-found', uid };
    const data = userSnap.data();

    const target = decideTarget(data);
    if (!target) return { error: 'no-target-stage', uid, stage: data.lifecycleStage };

    const window = opts.forceWindow || target.windows[0];

    // forceWindow일 땐 idempotency/ skip 정책 일부 우회
    const skip = opts.forceWindow ? null : shouldSkipUser(data);
    if (skip) return { error: skip, uid };

    if (!opts.forceWindow && alreadySent(data, window)) {
        return { error: 'already-sent', uid, window };
    }

    const result = await sendReengagementPush(uid, {
        doc: data,
        type: target.type,
        window,
        dryRun: opts.dryRun,
    });

    if (result.ok && !opts.dryRun && !opts.forceWindow) {
        const field = FIELD_BY_WINDOW[window];
        await userSnap.ref.update({
            [`reengagementSentAt.${field}`]: FieldValue.serverTimestamp(),
        });
    }
    return { uid, window, type: target.type, result };
}

router.post('/api/cron/reengagement-push', requireCronAuth, async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const onlyUid = req.query.onlyUid || null;
    const forceWindow = req.query.forceWindow || null;
    const now = new Date();

    const opts = { dryRun, onlyUid, forceWindow };

    try {
        // ── 모드 1: 단일 유저 admin trigger ─────────────────────────
        if (onlyUid && forceWindow) {
            const out = await processOnlyUid(onlyUid, opts);
            return res.json({ mode: 'onlyUid+forceWindow', ranAt: now.toISOString(), out });
        }

        // ── 모드 2: 정상 cron (또는 dryRun, 또는 onlyUid 필터링만) ────
        const targetCountries = countriesAtLocalHour10(now);
        const windows = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

        const perCountryResults = [];
        for (const country of targetCountries) {
            for (const window of windows) {
                const r = await processWindow(window, country, now, opts);
                perCountryResults.push(r);
            }
        }

        // geoCountry 없는 유저 — 매시간 한 번씩 deviceLang 기반 local 10시 매칭으로 처리
        const noGeoResults = [];
        for (const window of windows) {
            const r = await processNoGeoCountry(window, now, opts);
            noGeoResults.push(r);
        }

        // 집계
        const totals = {
            candidates: 0, sent: 0, failed: 0,
        };
        const skipAggregate = {};
        for (const r of [...perCountryResults, ...noGeoResults]) {
            totals.candidates += r.candidates || 0;
            totals.sent += r.sent || 0;
            totals.failed += r.failed || 0;
            for (const [k, v] of Object.entries(r.skipped || {})) {
                skipAggregate[k] = (skipAggregate[k] || 0) + v;
            }
        }

        const summary = {
            ranAt: now.toISOString(),
            mode: dryRun ? 'dryRun' : 'send',
            targetCountries,
            totals,
            skipAggregate,
            details: [...perCountryResults, ...noGeoResults].filter(r => (r.candidates || 0) > 0 || r.error),
        };

        // 관측: 실발송 시에만 reengagementLogs에 기록 (dryRun은 응답으로만)
        if (!dryRun && targetCountries.length > 0) {
            try {
                const logId = `${now.toISOString().slice(0, 13).replace(/[-:T]/g, '')}-${targetCountries.join('_').slice(0, 60)}`;
                await adminDb.collection('reengagementLogs').doc(logId).set({
                    ranAt: FieldValue.serverTimestamp(),
                    targetCountries,
                    totals,
                    skipAggregate,
                });
            } catch (e) {
                console.warn('[Reengagement] log write failed:', e.message);
            }
        }

        console.log(`[Reengagement] ${dryRun ? 'DRY' : 'SEND'} ranAt=${now.toISOString()} countries=${targetCountries.length} sent=${totals.sent} candidates=${totals.candidates}`);
        return res.json(summary);
    } catch (e) {
        console.error('[Reengagement] cron failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

module.exports = router;
