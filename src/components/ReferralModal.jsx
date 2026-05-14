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

        // Android System WebView는 navigator.share 미노출(2026-04-26 단말 검증).
        // 데스크탑 Chrome/Edge·iOS WKWebView 등에서는 동작할 수 있어 시도는 유지.
        // 안드로이드 native Share 플러그인은 다음 AAB 빌드 시 cap sync 후 부활 예정.
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ title, text: textForShare, url });
                return;
            } catch (err) {
                if (err?.name === 'AbortError') return;
                console.warn('[Referral] navigator.share failed:', err?.name, err?.message);
            }
        }

        // Fallback — 메시지 전체를 클립보드 복사 + 사용자에게 다음 동작 안내
        try {
            await navigator.clipboard.writeText(fullMessage);
            setCopiedFlash(true);
            setShareHintVisible(true);
            setTimeout(() => setCopiedFlash(false), 1500);
            setTimeout(() => setShareHintVisible(false), 4000);
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
