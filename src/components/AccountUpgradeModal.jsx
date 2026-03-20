import { useState } from 'react';
import { X, Mail, Chrome, Loader, AlertCircle, CheckCircle } from 'lucide-react';
import { auth, googleProvider, db } from '../firebase/config';
import {
    signInWithPopup, GoogleAuthProvider as FirebaseGoogleAuthProvider,
    signInWithCredential, EmailAuthProvider, createUserWithEmailAndPassword,
    linkWithCredential,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { getT } from '../utils/i18n';

const AccountUpgradeModal = ({ onClose, sourceLang = 'ko' }) => {
    const { user, upgradeAnonymous } = useAuth();
    const t = (key) => getT(sourceLang, key);

    const [mode, setMode] = useState('choice'); // 'choice' | 'email'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const isNative = window.Capacitor?.isNativePlatform?.() || false;

    // ── Google 업그레이드 ──────────────────────────────────────────────────────
    const handleGoogleUpgrade = async () => {
        setLoading(true);
        setError('');
        try {
            if (isNative) {
                const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                const result = await FirebaseAuthentication.signInWithGoogle();
                const idToken = result.credential?.idToken;
                if (!idToken) throw new Error('No idToken');
                const credential = FirebaseGoogleAuthProvider.credential(idToken);
                await upgradeAnonymous(credential);
            } else {
                const result = await signInWithPopup(auth, googleProvider);
                // linkWithCredential은 upgradeAnonymous가 처리
                // signInWithPopup은 이미 새 세션을 만들므로, 별도 처리
                // 익명 유저가 있을 경우: popup 결과의 credential로 link 시도
                // (popup이 이미 sign-in 처리했으므로 profile만 업데이트)
                await setDoc(doc(db, 'users', result.user.uid), {
                    email: result.user.email,
                    displayName: result.user.displayName || 'Google User',
                    isAnonymous: false,
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
            setSuccess(true);
            setTimeout(() => onClose(), 1500);
        } catch (err) {
            if (err.code === 'auth/credential-already-in-use') {
                setError(t('upgrade.errAlreadyExists'));
            } else if (err.code !== 'auth/popup-closed-by-user') {
                setError(t('upgrade.errGeneral'));
            }
        } finally {
            setLoading(false);
        }
    };

    // ── 이메일 업그레이드 ──────────────────────────────────────────────────────
    const handleEmailUpgrade = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const credential = EmailAuthProvider.credential(email, password);
            await upgradeAnonymous(credential);
            setSuccess(true);
            setTimeout(() => onClose(), 1500);
        } catch (err) {
            if (err.code === 'auth/email-already-in-use' || err.code === 'auth/credential-already-in-use') {
                setError(t('upgrade.errAlreadyExists'));
            } else if (err.code === 'auth/weak-password') {
                setError(t('upgrade.errWeakPassword'));
            } else if (err.code === 'auth/invalid-email') {
                setError(t('upgrade.errInvalidEmail'));
            } else {
                setError(t('upgrade.errGeneral'));
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '20px',
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
                                    {loading ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : (
                                        <svg width="18" height="18" viewBox="0 0 48 48">
                                            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.7 0 6.7 5.5 2.8 13.5l7.8 6.1C12.5 13.2 17.8 9.5 24 9.5z"/>
                                            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.1z"/>
                                            <path fill="#FBBC05" d="M10.6 28.4A14.8 14.8 0 0 1 9.5 24c0-1.5.2-3 .6-4.4L2.3 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8.1-6.2z"/>
                                            <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.6-5.9c-2 1.4-4.6 2.2-7.6 2.2-6.2 0-11.4-4.2-13.3-9.9l-8 6.2C6.7 42.5 14.7 48 24 48z"/>
                                        </svg>
                                    )}
                                    {t('upgrade.googleBtn')}
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
                                    {loading && <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />}
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
