import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Share2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useT } from '../utils/i18n';
import { authFetch } from '../utils/authFetch';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.arigems.pronunfit';
const WEB_URL = 'https://multi-translator-seven.vercel.app/';

// 공유 시 첨부할 앱 설치 링크 — A의 플랫폼 + (웹의 경우) 브라우저 UA 기준
// iOS 앱 미출시 상태이므로 iOS 사용자는 Web URL (웹앱 사용 가능)
function getShareUrl() {
    if (Capacitor.getPlatform() === 'android') return PLAY_STORE_URL;
    if (Capacitor.getPlatform() === 'ios') return WEB_URL;
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua)) return PLAY_STORE_URL;
    return WEB_URL;
}

export default function ReferralModal({ open, onClose, sourceLang, onSuccess }) {
    const t = useT(sourceLang);
    const [myCode, setMyCode] = useState('');
    const [loadingCode, setLoadingCode] = useState(false);
    const [inputCode, setInputCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [copiedFlash, setCopiedFlash] = useState(false);

    // 모달 첫 오픈 시 lazy 코드 발급/조회
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        (async () => {
            setLoadingCode(true);
            try {
                const r = await authFetch(`${API_URL}/api/referral/ensure-code`, { method: 'POST' });
                const d = await r.json();
                if (cancelled) return;
                if (d.success) setMyCode(d.code);
            } catch {}
            setLoadingCode(false);
        })();
        return () => { cancelled = true; };
    }, [open]);

    if (!open) return null;

    const handleSubmit = async () => {
        const code = inputCode.trim().toUpperCase();
        setErrorMsg('');
        setSuccessMsg('');
        if (!code) return;
        setSubmitting(true);
        try {
            const r = await authFetch(`${API_URL}/api/referral/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });
            const d = await r.json();
            if (d.success) {
                setSuccessMsg(t('bonus.referral.success'));
                setInputCode('');
                if (onSuccess) onSuccess();
            } else {
                const errMap = {
                    invalid_format: t('bonus.referral.invalid'),
                    invalid_code: t('bonus.referral.invalid'),
                    self_referral: t('bonus.referral.self'),
                    already_redeemed: t('bonus.referral.alreadyRedeemed'),
                    referrer_limit_reached: t('bonus.referral.referrerLimitReached'),
                    anonymous_not_allowed: t('bonus.referral.needLogin'),
                };
                setErrorMsg(errMap[d.error] || d.message || 'Error');
            }
        } catch (e) {
            setErrorMsg('Network error');
        }
        setSubmitting(false);
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(myCode);
            setCopiedFlash(true);
            setTimeout(() => setCopiedFlash(false), 1500);
        } catch {}
    };

    const handleShare = async () => {
        const message = (t('bonus.referral.shareMessage') || 'Code: {code}\n{url}')
            .replace('{code}', myCode)
            .replace('{url}', getShareUrl());
        const title = t('bonus.referral.shareTitle') || 'PronunFit';

        // 네이티브: Capacitor Share API
        if (Capacitor.isNativePlatform()) {
            try {
                const { Share } = await import('@capacitor/share');
                await Share.share({ title, text: message, dialogTitle: title });
                return;
            } catch (e) {
                if (e?.message?.includes('canceled') || e?.message?.includes('cancel')) return;
            }
        }
        // 웹: Web Share API (모바일 브라우저)
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title, text: message });
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        }
        // Fallback — 메시지 전체를 클립보드 복사 (데스크탑 등)
        try {
            await navigator.clipboard.writeText(message);
            setCopiedFlash(true);
            setTimeout(() => setCopiedFlash(false), 1500);
        } catch {}
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
                                {t('bonus.referral.title')}
                            </h3>
                            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                <X size={20} color="#64748b" />
                            </button>
                        </div>

                        <p style={{ fontSize: '0.85rem', color: '#475569', margin: '0 0 16px' }}>
                            {t('bonus.referral.desc')}
                        </p>

                        {/* 1. 코드 입력 영역 */}
                        <div style={{
                            background: '#eff6ff', borderRadius: '12px', padding: '14px',
                            marginBottom: '14px', border: '1px solid #bfdbfe',
                        }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#1e40af', fontWeight: 600, marginBottom: '6px' }}>
                                {t('bonus.referral.codeLabel')}
                            </label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    value={inputCode}
                                    onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                                    placeholder="PFIT-XXXXXX"
                                    style={{
                                        flex: 1, padding: '10px 12px', borderRadius: '8px',
                                        border: '1px solid #93c5fd', fontSize: '0.9rem',
                                        fontFamily: 'monospace', letterSpacing: '0.05em',
                                        background: 'white',
                                    }}
                                    maxLength={11}
                                    disabled={submitting}
                                />
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || !inputCode.trim()}
                                    style={{
                                        padding: '10px 16px', borderRadius: '8px',
                                        background: submitting ? '#94a3b8' : '#2563eb',
                                        color: 'white', border: 'none', fontWeight: 600,
                                        cursor: submitting ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {t('bonus.referral.submit')}
                                </button>
                            </div>
                            {errorMsg && (
                                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#dc2626' }}>
                                    {errorMsg}
                                </div>
                            )}
                            {successMsg && (
                                <div style={{ marginTop: '8px', fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                                    {successMsg}
                                </div>
                            )}
                        </div>

                        {/* 2. 내 코드 공유 영역 */}
                        <div style={{
                            background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                            borderRadius: '12px', padding: '14px',
                            border: '1px solid #93c5fd',
                        }}>
                            <div style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: 600, marginBottom: '6px' }}>
                                {t('bonus.referral.myCode')}
                            </div>
                            <div style={{
                                background: 'white', padding: '10px 12px', borderRadius: '8px',
                                fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700,
                                color: '#1d4ed8', textAlign: 'center', letterSpacing: '0.08em',
                                marginBottom: '10px',
                            }}>
                                {loadingCode ? '...' : (myCode || '—')}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={handleCopy}
                                    disabled={!myCode}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: '8px',
                                        background: 'white', border: '1px solid #93c5fd',
                                        color: '#1d4ed8', fontWeight: 600, fontSize: '0.85rem',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '4px',
                                    }}
                                >
                                    <Copy size={14} />
                                    {copiedFlash ? t('bonus.referral.copied') : t('bonus.referral.copy')}
                                </button>
                                <button
                                    onClick={handleShare}
                                    disabled={!myCode}
                                    style={{
                                        flex: 1, padding: '10px', borderRadius: '8px',
                                        background: '#2563eb', border: 'none',
                                        color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '4px',
                                    }}
                                >
                                    <Share2 size={14} />
                                    {t('bonus.referral.share')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
