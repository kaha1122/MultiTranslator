import { initializeApp } from "firebase/app";
import { getAuth, initializeAuth, browserLocalPersistence, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider, RecaptchaVerifier } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";
import { getMessaging, isSupported as isMessagingSupported } from "firebase/messaging";
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ── 네이티브(iOS/Android) Auth persistence 대응 ──────────────────────────
// iOS Capacitor capacitor://localhost 스킴은 IndexedDB hang 이슈, Android는
// Play Store 업그레이드 시 IndexedDB 손상으로 인한 익명 UID 분실 사례
// (Phase 1-C, 2026-05-17) → 두 네이티브 모두 localStorage 기반
// browserLocalPersistence 강제. Firestore Long Polling은 iOS 스킴 한정 유지
// (Android WebChannel은 정상 동작).
const platform = Capacitor.getPlatform();
const isNative = platform === 'ios' || platform === 'android';

export const auth = isNative
    ? initializeAuth(app, { persistence: browserLocalPersistence })
    : getAuth(app);

export const db = platform === 'ios'
    ? initializeFirestore(app, { experimentalForceLongPolling: true })
    : getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
export const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope('email');
facebookProvider.addScope('public_profile');
export const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

// Web FCM messaging — 네이티브는 Capacitor PushNotifications 사용하므로 skip.
// isSupported(): 시크릿모드/구형 브라우저/일부 인앱 브라우저(카카오/네이버/인스타)는 false 반환.
// lazy 캐시: 첫 호출에만 init, 이후 동일 인스턴스 반환.
let _webMessaging = null;
let _webMessagingChecked = false;
export async function getWebMessaging() {
    if (_webMessagingChecked) return _webMessaging;
    _webMessagingChecked = true;
    if (typeof window === 'undefined') return null;
    if (Capacitor.isNativePlatform?.()) return null;
    try {
        const supported = await isMessagingSupported();
        if (!supported) return null;
        _webMessaging = getMessaging(app);
        return _webMessaging;
    } catch (e) {
        console.warn('[Firebase] Web messaging init failed:', e?.message);
        return null;
    }
}

export { RecaptchaVerifier };
export default app;
