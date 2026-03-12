import React, { useState } from 'react';
import { auth, db, googleProvider } from '../../firebase/config';
import { signInWithEmailAndPassword, signInWithPopup, getAdditionalUserInfo, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { LogIn, Mail, Lock, AlertCircle, Smartphone } from 'lucide-react';
import { getT } from '../../utils/i18n';
import './Auth.css';

const detectInAppBrowser = () => {
    const ua = navigator.userAgent || '';
    const isKnownApp = /KAKAOTALK|KAKAO|Instagram|NAVER|NaverApp|Line\/|FBAN|FBAV|Twitter|Snapchat/i.test(ua);
    const isAndroidWebView = /Android/.test(ua) && /wv\)/.test(ua);
    const isIOSWebView = /iPhone|iPad/.test(ua) && !/Safari/.test(ua);
    return isKnownApp || isAndroidWebView || isIOSWebView;
};

function Login({ onSwitchToSignup, sourceLang }) {
    const t = (key) => getT(sourceLang, key);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    const handleForgotPassword = async () => {
        if (!email.trim()) {
            setError(t('auth.forgotEmailFirst'));
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            setResetSent(true);
            setError('');
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                setError(t('auth.forgotNotFound'));
            } else {
                setError(`${t('auth.forgotFail')}: ${err.code}`);
            }
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
        if (detectInAppBrowser()) {
            setError('inapp');
            setIsLoading(false);
            return;
        }
        try {
            const userCredential = await signInWithPopup(auth, googleProvider);
            const user = userCredential.user;
            const additionalInfo = getAdditionalUserInfo(userCredential);
            const profileData = { uid: user.uid, email: user.email, membership: 'Free', updatedAt: serverTimestamp() };
            if (additionalInfo && additionalInfo.isNewUser) {
                profileData.displayName = user.displayName || 'Google User';
                profileData.hasCompletedOnboarding = false;
                profileData.createdAt = serverTimestamp();
            }
            await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
        } catch (err) {
            console.error(err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(`${t('auth.googleFailed')}: ${err.code}`);
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
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-icon-circle">
                        <LogIn size={24} color="white" />
                    </div>
                    <h2>{t('auth.welcomeBack')}</h2>
                    <p>{t('auth.loginSubtitle')}</p>
                </div>

                {error === 'inapp' ? (
                    <div className="auth-inapp-warning">
                        <Smartphone size={20} />
                        <div>
                            <strong>{t('auth.inappTitle')}</strong>
                            <p>{t('auth.inappDesc')}</p>
                        </div>
                    </div>
                ) : error && (
                    <div className="auth-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handleLogin} className="auth-form">
                    <div className="input-wrapper">
                        <label className="input-label">{t('auth.email')} <span className="required-star">*</span></label>
                        <div className="input-group">
                            <Mail size={18} className="input-icon" />
                            <input
                                type="email"
                                placeholder={t('auth.emailPlaceholder')}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="input-wrapper">
                        <label className="input-label">{t('auth.password')} <span className="required-star">*</span></label>
                        <div className="input-group">
                            <Lock size={18} className="input-icon" />
                            <input
                                type="password"
                                placeholder={t('auth.passwordPlaceholder')}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div style={{ textAlign: 'right', marginTop: '2px' }}>
                        <span
                            onClick={handleForgotPassword}
                            style={{ fontSize: '0.8rem', color: '#6366f1', cursor: 'pointer', fontWeight: '600' }}
                        >
                            {t('auth.forgotPassword')}
                        </span>
                    </div>

                    {resetSent && (
                        <div style={{
                            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px',
                            padding: '10px 14px', fontSize: '0.82rem', color: '#166534', fontWeight: '500'
                        }}>
                            ✅ {t('auth.forgotSent')}
                        </div>
                    )}

                    <button type="submit" className="auth-submit-btn" disabled={isLoading} style={{ marginTop: '6px' }}>
                        {isLoading ? t('auth.processing') : t('auth.login')}
                    </button>
                </form>

                <div className="auth-divider">{t('auth.or')}</div>

                <button className="google-btn" onClick={handleGoogleLogin} disabled={isLoading}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
                    {t('auth.googleLogin')}
                </button>

                <div className="auth-footer">
                    <p>{t('auth.noAccount')} <span onClick={onSwitchToSignup}>{t('auth.signup')}</span></p>
                </div>
            </div>
        </div>
    );
}

export default Login;
