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

module.exports = router;
