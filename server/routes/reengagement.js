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
const { sendFreeTalkEmail, verifyUnsubToken } = require('../utils/sendEmail');
const { effectiveCountry, getLocalHour, countriesAtLocalHour10, TZ_BY_COUNTRY } = require('../utils/countryTimezone');

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

        // sent 판정 분기:
        //  - dryRun: result.ok면 "would-send" 카운트 (시뮬레이션)
        //  - live: result.sent > 0이어야 실제 도달로 인정 (FCM 응답상 1+개 성공)
        //  - live + result.sent === 0: 모든 토큰 invalid → 'fcm-all-invalid' skip (d2At 마킹 안 함)
        if (opts.dryRun && result.ok) {
            sent += 1;
            sentUids.push(doc.id);
        } else if (result.ok && result.sent > 0) {
            const field = FIELD_BY_WINDOW[windowName];
            try {
                await doc.ref.update({
                    [`reengagementSentAt.${field}`]: FieldValue.serverTimestamp(),
                });
            } catch (e) {
                console.warn(`[Reengagement] sentAt update failed for ${doc.id}:`, e.message);
            }
            sent += 1;
            sentUids.push(doc.id);
        } else if (result.ok && result.sent === 0) {
            // FCM 호출은 OK였지만 모든 토큰이 invalid (cleanup으로 fcmTokens 비워짐)
            // d2At 마킹 안 함 — 다음 cron에서 no-tokens skip으로 자연 정리됨
            skipReasons['fcm-all-invalid'] = (skipReasons['fcm-all-invalid'] || 0) + 1;
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

        // geoCountry가 TZ_BY_COUNTRY에 매핑된 경우만 다른 슬롯(processWindow)에서 처리됨.
        // 매핑 안 된 geoCountry(예: 신규 ISO 코드, 매핑 누락)나 필드 자체 없는 유저는 여기서 처리.
        // 안전망 — TZ_BY_COUNTRY에 없는 국가도 deviceLang fallback으로 자동 catch.
        const geo = data.geoCountry && String(data.geoCountry).trim();
        if (geo && TZ_BY_COUNTRY[geo]) continue; // mapped면 처리됨

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

        // sent 판정 — processWindow와 동일 정책 (dryRun / 실도달 / fcm-all-invalid 분리)
        if (opts.dryRun && result.ok) {
            sent += 1;
            sentUids.push(doc.id);
        } else if (result.ok && result.sent > 0) {
            const field = FIELD_BY_WINDOW[windowName];
            try {
                await doc.ref.update({
                    [`reengagementSentAt.${field}`]: FieldValue.serverTimestamp(),
                });
            } catch {}
            sent += 1;
            sentUids.push(doc.id);
        } else if (result.ok && result.sent === 0) {
            skipReasons['fcm-all-invalid'] = (skipReasons['fcm-all-invalid'] || 0) + 1;
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

    // 실 도달(result.sent > 0)일 때만 idempotency 마킹. forceWindow면 우회 (기존 동작 유지)
    if (result.ok && result.sent > 0 && !opts.dryRun && !opts.forceWindow) {
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

// ─────────────────────────────────────────────────────────────────────────
// Backfill — lastActiveAt 필드를 모든 기존 유저에게 일괄 설정 (1회성)
//
// 배경: lastActiveAt 필드는 2026-05-01 신설(commit cb60370)이라 기존 유저는 이 필드가 없음.
// Firestore where('lastActiveAt', '>=', X) 쿼리는 필드 없는 doc을 자동 제외 →
// re-engagement cron이 기존 유저를 영영 못 잡는 갭 발생.
//
// 해결: 모든 유저에게 lastActiveAt = '오늘 UTC 자정' 으로 일괄 설정.
//   → 다음 KST 10시 cron에서 D1 윈도우 [오늘 UTC 자정, 내일 UTC 자정) 안에 들어감
//   → starter D1 / engaged D2 부터 자연스럽게 drip 시작
//   → 5-6일에 걸쳐 stage별 3회 발송 후 자동 종료 (이미 reengagementSentAt 멱등)
//
// 정책:
//   - 이미 lastActiveAt 있는 유저: skip (오늘 deploy 후 활동한 유저 → 실데이터 보존)
//   - 그 외 모든 유저에게 set (fcmTokens 유무 등 cron 자체의 shouldSkipUser가 따로 필터)
//
// 사용:
//   curl -X POST "$RENDER_URL/api/cron/backfill-last-active?dryRun=1"  # 미리보기
//   curl -X POST "$RENDER_URL/api/cron/backfill-last-active"           # 실행
//   maxBatches로 안전 캡 조정 가능 (기본 50, 25000명까지 한 번에 처리)
router.post('/api/cron/backfill-last-active', requireCronAuth, async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const batchSize = Math.min(parseInt(req.query.batchSize || '500', 10), 500);
    const maxBatches = parseInt(req.query.maxBatches || '50', 10);

    // 오늘 UTC 자정 — D1 윈도우 [오늘 UTC 자정, 내일 UTC 자정) 안에 들어가도록
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(0, 0, 0, 0);
    const targetTimestamp = Timestamp.fromDate(target);

    let totalScanned = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let cursor = null;
    let batches = 0;
    const sampleUpdated = []; // 처음 5개 uid만 응답에 노출 (디버그용)

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            const writeBatch = !dryRun ? adminDb.batch() : null;
            let batchUpdated = 0;

            for (const doc of snap.docs) {
                totalScanned += 1;
                const data = doc.data();
                if (data.lastActiveAt) {
                    totalSkipped += 1;
                    continue;
                }
                if (!dryRun) {
                    writeBatch.update(doc.ref, { lastActiveAt: targetTimestamp });
                }
                if (sampleUpdated.length < 5) sampleUpdated.push(doc.id);
                totalUpdated += 1;
                batchUpdated += 1;
            }

            if (!dryRun && batchUpdated > 0) {
                await writeBatch.commit();
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;

            if (snap.size < batchSize) break; // 마지막 배치
        }

        const complete = batches < maxBatches;

        console.log(`[Backfill] ${dryRun ? 'DRY' : 'LIVE'} target=${target.toISOString()} batches=${batches} scanned=${totalScanned} updated=${totalUpdated} skipped=${totalSkipped} complete=${complete}`);

        return res.json({
            mode: dryRun ? 'dryRun' : 'live',
            target: target.toISOString(),
            batches,
            totalScanned,
            totalUpdated,
            totalSkipped,
            complete,
            sampleUpdated,
            note: complete
                ? '전체 컬렉션 처리 완료'
                : `maxBatches(${maxBatches}) 도달. 다시 호출하면 이어서 처리 가능 (이미 set된 유저는 자동 skip되므로 idempotent)`,
        });
    } catch (e) {
        console.error('[Backfill] failed:', e);
        return res.status(500).json({
            error: e.message,
            partial: { batches, totalScanned, totalUpdated, totalSkipped },
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 진단 엔드포인트 — sourceLang / deviceLang / fcmTokens 분포 (1회성)
//
// re-engagement push 발송 대상 분석 + sourceLang fix 효과 측정용
// 'pickLangForUser'가 채택할 lang 분포까지 시뮬레이션
router.post('/api/cron/user-lang-stats', requireCronAuth, async (req, res) => {
    const batchSize = 500;
    const maxBatches = 50;

    let totalUsers = 0;
    let withSourceLang = 0;
    let withDeviceLang = 0;
    let withBoth = 0;
    let withNeither = 0;
    let withFcmTokens = 0;
    let geoCountryMapped = 0;     // TZ_BY_COUNTRY 매핑 있음 → cron 정상 처리
    let geoCountryUnmapped = 0;   // 값은 있지만 TZ 매핑 없음 → cron 갭 (갭 1)
    let geoCountryMissing = 0;    // 필드 자체 없음 → processNoGeoCountry로 처리됨
    const sourceLangDist = {};
    const deviceLangDist = {};
    const effectiveLangDist = {}; // pickLangForUser 결과 분포
    const unmappedGeoCountryDist = {}; // 매핑 없는 국가 코드 분포

    // pickLang 로직 (sendPush.js와 동일하게 inline)
    const SUPPORTED = ['ko', 'en', 'ja', 'zh-CN', 'vi', 'fr', 'de', 'es', 'ru', 'pt-BR'];
    const pickLang = (l) => {
        if (!l) return 'en';
        if (SUPPORTED.includes(l)) return l;
        if (l.startsWith('zh')) return 'zh-CN';
        if (l.startsWith('pt')) return 'pt-BR';
        const short = l.split('-')[0];
        if (SUPPORTED.includes(short)) return short;
        return 'en';
    };

    let cursor = null;
    let batches = 0;

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                totalUsers += 1;
                const d = doc.data();
                const sl = d.sourceLang;
                const dl = d.deviceLang;
                const hasSL = !!sl;
                const hasDL = !!dl;
                const hasFcm = Array.isArray(d.fcmTokens) && d.fcmTokens.length > 0;

                if (hasSL) {
                    withSourceLang += 1;
                    sourceLangDist[sl] = (sourceLangDist[sl] || 0) + 1;
                }
                if (hasDL) {
                    withDeviceLang += 1;
                    deviceLangDist[dl] = (deviceLangDist[dl] || 0) + 1;
                }
                if (hasSL && hasDL) withBoth += 1;
                if (!hasSL && !hasDL) withNeither += 1;
                if (hasFcm) withFcmTokens += 1;

                // pickLangForUser 시뮬레이션 — sourceLang 우선, 없으면 deviceLang
                const effLang = pickLang(sl || dl);
                effectiveLangDist[effLang] = (effectiveLangDist[effLang] || 0) + 1;

                // geoCountry 커버리지 분석
                const geo = (d.geoCountry && String(d.geoCountry).trim()) || '';
                if (!geo) {
                    geoCountryMissing += 1;
                } else if (TZ_BY_COUNTRY[geo]) {
                    geoCountryMapped += 1;
                } else {
                    geoCountryUnmapped += 1;
                    unmappedGeoCountryDist[geo] = (unmappedGeoCountryDist[geo] || 0) + 1;
                }
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        return res.json({
            totalUsers,
            withSourceLang,
            withSourceLangPct: totalUsers ? +(withSourceLang / totalUsers * 100).toFixed(1) : 0,
            withDeviceLang,
            withDeviceLangPct: totalUsers ? +(withDeviceLang / totalUsers * 100).toFixed(1) : 0,
            withBoth,
            withNeither,
            withFcmTokens,
            withFcmTokensPct: totalUsers ? +(withFcmTokens / totalUsers * 100).toFixed(1) : 0,
            sourceLangDist,
            deviceLangDist,
            effectiveLangDist,
            geoCountryCoverage: {
                mapped: geoCountryMapped,
                unmapped: geoCountryUnmapped,
                missing: geoCountryMissing,
                unmappedPct: totalUsers ? +(geoCountryUnmapped / totalUsers * 100).toFixed(1) : 0,
            },
            unmappedGeoCountryDist,
        });
    } catch (e) {
        console.error('[UserLangStats] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 최근 reengagementLogs 조회 (운영 진단용)
// 매시간 cron 실행 결과 요약을 한눈에 보기 — 어느 국가에 몇 명이 발송됐는지
router.post('/api/cron/recent-reengagement-logs', requireCronAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '48', 10), 200);

    try {
        const snap = await adminDb.collection('reengagementLogs')
            .orderBy('ranAt', 'desc')
            .limit(limit)
            .get();

        const logs = [];
        for (const doc of snap.docs) {
            const d = doc.data();
            logs.push({
                id: doc.id,
                ranAt: d.ranAt?.toDate?.()?.toISOString() || null,
                targetCountries: d.targetCountries || [],
                totals: d.totals || {},
                skipAggregate: d.skipAggregate || {},
            });
        }

        // 집계 — 최근 N개 합산
        const aggregate = {
            totalRuns: logs.length,
            totalCandidates: 0,
            totalSent: 0,
            totalFailed: 0,
            countriesHit: new Set(),
            skipReasons: {},
        };
        for (const l of logs) {
            aggregate.totalCandidates += l.totals.candidates || 0;
            aggregate.totalSent += l.totals.sent || 0;
            aggregate.totalFailed += l.totals.failed || 0;
            (l.targetCountries || []).forEach(c => aggregate.countriesHit.add(c));
            for (const [k, v] of Object.entries(l.skipAggregate || {})) {
                aggregate.skipReasons[k] = (aggregate.skipReasons[k] || 0) + v;
            }
        }
        aggregate.countriesHit = Array.from(aggregate.countriesHit).sort();

        return res.json({ aggregate, logs });
    } catch (e) {
        console.error('[RecentLogs] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 특정 국가 engaged 유저의 lastActiveAt을 특정 날짜로 일괄 set (특수 운영용)
//
// 용도: KR cron이 이미 지난 시점에서 다른 국가(예: VN, IN)의 cron 시간 직전에
//       engaged 유저들을 D2 윈도우로 강제 진입시켜 즉시 발송 트리거
//
// 매개변수:
//   country: ISO 코드 (geoCountry 또는 deviceLang→해당 국가 fallback 매칭)
//   targetDate: YYYY-MM-DD (UTC 자정으로 해석). 기본 = 어제 UTC 자정
//   dryRun: 1이면 미리보기만
//   stages: 'engaged,subscriber' (콤마 구분, 기본값)
//
// 안전장치:
//   - reengagementSentAt.d2At 이미 있는 유저 skip (idempotency)
//   - admin / D0 / no-fcmTokens 제외 (cron의 shouldSkipUser 로직과 일관성)
//   - 백필만 — 발송은 안 함. 다음 cron(국가별 local 10시)이 자연스럽게 발송
router.post('/api/cron/backfill-engaged', requireCronAuth, async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const country = (req.query.country || '').toUpperCase().trim();
    const targetDateStr = req.query.targetDate || '';
    const stagesParam = (req.query.stages || 'engaged,subscriber')
        .split(',').map(s => s.trim()).filter(Boolean);

    if (!country) {
        return res.status(400).json({ error: 'country query param required (ISO code, e.g. VN)' });
    }
    if (!TZ_BY_COUNTRY[country]) {
        return res.status(400).json({ error: `country ${country} not in TZ_BY_COUNTRY` });
    }

    // targetDate 파싱 — YYYY-MM-DD → UTC 자정
    let target;
    if (targetDateStr) {
        const m = targetDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return res.status(400).json({ error: 'targetDate must be YYYY-MM-DD' });
        target = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 0, 0, 0));
    } else {
        // 기본 = 어제 UTC 자정
        const now = new Date();
        target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
    }
    const targetTimestamp = Timestamp.fromDate(target);

    const batchSize = 500;
    const maxBatches = 50;

    let totalScanned = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let cursor = null;
    let batches = 0;
    const skipReasons = {};
    const sampleUpdated = [];

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            const writeBatch = !dryRun ? adminDb.batch() : null;

            for (const doc of snap.docs) {
                totalScanned += 1;
                const data = doc.data();

                // 국가 매칭 — geoCountry 직접 매치 또는 deviceLang→대표국가 fallback
                const geo = (data.geoCountry || '').toUpperCase().trim();
                const matchedCountry = (geo === country) || (effectiveCountry(data) === country && !geo);
                if (!matchedCountry) {
                    skipReasons['country-mismatch'] = (skipReasons['country-mismatch'] || 0) + 1;
                    continue;
                }

                // 스테이지 필터
                const stage = data.lifecycleStage || null;
                if (!stagesParam.includes(stage)) {
                    skipReasons['stage-mismatch'] = (skipReasons['stage-mismatch'] || 0) + 1;
                    continue;
                }

                // 공통 제외 정책 (발송 가능성 있는 유저만 대상)
                const skip = shouldSkipUser(data);
                if (skip) {
                    skipReasons[skip] = (skipReasons[skip] || 0) + 1;
                    continue;
                }

                // idempotency — 이미 d2At 있으면 skip (이전 발송됨)
                if (data.reengagementSentAt?.d2At) {
                    skipReasons['already-sent-d2'] = (skipReasons['already-sent-d2'] || 0) + 1;
                    continue;
                }

                if (!dryRun) {
                    writeBatch.update(doc.ref, { lastActiveAt: targetTimestamp });
                }
                if (sampleUpdated.length < 5) sampleUpdated.push(doc.id);
                totalUpdated += 1;
            }

            if (!dryRun && totalUpdated > 0) {
                await writeBatch.commit();
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        const complete = batches < maxBatches;
        console.log(`[BackfillEngaged] ${dryRun ? 'DRY' : 'LIVE'} country=${country} target=${target.toISOString()} updated=${totalUpdated} skipped(byReason)=${JSON.stringify(skipReasons)}`);

        return res.json({
            mode: dryRun ? 'dryRun' : 'live',
            country,
            stagesTargeted: stagesParam,
            target: target.toISOString(),
            batches,
            totalScanned,
            totalUpdated,
            totalSkipped,
            skipReasons,
            complete,
            sampleUpdated,
            note: complete
                ? `${dryRun ? '[DryRun] ' : ''}${country} ${stagesParam.join('/')} 유저 ${totalUpdated}명 대상. 다음 ${country} cron 실행 시 D2 윈도우 매칭됨.`
                : `maxBatches(${maxBatches}) 도달. 다시 호출하면 이어서 처리 (idempotent)`,
        });
    } catch (e) {
        console.error('[BackfillEngaged] failed:', e);
        return res.status(500).json({
            error: e.message,
            partial: { batches, totalScanned, totalUpdated, totalSkipped },
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 최근 N시간 안에 D2 발송된 유저 리스트 (운영 진단용)
// "누가 받았는지" 확인. uid + geoCountry + deviceLang + sourceLang + lifecycleStage + tier + fcm수
router.post('/api/cron/recently-sent-d2', requireCronAuth, async (req, res) => {
    const hoursAgo = parseInt(req.query.hours || '3', 10);
    const since = new Date(Date.now() - hoursAgo * 3600 * 1000);

    const batchSize = 500;
    const maxBatches = 10;

    let totalScanned = 0;
    const recent = [];
    let cursor = null;
    let batches = 0;

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                totalScanned += 1;
                const d = doc.data();
                const d2At = d.reengagementSentAt?.d2At;
                if (d2At?.toMillis && d2At.toMillis() >= since.getTime()) {
                    recent.push({
                        uid: doc.id,
                        geoCountry: d.geoCountry || null,
                        deviceLang: d.deviceLang || null,
                        sourceLang: d.sourceLang || null,
                        lifecycleStage: d.lifecycleStage || null,
                        tier: d.tier || null,
                        isAnonymous: !!d.isAnonymous,
                        activeDayCount: d.activeDayCount || 0,
                        fcmTokensCount: Array.isArray(d.fcmTokens) ? d.fcmTokens.length : 0,
                        createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
                        lastActiveAt: d.lastActiveAt?.toDate?.()?.toISOString() || null,
                        d2At: d2At.toDate().toISOString(),
                        d1At: d.reengagementSentAt?.d1At?.toDate?.()?.toISOString() || null,
                    });
                }
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        return res.json({
            sinceISO: since.toISOString(),
            hoursAgo,
            totalScanned,
            recentSentCount: recent.length,
            users: recent,
        });
    } catch (e) {
        console.error('[RecentlySent] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 특정 국가 lifecycleStage 분포 (왜 발송 적은지 진단용)
// 예: ?countries=KR,JP,KP — fcmTokens 보유 여부 + lifecycleStage 교차 분석
router.post('/api/cron/stage-by-country', requireCronAuth, async (req, res) => {
    const countries = (req.query.countries || 'KR,JP,KP').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    const batchSize = 500;
    const maxBatches = 10;

    let totalScanned = 0;
    let cursor = null;
    let batches = 0;

    // { country: { stage: { withFcm, withoutFcm, total } } }
    const result = {};
    for (const c of countries) result[c] = {};

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                totalScanned += 1;
                const d = doc.data();
                const geo = (d.geoCountry || '').toUpperCase().trim();
                if (!countries.includes(geo)) continue;

                const stage = d.lifecycleStage || 'null';
                const hasFcm = Array.isArray(d.fcmTokens) && d.fcmTokens.length > 0;

                if (!result[geo][stage]) {
                    result[geo][stage] = { withFcm: 0, withoutFcm: 0, total: 0 };
                }
                result[geo][stage].total += 1;
                if (hasFcm) result[geo][stage].withFcm += 1;
                else result[geo][stage].withoutFcm += 1;
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        // 합계 계산
        const summary = {};
        for (const c of countries) {
            const stages = result[c];
            const totalUsers = Object.values(stages).reduce((s, v) => s + v.total, 0);
            const totalFcm = Object.values(stages).reduce((s, v) => s + v.withFcm, 0);
            summary[c] = { totalUsers, totalFcm };
        }

        return res.json({
            countries,
            totalScanned,
            byCountryAndStage: result,
            summary,
        });
    } catch (e) {
        console.error('[StageByCountry] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 최근 N시간 안에 dXAt 발송된 유저 + native 버전 분포 (운영 진단용)
// "발송된 142명 누구인지 + 어떤 OS 버전 분포인지" 분석
router.post('/api/cron/recently-sent-window', requireCronAuth, async (req, res) => {
    const window = (req.query.window || 'd2').toLowerCase().replace('d', '');
    const fieldName = `d${window}At`; // d1At..d6At
    if (!['d1At','d2At','d3At','d4At','d5At','d6At'].includes(fieldName)) {
        return res.status(400).json({ error: 'invalid window (use D1..D6)' });
    }
    const hoursAgo = parseInt(req.query.hours || '6', 10);
    const since = new Date(Date.now() - hoursAgo * 3600 * 1000);

    const batchSize = 500;
    const maxBatches = 10;

    let totalScanned = 0;
    const recent = [];
    let cursor = null;
    let batches = 0;

    // 분포 카운터
    const platformDist = {};
    const versionDist = {};
    const countryDist = {};
    const langDist = {};

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                totalScanned += 1;
                const d = doc.data();
                const dAt = d.reengagementSentAt?.[fieldName];
                if (dAt?.toMillis && dAt.toMillis() >= since.getTime()) {
                    const platform = d.currentNativePlatform || 'unknown';
                    const version = d.currentNativeVersion || 'unknown';
                    const country = d.geoCountry || 'unknown';
                    const lang = d.sourceLang || d.deviceLang || 'unknown';

                    platformDist[platform] = (platformDist[platform] || 0) + 1;
                    versionDist[version] = (versionDist[version] || 0) + 1;
                    countryDist[country] = (countryDist[country] || 0) + 1;
                    langDist[lang] = (langDist[lang] || 0) + 1;

                    if (recent.length < 20) {
                        recent.push({
                            uid: doc.id,
                            country, lang, platform, version,
                            stage: d.lifecycleStage || null,
                            isAnonymous: !!d.isAnonymous,
                            fcmTokensCount: Array.isArray(d.fcmTokens) ? d.fcmTokens.length : 0,
                            sentAt: dAt.toDate().toISOString(),
                        });
                    }
                }
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        return res.json({
            window: fieldName,
            sinceISO: since.toISOString(),
            hoursAgo,
            totalScanned,
            recentSentCount: Object.values(versionDist).reduce((a, b) => a + b, 0),
            platformDist,
            versionDist,
            countryDist,
            langDist,
            sampleUsers: recent,
        });
    } catch (e) {
        console.error('[RecentlySentWindow] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 발송 후 활동 진단 — "0/142 return" 가설 검증용
// d{N}At 시점 이후 유저가 lastActiveAt(의미있는 행동) 또는 updatedAt(앱 오픈)을 갱신했는지
router.post('/api/cron/post-push-activity', requireCronAuth, async (req, res) => {
    const window = (req.query.window || 'd3').toLowerCase().replace('d', '');
    const fieldName = `d${window}At`;
    if (!['d1At','d2At','d3At','d4At','d5At','d6At'].includes(fieldName)) {
        return res.status(400).json({ error: 'invalid window' });
    }
    const hoursAgo = parseInt(req.query.hours || '12', 10);
    const since = new Date(Date.now() - hoursAgo * 3600 * 1000);

    const batchSize = 500;
    const maxBatches = 10;
    let cursor = null;
    let batches = 0;

    let totalSent = 0;
    let returnedActive = 0;     // lastActiveAt > sentAt (의미있는 행동)
    let openedPassive = 0;      // updatedAt > sentAt but lastActiveAt <= sentAt (그냥 앱 열기만)
    let noResponse = 0;         // updatedAt 도 <= sentAt (전혀 안 들어옴)

    const byCountry = {};       // country -> { sent, returnedActive, openedPassive, noResponse }
    const sampleReturned = [];
    const sampleNoResponse = [];

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                const d = doc.data();
                const sentAt = d.reengagementSentAt?.[fieldName];
                if (!sentAt?.toMillis || sentAt.toMillis() < since.getTime()) continue;

                totalSent += 1;
                const sentMs = sentAt.toMillis();
                const lastActiveMs = d.lastActiveAt?.toMillis?.() || 0;
                const updatedMs = d.updatedAt?.toMillis?.() || 0;
                const country = d.geoCountry || 'unknown';

                if (!byCountry[country]) byCountry[country] = { sent: 0, returnedActive: 0, openedPassive: 0, noResponse: 0 };
                byCountry[country].sent += 1;

                let category;
                if (lastActiveMs > sentMs) {
                    returnedActive += 1; byCountry[country].returnedActive += 1; category = 'returnedActive';
                } else if (updatedMs > sentMs) {
                    openedPassive += 1; byCountry[country].openedPassive += 1; category = 'openedPassive';
                } else {
                    noResponse += 1; byCountry[country].noResponse += 1; category = 'noResponse';
                }

                const sampleEntry = {
                    uid: doc.id,
                    country, lang: d.sourceLang || d.deviceLang,
                    platform: d.currentNativePlatform, version: d.currentNativeVersion,
                    sentAt: sentAt.toDate().toISOString(),
                    lastActiveAt: d.lastActiveAt?.toDate?.()?.toISOString() || null,
                    updatedAt: d.updatedAt?.toDate?.()?.toISOString() || null,
                    fcmTokensCount: Array.isArray(d.fcmTokens) ? d.fcmTokens.length : 0,
                };
                if (category === 'returnedActive' && sampleReturned.length < 5) sampleReturned.push(sampleEntry);
                if (category === 'noResponse' && sampleNoResponse.length < 5) sampleNoResponse.push(sampleEntry);
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        // Firebase 프로젝트 ID — server admin SDK가 어느 project인지 (클라이언트와 일치 검증용)
        const serverProjectId = admin.apps[0]?.options?.projectId
            || admin.apps[0]?.options?.credential?.projectId
            || 'unknown';

        return res.json({
            window: fieldName,
            sinceISO: since.toISOString(),
            hoursAgo,
            firebaseProjectId: serverProjectId,
            totalSent,
            categories: {
                returnedActive,             // 푸시 후 의미있는 행동
                openedPassive,              // 푸시 후 앱 열기만 (passive)
                noResponse,                 // 전혀 반응 없음
            },
            returnedActivePct: totalSent ? +(returnedActive / totalSent * 100).toFixed(1) : 0,
            anyOpenPct: totalSent ? +((returnedActive + openedPassive) / totalSent * 100).toFixed(1) : 0,
            byCountry,
            sampleReturned,
            sampleNoResponse,
        });
    } catch (e) {
        console.error('[PostPushActivity] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// Lapsed 유저 도달 채널 inventory — email/phone/displayName 보유율
// "푸시 안 통하는 유저들에게 다른 채널로 닿을 수 있는가" 분석
router.post('/api/cron/lapsed-reach-inventory', requireCronAuth, async (req, res) => {
    const country = (req.query.country || 'VN').toUpperCase();
    const lapsedDays = parseInt(req.query.lapsedDays || '3', 10); // updatedAt > N일 전 = lapsed
    const lapsedThreshold = new Date(Date.now() - lapsedDays * 24 * 3600 * 1000);

    const batchSize = 500;
    const maxBatches = 10;
    let cursor = null;
    let batches = 0;

    let totalCountry = 0;
    let lapsed = 0;
    let withEmail = 0;
    let withPhone = 0;
    let withDisplayName = 0;
    let withFcmTokens = 0;
    let allChannels = 0;          // email + phone 둘 다
    let onlyFcm = 0;              // fcm만 (email/phone 없음)
    let unreachable = 0;          // 어떤 채널도 없음

    const lifecycleDist = {};
    const sampleEmail = [];
    const samplePhone = [];

    try {
        while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                const d = doc.data();
                if ((d.geoCountry || '').toUpperCase() !== country) continue;
                totalCountry += 1;

                const updMs = d.updatedAt?.toMillis?.() || 0;
                if (updMs >= lapsedThreshold.getTime()) continue; // 활성 — skip

                lapsed += 1;
                const stage = d.lifecycleStage || 'null';
                lifecycleDist[stage] = (lifecycleDist[stage] || 0) + 1;

                const hasEmail = !!d.email;
                const hasPhone = !!d.phoneNumber;
                const hasName = !!d.displayName;
                const hasFcm = Array.isArray(d.fcmTokens) && d.fcmTokens.length > 0;

                if (hasEmail) withEmail += 1;
                if (hasPhone) withPhone += 1;
                if (hasName) withDisplayName += 1;
                if (hasFcm) withFcmTokens += 1;
                if (hasEmail && hasPhone) allChannels += 1;
                if (hasFcm && !hasEmail && !hasPhone) onlyFcm += 1;
                if (!hasFcm && !hasEmail && !hasPhone) unreachable += 1;

                if (hasEmail && sampleEmail.length < 5) {
                    sampleEmail.push({
                        uid: doc.id,
                        email: d.email,
                        displayName: d.displayName,
                        sourceLang: d.sourceLang,
                        stage,
                        updatedAt: d.updatedAt?.toDate?.()?.toISOString(),
                    });
                }
                if (hasPhone && samplePhone.length < 5) {
                    samplePhone.push({
                        uid: doc.id,
                        phoneNumber: d.phoneNumber?.replace(/(\d{3})\d+(\d{2})/, '$1***$2'),
                        phoneCountry: d.phoneCountry,
                        stage,
                        updatedAt: d.updatedAt?.toDate?.()?.toISOString(),
                    });
                }
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        const pct = (n) => lapsed ? +(n / lapsed * 100).toFixed(1) : 0;

        return res.json({
            country, lapsedDays, lapsedThresholdISO: lapsedThreshold.toISOString(),
            totalCountry, lapsed,
            lapsedRate: totalCountry ? +(lapsed / totalCountry * 100).toFixed(1) : 0,
            channels: {
                withEmail,        emailPct:  pct(withEmail),
                withPhone,        phonePct:  pct(withPhone),
                withDisplayName,  namePct:   pct(withDisplayName),
                withFcmTokens,    fcmPct:    pct(withFcmTokens),
                allChannels,      allPct:    pct(allChannels),
                onlyFcm,          onlyFcmPct: pct(onlyFcm),
                unreachable,      unreachablePct: pct(unreachable),
            },
            lifecycleDist,
            sampleEmail,
            samplePhone,
        });
    } catch (e) {
        console.error('[LapsedReachInventory] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 단일 유저 doc 진단 — fcmTokens 등록/재등록 미작동 원인 분석용
router.post('/api/cron/user-info', requireCronAuth, async (req, res) => {
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ error: 'uid query param required' });

    try {
        const snap = await adminDb.collection('users').doc(uid).get();
        if (!snap.exists) return res.status(404).json({ error: 'user-not-found', uid });
        const d = snap.data();

        const toIso = (ts) => ts?.toDate?.()?.toISOString() || null;

        // ProfileHeal FCM 재등록 4가지 조건 평가 (서버에서 알 수 있는 것만)
        const isNative = !!d.currentNativePlatform; // android/ios 있으면 네이티브
        const fcmEmpty = !Array.isArray(d.fcmTokens) || d.fcmTokens.length === 0;
        const heal = {
            cond1_isNativePlatform: isNative,
            cond2_fcmTokensEmpty: fcmEmpty,
            cond3_sameSessionGuard: 'unknown (device memory)',
            cond4_permissionGranted: 'unknown (device runtime)',
            note: 'cond4 (permission granted)가 가장 자주 실패함 — 유저가 알림 권한 거부했거나 한 번도 요청 안 됐으면 register() 안 호출됨',
        };

        return res.json({
            uid,
            // 핵심
            tier: d.tier || null,
            isAnonymous: !!d.isAnonymous,
            lifecycleStage: d.lifecycleStage || null,
            activeDayCount: d.activeDayCount || 0,
            email: d.email || null,
            displayName: d.displayName || null,

            // 언어/지역
            sourceLang: d.sourceLang || null,
            deviceLang: d.deviceLang || null,
            geoCountry: d.geoCountry || null,
            geoCity: d.geoCity || null,
            phoneCountry: d.phoneCountry || null,

            // 플랫폼
            currentNativePlatform: d.currentNativePlatform || null,
            currentNativeVersion: d.currentNativeVersion || null,
            firstNativePlatform: d.firstNativePlatform || null,
            firstNativeVersion: d.firstNativeVersion || null,

            // FCM 관련
            fcmTokens: Array.isArray(d.fcmTokens) ? d.fcmTokens.map(t => t?.slice(0, 16) + '...') : [],
            fcmTokensCount: Array.isArray(d.fcmTokens) ? d.fcmTokens.length : 0,
            fcmTokenUpdatedAt: toIso(d.fcmTokenUpdatedAt),
            subscriptionAlertOptOut: d.subscriptionAlertOptOut || false,
            reengagementOptOut: d.reengagementOptOut || false,
            subscriptionAlertPromptShown: d.subscriptionAlertPromptShown || false,

            // 활동 추적
            createdAt: toIso(d.createdAt),
            updatedAt: toIso(d.updatedAt),
            lastActiveAt: toIso(d.lastActiveAt),
            lastActiveDay: d.lastActiveDay || null,
            hasCompletedOnboarding: !!d.hasCompletedOnboarding,

            // 발송 이력
            reengagementSentAt: d.reengagementSentAt
                ? Object.fromEntries(Object.entries(d.reengagementSentAt).map(([k, v]) => [k, toIso(v)]))
                : null,

            // ProfileHeal FCM 재등록 진단
            profileHealFcmDiagnostic: heal,
        });
    } catch (e) {
        console.error('[UserInfo] failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// Free Talk 캠페인 이메일 발송 (VN lapsed 유저, 1회성)
//
// 정책:
//   - geoCountry === 'VN' AND email 보유 AND updatedAt < N일 전 (lapsed)
//   - emailOptOut !== true AND tier !== 'admin' AND createdAt > 24h
//   - freeTalkEmailSentAt 없는 유저만 (idempotency)
//
// 모드:
//   ?dryRun=1 — 발송 없이 후보 미리보기
//   ?onlyEmail=foo@bar.com — 단일 테스트
//   ?lapsedDays=3 — 비활성 기준일 (기본 3일)
//   ?limit=N — 최대 발송 수 (기본 200)
router.post('/api/cron/send-free-talk-email', requireCronAuth, async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const onlyEmail = (req.query.onlyEmail || '').trim().toLowerCase() || null;
    const lapsedDays = parseInt(req.query.lapsedDays || '3', 10);
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const country = (req.query.country || 'VN').toUpperCase();

    const lapsedThreshold = new Date(Date.now() - lapsedDays * 24 * 3600 * 1000);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const batchSize = 500;
    const maxBatches = 10;
    let cursor = null;
    let batches = 0;

    let totalScanned = 0;
    let totalCandidates = 0;
    let totalSent = 0;
    let totalSkipped = 0;
    const skipReasons = {};
    const sentSamples = [];
    const errors = [];

    try {
        outer: while (batches < maxBatches) {
            let q = adminDb.collection('users')
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(batchSize);
            if (cursor) q = q.startAfter(cursor);

            const snap = await q.get();
            if (snap.empty) break;

            for (const doc of snap.docs) {
                totalScanned += 1;
                const d = doc.data();

                // 국가 필터
                if ((d.geoCountry || '').toUpperCase() !== country) continue;
                // 이메일 보유 필터
                const email = (d.email || '').trim();
                if (!email) {
                    skipReasons['no-email'] = (skipReasons['no-email'] || 0) + 1;
                    continue;
                }
                // onlyEmail 필터 (테스트 모드)
                if (onlyEmail && email.toLowerCase() !== onlyEmail) {
                    skipReasons['not-only-email'] = (skipReasons['not-only-email'] || 0) + 1;
                    continue;
                }
                // lapsed 필터
                const updMs = d.updatedAt?.toMillis?.() || 0;
                if (!onlyEmail && updMs >= lapsedThreshold.getTime()) {
                    skipReasons['not-lapsed'] = (skipReasons['not-lapsed'] || 0) + 1;
                    continue;
                }
                // 제외 조건
                if (d.emailOptOut === true) {
                    skipReasons['opted-out'] = (skipReasons['opted-out'] || 0) + 1;
                    continue;
                }
                if (d.tier === 'admin') {
                    skipReasons['admin'] = (skipReasons['admin'] || 0) + 1;
                    continue;
                }
                if (!onlyEmail && d.createdAt?.toMillis && (Date.now() - d.createdAt.toMillis() < 24 * 3600 * 1000)) {
                    skipReasons['d0-new'] = (skipReasons['d0-new'] || 0) + 1;
                    continue;
                }
                // idempotency
                if (!onlyEmail && d.freeTalkEmailSentAt) {
                    skipReasons['already-sent'] = (skipReasons['already-sent'] || 0) + 1;
                    continue;
                }

                totalCandidates += 1;
                if (totalCandidates > limit) {
                    skipReasons['over-limit'] = (skipReasons['over-limit'] || 0) + 1;
                    continue;
                }

                // country → lang 자동 매핑 (?lang= 으로 명시 override 가능)
                const lang = (req.query.lang || (country === 'KR' ? 'ko' : 'vi')).toLowerCase();
                const result = await sendFreeTalkEmail({
                    to: email,
                    name: d.displayName || null,
                    uid: doc.id,
                    baseUrl,
                    lang,
                    dryRun,
                });

                if (result.ok) {
                    if (!dryRun) {
                        try {
                            await doc.ref.update({
                                freeTalkEmailSentAt: FieldValue.serverTimestamp(),
                                freeTalkEmailMessageId: result.id || null,
                            });
                        } catch (e) {
                            console.warn(`[FreeTalkEmail] markSent failed for ${doc.id}:`, e.message);
                        }
                    }
                    totalSent += 1;
                    if (sentSamples.length < 5) {
                        sentSamples.push({ uid: doc.id, email, name: d.displayName, messageId: result.id, dryRun: !!result.dryRun });
                    }
                } else {
                    totalSkipped += 1;
                    skipReasons[result.reason || 'send-failed'] = (skipReasons[result.reason || 'send-failed'] || 0) + 1;
                    if (errors.length < 5) errors.push({ uid: doc.id, email, reason: result.reason });
                }

                // onlyEmail 매칭 시 1건만 처리하고 종료
                if (onlyEmail) break outer;
            }

            cursor = snap.docs[snap.docs.length - 1];
            batches += 1;
            if (snap.size < batchSize) break;
        }

        return res.json({
            mode: dryRun ? 'dryRun' : 'live',
            country, lapsedDays, lapsedThresholdISO: lapsedThreshold.toISOString(),
            limit, onlyEmail,
            totalScanned, totalCandidates, totalSent, totalSkipped,
            skipReasons, sentSamples, errors,
        });
    } catch (e) {
        console.error('[FreeTalkEmail] cron failed:', e);
        return res.status(500).json({ error: e.message, partial: { totalScanned, totalCandidates, totalSent } });
    }
});

// ─────────────────────────────────────────────────────────────────────────
// 이메일 수신거부 (Unsubscribe) — GET 호출로 emailOptOut: true 마킹
// HMAC 토큰 검증 (UNSUBSCRIBE_SECRET 설정 시). 결과는 베트남어 사과 페이지 표시
router.get('/api/unsubscribe-email', async (req, res) => {
    const uid = (req.query.uid || '').trim();
    const token = (req.query.t || '').trim();

    if (!uid) {
        return res.status(400).type('html').send('<h1>Invalid request</h1><p>Missing uid.</p>');
    }
    if (!verifyUnsubToken(uid, token)) {
        return res.status(401).type('html').send('<h1>Invalid token</h1><p>Liên kết hủy đăng ký không hợp lệ.</p>');
    }

    try {
        const ref = adminDb.collection('users').doc(uid);
        const snap = await ref.get();
        if (!snap.exists) {
            return res.status(404).type('html').send('<h1>Not found</h1><p>Tài khoản không tồn tại.</p>');
        }
        await ref.update({
            emailOptOut: true,
            emailOptOutAt: FieldValue.serverTimestamp(),
        });
        console.log(`[Unsubscribe] ${uid} opted out from emails`);
        return res.type('html').send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Đã hủy đăng ký - PronunFit</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 40px 20px; min-height: 100vh; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
  .card { background: #ffffff; border-radius: 16px; padding: 40px 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  h1 { color: #7B2D8E; margin: 0 0 12px; font-size: 1.4rem; }
  p { color: #475569; line-height: 1.6; margin: 0 0 8px; font-size: 0.95rem; }
  .icon { font-size: 3rem; margin-bottom: 16px; }
  .subtitle { color: #94a3b8; font-size: 0.85rem; margin-top: 24px; }
  a { color: #7B2D8E; text-decoration: none; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Đã hủy đăng ký thành công</h1>
    <p>Chúng tôi sẽ không gửi email cho bạn nữa.</p>
    <p>Cảm ơn bạn đã từng đồng hành cùng PronunFit. Nếu đổi ý, bạn có thể quay lại bất cứ lúc nào.</p>
    <p class="subtitle">— Đội ngũ PronunFit<br><a href="https://pronunfit.com">pronunfit.com</a></p>
  </div>
</body>
</html>`);
    } catch (e) {
        console.error('[Unsubscribe] failed:', e);
        return res.status(500).type('html').send('<h1>Error</h1><p>Something went wrong. Please try again later.</p>');
    }
});

module.exports = router;
