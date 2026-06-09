// 이메일 인증/변경 통합 모달
// 3가지 시나리오 처리:
//   1) 미인증 + 이메일 그대로 → sendEmailVerification (현재 이메일 인증)
//   2) 미인증/인증 + 이메일 변경 → verifyBeforeUpdateEmail (새 이메일로 변경+인증)
//   3) 이미 인증 + 이메일 그대로 → "이미 인증됨" 안내
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail } from 'lucide-react';
import { getAuth, sendEmailVerification, verifyBeforeUpdateEmail } from 'firebase/auth';
import { useT } from '../utils/i18n';

export default function EmailVerifyChangeModal({ open, onClose, currentEmail, isVerified, sourceLang }) {
    const t = useT(sourceLang);
    const [emailInput, setEmailInput] = useState(currentEmail || '');
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    // 모달 열릴 때마다 입력값 초기화
    useEffect(() => {
        if (open) {
            setEmailInput(currentEmail || '');
            setErrorMsg('');
            setSuccessMsg('');
        }
    }, [open, currentEmail]);

    if (!open) return null;

    const handleSubmit = async () => {
        const newEmail = emailInput.trim();
        setErrorMsg('');
        setSuccessMsg('');

        if (!newEmail || !newEmail.includes('@')) {
            setErrorMsg(t('upgrade.invalidEmail') || 'Invalid email');
            return;
        }

        const isSameEmail = newEmail.toLowerCase() === (currentEmail || '').toLowerCase();

        // 시나리오 3: 이미 인증 + 동일 이메일 → 안내 후 종료
        if (isSameEmail && isVerified) {
            setSuccessMsg(t('auth.emailVerifyChange.alreadyVerifiedSame'));
            return;
        }

        setSubmitting(true);
        try {
            const auth = getAuth();
            if (isSameEmail) {
                // 시나리오 1: 미인증 + 동일 이메일 → 현재 이메일 인증 메일
                await sendEmailVerification(auth.currentUser);
                setSuccessMsg(t('auth.emailVerifyChange.sentSame'));
            } else {
                // 시나리오 2: 이메일 변경 → 새 이메일로 인증+변경 메일
                await verifyBeforeUpdateEmail(auth.currentUser, newEmail);
                setSuccessMsg(t('auth.emailVerifyChange.sentNew'));
            }
        } catch (e) {
            if (e.code === 'auth/requires-recent-login') {
                setErrorMsg(t('auth.emailVerifyChange.requiresRecentLogin'));
            } else if (e.code === 'auth/email-already-in-use') {
                setErrorMsg(t('auth.emailInUse') || 'Email already in use');
            } else if (e.code === 'auth/too-many-requests') {
                setErrorMsg(t('upgrade.emailTooMany') || 'Too many requests');
            } else if (e.code === 'auth/invalid-email') {
                setErrorMsg(t('upgrade.invalidEmail') || 'Invalid email');
            } else {
                setErrorMsg(t('upgrade.emailSendFailed') || e.message || 'Send failed');
            }
        }
        setSubmitting(false);
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                    style={{
                        position: 'fixed', inset: 0, background: 'var(--modal-overlay-bg)',
                        zIndex: 'var(--z-modal)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '16px',
                    }}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--modal-card-bg)', borderRadius: 'var(--modal-radius)', padding: '20px',
                            maxWidth: '420px', width: '100%', maxHeight: '90vh', overflow: 'auto',
                            boxShadow: 'var(--modal-shadow)', position: 'relative',
                        }}
                    >
                        {/* 표준 닫기 X (우상단) */}
                        <button className="modal-close" onClick={onClose} aria-label="Close">
                            <X size={20} />
                        </button>

                        {/* 헤더 */}
                        <div style={{ marginBottom: '12px', paddingRight: '28px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1d4ed8' }}>
                                {t('auth.emailVerifyChange.title')}
                            </h3>
                        </div>

                        {/* 설명 */}
                        <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 14px', lineHeight: 1.5 }}>
                            {t('auth.emailVerifyChange.desc')}
                        </p>

                        {/* 이메일 입력 */}
                        <label style={{ display: 'block', fontSize: '0.78rem', color: '#475569', fontWeight: 600, marginBottom: '4px' }}>
                            {t('auth.emailVerifyChange.emailLabel')}
                        </label>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            border: '1px solid #cbd5e1', borderRadius: '10px',
                            padding: '10px 12px', background: '#f8fafc', marginBottom: '14px',
                        }}>
                            <Mail size={16} color="#94a3b8" />
                            <input
                                type="email"
                                value={emailInput}
                                onChange={(e) => setEmailInput(e.target.value)}
                                disabled={submitting}
                                placeholder="email@example.com"
                                style={{
                                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                                    fontSize: '0.9rem', color: '#1e293b',
                                }}
                            />
                        </div>

                        {/* Submit 버튼 */}
                        <button
                            onClick={handleSubmit}
                            disabled={submitting || !emailInput.trim()}
                            style={{
                                width: '100%', padding: '12px', borderRadius: '10px',
                                background: (submitting || !emailInput.trim()) ? '#cbd5e1' : 'var(--brand-primary)',
                                color: 'white', border: 'none', fontWeight: 700, fontSize: '0.95rem',
                                cursor: (submitting || !emailInput.trim()) ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {submitting
                                ? t('auth.emailVerifyChange.sending')
                                : t('auth.emailVerifyChange.sendBtn')}
                        </button>

                        {/* 결과 메시지 */}
                        {errorMsg && (
                            <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', fontSize: '0.82rem', color: '#dc2626' }}>
                                {errorMsg}
                            </div>
                        )}
                        {successMsg && (
                            <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '0.82rem', color: '#16a34a', fontWeight: 600 }}>
                                ✅ {successMsg}
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
