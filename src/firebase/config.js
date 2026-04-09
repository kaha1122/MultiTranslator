import { initializeApp } from "firebase/app";
import { getAuth, initializeAuth, browserLocalPersistence, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider, RecaptchaVerifier } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";
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

// ── iOS WKWebView 대응 ──────────────────────────────────────────────────
// iOS Capacitor는 capacitor://localhost 커스텀 스킴을 사용하는데,
// 이 스킴에서 두 가지 문제가 발생:
//   1) Firebase Auth 기본 persistence(IndexedDB)가 hang → browserLocalPersistence 사용
//   2) Firestore 기본 WebChannel이 작동 안 함 → Long Polling 강제
// Android(http://localhost)와 Web(https://...)은 기존 방식 그대로 유지
const isIOS = Capacitor.getPlatform() === 'ios';

export const auth = isIOS
    ? initializeAuth(app, { persistence: browserLocalPersistence })
    : getAuth(app);

export const db = isIOS
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

export { RecaptchaVerifier };
export default app;
