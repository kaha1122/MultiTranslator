// FCM push 설정 저장 — 스토리지 + Firestore 헬퍼만 담당
// 플러그인 호출(checkPermissions/requestPermissions/register/listeners)은 호출 측에서 인라인으로 수행
// (과거 래퍼 경로에서 hang 현상 발견 후 인라인 패턴으로 전환)
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';
import { db, getWebMessaging } from '../firebase/config';

const STORAGE_KEY_SUB_ALERT = 'pronunfit.pushAlert.subscription';
const STORAGE_KEY_REENGAGEMENT = 'pronunfit.pushAlert.reengagement';
const STORAGE_KEY_REGISTERED_TOKEN = 'pronunfit.pushAlert.registeredToken';

// 구독 알림 ON/OFF 사용자 프리퍼런스 (기본 true)
export function loadSubscriptionAlertPref() {
    try {
        const v = localStorage.getItem(STORAGE_KEY_SUB_ALERT);
        return v === null ? true : v === 'true';
    } catch {
        return true;
    }
}

export function saveSubscriptionAlertPref(enabled) {
    try {
        localStorage.setItem(STORAGE_KEY_SUB_ALERT, enabled ? 'true' : 'false');
    } catch {}
}

// Firestore에 opt-out 플래그 저장 (서버 sendPush가 체크)
export async function setSubscriptionAlertPref(uid, enabled) {
    saveSubscriptionAlertPref(enabled);
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'users', uid), {
            subscriptionAlertOptOut: !enabled,
        });
    } catch (e) {
        console.warn('[Push] alert pref save failed:', e.message);
    }
}

// Re-engagement 알림 ON/OFF (기본 true = 옵트인 / 발송 대상)
// Firestore에는 reengagementOptOut 필드(서버 cron이 검사)
export function loadReengagementAlertPref() {
    try {
        const v = localStorage.getItem(STORAGE_KEY_REENGAGEMENT);
        return v === null ? true : v === 'true';
    } catch {
        return true;
    }
}

export function saveReengagementAlertPref(enabled) {
    try {
        localStorage.setItem(STORAGE_KEY_REENGAGEMENT, enabled ? 'true' : 'false');
    } catch {}
}

export async function setReengagementAlertPref(uid, enabled) {
    saveReengagementAlertPref(enabled);
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'users', uid), {
            reengagementOptOut: !enabled,
        });
    } catch (e) {
        console.warn('[Push] reengagement pref save failed:', e.message);
    }
}

// 이전에 저장한 FCM 토큰 (중복 저장 방지용)
export function getRegisteredFcmToken() {
    try { return localStorage.getItem(STORAGE_KEY_REGISTERED_TOKEN); } catch { return null; }
}

// FCM 토큰을 Firestore users/{uid}.fcmTokens 배열에 병합 저장
// 플랫폼 정보는 별도의 currentNativePlatform 필드에서 관리 (App.jsx 버전 추적 useEffect)
// 과거 fcmPlatform 필드는 더 이상 쓰지 않음 (기존 데이터는 호환성을 위해 유지)
// localStorage 쇼트서킷은 쓰지 않는다:
//   - arrayUnion은 멱등이라 중복 write가 Firestore에 누적되지 않음
//   - 서버의 stale-token 정리(sendPush.js)가 실행되면 Firestore에서는 토큰이 빠지지만
//     기기 localStorage에는 남아있어서, 과거 쇼트서킷으로 인해 영원히 복구 불가 divergence 발생
export async function saveFcmTokenToFirestore(uid, token) {
    if (!uid || !token) {
        console.warn('[Push] saveFcmTokenToFirestore missing arg:', { uid: !!uid, token: !!token });
        return { ok: false, reason: 'missing-arg' };
    }
    try {
        await updateDoc(doc(db, 'users', uid), {
            fcmTokens: arrayUnion(token),
            fcmTokenUpdatedAt: serverTimestamp(),
        });
        try { localStorage.setItem(STORAGE_KEY_REGISTERED_TOKEN, token); } catch {}
        console.log('[Push] token saved to Firestore:', token.slice(0, 12) + '...');
        return { ok: true };
    } catch (e) {
        console.warn('[Push] token save failed:', e.message);
        return { ok: false, reason: e.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Web FCM (브라우저용) — Capacitor 네이티브와 별도 경로
// ─────────────────────────────────────────────────────────────────────────
// 결과 reason 분기:
//   - 'unsupported'        : 브라우저가 Notification/serviceWorker/FCM 미지원 (iOS Safari 일반탭, 인앱브라우저, 시크릿모드 등)
//   - 'no-vapid-key'       : VITE_FIREBASE_VAPID_KEY 환경변수 누락 (Firebase Console → Cloud Messaging → Web Push certificates)
//   - 'denied'             : 사용자가 권한 거부
//   - 'no-token'           : 권한은 받았으나 getToken이 빈 토큰 반환 (드물지만 가능)
//   - 그 외(에러 메시지)    : 네트워크/Firebase 오류

export async function registerWebFCM(uid) {
    if (!uid) return { ok: false, reason: 'no-uid' };

    // 브라우저 지원 1차 체크
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
        return { ok: false, reason: 'unsupported' };
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
        console.warn('[Push-Web] VITE_FIREBASE_VAPID_KEY 미설정 — Firebase Console에서 발급 필요');
        return { ok: false, reason: 'no-vapid-key' };
    }

    try {
        // 1) 권한 요청 (이미 granted면 즉시 반환)
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return { ok: false, reason: 'denied' };

        // 2) Service worker 등록 — URL params로 Firebase config 전달
        //    (SW는 import.meta.env를 못 읽으므로 메인 앱이 주입)
        const swParams = new URLSearchParams({
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
            appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
        }).toString();
        const swReg = await navigator.serviceWorker.register(
            `/firebase-messaging-sw.js?${swParams}`,
            { scope: '/firebase-cloud-messaging-push-scope' }
        );

        // 3) Firebase Web Messaging 초기화 + 토큰 발급
        const messaging = await getWebMessaging();
        if (!messaging) return { ok: false, reason: 'unsupported' };

        const token = await getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: swReg,
        });
        if (!token) return { ok: false, reason: 'no-token' };

        // 4) Firestore 저장 (네이티브와 동일 경로 — sendPush.js가 web/native 구분 없이 처리)
        const res = await saveFcmTokenToFirestore(uid, token);
        return { ok: res.ok, reason: res.reason, token };
    } catch (e) {
        console.warn('[Push-Web] registerWebFCM failed:', e?.message);
        return { ok: false, reason: e?.message || 'unknown' };
    }
}

// Foreground 메시지 리스너 — 앱이 열린 상태에서 푸시 수신.
// 브라우저는 foreground일 때 시스템 알림을 자동 표시하지 않으므로 수동 표시 또는 in-app banner 사용.
// 반환: unsubscribe 함수
export async function attachWebFCMForegroundListener(handler) {
    const messaging = await getWebMessaging();
    if (!messaging) return () => {};
    return onMessage(messaging, (payload) => {
        console.log('[Push-Web] foreground message:', payload);
        try { handler?.(payload); } catch (e) { console.warn('[Push-Web] handler error:', e?.message); }
    });
}
