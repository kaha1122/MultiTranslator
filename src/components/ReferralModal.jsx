import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy } from 'lucide-react';

// Apple 로고 (iPhone 브랜드 마크) — lucide-react는 trademark로 미제공, 인라인 SVG
const AppleIcon = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
);
// Android 로봇 마크
const AndroidIcon = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.523 15.34c-.553 0-1-.447-1-1s.447-1 1-1 1 .447 1 1-.447 1-1 1m-11.046 0c-.553 0-1-.447-1-1s.447-1 1-1 1 .447 1 1-.447 1-1 1m11.405-6.402l1.997-3.46a.413.413 0 0 0-.151-.564.412.412 0 0 0-.564.151l-2.022 3.503C15.595 7.85 13.85 7.4 12 7.4c-1.85 0-3.595.45-5.142 1.168L4.836 5.065a.412.412 0 0 0-.564-.151.413.413 0 0 0-.151.564l1.997 3.46C2.69 10.665.5 14.012.5 17.832h23c0-3.82-2.19-7.167-5.618-8.894"/>
    </svg>
);
import { Capacitor } from '@capacitor/core';
import { useT } from '../utils/i18n';
import { authFetch } from '../utils/authFetch';
import { getCountryByLang } from '../utils/phoneFormat';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const APPLE_APP_ID = '6761342764';
const ANDROID_PKG = 'com.arigems.pronunfit';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PKG}`;

// 공유 URL은 "받는 친구의 단말" 기준으로 결정. 발신자가 친구 단말을 알고 직접 버튼을 고름.
// (예전엔 발신자 플랫폼으로 분기했으나, Android 발신자 → iPhone 수신자 시 Play Store 링크가
//  iPhone에서 죽은 링크가 되는 문제가 있어 사용자 명시 선택 방식으로 변경. 2026-04-26)
// target: 'android' = 받는 친구가 Android(갤럭시 등) → Play Store
//         'iosweb'  = 받는 친구가 iPhone 또는 PC/웹 사용자 → App Store
//
// 2026-05-14: iOS URL을 발신자 국가 명시 형태로 변경 — canonical /app/id... URL이 HTTP 301
//   redirect를 일으켜 카톡 등 메신저의 link preview generator가 redirect 체인을 따라가지
//   못하고 timeout → 친구에게 메시지 전송 실패하는 이슈 해결. 명시 국가 URL(`/kr/`, `/vn/`)은
//   redirect 없이 직접 응답 → preview gen 정상. 카톡뿐 아니라 텔레그램·라인·WhatsApp 등
//   모든 메신저 공통 best practice.
function getShareUrl(target, country) {
    if (target === 'android') return PLAY_STORE_URL;
    const cc = (country || 'US').toLowerCase();
    return `https://apps.apple.com/${cc}/app/id${APPLE_APP_ID}`;
}

export default function ReferralModal({ open, onClose, sourceLang, phoneCountry, onSuccess }) {
    const t = useT(sourceLang);
    const [myCode, setMyCode] = useState('');
    const [loadingCode, setLoadingCode] = useState(false);
    const [inputCode, setInputCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [copiedFlash, setCopiedFlash] = useState(false);
    const [shareHintVisible, setShareHintVisible] = useState(false);

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

    // target: 'android' | 'iosweb' — 받는 친구의 단말 기준
    const handleShare = async (target) => {
        const rawMsg = t('bonus.referral.shareMessage') || 'Code: {code}\n{url}';
        // 발신자 국가: profile.phoneCountry > sourceLang 추론 > 'US' 폴백
        const country = phoneCountry || getCountryByLang(sourceLang) || 'US';
        const url = getShareUrl(target, country);
        const title = t('bonus.referral.shareTitle') || 'PronunFit';

        // 네이티브 share sheet용 텍스트: {url} 포함된 마지막 라인을 통째 제거 → url 필드로 분리.
        // (카톡 iOS share extension이 text 안에 embedded URL을 받으면 메시지 전송 실패하는
        //  케이스 회피. 모든 locale이 "...{code}\n\n[label]: {url}" 패턴이라 정규식 일괄 처리.)
        const textForShare = rawMsg
            .replace(/\n*[^\n]*\{url\}[^\n]*$/, '')
            .replace('{code}', myCode)
            .trim();

        // 클립보드 fallback용: URL 포함된 전체 메시지 (붙여넣기 한 번으로 친구가 코드+URL 모두 받음)
        const fullMessage = rawMsg.replace('{code}', myCode).replace('{url}', url);

        // 네이티브(iOS/Android) — Capacitor Share 플러그인이 OS 공유 시트 호출.
        // Android System WebView는 navigator.share 미노출이라 native plugin 필수,
        // iOS는 navigator.share 빌트인이지만 Capacitor.Share가 UIActivityViewController
        // 동일 호출이라 일관성·예외처리 이점 → 양 플랫폼 동일 경로 사용.
        if (Capacitor.isNativePlatform()) {
            try {
                const { Share } = await import('@capacitor/share');
                await Share.share({ title, text: textForShare, url, dialogTitle: title });
                onClose?.();
                return;
            } catch (err) {
                // 사용자가 공유 시트에서 취소한 경우 — 모달 유지 + hint 안 띄움.
                // Android는 'Share canceled', iOS는 'cancel' 등 메시지 다양 → 포괄 매칭.
                const msg = String(err?.message || '').toLowerCase();
                if (msg.includes('cancel')) return;
                console.warn('[Referral] Capacitor.Share failed:', err?.message);
                // 실패 시 아래 fallback (navigator.share → clipboard)로 진행
            }
        }

        // 데스크탑 PWA / 일반 웹 — navigator.share 지원 시 OS share sheet 사용
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title, text: textForShare, url });
                // 성공 → 모달 자동 닫기. 외부 앱(카톡/메일 등)에서 돌아온 사용자에게
                // "친구 추천 완료"의 명확한 피드백 제공 (어제까지는 모달 그대로 열려있어 헷갈림).
                onClose?.();
                return;
            } catch (err) {
                if (err?.name === 'AbortError') return; // 취소 → 모달 유지 (재시도 가능)
                console.warn('[Referral] navigator.share failed:', err?.name, err?.message);
            }
        }

        // Fallback — 메시지 전체를 클립보드 복사 + 사용자에게 다음 동작 안내
        try {
            await navigator.clipboard.writeText(fullMessage);
            setCopiedFlash(true);
            setShareHintVisible(true);
            setTimeout(() => setCopiedFlash(false), 1500);
            // hint 4초 표시 후 모달 자동 닫기 (사용자는 카톡으로 가서 붙여넣기 진행)
            setTimeout(() => {
                setShareHintVisible(false);
                onClose?.();
            }, 4000);
        } catch (err) {
            console.error('[Referral] clipboard failed:', err);
        }
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
                                {t('bonus.referral.title')}
                            </h3>
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
                                        background: submitting ? '#94a3b8' : 'var(--brand-primary)',
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
                            {/* 코드 복사 — 코드 6자리만 클립보드 (단순 사용) */}
                            <button
                                onClick={handleCopy}
                                disabled={!myCode}
                                style={{
                                    width: '100%', padding: '10px', borderRadius: '8px',
                                    background: 'white', border: '1px solid #93c5fd',
                                    color: '#1d4ed8', fontWeight: 600, fontSize: '0.85rem',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', gap: '4px',
                                    marginBottom: '8px',
                                }}
                            >
                                <Copy size={14} />
                                {copiedFlash ? t('bonus.referral.copied') : t('bonus.referral.copy')}
                            </button>

                            {/* 받는 친구의 단말에 맞는 URL 분기 안내 */}
                            <div style={{
                                fontSize: '0.7rem', color: '#475569', textAlign: 'center',
                                marginBottom: '6px', fontWeight: 500,
                            }}>
                                💡 {t('bonus.referral.sharePickHint')}
                            </div>

                            <div style={{ display: 'flex', gap: '8px' }}>
                                {/* 왼쪽: 받는 친구가 iPhone 또는 PC/웹 사용자 → Web URL */}
                                <button
                                    onClick={() => handleShare('iosweb')}
                                    disabled={!myCode}
                                    style={{
                                        flex: 1, padding: '10px 8px', borderRadius: '8px',
                                        background: '#1d1d1f', border: 'none',
                                        color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap',
                                    }}
                                >
                                    <AppleIcon size={15} />
                                    {t('bonus.referral.shareIosWeb')}
                                </button>
                                {/* 오른쪽: 받는 친구가 Android(갤럭시 등) → Play Store URL */}
                                <button
                                    onClick={() => handleShare('android')}
                                    disabled={!myCode}
                                    style={{
                                        flex: 1, padding: '10px 8px', borderRadius: '8px',
                                        background: '#3DDC84', border: 'none',
                                        color: 'white', fontWeight: 600, fontSize: '0.85rem',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap',
                                    }}
                                >
                                    <AndroidIcon size={15} />
                                    {t('bonus.referral.shareAndroid')}
                                </button>
                            </div>
                            {shareHintVisible && (
                                <div style={{
                                    marginTop: '10px', padding: '8px 10px',
                                    background: '#dbeafe', borderRadius: '8px',
                                    fontSize: '0.78rem', color: '#1e40af', fontWeight: 500,
                                    textAlign: 'center', lineHeight: 1.45,
                                }}>
                                    {t('bonus.referral.shareHint')}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
