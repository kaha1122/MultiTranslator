// ── K-DramaAnyLang 사일런트 푸시 탐침 — 앱 삭제 추정(iOS) + 죽은 토큰 정리 ────────────
// 2026-09-04 도입. iOS는 삭제 이벤트가 없다(GA4 app_remove는 Android만). 삭제된 기기의 APNs 토큰은 무효가 되므로
// 알림 없는 data-only 푸시를 보내 FCM이 `registration-token-not-registered`를 돌려주는 시점을 삭제 추정으로 기록한다
// (Braze·CleverTap 등이 쓰는 표준 기법). 사용자에게 보이는 것은 없다.
// 실행: 재참여 크론(매시간)에서 호출 → 각 토큰의 **현지 04시**에 하루 1회(토큰 문서 probeLastDate로 멱등).
// 대상: platform ios·android(웹 토큰 제외 — 브라우저 SW가 data-only를 빈 알림으로 띄울 수 있고 삭제 개념도 없음).
// 결과: DEAD → `uninstall_events` 컬렉션에 {uid, token, platform, tz, lang, appInstanceId, lastSeenAt, detectedAt, reason} 기록 후 토큰 삭제.
//   GA4 대조는 appInstanceId로 후속(Measurement Protocol) — v1은 Firestore 기록까지.
// ⚠ iOS 백그라운드 수신에는 네이티브 Info.plist UIBackgroundModes(remote-notification)가 필요(1.1.7 빌드부터).
//   그 전 바이너리에서도 "토큰 무효 판정"은 APNs 단계에서 나므로 삭제 추정 자체는 동작한다.
const admin = require('firebase-admin');
const { kcultureApp, kcultureDb } = require('../config/firebaseKculture');
const { resolveLang, getPushFlags, DEAD } = require('./kculturePush');
const { localParts, DEFAULT_TZ_BY_LANG } = require('./kcultureSogamPush');

const PROBE_HOUR = 4; // 현지 04시 — 사용자 방해 최소·크론 부하 분산

function probeMessage(token, platform) {
    if (platform === 'ios') {
        return {
            token, data: { probe: '1' },
            apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } },
        };
    }
    return { token, data: { probe: '1' }, android: { priority: 'normal', ttl: 3600 * 1000 } };
}

async function runPushProbeHourly(now = new Date(), { dryRun = false } = {}) {
    if (!kcultureDb || !kcultureApp) return { skipped: 'no-db' };
    if (!(await getPushFlags()).probeEnabled) return { skipped: 'disabled(config/kc_push.probeEnabled)' }; // 킬스위치
    const snap = await kcultureDb.collectionGroup('pushTokens').get();
    if (snap.empty) return { skipped: 'no-tokens' };

    const targets = [];
    for (const d of snap.docs) {
        const t = d.data() || {};
        const platform = t.platform || 'web';
        if (platform !== 'ios' && platform !== 'android') continue;
        const lp = localParts(t.tz || DEFAULT_TZ_BY_LANG[resolveLang(t.lang)] || 'UTC', now);
        if (!lp || lp.hour !== PROBE_HOUR) continue;
        if (t.probeLastDate === lp.date) continue;
        targets.push({ ref: d.ref, token: d.id, platform, date: lp.date, meta: t });
    }
    if (!targets.length) return { candidates: 0 };
    if (dryRun) return { dryRun: true, candidates: targets.length };

    let ok = 0, dead = 0, other = 0;
    for (let i = 0; i < targets.length; i += 500) {
        const chunk = targets.slice(i, i + 500);
        const res = await admin.messaging(kcultureApp).sendEach(chunk.map((x) => probeMessage(x.token, x.platform)));
        const writes = [];
        res.responses.forEach((r, j) => {
            const x = chunk[j];
            if (r.success) { ok++; writes.push(x.ref.set({ probeLastDate: x.date, probeLastAt: new Date() }, { merge: true }).catch(() => {})); return; }
            const code = r.error?.code || 'unknown';
            if (DEAD.has(code)) {
                dead++;
                const uid = x.ref.parent?.parent?.id || null;
                writes.push(kcultureDb.collection('uninstall_events').add({
                    uid, token: x.token, platform: x.platform, tz: x.meta.tz || null, lang: x.meta.lang || null,
                    appInstanceId: x.meta.appInstanceId || null, lastSeenAt: x.meta.lastSeenAt || x.meta.updatedAt || null,
                    detectedAt: new Date(), reason: code, source: 'silent-probe',
                }).then(() => x.ref.delete()).catch((e) => console.warn('[PushProbe/KC] record fail:', e?.message)));
            } else {
                other++; // 일시 오류(unavailable 등) — 다음 날 재시도, 표시만
                writes.push(x.ref.set({ probeLastDate: x.date, probeLastError: code }, { merge: true }).catch(() => {}));
            }
        });
        await Promise.all(writes);
    }
    console.log(`[PushProbe/KC] probed=${targets.length} alive=${ok} uninstalled=${dead} other=${other}`);
    return { candidates: targets.length, alive: ok, uninstalled: dead, other };
}

module.exports = { runPushProbeHourly, PROBE_HOUR };
