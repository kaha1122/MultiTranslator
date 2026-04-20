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
