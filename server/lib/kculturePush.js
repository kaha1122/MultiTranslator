// ── K-DramaAnyLang 푸시 발송(FCM — 웹 + Android + iOS 네이티브) ──────────────────
// /api/community/notify가 인앱 알림 문서 기록 후 fire-and-forget으로 호출(sendPushForNotif).
// 수신자 users/{uid}/pushTokens/* (클라 등록: {platform,lang,tz,appInstanceId,sogam,updatedAt,lastSeenAt}) 를 읽어
// 토큰별 언어로 문구를 만들어 sendEach → 무효 토큰(unregistered)은 즉시 문서 삭제.
// 문구 SSOT: 클라 locales의 notif.{kind} → config/kculturePushTexts.json (클라 문구 변경 시 함께 갱신).
// 2026-09-04: iOS(apns) 분기 + buildTokenMessage/pruneDeadTokens를 export — 소감 푸시(kcultureSogamPush)·탐침(kculturePushProbe)이 재사용.
const admin = require('firebase-admin');
const { kcultureApp, kcultureDb } = require('../config/firebaseKculture');
const TEXTS = require('../config/kculturePushTexts');

const FALLBACK = 'en';
// 무효 토큰 판정 — 재설치/권한 회수/토큰 회전으로 죽은 토큰은 발송 대상에서 제거.
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-argument']);

// 클라 UI 언어(38종 가능)를 템플릿 보유 12개 언어로 매핑(클라 I18nProvider matchLang과 동일 규칙).
function resolveLang(raw) {
    const l = String(raw || '');
    if (TEXTS[l]) return l;
    const low = l.toLowerCase();
    if (low.startsWith('zh')) return 'zh-CN';
    if (low.startsWith('pt')) return 'pt-BR';
    const base = low.slice(0, 2);
    return TEXTS[base] ? base : FALLBACK;
}

// 클라 notifRoute(src/lib/notify.js)와 동일 매핑 — 해시 경로(네이티브 HashRouter 그대로, 웹은 main.jsx가 레거시 해시를 흡수).
// anchor가 있으면 쿼리로 부착 — 푸시 클릭 시에도 해당 댓글/평가로 스크롤(웹 SW·네이티브 공통).
const POST_KINDS = new Set(['post_like', 'post_comment', 'comment_like', 'comment_reply', 'reply_like']);
function notifUrl({ kind, postId, titleId, media, anchor }) {
    const q = anchor ? `?anchor=${anchor}` : '';
    if (POST_KINDS.has(kind) && postId) return `/#/community/post/${postId}${q}`;
    if (titleId != null) return `/#/title/${media || 'tv'}/${titleId}${q}`;
    return '/#/notifications';
}

// 토큰 문서 1개 → 플랫폼별 FCM 메시지. data는 문자열 값만(FCM 제약).
//   android: 시스템 트레이 알림(notification) + data.url — 탭 시 클라 NativePushHandler가 라우팅. imageUrl = BigPicture 썸네일.
//   ios:     notification + apns(aps.sound) — 탭 라우팅은 같은 플러그인 이벤트. imageUrl은 fcm_options.image(Notification Service Extension 없으면 무시 — 무해).
//   web:     webpush.notification(icon = imageUrl) — public/push-sw.js가 소비.
function buildTokenMessage(tokenDoc, { title, body, data = {}, imageUrl = null }) {
    const platform = tokenDoc.get('platform') || 'web';
    const image = (typeof imageUrl === 'string' && imageUrl.startsWith('https://')) ? imageUrl : null;
    const strData = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    if (platform === 'android') {
        return {
            token: tokenDoc.id, data: strData, notification: { title, body },
            android: { ttl: 86400 * 1000, priority: 'normal', ...(image ? { notification: { imageUrl: image } } : {}) },
        };
    }
    if (platform === 'ios') {
        return {
            token: tokenDoc.id, data: strData, notification: { title, body },
            apns: {
                headers: { 'apns-priority': '10', 'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400) },
                payload: { aps: { sound: 'default' } },
                ...(image ? { fcmOptions: { imageUrl: image } } : {}),
            },
        };
    }
    return {
        token: tokenDoc.id, data: strData,
        webpush: {
            notification: { title, body, ...(image ? { icon: image } : {}) },
            headers: { Urgency: 'normal', TTL: '86400' },
        },
    };
}

// 운영 스위치 — Firestore config/kc_push { sogamEnabled, probeEnabled } (기본 false = 발송 안 함).
// 검증 전 자동 발송을 막는 킬스위치(2026-09-04). 서버 스크립트 scripts/kc-push-flags.js 또는 콘솔에서 토글.
async function getPushFlags() {
    try {
        const snap = await kcultureDb.doc('config/kc_push').get();
        const d = snap.exists ? (snap.data() || {}) : {};
        return { sogamEnabled: d.sogamEnabled === true, probeEnabled: d.probeEnabled === true };
    } catch { return { sogamEnabled: false, probeEnabled: false }; }
}

// sendEach 결과에서 죽은 토큰 문서를 삭제. 삭제 건수 반환.
async function pruneDeadTokens(result, tokenRefs) {
    const deletions = [];
    result.responses.forEach((r, i) => {
        if (!r.success && DEAD.has(r.error?.code) && tokenRefs[i]) deletions.push(tokenRefs[i].delete().catch(() => {}));
    });
    await Promise.all(deletions);
    return deletions.length;
}

// 알림 1건에 대한 푸시 발송. notif = notify 라우트가 검증·정규화한 필드 그대로.
// 실패해도 throw하지 않는다(인앱 알림은 이미 기록됨 — 푸시는 best-effort).
async function sendPushForNotif(recipientUid, notif) {
    if (!kcultureDb || !kcultureApp) return;
    try {
        const snap = await kcultureDb.collection('users').doc(recipientUid).collection('pushTokens').get();
        if (snap.empty) return;

        const url = notifUrl(notif);
        const name = notif.actorName || 'User';
        // 작성자 프로필 사진 — https만 허용(notify 라우트가 클라 입력을 그대로 저장하므로 여기서 한 번 더 가드).
        const photo = (typeof notif.actorPhoto === 'string' && notif.actorPhoto.startsWith('https://')) ? notif.actorPhoto : null;
        const messages = []; const tokenRefs = [];
        for (const d of snap.docs) {
            const lang = resolveLang(d.get('lang'));
            const template = (TEXTS[lang] && TEXTS[lang][notif.kind]) || (TEXTS[FALLBACK][notif.kind]);
            if (!template) continue;
            messages.push(buildTokenMessage(d, {
                title: template.replaceAll('{name}', name), body: notif.preview || '',
                data: { kind: notif.kind, url }, imageUrl: photo,
            }));
            tokenRefs.push(d.ref);
        }
        if (!messages.length) return;

        const result = await admin.messaging(kcultureApp).sendEach(messages);
        const pruned = await pruneDeadTokens(result, tokenRefs);
        console.log(`[Push/KC] → ${String(recipientUid).slice(0, 8)} kind=${notif.kind} sent=${result.successCount}/${messages.length}${pruned ? ` pruned=${pruned}` : ''}`);
    } catch (e) {
        console.warn('[Push/KC] send failed:', e?.message);
    }
}

module.exports = { sendPushForNotif, buildTokenMessage, pruneDeadTokens, resolveLang, notifUrl, getPushFlags, TEXTS, FALLBACK, DEAD };
