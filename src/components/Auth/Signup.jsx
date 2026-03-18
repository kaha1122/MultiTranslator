import React, { useState } from 'react';
import { auth, db, googleProvider } from '../../firebase/config';
import { createUserWithEmailAndPassword, signInWithPopup, signInWithCredential, GoogleAuthProvider as FirebaseGoogleAuthProvider, getAdditionalUserInfo } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserPlus, Mail, Lock, AlertCircle, User, Phone, Smartphone } from 'lucide-react';
import { getT } from '../../utils/i18n';
import { COUNTRY_PHONES, formatPhoneByCountry, getCountryByLang } from '../../utils/phoneFormat';
import './Auth.css';

const detectInAppBrowser = () => {
    const ua = navigator.userAgent || '';
    const isKnownApp = /KAKAOTALK|KAKAO|Instagram|NAVER|NaverApp|Line\/|FBAN|FBAV|Twitter|Snapchat/i.test(ua);
    const isAndroidWebView = /Android/.test(ua) && /wv\)/.test(ua);
    const isIOSWebView = /iPhone|iPad/.test(ua) && !/Safari/.test(ua);
    return isKnownApp || isAndroidWebView || isIOSWebView;
};

function Signup({ onSwitchToLogin, sourceLang }) {
    const t = (key) => getT(sourceLang, key);
    const [email, setEmail] = useState('');
    const [nickname, setNickname] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [phone, setPhone] = useState('');
    const [phoneCountry, setPhoneCountry] = useState(getCountryByLang(sourceLang));
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const selectedCountry = COUNTRY_PHONES.find(c => c.code === phoneCountry) || COUNTRY_PHONES[0];

    const handleSignup = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            return setError(t('auth.passwordMismatch'));
        }
        setIsLoading(true);
        setError('');
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            const rawDigits = phone.replace(/\D/g, '');
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: email,
                displayName: nickname,
                phoneNumber: rawDigits ? `${selectedCountry.dial}${rawDigits}` : '',
                phoneCountry: phoneCountry,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        } catch (err) {
            console.error(err);
            if (err.code === 'auth/email-already-in-use') {
                setError(t('auth.emailInUse'));
            } else {
                setError(`${t('auth.signupFailed')}: ${err.code}`);
            }
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
                const result = await FirebaseAuthentication.signInWithGoogle();
                const idToken = result.credential?.idToken;
                if (!idToken) throw new Error('No idToken');
                const credential = FirebaseGoogleAuthProvider.credential(idToken);
                const userCredential = await signInWithCredential(auth, credential);
                const user = userCredential.user;
                const additionalInfo = getAdditionalUserInfo(userCredential);
                const profileData = { uid: user.uid, email: user.email, updatedAt: serverTimestamp() };
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
            const profileData = { uid: user.uid, email: user.email, updatedAt: serverTimestamp() };
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
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-icon-circle signup-icon">
                        <UserPlus size={24} color="white" />
                    </div>
                    <h2>{t('auth.createAccount')}</h2>
                    <p>{t('auth.createSubtitle')}</p>
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

                <form onSubmit={handleSignup} className="auth-form">
                    <div className="input-wrapper">
                        <label className="input-label">{t('auth.nickname')} <span className="required-star">*</span></label>
                        <div className="input-group">
                            <User size={18} className="input-icon" />
                            <input
                                type="text"
                                placeholder={t('auth.nicknamePlaceholder')}
                                value={nickname}
                                onChange={(e) => setNickname(e.target.value)}
                                required
                            />
                        </div>
                    </div>

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
                        <label className="input-label">{t('auth.phone')}</label>
                        <div className="input-group" style={{ gap: 0 }}>
                            <Phone size={18} className="input-icon" />
                            <select
                                value={phoneCountry}
                                onChange={(e) => { setPhoneCountry(e.target.value); setPhone(''); }}
                                className="phone-country-select"
                            >
                                {COUNTRY_PHONES.map(c => (
                                    <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>
                                ))}
                            </select>
                            <input
                                type="tel"
                                placeholder={t('auth.phonePlaceholder')}
                                value={phone}
                                onChange={(e) => setPhone(formatPhoneByCountry(e.target.value, phoneCountry))}
                                style={{ flex: 1 }}
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

                    <div className="input-wrapper">
                        <label className="input-label">{t('auth.confirmPassword')} <span className="required-star">*</span></label>
                        <div className="input-group">
                            <Lock size={18} className="input-icon" />
                            <input
                                type="password"
                                placeholder={t('auth.confirmPlaceholder')}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="auth-submit-btn" disabled={isLoading} style={{ marginTop: '10px' }}>
                        {isLoading ? t('auth.processing') : t('auth.signup')}
                    </button>
                </form>

                <div className="auth-divider">{t('auth.or')}</div>

                <button className="google-btn" onClick={handleGoogleLogin} disabled={isLoading}>
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
                    {t('auth.googleSignup')}
                </button>

                <div className="auth-footer">
                    <p>{t('auth.hasAccount')} <span onClick={onSwitchToLogin}>{t('auth.login')}</span></p>
                </div>
            </div>
        </div>
    );
}

export default Signup;
