import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Check } from 'lucide-react';
import { useT } from '../utils/i18n';
import { authFetch } from '../utils/authFetch';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PLAY_REVIEWS_URL = 'https://play.google.com/store/apps/details?id=com.arigems.pronunfit&showAllReviews=1';

export default function ReviewBonusModal({ open, onClose, sourceLang, alreadyClaimed = false, onSuccess }) {
    const t = useT(sourceLang);
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [skippedPro, setSkippedPro] = useState(false);
    const [hasOpenedStore, setHasOpenedStore] = useState(false); // Play Store 열기 클릭 여부 — 작성완료 전제조건

    if (!open) return null;

    const handleOpenStore = () => {
        // Web/Android — Play Store 리뷰 섹션 직접 열기
        window.open(PLAY_REVIEWS_URL, '_blank');
        setHasOpenedStore(true); // 작성완료 버튼 활성화 전제조건
    };

    const handleConfirm = async () => {
        setErrorMsg('');
        setSuccessMsg('');
        setSkippedPro(false);
        setSubmitting(true);
        try {
            const r = await authFetch(`${API_URL}/api/review-bonus/claim`, { method: 'POST' });
            const d = await r.json();
            if (d.success) {
                setSuccessMsg(t('bonus.review.success'));
                if (onSuccess) onSuccess();
            } else if (d.skipped) {
                setSkippedPro(true);
            } else {
                const errMap = {
                    already_claimed: t('bonus.review.alreadyClaimed'),
                    anonymous_not_allowed: t('bonus.referral.needLogin'),
                };
                setErrorMsg(errMap[d.error] || d.message || 'Error');
            }
        } catch (e) {
            setErrorMsg('Network error');
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
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '16px',
                    }}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'white', borderRadius: '16px', padding: '20px',
                            maxWidth: '420px', width: '100%', maxHeight: '90vh', overflow: 'auto',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                        }}
                    >
                        {/* 헤더 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1d4ed8' }}>
                                {t('bonus.review.title')}
                            </h3>
                            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                <X size={20} color="#64748b" />
                            </button>
                        </div>

                        {/* 이미 받은 경우 */}
                        {alreadyClaimed ? (
                            <div style={{
                                background: '#f1f5f9', borderRadius: '12px', padding: '20px',
                                textAlign: 'center', color: '#64748b',
                            }}>
                                <Check size={32} style={{ margin: '0 auto 8px', display: 'block', color: '#94a3b8' }} />
                                <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                                    {t('bonus.review.alreadyClaimed')}
                                </div>
                            </div>
                        ) : (
                            <>
                                <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 16px', lineHeight: 1.5 }}>
                                    {t('bonus.review.desc')}
                                </p>

                                {/* Step 1: Play Store 열기 */}
                                <button
                                    onClick={handleOpenStore}
                                    style={{
                                        width: '100%', padding: '12px', borderRadius: '10px',
                                        background: 'white', border: '1.5px solid #93c5fd',
                                        color: '#1d4ed8', fontSize: '0.9rem', fontWeight: 600,
                                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '6px', marginBottom: '8px',
                                    }}
                                >
                                    <ExternalLink size={16} />
                                    {t('bonus.review.openStore')}
                                </button>

                                {/* Step 2: 작성 완료 — Play Store 먼저 열어야 활성화 */}
                                <button
                                    onClick={handleConfirm}
                                    disabled={submitting || !hasOpenedStore}
                                    style={{
                                        width: '100%', padding: '14px', borderRadius: '10px',
                                        background: (submitting || !hasOpenedStore) ? '#cbd5e1' : '#2563eb',
                                        border: 'none', color: 'white', fontSize: '0.95rem',
                                        fontWeight: 700,
                                        cursor: (submitting || !hasOpenedStore) ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {t('bonus.review.confirm')}
                                </button>
                                {!hasOpenedStore && (
                                    <div style={{
                                        marginTop: '6px', fontSize: '0.72rem', color: '#94a3b8',
                                        textAlign: 'center',
                                    }}>
                                        {t('bonus.review.openStoreFirst') || '먼저 Play Store에서 후기를 작성해주세요'}
                                    </div>
                                )}

                                {errorMsg && (
                                    <div style={{ marginTop: '10px', fontSize: '0.85rem', color: '#dc2626', textAlign: 'center' }}>
                                        {errorMsg}
                                    </div>
                                )}
                                {successMsg && (
                                    <div style={{ marginTop: '10px', fontSize: '0.95rem', color: '#16a34a', textAlign: 'center', fontWeight: 600 }}>
                                        {successMsg}
                                    </div>
                                )}
                                {skippedPro && (
                                    <div style={{
                                        marginTop: '12px', padding: '12px', borderRadius: '10px',
                                        background: '#fef3c7', border: '1px solid #fde68a',
                                    }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#92400e', marginBottom: '4px' }}>
                                            {t('bonus.review.skippedProTitle')}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: '#b45309' }}>
                                            {t('bonus.review.skippedProDesc')}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
