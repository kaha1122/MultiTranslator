import { useState } from 'react';
import { X, Mail, Chrome, Loader, AlertCircle, CheckCircle } from 'lucide-react';
import { auth, googleProvider, facebookProvider, appleProvider, db } from '../firebase/config';
import {
    linkWithPopup, GoogleAuthProvider as FirebaseGoogleAuthProvider,
    FacebookAuthProvider as FirebaseFacebookAuthProvider,
    OAuthProvider, signInWithCredential, EmailAuthProvider, createUserWithEmailAndPassword,
    linkWithCredential,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { getT } from '../utils/i18n';
import { authFetch } from '../utils/authFetch';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const AccountUpgradeModal = ({ onClose, onSuccess, fromSubscription, sourceLang = 'ko' }) => {
    const handleComplete = onSuccess || onClose; // 계정 생성 성공 시 콜백
    const { user, profile, upgradeAnonymous } = useAuth();
    const t = (key) => getT(sourceLang, key);

    const [mode, setMode] = useState('choice'); // 'choice' | 'email'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loadingType, setLoadingType] = useState(null); // 'google' | 'facebook' | 'email' | null
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const isNative = window.Capacitor?.isNativePlatform?.() || false;

    // ── 재방문 유저: 기존 계정으로 로그인 + 익명 데이터 마이그레이션 ──────────
    const migrateAndSignIn = async (credential) => {
        const anonymousUid = auth.currentUser?.uid;
        // 기존 계정으로 로그인
        const result = await signInWithCredential(auth, credential);
        // 서버에 마이그레이션 요청
        if (anonymousUid && anonymousUid !== result.user.uid) {
            try {
                const token = await result.user.getIdToken();
                const resp = await fetch(`${API_URL}/api/migrate-anonymous`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ anonymousUid }),
                });
                const data = await resp.json();
                if (data.success) {
                    console.log('[Migrate] success:', data.migrated);
                }
            } catch (e) {
                console.warn('[Migrate] failed (non-blocking):', e.message);
            }
        }
        // Firestore 프로필 업데이트
        await setDoc(doc(db, 'users', result.user.uid), {
            email: result.user.email,
            displayName: profile?.displayName || result.user.displayName || 'User',
            isAnonymous: false,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    };

    // ── Google 업그레이드 ──────────────────────────────────────────────────────
    const handleGoogleUpgrade = async () => {
        setLoadingType('google');
        setError('');
        try {
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
                const idToken = result.credential?.idToken;
                if (!idToken) throw new Error('No idToken');
                const credential = FirebaseGoogleAuthProvider.credential(idToken);
                try {
                    await upgradeAnonymous(credential);
                } catch (linkErr) {
                    if (linkErr.code === 'auth/credential-already-in-use') {
                        await migrateAndSignIn(credential);
                    } else {
                        throw linkErr;
                    }
                }
            } else {
                try {
                    const result = await linkWithPopup(auth.currentUser, googleProvider);
                    await setDoc(doc(db, 'users', result.user.uid), {
                        email: result.user.email,
                        displayName: profile?.displayName || result.user.displayName || 'Google User',
                        isAnonymous: false,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                } catch (linkErr) {
                    if (linkErr.code === 'auth/credential-already-in-use') {
                        const credential = FirebaseGoogleAuthProvider.credentialFromError(linkErr)
                            || GoogleAuthProvider.credentialFromError(linkErr);
                        if (credential) {
                            await migrateAndSignIn(credential);
                        } else {
                            throw linkErr;
                        }
                    } else {
                        throw linkErr;
                    }
                }
            }
            setSuccess(true);
            setTimeout(() => handleComplete(), 1500);
        } catch (err) {
            if (err.code === 'auth/credential-already-in-use') {
                setError(t('upgrade.errAlreadyExists'));
            } else if (err.code !== 'auth/popup-closed-by-user') {
                setError(t('upgrade.errGeneral'));
            }
        } finally {
            setLoadingType(null);
        }
    };

    // ── Facebook 업그레이드 ─────────────────────────────────────────────────────
    const handleFacebookUpgrade = async () => {
        setLoadingType('facebook');
        setError('');
        try {
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithFacebook();
                const accessToken = result.credential?.accessToken;
                if (!accessToken) throw new Error('No accessToken');
                const credential = FirebaseFacebookAuthProvider.credential(accessToken);
                try {
                    await upgradeAnonymous(credential);
                } catch (linkErr) {
                    if (linkErr.code === 'auth/credential-already-in-use' || linkErr.code === 'auth/account-exists-with-different-credential') {
                        await migrateAndSignIn(credential);
                    } else {
                        throw linkErr;
                    }
                }
            } else {
                try {
                    const result = await linkWithPopup(auth.currentUser, facebookProvider);
                    await setDoc(doc(db, 'users', result.user.uid), {
                        email: result.user.email,
                        displayName: profile?.displayName || result.user.displayName || 'Facebook User',
                        isAnonymous: false,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                } catch (linkErr) {
                    if (linkErr.code === 'auth/credential-already-in-use' || linkErr.code === 'auth/account-exists-with-different-credential') {
                        const credential = FirebaseFacebookAuthProvider.credentialFromError(linkErr);
                        if (credential) {
                            await migrateAndSignIn(credential);
                        } else {
                            throw linkErr;
                        }
                    } else {
                        throw linkErr;
                    }
                }
            }
            setSuccess(true);
            setTimeout(() => handleComplete(), 1500);
        } catch (err) {
            if (err.code === 'auth/credential-already-in-use' || err.code === 'auth/account-exists-with-different-credential') {
                setError(t('upgrade.errAlreadyExists'));
            } else if (err.code !== 'auth/popup-closed-by-user') {
                setError(t('upgrade.errGeneral'));
            }
        } finally {
            setLoadingType(null);
        }
    };

    // ── Apple 업그레이드 ──────────────────────────────────────────────────────
    const handleAppleUpgrade = async () => {
        setLoadingType('apple');
        setError('');
        try {
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithApple();
                const idToken = result.credential?.idToken;
                const rawNonce = result.credential?.nonce;
                if (!idToken) throw new Error('No idToken');
                const credential = new OAuthProvider('apple.com').credential({ idToken, rawNonce });
                try {
                    await upgradeAnonymous(credential);
                } catch (linkErr) {
                    if (linkErr.code === 'auth/credential-already-in-use') {
                        await migrateAndSignIn(credential);
                    } else {
                        throw linkErr;
                    }
                }
            } else {
                try {
                    const result = await linkWithPopup(auth.currentUser, appleProvider);
                    await setDoc(doc(db, 'users', result.user.uid), {
                        email: result.user.email,
                        displayName: profile?.displayName || result.user.displayName || 'Apple User',
                        isAnonymous: false,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                } catch (linkErr) {
                    if (linkErr.code === 'auth/credential-already-in-use') {
                        const credential = OAuthProvider.credentialFromError(linkErr);
                        if (credential) {
                            await migrateAndSignIn(credential);
                        } else {
                            throw linkErr;
                        }
                    } else {
                        throw linkErr;
                    }
                }
            }
            setSuccess(true);
            setTimeout(() => handleComplete(), 1500);
        } catch (err) {
            if (err.code === 'auth/credential-already-in-use') {
                setError(t('upgrade.errAlreadyExists'));
            } else if (err.code !== 'auth/popup-closed-by-user') {
                setError(t('upgrade.errGeneral'));
            }
        } finally {
            setLoadingType(null);
        }
    };

    // ── 이메일 업그레이드 ──────────────────────────────────────────────────────
    const handleEmailUpgrade = async (e) => {
        e.preventDefault();
        setLoadingType('email');
        setError('');
        try {
            const credential = EmailAuthProvider.credential(email, password);
            try {
                await upgradeAnonymous(credential);
            } catch (linkErr) {
                if (linkErr.code === 'auth/email-already-in-use' || linkErr.code === 'auth/credential-already-in-use') {
                    // 기존 이메일 계정이 존재 → 입력된 비밀번호로 로그인 시도 후 마이그레이션
                    await migrateAndSignIn(credential);
                } else {
                    throw linkErr;
                }
            }
            setSuccess(true);
            setTimeout(() => handleComplete(), 1500);
        } catch (err) {
            if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
                setError(t('upgrade.errWrongPassword'));
            } else if (err.code === 'auth/weak-password') {
                setError(t('upgrade.errWeakPassword'));
            } else if (err.code === 'auth/invalid-email') {
                setError(t('upgrade.errInvalidEmail'));
            } else {
                setError(t('upgrade.errGeneral'));
            }
        } finally {
            setLoadingType(null);
        }
    };

    const loading = !!loadingType; // 하위 호환: disabled 체크용

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '20px 20px calc(20px + max(env(safe-area-inset-bottom, 0px), var(--admob-bottom, 0px)))',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{
                background: '#fff', borderRadius: '20px',
                width: '100%', maxWidth: '380px',
                padding: '28px 24px', position: 'relative',
                boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}>
                <button onClick={onClose} style={{
                    position: 'absolute', top: '16px', right: '16px',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8',
                }}>
                    <X size={20} />
                </button>

                {success ? (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <CheckCircle size={48} color="#059669" style={{ marginBottom: '12px' }} />
                        <p style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1e293b' }}>
                            {t('upgrade.successTitle')}
                        </p>
                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '6px' }}>
                            {t('upgrade.successBody')}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* 헤더 */}
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔓</div>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                                {t('upgrade.title')}
                            </h2>
                            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '6px 0 0' }}>
                                {t('upgrade.subtitle')}
                            </p>
                        </div>

                        {/* 구독 시도 → 계정 먼저 만들기 안내 */}
                        {fromSubscription && (
                            <div style={{
                                background: '#eff6ff', border: '1.5px solid #60a5fa', borderRadius: '12px',
                                padding: '12px 14px', marginBottom: '14px',
                                fontSize: '0.82rem', color: '#1e40af', fontWeight: 600, textAlign: 'center',
                            }}>
                                {t('upgrade.accountRequiredForSubscription')}
                            </div>
                        )}

                        {/* 혜택 안내 */}
                        <div style={{
                            background: '#f0fdf4', borderRadius: '12px',
                            padding: '12px 14px', marginBottom: '20px',
                            fontSize: '0.82rem', color: '#166534', lineHeight: 1.7,
                        }}>
                            ✅ {t('upgrade.benefit1')}<br />
                            ✅ {t('upgrade.benefit2')}<br />
                            ✅ {t('upgrade.benefit3')}
                        </div>

                        {error && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                background: '#fef2f2', borderRadius: '10px',
                                padding: '10px 12px', marginBottom: '16px',
                                color: '#dc2626', fontSize: '0.82rem',
                            }}>
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        {mode === 'choice' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {/* Google */}
                                <button
                                    onClick={handleGoogleUpgrade}
                                    disabled={loading}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        padding: '13px', borderRadius: '12px',
                                        border: '2px solid #e2e8f0', background: '#fff',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, fontSize: '0.95rem', color: '#1e293b',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {loadingType === 'google' ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : (
                                        <svg width="18" height="18" viewBox="0 0 48 48">
                                            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.7 0 6.7 5.5 2.8 13.5l7.8 6.1C12.5 13.2 17.8 9.5 24 9.5z"/>
                                            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.1z"/>
                                            <path fill="#FBBC05" d="M10.6 28.4A14.8 14.8 0 0 1 9.5 24c0-1.5.2-3 .6-4.4L2.3 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8.1-6.2z"/>
                                            <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.6-5.9c-2 1.4-4.6 2.2-7.6 2.2-6.2 0-11.4-4.2-13.3-9.9l-8 6.2C6.7 42.5 14.7 48 24 48z"/>
                                        </svg>
                                    )}
                                    {t('upgrade.googleBtn')}
                                </button>

                                {/* Facebook */}
                                <button
                                    onClick={handleFacebookUpgrade}
                                    disabled={loading}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        padding: '13px', borderRadius: '12px',
                                        border: '1.5px solid #e2e8f0', background: '#fff',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, fontSize: '0.95rem', color: '#1e293b',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {loadingType === 'facebook' ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : (
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                                    )}
                                    {t('upgrade.facebookBtn')}
                                </button>

                                {/* Apple */}
                                <button
                                    onClick={handleAppleUpgrade}
                                    disabled={loading}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        padding: '13px', borderRadius: '12px',
                                        border: 'none', background: '#000',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, fontSize: '0.95rem', color: '#fff',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {loadingType === 'apple' ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : (
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                                    )}
                                    {t('upgrade.appleBtn')}
                                </button>

                                {/* 이메일 */}
                                <button
                                    onClick={() => setMode('email')}
                                    disabled={loading}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                        padding: '13px', borderRadius: '12px',
                                        border: '2px solid #e2e8f0', background: '#f8fafc',
                                        cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', color: '#475569',
                                    }}
                                >
                                    <Mail size={18} />
                                    {t('upgrade.emailBtn')}
                                </button>
                            </div>
                        )}

                        {mode === 'email' && (
                            <form onSubmit={handleEmailUpgrade} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <input
                                    type="email"
                                    placeholder="Email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                    style={{
                                        padding: '12px 14px', borderRadius: '10px',
                                        border: '1.5px solid #e2e8f0', fontSize: '0.95rem',
                                        outline: 'none', width: '100%', boxSizing: 'border-box',
                                    }}
                                />
                                <input
                                    type="password"
                                    placeholder={t('upgrade.passwordPlaceholder')}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    style={{
                                        padding: '12px 14px', borderRadius: '10px',
                                        border: '1.5px solid #e2e8f0', fontSize: '0.95rem',
                                        outline: 'none', width: '100%', boxSizing: 'border-box',
                                    }}
                                />
                                <button
                                    type="submit"
                                    disabled={loading || !email || !password}
                                    style={{
                                        padding: '13px', borderRadius: '12px',
                                        background: loading ? '#94a3b8' : '#00a884',
                                        border: 'none', color: '#fff',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        fontWeight: 700, fontSize: '0.95rem',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                    }}
                                >
                                    {loadingType === 'email' && <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />}
                                    {t('upgrade.createBtn')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setMode('choice'); setError(''); }}
                                    style={{
                                        background: 'none', border: 'none', color: '#64748b',
                                        cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
                                    }}
                                >
                                    ← {t('upgrade.back')}
                                </button>
                            </form>
                        )}

                        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', marginTop: '16px' }}>
                            {t('upgrade.dataKept')}
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default AccountUpgradeModal;
