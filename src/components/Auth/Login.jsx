import React, { useState } from 'react';
import { auth, db, googleProvider, facebookProvider, appleProvider } from '../../firebase/config';
import { signInWithEmailAndPassword, signInWithPopup, signInWithCredential, GoogleAuthProvider as FirebaseGoogleAuthProvider, FacebookAuthProvider as FirebaseFacebookAuthProvider, OAuthProvider, getAdditionalUserInfo, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Mail, Lock, AlertCircle, Smartphone } from 'lucide-react';
import { getT } from '../../utils/i18n';
import { readAnonProfileFields } from '../../utils/anonProfileMigrate';
import './Auth.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// 익명 유저 데이터를 새 계정으로 마이그레이션
const migrateAnonymousData = async (anonymousUid, newUser) => {
    if (!anonymousUid || anonymousUid === newUser.uid) return;
    try {
        const token = await newUser.getIdToken();
        const resp = await fetch(`${API_URL}/api/migrate-anonymous`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anonymousUid }),
        });
        const data = await resp.json();
        if (data.success) console.log('[Login Migrate] success:', data.migrated);
    } catch (e) {
        console.warn('[Login Migrate] failed (non-blocking):', e.message);
    }
};

const detectInAppBrowser = () => {
    const ua = navigator.userAgent || '';
    const isKnownApp = /KAKAOTALK|KAKAO|Instagram|NAVER|NaverApp|Line\/|FBAN|FBAV|Twitter|Snapchat/i.test(ua);
    const isAndroidWebView = /Android/.test(ua) && /wv\)/.test(ua);
    const isIOSWebView = /iPhone|iPad/.test(ua) && !/Safari/.test(ua);
    return isKnownApp || isAndroidWebView || isIOSWebView;
};

function Login({ onSwitchToSignup, sourceLang, onCancel }) {
    const t = (key) => getT(sourceLang, key);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    const handleForgotPassword = async () => {
        if (!email.trim()) { setError(t('auth.forgotEmailFirst')); return; }
        try {
            await sendPasswordResetEmail(auth, email);
            setResetSent(true);
            setError('');
        } catch (err) {
            setError(err.code === 'auth/user-not-found' ? t('auth.forgotNotFound') : `${t('auth.forgotFail')}: ${err.code}`);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        const prevAnonUid = auth.currentUser?.isAnonymous ? auth.currentUser.uid : null;
        try {
            const result = await signInWithEmailAndPassword(auth, email, password);
            if (prevAnonUid) await migrateAnonymousData(prevAnonUid, result.user);
        } catch (err) {
            console.error(err);
            setError(`${t('auth.loginFailed')}: ${err.code}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        setError('');
        const isNative = window.Capacitor?.isNativePlatform?.();
        if (!isNative && detectInAppBrowser()) {
            setError('inapp');
            setIsLoading(false);
            return;
        }
        const prevAnonUid = auth.currentUser?.isAnonymous ? auth.currentUser.uid : null;
        // 익명→실계정 전환 시 서버 migrate race condition 대비: 언어/온보딩 필드 미리 읽기
        const anonFields = prevAnonUid ? await readAnonProfileFields(prevAnonUid) : {};
        try {
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
                const idToken = result.credential?.idToken;
                if (!idToken) throw new Error('No idToken');
                const credential = FirebaseGoogleAuthProvider.credential(idToken);
                const userCredential = await signInWithCredential(auth, credential);
                const user = userCredential.user;
                const additionalInfo = getAdditionalUserInfo(userCredential);
                const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
                if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
                const platform = 'app';
                const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                const profileData = { uid: user.uid, email: resolvedEmail, platform, deviceLang, updatedAt: serverTimestamp() };
                if (additionalInfo?.isNewUser) {
                    // 익명→신규 전환만 anonFields 이관 (재로그인=기존 계정은 Firestore 값 보호)
                    Object.assign(profileData, anonFields);
                    profileData.displayName = user.displayName || 'Google User';
                    profileData.createdAt = serverTimestamp();
                    profileData.hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true;
                }
                await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
                setIsLoading(false);
                return;
            }
            const userCredential = await signInWithPopup(auth, googleProvider);
            const user = userCredential.user;
            const additionalInfo = getAdditionalUserInfo(userCredential);
            const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
            if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
            const platform = 'web';
            const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
            const profileData = { uid: user.uid, email: resolvedEmail, platform, deviceLang, updatedAt: serverTimestamp() };
            if (additionalInfo?.isNewUser) {
                // 익명→신규 전환만 anonFields 이관 (재로그인=기존 계정은 Firestore 값 보호)
                Object.assign(profileData, anonFields);
                profileData.displayName = user.displayName || 'Google User';
                profileData.createdAt = serverTimestamp();
                profileData.hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true;
            }
            await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
        } catch (err) {
            console.error(err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(`${t('auth.googleFailed')}: ${err.code || err.message || JSON.stringify(err)}`);
            }
            setIsLoading(false);
        }
    };

    const handleFacebookLogin = async () => {
        setIsLoading(true);
        setError('');
        const isNative = window.Capacitor?.isNativePlatform?.();
        if (!isNative && detectInAppBrowser()) {
            setError('inapp');
            setIsLoading(false);
            return;
        }
        const prevAnonUid = auth.currentUser?.isAnonymous ? auth.currentUser.uid : null;
        // 익명→실계정 전환 시 서버 migrate race condition 대비: 언어/온보딩 필드 미리 읽기
        const anonFields = prevAnonUid ? await readAnonProfileFields(prevAnonUid) : {};
        try {
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithFacebook();
                const accessToken = result.credential?.accessToken;
                if (!accessToken) throw new Error('No accessToken');
                const credential = FirebaseFacebookAuthProvider.credential(accessToken);
                const userCredential = await signInWithCredential(auth, credential);
                const user = userCredential.user;
                const additionalInfo = getAdditionalUserInfo(userCredential);
                const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
                if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
                const platform = 'app';
                const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                const profileData = { uid: user.uid, email: resolvedEmail, platform, deviceLang, updatedAt: serverTimestamp() };
                if (additionalInfo?.isNewUser) {
                    // 익명→신규 전환만 anonFields 이관 (재로그인=기존 계정은 Firestore 값 보호)
                    Object.assign(profileData, anonFields);
                    profileData.displayName = user.displayName || 'Facebook User';
                    profileData.createdAt = serverTimestamp();
                    profileData.hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true;
                }
                await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
                setIsLoading(false);
                return;
            }
            const userCredential = await signInWithPopup(auth, facebookProvider);
            const user = userCredential.user;
            const additionalInfo = getAdditionalUserInfo(userCredential);
            const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
            if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
            const platform = 'web';
            const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
            const profileData = { uid: user.uid, email: resolvedEmail, platform, deviceLang, updatedAt: serverTimestamp() };
            if (additionalInfo?.isNewUser) {
                // 익명→신규 전환만 anonFields 이관 (재로그인=기존 계정은 Firestore 값 보호)
                Object.assign(profileData, anonFields);
                profileData.displayName = user.displayName || 'Facebook User';
                profileData.createdAt = serverTimestamp();
                profileData.hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true;
            }
            await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
        } catch (err) {
            console.error(err);
            if (err.code === 'auth/account-exists-with-different-credential') {
                setError(t('auth.accountExistsDifferent'));
            } else if (err.code !== 'auth/popup-closed-by-user') {
                setError(`${t('auth.facebookFailed')}: ${err.code || err.message || JSON.stringify(err)}`);
            }
            setIsLoading(false);
        }
    };

    const handleAppleLogin = async () => {
        setIsLoading(true);
        setError('');
        const prevAnonUid = auth.currentUser?.isAnonymous ? auth.currentUser.uid : null;
        // 익명→실계정 전환 시 서버 migrate race condition 대비: 언어/온보딩 필드 미리 읽기
        const anonFields = prevAnonUid ? await readAnonProfileFields(prevAnonUid) : {};
        try {
            const isNative = window.Capacitor?.isNativePlatform?.();
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithApple();
                const idToken = result.credential?.idToken;
                const rawNonce = result.credential?.nonce;
                if (!idToken) throw new Error('No idToken');
                const credential = new OAuthProvider('apple.com').credential({ idToken, rawNonce });
                const userCredential = await signInWithCredential(auth, credential);
                const user = userCredential.user;
                const additionalInfo = getAdditionalUserInfo(userCredential);
                const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
                if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
                const platform = 'app';
                const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                const profileData = { uid: user.uid, email: resolvedEmail, platform, deviceLang, updatedAt: serverTimestamp() };
                if (additionalInfo?.isNewUser) {
                    // 익명→신규 전환만 anonFields 이관 (재로그인=기존 계정은 Firestore 값 보호)
                    Object.assign(profileData, anonFields);
                    profileData.displayName = user.displayName || 'Apple User';
                    profileData.createdAt = serverTimestamp();
                    profileData.hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true;
                }
                await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
                setIsLoading(false);
                return;
            }
            const userCredential = await signInWithPopup(auth, appleProvider);
            const user = userCredential.user;
            const additionalInfo = getAdditionalUserInfo(userCredential);
            const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
            if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
            const platform = 'web';
            const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
            const profileData = { uid: user.uid, email: resolvedEmail, platform, deviceLang, updatedAt: serverTimestamp() };
            if (additionalInfo?.isNewUser) {
                // 익명→신규 전환만 anonFields 이관 (재로그인=기존 계정은 Firestore 값 보호)
                Object.assign(profileData, anonFields);
                profileData.displayName = user.displayName || 'Apple User';
                profileData.createdAt = serverTimestamp();
                profileData.hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true;
            }
            await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
        } catch (err) {
            console.error(err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(`${t('auth.appleFailed')}: ${err.code || err.message || JSON.stringify(err)}`);
            }
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="auth-container">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '3rem' }}>
                    <div style={{ width: '36px', height: '36px', border: '4px solid #e2e8f0', borderTop: '4px solid #00a884', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>{t('auth.loadingLogin')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-container">
            <div className="auth-card" style={{ padding: '24px 20px 20px', gap: 0 }}>
                {/* 닫기 버튼 */}
                {onCancel && (
                    <button onClick={onCancel} style={{
                        position: 'absolute', top: '14px', right: '14px',
                        background: 'none', border: 'none', fontSize: '1.4rem',
                        cursor: 'pointer', color: '#94a3b8', lineHeight: 1,
                    }} aria-label="close">×</button>
                )}

                {/* 타이틀 */}
                <h2 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 4px' }}>
                    {t('auth.welcomeBack')}
                </h2>
                <p style={{ textAlign: 'center', fontSize: '0.82rem', color: '#94a3b8', margin: '0 0 18px' }}>
                    {t('auth.loginSubtitle')}
                </p>

                {/* 에러 */}
                {error === 'inapp' ? (
                    <div className="auth-inapp-warning" style={{ marginBottom: '12px' }}>
                        <Smartphone size={20} />
                        <div>
                            <strong>{t('auth.inappTitle')}</strong>
                            <p>{t('auth.inappDesc')}</p>
                        </div>
                    </div>
                ) : error && (
                    <div className="auth-error" style={{ marginBottom: '12px' }}>
                        <AlertCircle size={16} />
                        <span style={{ fontSize: '0.82rem' }}>{error}</span>
                    </div>
                )}

                {/* ── 상단: 구글 로그인 (메인) ── */}
                <button className="google-btn" onClick={handleGoogleLogin} disabled={isLoading}
                    style={{ width: '100%', padding: '13px', fontSize: '1rem', fontWeight: 700, marginBottom: '0' }}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
                    {t('auth.googleLogin')}
                </button>

                <button className="facebook-btn" onClick={handleFacebookLogin} disabled={isLoading}
                    style={{ width: '100%', padding: '13px', fontSize: '1rem', fontWeight: 700, marginTop: '8px', marginBottom: '0',
                        background: '#fff', color: '#1e293b', border: '1.5px solid #e2e8f0', borderRadius: '12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    {t('auth.facebookLogin')}
                </button>

                <button onClick={handleAppleLogin} disabled={isLoading}
                    style={{ width: '100%', padding: '13px', fontSize: '1rem', fontWeight: 700, marginTop: '8px', marginBottom: '0',
                        background: '#000', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                    {t('auth.appleLogin')}
                </button>

                {/* 구분선 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '16px 0 14px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
                    <span style={{ fontSize: '0.75rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                        {t('auth.or')} {t('auth.email')}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
                </div>

                {/* ── 하단: 이메일/비번 (보조) ── */}
                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                        <Mail size={16} className="input-icon" />
                        <input
                            type="email"
                            placeholder={t('auth.emailPlaceholder')}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            style={{ fontSize: '0.88rem', padding: '10px 10px 10px 36px' }}
                        />
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                        <Lock size={16} className="input-icon" />
                        <input
                            type="password"
                            placeholder={t('auth.passwordPlaceholder')}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            style={{ fontSize: '0.88rem', padding: '10px 10px 10px 36px' }}
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <span onClick={handleForgotPassword}
                            style={{ fontSize: '0.76rem', color: '#6366f1', cursor: 'pointer', fontWeight: '600' }}>
                            {t('auth.forgotPassword')}
                        </span>
                    </div>

                    {resetSent && (
                        <div style={{
                            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
                            padding: '8px 12px', fontSize: '0.78rem', color: '#166534',
                        }}>
                            ✅ {t('auth.forgotSent')}
                        </div>
                    )}

                    <button type="submit" disabled={isLoading} style={{
                        padding: '10px', borderRadius: '12px', border: '1px solid #cbd5e1',
                        background: '#f8fafc', color: '#475569', fontWeight: 600,
                        fontSize: '0.88rem', cursor: 'pointer', marginTop: '2px',
                    }}>
                        {isLoading ? t('auth.processing') : t('auth.login')}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default Login;
