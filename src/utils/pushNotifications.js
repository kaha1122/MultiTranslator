// FCM push 설정 저장 — 스토리지 + Firestore 헬퍼만 담당
// 플러그인 호출(checkPermissions/requestPermissions/register/listeners)은 호출 측에서 인라인으로 수행
// (과거 래퍼 경로에서 hang 현상 발견 후 인라인 패턴으로 전환)
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

const STORAGE_KEY_SUB_ALERT = 'pronunfit.pushAlert.subscription';
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

// 이전에 저장한 FCM 토큰 (중복 저장 방지용)
export function getRegisteredFcmToken() {
    try { return localStorage.getItem(STORAGE_KEY_REGISTERED_TOKEN); } catch { return null; }
}

// FCM 토큰을 Firestore users/{uid}.fcmTokens 배열에 병합 저장
export async function saveFcmTokenToFirestore(uid, token, platform) {
    if (!uid || !token) return { ok: false, reason: 'missing-arg' };
    const stored = getRegisteredFcmToken();
    if (stored === token) return { ok: true, reason: 'already-saved' };
    try {
        await updateDoc(doc(db, 'users', uid), {
            fcmTokens: arrayUnion(token),
            fcmTokenUpdatedAt: serverTimestamp(),
            fcmPlatform: platform || 'unknown',
        });
        try { localStorage.setItem(STORAGE_KEY_REGISTERED_TOKEN, token); } catch {}
        return { ok: true };
    } catch (e) {
        console.warn('[Push] token save failed:', e.message);
        return { ok: false, reason: e.message };
    }
}
