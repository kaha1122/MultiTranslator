import React, { useState } from 'react';
import { auth, db, googleProvider } from '../../firebase/config';
import { signInWithEmailAndPassword, signInWithPopup, signInWithCredential, GoogleAuthProvider as FirebaseGoogleAuthProvider, getAdditionalUserInfo, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Mail, Lock, AlertCircle, Smartphone } from 'lucide-react';
import { getT } from '../../utils/i18n';
import './Auth.css';

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
        try {
            await signInWithEmailAndPassword(auth, email, password);
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
                const platform = 'app';
                const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                const profileData = { uid: user.uid, email: user.email, platform, deviceLang, updatedAt: serverTimestamp() };
                if (additionalInfo?.isNewUser) {
                    profileData.displayName = user.displayName || 'Google User';
                    profileData.hasCompletedOnboarding = false;
                    profileData.createdAt = serverTimestamp();
                }
                await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
                setIsLoading(false);
                return;
            }
            const userCredential = await signInWithPopup(auth, googleProvider);
            const user = userCredential.user;
            const additionalInfo = getAdditionalUserInfo(userCredential);
            const platform = 'web';
            const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
            const profileData = { uid: user.uid, email: user.email, platform, deviceLang, updatedAt: serverTimestamp() };
            if (additionalInfo?.isNewUser) {
                profileData.displayName = user.displayName || 'Google User';
                profileData.hasCompletedOnboarding = false;
                profileData.createdAt = serverTimestamp();
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
