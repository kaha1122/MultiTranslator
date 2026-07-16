// ── K-DramaAnyLang 푸시 발송(FCM — 웹 + Android 네이티브) ────────────────────
// /api/community/notify가 인앱 알림 문서 기록 후 fire-and-forget으로 호출.
// 수신자 users/{uid}/pushTokens/* (클라 등록: {platform,lang,updatedAt}) 를 읽어
// 토큰별 언어로 문구를 만들어 sendEach → 무효 토큰(unregistered)은 즉시 문서 삭제.
// 문구 SSOT: 클라 locales의 notif.{kind} → scripts로 추출한 config/kculturePushTexts.json
// (클라 문구 변경 시 재추출 필요 — KCulture repo 쪽 작업 로그 참조).
const admin = require('firebase-admin');
const { kcultureApp, kcultureDb } = require('../config/firebaseKculture');
const TEXTS = require('../config/kculturePushTexts');

const FALLBACK = 'en';

// 클라 UI 언어(38종 가능)를 템플릿 보유 10개 언어로 매핑(클라 I18nProvider matchLang과 동일 규칙).
function resolveLang(raw) {
    const l = String(raw || '');
    if (TEXTS[l]) return l;
    const low = l.toLowerCase();
    if (low.startsWith('zh')) return 'zh-CN';
    if (low.startsWith('pt')) return 'pt-BR';
    const base = low.slice(0, 2);
    return TEXTS[base] ? base : FALLBACK;
}

// 클라 notifRoute(src/lib/notify.js)와 동일 매핑 — HashRouter 경로.
const POST_KINDS = new Set(['post_like', 'post_comment', 'comment_like', 'comment_reply', 'reply_like']);
function notifUrl({ kind, postId, titleId, media }) {
    if (POST_KINDS.has(kind) && postId) return `/#/community/post/${postId}`;
    if (titleId != null) return `/#/title/${media || 'tv'}/${titleId}`;
    return '/#/notifications';
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
        // 작성자 프로필 사진 — 웹은 알림 icon(push-sw.js), Android는 imageUrl(접힘 시 우측 썸네일).
        // https만 허용(notify 라우트가 클라 입력을 그대로 저장하므로 여기서 한 번 더 가드).
        const photo = (typeof notif.actorPhoto === 'string' && notif.actorPhoto.startsWith('https://')) ? notif.actorPhoto : null;
        const messages = [];
        const tokenDocs = [];
        for (const d of snap.docs) {
            const lang = resolveLang(d.get('lang'));
            const template = (TEXTS[lang] && TEXTS[lang][notif.kind]) || (TEXTS[FALLBACK][notif.kind]);
            if (!template) continue;
            const title = template.replaceAll('{name}', name);
            const body = notif.preview || '';
            // platform별 메시지(클라 push.js가 토큰 문서에 기록: 'web' | 'android'. ios는 APNs 콘솔 작업 후 apns 블록 추가).
            const platform = d.get('platform') || 'web';
            if (platform === 'android') {
                // 시스템 트레이 알림(notification 메시지) — 탭 시 data.url을
                // 클라 NativePushHandler(notificationActionPerformed)가 라우팅.
                messages.push({
                    token: d.id,
                    data: { kind: notif.kind, url },
                    notification: { title, body },
                    android: {
                        ttl: 86400 * 1000, priority: 'normal', // 하루 지난 알림은 폐기(ms)
                        ...(photo ? { notification: { imageUrl: photo } } : {}), // 접힘 시 우측 썸네일(BigPicture)
                    },
                });
            } else {
                messages.push({
                    token: d.id,
                    data: { kind: notif.kind, url },
                    webpush: {
                        notification: { title, body, ...(photo ? { icon: photo } : {}) }, // icon = 작성자 프로필(push-sw.js가 소비)
                        headers: { Urgency: 'normal', TTL: '86400' }, // 하루 지난 알림은 폐기
                    },
                });
            }
            tokenDocs.push(d.ref);
        }
        if (!messages.length) return;

        const result = await admin.messaging(kcultureApp).sendEach(messages);
        // 무효 토큰 정리 — 재설치/권한 회수/토큰 회전으로 죽은 토큰은 발송 대상에서 제거.
        const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-argument']);
        const deletions = [];
        result.responses.forEach((r, i) => {
            if (!r.success && DEAD.has(r.error?.code)) deletions.push(tokenDocs[i].delete().catch(() => {}));
        });
        await Promise.all(deletions);
        console.log(`[Push/KC] → ${String(recipientUid).slice(0, 8)} kind=${notif.kind} sent=${result.successCount}/${messages.length}${deletions.length ? ` pruned=${deletions.length}` : ''}`);
    } catch (e) {
        console.warn('[Push/KC] send failed:', e?.message);
    }
}

module.exports = { sendPushForNotif };
