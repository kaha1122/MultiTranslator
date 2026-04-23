import React, { useState } from 'react';
import { auth, db, googleProvider, facebookProvider, appleProvider } from '../../firebase/config';
import { createUserWithEmailAndPassword, signInWithPopup, signInWithCredential, GoogleAuthProvider as FirebaseGoogleAuthProvider, FacebookAuthProvider as FirebaseFacebookAuthProvider, OAuthProvider, getAdditionalUserInfo } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserPlus, Mail, Lock, AlertCircle, User, Phone, Smartphone } from 'lucide-react';
import { getT } from '../../utils/i18n';
import { COUNTRY_PHONES, formatPhoneByCountry, getCountryByLang } from '../../utils/phoneFormat';
import { readAnonProfileFields } from '../../utils/anonProfileMigrate';
import './Auth.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Facebook 로그인 버튼 노출 여부 — Meta App Review 승인 + APronunFit 전환 완료 시까지 숨김
const SHOW_FACEBOOK_LOGIN = false;

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
        if (data.success) console.log('[Signup Migrate] success:', data.migrated);
    } catch (e) {
        console.warn('[Signup Migrate] failed (non-blocking):', e.message);
    }
};

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
        const prevAnonUid = auth.currentUser?.isAnonymous ? auth.currentUser.uid : null;
        // 익명→실계정 전환 시 서버 migrate race condition 대비: 언어/온보딩 필드 미리 읽기
        const anonFields = prevAnonUid ? await readAnonProfileFields(prevAnonUid) : {};
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            if (prevAnonUid) await migrateAnonymousData(prevAnonUid, user);
            const rawDigits = phone.replace(/\D/g, '');
            await setDoc(doc(db, 'users', user.uid), {
                ...anonFields,
                uid: user.uid,
                email: email,
                displayName: nickname,
                phoneNumber: rawDigits ? `${selectedCountry.dial}${rawDigits}` : '',
                phoneCountry: phoneCountry,
                hasCompletedOnboarding: anonFields.hasCompletedOnboarding === true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });
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
            if (!resolvedEmail) {
                await auth.signOut();
                setError(t('auth.noEmailError'));
                setIsLoading(false);
                return;
            }
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
                setError(`${t('auth.googleFailed')}: ${err.code}`);
            }
        } finally {
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
            if (!resolvedEmail) {
                await auth.signOut();
                setError(t('auth.noEmailError'));
                setIsLoading(false);
                return;
            }
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
                setError(`${t('auth.facebookFailed')}: ${err.code}`);
            }
        } finally {
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
            if (!resolvedEmail) {
                await auth.signOut();
                setError(t('auth.noEmailError'));
                setIsLoading(false);
                return;
            }
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
                profileData.createdAt = serverTimestamp();
            }
            await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
        } catch (err) {
            console.error(err);
            if (err.code !== 'auth/popup-closed-by-user') {
                setError(`${t('auth.appleFailed')}: ${err.code || err.message || JSON.stringify(err)}`);
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

                <button onClick={handleAppleLogin} disabled={isLoading}
                    style={{ width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 700, marginTop: '8px',
                        background: '#fff', color: '#1e293b', border: '1.5px solid #e2e8f0', borderRadius: '12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#000"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                    {t('auth.appleSignup')}
                </button>

                {SHOW_FACEBOOK_LOGIN && (
                <button className="facebook-btn" onClick={handleFacebookLogin} disabled={isLoading}
                    style={{ width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 700, marginTop: '8px',
                        background: '#fff', color: '#1e293b', border: '1.5px solid #e2e8f0', borderRadius: '12px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    {t('auth.facebookSignup')}
                </button>
                )}

                <div className="auth-footer">
                    <p>{t('auth.hasAccount')} <span onClick={onSwitchToLogin}>{t('auth.login')}</span></p>
                </div>
            </div>
        </div>
    );
}

export default Signup;
