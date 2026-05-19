// FCM push 설정 저장 — 스토리지 + Firestore 헬퍼만 담당
// 플러그인 호출(checkPermissions/requestPermissions/register/listeners)은 호출 측에서 인라인으로 수행
// (과거 래퍼 경로에서 hang 현상 발견 후 인라인 패턴으로 전환)
import { doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { db, getWebMessaging } from '../firebase/config';

const STORAGE_KEY_SUB_ALERT = 'pronunfit.pushAlert.subscription';
const STORAGE_KEY_REENGAGEMENT = 'pronunfit.pushAlert.reengagement';
const STORAGE_KEY_STREAK_REMINDER = 'pronunfit.pushAlert.streakReminder';
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

// 2026-05-18: Streak 정기 리마인더 ON/OFF — local 13:00 FCM 발송 (LocalNotifications 12:30 대체)
// Firestore streakReminderOptOut 필드를 서버 cron이 검사
export function loadStreakReminderAlertPref() {
    try {
        const v = localStorage.getItem(STORAGE_KEY_STREAK_REMINDER);
        return v === null ? true : v === 'true';
    } catch {
        return true;
    }
}

export function saveStreakReminderAlertPref(enabled) {
    try {
        localStorage.setItem(STORAGE_KEY_STREAK_REMINDER, enabled ? 'true' : 'false');
    } catch {}
}

export async function setStreakReminderAlertPref(uid, enabled) {
    saveStreakReminderAlertPref(enabled);
    if (!uid) return;
    try {
        await updateDoc(doc(db, 'users', uid), {
            streakReminderOptOut: !enabled,
        });
    } catch (e) {
        console.warn('[Push] streak reminder pref save failed:', e.message);
    }
}

// 이전에 저장한 FCM 토큰 (중복 저장 방지용)
export function getRegisteredFcmToken() {
    try { return localStorage.getItem(STORAGE_KEY_REGISTERED_TOKEN); } catch { return null; }
}

// FCM 토큰을 Firestore users/{uid}.fcmTokens 배열에 dedup 저장 (2026-05-18 fix)
// 같은 Instance ID(콜론 앞 prefix) 토큰은 회전된 옛 토큰으로 보고 제거 후 새 토큰 추가.
// 다른 단말(폰+태블릿)은 prefix 달라 보존. 회전된 옛 토큰이 누적되어 같은 단말에 알림이
// 2번 발화하는 결함을 근본 차단.
//
// 옛 arrayUnion-only 코드는 회전된 새 토큰(다른 문자열)을 별개로 보고 누적했음 → zmxn1999
// 사고 패턴(같은 prefix 두 토큰 공존).
export async function saveFcmTokenToFirestore(uid, token) {
    if (!uid || !token) {
        console.warn('[Push] saveFcmTokenToFirestore missing arg:', { uid: !!uid, token: !!token });
        return { ok: false, reason: 'missing-arg' };
    }
    try {
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        const existing = Array.isArray(snap.data()?.fcmTokens) ? snap.data().fcmTokens.filter(Boolean) : [];
        const newPrefix = token.split(':')[0];
        const cleaned = existing.filter(t => t.split(':')[0] !== newPrefix);
        const merged = [...cleaned, token]; // 같은 prefix 옛 토큰 제거 + 새 토큰 추가
        // 동일 토큰 중복은 Set으로 한 번 더 정리
        const dedup = [...new Set(merged)];
        await updateDoc(ref, {
            fcmTokens: dedup,
            fcmTokenUpdatedAt: serverTimestamp(),
        });
        try { localStorage.setItem(STORAGE_KEY_REGISTERED_TOKEN, token); } catch {}
        console.log('[Push] token saved (dedup):', token.slice(0, 12) + '... total=' + dedup.length);
        return { ok: true };
    } catch (e) {
        console.warn('[Push] token save failed:', e.message);
        return { ok: false, reason: e.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// iOS 전용 FCM 등록 (2026-05-19) — @capacitor-firebase/messaging 경유
// Android는 @capacitor/push-notifications의 'registration' 이벤트로 FCM token이 정상 반환되지만,
// iOS는 Firebase Messaging iOS SDK 없이는 APNs hex token만 반환됨(firebase-admin에서 invalid-argument).
// → iOS만 별도 경로로 FCM token 발급 후 동일한 saveFcmTokenToFirestore에 저장.
// 반환 reason 분기:
//   - 'no-uid' | 'denied' | 'denied-persistent' | 'no-token' | <error message>
// ─────────────────────────────────────────────────────────────────────────
export async function registerIOSFCM(uid) {
    if (!uid) return { ok: false, reason: 'no-uid' };
    if (Capacitor.getPlatform() !== 'ios') return { ok: false, reason: 'wrong-platform' };
    try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        const check = await FirebaseMessaging.checkPermissions();
        if (check.receive !== 'granted') {
            if (check.receive === 'denied') return { ok: false, reason: 'denied-persistent' };
            const result = await FirebaseMessaging.requestPermissions();
            if (result.receive !== 'granted') return { ok: false, reason: 'denied' };
        }
        const { token } = await FirebaseMessaging.getToken();
        if (!token) return { ok: false, reason: 'no-token' };
        const saveResult = await saveFcmTokenToFirestore(uid, token);
        return { ok: saveResult.ok, reason: saveResult.reason, token };
    } catch (err) {
        console.warn('[Push-iOS] registerIOSFCM failed:', err?.message);
        return { ok: false, reason: err?.message || 'ios-fcm-failed' };
    }
}

// iOS 토큰 갱신 리스너 — Firebase Messaging이 자체적으로 refresh할 때 발화
// 반환: unsubscribe 함수
export async function attachIOSFCMTokenListener(getUid) {
    if (Capacitor.getPlatform() !== 'ios') return () => {};
    try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        const handle = await FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
            const uid = typeof getUid === 'function' ? getUid() : getUid;
            if (!token || !uid) {
                console.warn('[Push-iOS] tokenReceived skipped — missing token/uid', { tk: !!token, uid: !!uid });
                return;
            }
            const res = await saveFcmTokenToFirestore(uid, token);
            console.log('[Push-iOS] tokenReceived saveFcmTokenToFirestore:', res);
        });
        return () => { try { handle?.remove?.(); } catch {} };
    } catch (err) {
        console.warn('[Push-iOS] tokenReceived listener setup failed:', err?.message);
        return () => {};
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
