import { useState, useEffect, Suspense } from 'react';
import { X, Zap, Crown, Check, ShieldCheck, Mail, Loader2, RotateCcw } from 'lucide-react';
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';
// PayPal SDK wrapper — 정적 import로 전환 (lazy waterfall 제거). SDK script는 Provider mount 시점에 CDN에서 로드.
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { getAuth, sendEmailVerification, verifyBeforeUpdateEmail } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import { detectCountry, isKorea } from '../utils/detectCountry';
import { authFetch } from '../utils/authFetch';
import './UpgradeModal.css';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY;
const FRONTEND_URL = window.location.origin;
const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID;

// USD planId → PayPal Plan ID 매핑
const PAYPAL_PLAN_IDS = {
    pro_1_usd: import.meta.env.VITE_PAYPAL_PLAN_PRO_1,
    pro_3_usd: import.meta.env.VITE_PAYPAL_PLAN_PRO_3,
    premium_1_usd: import.meta.env.VITE_PAYPAL_PLAN_PREMIUM_1,
    premium_3_usd: import.meta.env.VITE_PAYPAL_PLAN_PREMIUM_3,
};

// ── RevenueCat 대시보드 구성 ──
// Products:     pro_1(Monthly), Pro_3(3months), Premium_1(Monthly), Premium_3(3months)
// Entitlements: Pro → pro_1, Pro_3  /  Premium → Premium_1, Premium_3
// Offerings:    Pro(pro_1, Pro_3)   /  Premium(Premium_1, Premium_3)
const RC_OFFERING_PRO = 'Pro';
const RC_OFFERING_PREMIUM = 'Premium';

// ── 각 Offering의 UI 스타일 매핑 ──
const RC_PACKAGE_META = {
    pro: {
        tier: 'pro',
        icon: <Zap size={22} />,
        name: 'Pro',
        color: '#4338ca',
        borderColor: '#e0e7ff',
        bgColor: '#f5f3ff',
        borderColorBest: '#c7d2fe',
        bgColorBest: '#eef2ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3', 'upgrade.noAds'],
    },
    premium: {
        tier: 'premium',
        icon: <Crown size={22} />,
        name: 'Premium',
        color: '#b45309',
        borderColor: '#fde68a',
        bgColor: '#fffbeb',
        borderColorBest: '#fcd34d',
        bgColorBest: '#fef9c3',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature2', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4', 'upgrade.noAds'],
    },
};

// RevenueCat 표준 packageType → months
const RC_TYPE_TO_MONTHS = {
    'MONTHLY': 1,
    'TWO_MONTH': 2,
    'THREE_MONTH': 3,
    'SIX_MONTH': 6,
    'ANNUAL': 12,
    'LIFETIME': 0,
};

// Product ID → months 폴백 (Google Play / RevenueCat 모두 소문자 통일)
const PRODUCT_ID_TO_MONTHS = {
    'pro_1': 1, 'pro_3': 3,
    'premium_1': 1, 'premium_3': 3,
};

// RevenueCat 패키지 배열 → UI plan 배열 변환
const rcPackagesToPlans = (packages, tierKey) => {
    const meta = RC_PACKAGE_META[tierKey];
    if (!meta || !packages?.length) return [];

    return packages
        .map(pkg => {
            const product = pkg.product;
            // 1순위: RevenueCat 표준 packageType (MONTHLY, THREE_MONTH 등)
            // 2순위: product identifier로 폴백 (pro_1, Pro_3, Premium_1, Premium_3)
            const months = RC_TYPE_TO_MONTHS[pkg.packageType]
                ?? PRODUCT_ID_TO_MONTHS[product.identifier]
                ?? 1;
            const isBest = months >= 3;

            return {
                id: product.identifier,                    // Google Play / App Store product ID
                rcPackage: pkg,                             // 원본 패키지 (purchasePackage에 전달)
                tier: meta.tier,
                months,
                icon: meta.icon,
                name: meta.name,
                // RevenueCat SDK가 국가/통화에 맞는 가격 자동 제공
                price: product.priceString,
                priceNum: product.price,
                currency: product.currencyCode,
                color: meta.color,
                borderColor: isBest ? meta.borderColorBest : meta.borderColor,
                bgColor: isBest ? meta.bgColorBest : meta.bgColor,
                featureKeys: meta.featureKeys,
                badge: isBest ? 'BEST' : null,
                discount: null, // calcDiscounts에서 후처리
            };
        })
        .sort((a, b) => a.months - b.months); // 1개월 → 3개월 순
};

// 할인율 계산 (월간 대비 장기 플랜 절감액)
const calcDiscounts = (plans) => {
    const monthlyPlan = plans.find(p => p.months === 1);
    if (!monthlyPlan) return plans;
    return plans.map(p => {
        if (p.months <= 1 || !monthlyPlan.priceNum) return p;
        const monthlyEquiv = p.priceNum / p.months;
        const discount = Math.round((1 - monthlyEquiv / monthlyPlan.priceNum) * 100);
        return { ...p, discount: discount > 0 ? discount : null };
    });
};

// ── 웹 전용 하드코딩 플랜 (TossPayments) ──
const PLAN_CONFIGS_KRW = [
    {
        id: 'pro_1',
        tier: 'pro',
        months: 1,
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '₩9,000',
        priceNum: 9000,
        color: '#4338ca',
        borderColor: '#e0e7ff',
        bgColor: '#f5f3ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3', 'upgrade.noAds'],
    },
    {
        id: 'pro_3',
        tier: 'pro',
        months: 3,
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '₩22,000',
        priceNum: 22000,
        discount: 18,
        badge: 'BEST',
        color: '#4338ca',
        borderColor: '#c7d2fe',
        bgColor: '#eef2ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3', 'upgrade.noAds'],
    },
    {
        id: 'premium_1',
        tier: 'premium',
        months: 1,
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '₩16,990',
        priceNum: 16990,
        color: '#b45309',
        borderColor: '#fde68a',
        bgColor: '#fffbeb',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature2', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4', 'upgrade.noAds'],
    },
    {
        id: 'premium_3',
        tier: 'premium',
        months: 3,
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '₩35,000',
        priceNum: 35000,
        discount: 31,
        badge: 'BEST',
        color: '#b45309',
        borderColor: '#fcd34d',
        bgColor: '#fef9c3',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature2', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4', 'upgrade.noAds'],
    },
];

const PLAN_CONFIGS_USD = [
    {
        id: 'pro_1_usd',
        tier: 'pro',
        months: 1,
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '$5.99',
        priceNum: 599,
        currency: 'USD',
        color: '#4338ca',
        borderColor: '#e0e7ff',
        bgColor: '#f5f3ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3', 'upgrade.noAds'],
    },
    {
        id: 'pro_3_usd',
        tier: 'pro',
        months: 3,
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '$14.99',
        priceNum: 1499,
        currency: 'USD',
        discount: 17,
        badge: 'BEST',
        color: '#4338ca',
        borderColor: '#c7d2fe',
        bgColor: '#eef2ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3', 'upgrade.noAds'],
    },
    {
        id: 'premium_1_usd',
        tier: 'premium',
        months: 1,
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '$10.99',
        priceNum: 1099,
        currency: 'USD',
        color: '#b45309',
        borderColor: '#fde68a',
        bgColor: '#fffbeb',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature2', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4', 'upgrade.noAds'],
    },
    {
        id: 'premium_3_usd',
        tier: 'premium',
        months: 3,
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '$24.99',
        priceNum: 2499,
        currency: 'USD',
        discount: 24,
        badge: 'BEST',
        color: '#b45309',
        borderColor: '#fcd34d',
        bgColor: '#fef9c3',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature2', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4', 'upgrade.noAds'],
    },
];

const UpgradeModal = ({ onClose, sourceLang, onRequestPhoneVerify, initialTier }) => {
    const { user, profile } = useAuth();
    const t = useT(sourceLang);
    const [loadingPlan, setLoadingPlan] = useState(null);
    const [error, setError] = useState('');
    const [showVerifyWarnings, setShowVerifyWarnings] = useState(false);
    const [emailVerifSent, setEmailVerifSent] = useState(false);
    const [emailVerified, setEmailVerified] = useState(user?.emailVerified || false);
    const [newEmailInput, setNewEmailInput] = useState('');
    const [emailUpdateSent, setEmailUpdateSent] = useState(false);
    const hasNoEmail = !user?.email;
    const [countryInfo, setCountryInfo] = useState(null);
    const [paypalPlanId, setPaypalPlanId] = useState(null); // "선택" 클릭 후 PayPal 버튼 표시용

    // ── RevenueCat Offering 상태 (네이티브 전용) ──
    const isNative = Capacitor.isNativePlatform();
    const isIOS = Capacitor.getPlatform() === 'ios';
    const [rcProPlans, setRcProPlans] = useState([]);
    const [rcPremiumPlans, setRcPremiumPlans] = useState([]);
    const [rcLoading, setRcLoading] = useState(isNative); // 네이티브면 초기 로딩
    const [rcError, setRcError] = useState('');

    // RevenueCat Offerings 로드 (네이티브 앱 전용)
    useEffect(() => {
        if (!isNative) return;
        let cancelled = false;
        (async () => {
            try {
                const offerings = await Purchases.getOfferings();
                if (cancelled) return;

                // Pro offering
                const proOffering = offerings.all?.[RC_OFFERING_PRO];
                if (proOffering?.availablePackages?.length) {
                    const proPlans = calcDiscounts(rcPackagesToPlans(proOffering.availablePackages, 'pro'));
                    setRcProPlans(proPlans);
                }

                // Premium offering
                const premiumOffering = offerings.all?.[RC_OFFERING_PREMIUM];
                if (premiumOffering?.availablePackages?.length) {
                    const premPlans = calcDiscounts(rcPackagesToPlans(premiumOffering.availablePackages, 'premium'));
                    setRcPremiumPlans(premPlans);
                }

                if (!proOffering?.availablePackages?.length && !premiumOffering?.availablePackages?.length) {
                    setRcError('No offerings available');
                }
            } catch (e) {
                if (!cancelled) {
                    console.error('[RevenueCat] getOfferings failed:', e);
                    setRcError(e.message || 'Failed to load store products');
                }
            } finally {
                if (!cancelled) setRcLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isNative]);

    useEffect(() => {
        detectCountry().then(setCountryInfo);
    }, []);

    // 이메일 인증 후 앱 복귀 시 emailVerified 자동 갱신
    useEffect(() => {
        if (emailVerified) return; // 이미 인증됨
        const handleVisibility = async () => {
            if (document.visibilityState === 'visible') {
                try {
                    const auth = getAuth();
                    await auth.currentUser?.reload();
                    if (auth.currentUser?.emailVerified) {
                        setEmailVerified(true);
                        setShowVerifyWarnings(false);
                    }
                } catch (_) {}
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [emailVerified]);

    // 결제 통화 결정 (2026-04-21 재설계):
    // phoneCountry === 'KR' 만 한국 플로우(KRW/Toss). 그 외 모두 USD/PayPal.
    // 근거:
    //   - 한국 유저는 한국 번호 외에 쓸 이유 없음 (결정적 신호)
    //   - IP 기반(ipwhois.app) 감지는 rate limit/CORS로 간헐 실패 → 한국인 USD 오탐
    //   - 해외 거주 한국인도 한국 카드(KRW) 결제 선호 (해외 수수료 절약)
    //   - phoneCountry null인 기존 유저(~96%)는 AuthContext에서 로그인 시 자동 보완됨
    const isKR = profile?.phoneCountry === 'KR';
    // 웹: 기존 하드코딩 플랜 / 네이티브: RevenueCat offering에서 가져온 플랜
    const webPlanConfigs = isKR ? PLAN_CONFIGS_KRW : PLAN_CONFIGS_USD;
    const PLAN_CONFIGS = isNative
        ? [...rcProPlans, ...rcPremiumPlans]
        : webPlanConfigs;

    const needEmailVerify = !emailVerified;
    const needPhoneVerify = isKR && !profile?.phoneVerified; // 한국만 전화인증 필요

    const handleSendVerification = async () => {
        try {
            const auth = getAuth();
            await sendEmailVerification(auth.currentUser);
            setEmailVerifSent(true);
        } catch (e) {
            if (e.code === 'auth/too-many-requests') {
                setError(t('upgrade.emailTooMany'));
            } else {
                setError(t('upgrade.emailSendFailed'));
            }
        }
    };

    const handleAddEmail = async () => {
        if (!newEmailInput || !newEmailInput.includes('@')) {
            setError(t('upgrade.invalidEmail'));
            return;
        }
        try {
            const auth = getAuth();
            await verifyBeforeUpdateEmail(auth.currentUser, newEmailInput);
            setEmailUpdateSent(true);
            setError('');
        } catch (e) {
            if (e.code === 'auth/too-many-requests') {
                setError(t('upgrade.emailTooMany'));
            } else if (e.code === 'auth/email-already-in-use') {
                setError(t('auth.emailInUse'));
            } else {
                setError(t('upgrade.emailSendFailed'));
            }
        }
    };

    const handleUpgrade = async (plan) => {
        if (!user) return;

        // 이메일 인증 상태 최신화 (메일 인증 후 토큰 갱신)
        try {
            const auth = getAuth();
            await auth.currentUser.reload();
            const freshEmailVerified = auth.currentUser?.emailVerified || false;
            setEmailVerified(freshEmailVerified);

            if (!freshEmailVerified || needPhoneVerify) {
                setShowVerifyWarnings(true);
                return;
            }
        } catch (_) {
            if (needEmailVerify || needPhoneVerify) {
                setShowVerifyWarnings(true);
                return;
            }
        }
        setShowVerifyWarnings(false);

        setLoadingPlan(plan.id);
        setError('');
        try {
            if (isNative) {
                // ── RevenueCat In-App Purchase Flow ──
                try {
                    // plan.rcPackage: offering에서 가져온 원본 패키지 객체
                    const packageToBuy = plan.rcPackage;
                    if (!packageToBuy) throw new Error(`Product ${plan.id} not found in store`);

                    const purchaseResult = await Purchases.purchasePackage({ aPackage: packageToBuy });

                    // entitlement 활성화 확인 → 새로고침으로 tier 반영
                    if (Object.keys(purchaseResult.customerInfo.entitlements.active).length > 0) {
                        window.location.reload();
                    }
                } catch (e) {
                    if (!e.userCancelled) {
                        setError(e.message || t('upgrade.paymentError'));
                    }
                } finally {
                    setLoadingPlan(null);
                }
            } else if (!isKR && PAYPAL_PLAN_IDS[plan.id]) {
                // USD Web: "선택" 클릭 → PayPal 버튼 표시
                setPaypalPlanId(plan.id);
                setLoadingPlan(null);
                return;
            } else {
                // KRW Web: Toss Payments Flow
                const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY);
                const payment = tossPayments.payment({ customerKey: user.uid });
                const currency = plan.currency || 'KRW';
                await payment.requestBillingAuth({
                    method: 'CARD',
                    successUrl: `${FRONTEND_URL}?billing=success&tier=${plan.tier}&planId=${plan.id}&months=${plan.months}&customerKey=${user.uid}&email=${encodeURIComponent(user.email || '')}&currency=${currency}`,
                    failUrl: `${FRONTEND_URL}?billing=fail`,
                    customerEmail: user.email || undefined,
                    customerName: user.displayName || undefined,
                });
            }
        } catch (e) {
            setError(t('upgrade.paymentError'));
            setLoadingPlan(null);
        }
    };

    // PayPal onApprove 핸들러 — 구독 활성화 확인 후 Firestore 업데이트
    const handlePayPalApprove = async (data) => {
        setError('');
        try {
            const res = await authFetch(`${SERVER_URL}/api/paypal-activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscriptionId: data.subscriptionID,
                    userId: user.uid,
                    planId: data.subscriptionID, // 서버에서 PayPal API로 실제 plan_id 조회
                }),
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            window.location.reload();
        } catch (e) {
            setError(e.message || t('upgrade.paymentError'));
        }
    };

    const currentTier = profile?.tier || 'trial';
    const currentPlanId = (currentTier === 'pro' || currentTier === 'premium') ? (profile?.planId || null) : null;
    const isSubscribed = currentTier === 'pro' || currentTier === 'premium';

    const showPayPal = !isNative && !isKR && PAYPAL_CLIENT_ID;

    // 선택한 PayPal 플랜 정보
    const selectedPayPalPlan = paypalPlanId
        ? PLAN_CONFIGS.find(p => p.id === paypalPlanId) || null
        : null;

    // PayPal SDK Provider로 전체 모달 감싸기 (showPayPal일 때만)
    const modalContent = (
        <div className="upgrade-overlay" onClick={onClose}>
            <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose} aria-label="Close">
                    <X size={22} />
                </button>

                <div className="upgrade-header">
                    <div className="upgrade-header-emoji">✨</div>
                    <h2>{t('upgrade.modalTitle')}</h2>
                    <p>{t('upgrade.modalSubtitle')}</p>
                </div>

                {error && (
                    <div className="upgrade-error">{error}</div>
                )}

                {/* 네이티브: RevenueCat 로딩 / 에러 상태 */}
                {isNative && rcLoading && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0', gap: '8px', color: '#64748b' }}>
                        <Loader2 size={20} className="spin-animation" />
                        <span style={{ fontSize: '0.85rem' }}>{t('upgrade.loadingProducts') || 'Loading products...'}</span>
                    </div>
                )}
                {isNative && rcError && !rcLoading && (
                    <div className="upgrade-error">{rcError}</div>
                )}

                {showVerifyWarnings && (needEmailVerify || needPhoneVerify) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
                        {/* 0. 이메일 미등록 — 이메일 추가 입력 */}
                        {hasNoEmail && (
                            <div style={{
                                background: '#fef2f2', border: '1.5px solid #f87171', borderRadius: '12px',
                                padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Mail size={18} style={{ color: '#dc2626', flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#991b1b' }}>
                                        {t('upgrade.noEmailTitle')}
                                    </span>
                                </div>
                                <p style={{ fontSize: '0.78rem', color: '#7f1d1d', margin: 0, lineHeight: 1.5 }}>
                                    {t('upgrade.noEmailDesc')}
                                </p>
                                {emailUpdateSent ? (
                                    <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
                                        {t('upgrade.emailUpdateSent')}
                                    </span>
                                ) : (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="email"
                                            value={newEmailInput}
                                            onChange={(e) => setNewEmailInput(e.target.value)}
                                            placeholder={t('auth.email')}
                                            style={{
                                                flex: 1, padding: '8px 12px', borderRadius: '8px',
                                                border: '1px solid #d1d5db', fontSize: '0.82rem', outline: 'none'
                                            }}
                                        />
                                        <button
                                            onClick={handleAddEmail}
                                            style={{
                                                padding: '8px 16px', borderRadius: '10px', border: 'none',
                                                background: '#dc2626', color: 'white', fontSize: '0.82rem',
                                                fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {t('upgrade.addEmail')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* 1. 이메일 인증 (이메일은 있지만 미인증) */}
                        {needEmailVerify && !hasNoEmail && (
                            <div style={{
                                background: '#eff6ff', border: '1.5px solid #60a5fa', borderRadius: '12px',
                                padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Mail size={18} style={{ color: '#1d4ed8', flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e40af' }}>
                                        {t('upgrade.emailRequired')}
                                    </span>
                                </div>
                                <p style={{ fontSize: '0.78rem', color: '#1e3a5f', margin: 0, lineHeight: 1.5 }}>
                                    {t('upgrade.emailRequiredDesc')}
                                </p>
                                {emailVerifSent ? (
                                    <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
                                        {t('upgrade.emailSent')}
                                    </span>
                                ) : (
                                    <button
                                        onClick={handleSendVerification}
                                        style={{
                                            padding: '8px 16px', borderRadius: '10px', border: 'none',
                                            background: '#3b82f6', color: 'white', fontSize: '0.82rem',
                                            fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start'
                                        }}
                                    >
                                        {t('upgrade.sendVerification')}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* 2. 전화번호 인증 */}
                        {needPhoneVerify && (
                            <div style={{
                                background: '#fef3c7', border: '1.5px solid #fbbf24', borderRadius: '12px',
                                padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <ShieldCheck size={18} style={{ color: '#b45309', flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#92400e' }}>
                                        {t('upgrade.phoneRequired')}
                                    </span>
                                </div>
                                <p style={{ fontSize: '0.78rem', color: '#78350f', margin: 0, lineHeight: 1.5 }}>
                                    {t('upgrade.phoneRequiredDesc')}
                                </p>
                                <button
                                    onClick={() => onRequestPhoneVerify?.()}
                                    style={{
                                        padding: '8px 16px', borderRadius: '10px', border: 'none',
                                        background: '#f59e0b', color: 'white', fontSize: '0.82rem',
                                        fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start'
                                    }}
                                >
                                    {t('upgrade.verifyNow')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Pro Plans — initialTier이 없거나 'pro'일 때 표시 */}
                {(!initialTier || initialTier === 'pro') && !rcLoading && (
                <div className="upgrade-tier-group">
                    <div className="upgrade-tier-label" style={{ color: '#4338ca' }}>
                        <Zap size={16} /> Pro
                        <span className="upgrade-tier-autorenew">({t('upgrade.autoRenew')})</span>
                    </div>
                    <div className="upgrade-plans-row">
                        {PLAN_CONFIGS.filter(p => p.tier === 'pro').map(plan => {
                            const isCurrentPlan = currentPlanId
                                ? (currentPlanId === plan.id || plan.id?.startsWith(currentPlanId + ':') || currentPlanId.startsWith(plan.id + ':'))
                                : false;
                            return (
                                <div
                                    key={plan.id}
                                    className={`upgrade-plan-card ${isCurrentPlan ? 'current' : ''}`}
                                    style={{ borderColor: plan.borderColor, background: plan.bgColor }}
                                >
                                    {plan.badge && (
                                        <span className="upgrade-plan-badge" style={{ background: plan.color }}>
                                            {plan.badge}
                                        </span>
                                    )}
                                    <div className="upgrade-plan-duration">
                                        {plan.months === 1 ? `1 ${t('upgrade.period1m')}` : t('upgrade.period3m')}
                                    </div>
                                    <div className="upgrade-plan-price-block">
                                        <span className="upgrade-plan-amount" style={{ color: plan.color }}>
                                            {plan.price}
                                        </span>
                                        {plan.discount && (
                                            <div className="upgrade-plan-discount-line">
                                                <span className="upgrade-plan-discount">{plan.discount}% {t('upgrade.discount')}</span>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        className="upgrade-plan-btn"
                                        style={{
                                            background: isCurrentPlan ? '#e2e8f0' : 'var(--brand-primary)',
                                            color: isCurrentPlan ? '#94a3b8' : 'white',
                                            cursor: isCurrentPlan ? 'default' : 'pointer',
                                        }}
                                        onClick={() => !isCurrentPlan && handleUpgrade(plan)}
                                        disabled={isCurrentPlan || loadingPlan !== null}
                                    >
                                        {loadingPlan === plan.id
                                            ? t('upgrade.processing')
                                            : isCurrentPlan
                                                ? t('upgrade.currentPlan')
                                                : t('upgrade.startPlan')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <ul className="upgrade-plan-features">
                        {RC_PACKAGE_META.pro.featureKeys.filter(k => k !== 'upgrade.noAds').map((key, i) => (
                            <li key={i} style={i === 0 ? { display: 'flex', justifyContent: 'space-between', width: '100%' } : undefined}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Check size={14} style={{ color: '#4338ca', flexShrink: 0 }} />
                                    <span>{t(key)}</span>
                                </span>
                                {i === 0 && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                        <Check size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
                                        {t('upgrade.noAds')}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
                )}

                {/* Premium Plans — initialTier이 없거나 'premium'일 때 표시 */}
                {(!initialTier || initialTier === 'premium') && !rcLoading && (
                <div className="upgrade-tier-group" style={{ marginTop: initialTier ? '0' : '10px' }}>
                    <div className="upgrade-tier-label" style={{ color: '#b45309' }}>
                        <Crown size={16} /> Premium
                        <span className="upgrade-tier-autorenew">({t('upgrade.autoRenew')})</span>
                    </div>
                    <div className="upgrade-plans-row">
                        {PLAN_CONFIGS.filter(p => p.tier === 'premium').map(plan => {
                            const isCurrentPlan = currentPlanId
                                ? (currentPlanId === plan.id || plan.id?.startsWith(currentPlanId + ':') || currentPlanId.startsWith(plan.id + ':'))
                                : false;
                            return (
                                <div
                                    key={plan.id}
                                    className={`upgrade-plan-card ${isCurrentPlan ? 'current' : ''}`}
                                    style={{ borderColor: plan.borderColor, background: plan.bgColor }}
                                >
                                    {plan.badge && (
                                        <span className="upgrade-plan-badge" style={{ background: plan.color }}>
                                            {plan.badge}
                                        </span>
                                    )}
                                    <div className="upgrade-plan-duration">
                                        {plan.months === 1 ? `1 ${t('upgrade.period1m')}` : t('upgrade.period3m')}
                                    </div>
                                    <div className="upgrade-plan-price-block">
                                        <span className="upgrade-plan-amount" style={{ color: plan.color }}>
                                            {plan.price}
                                        </span>
                                        {plan.discount && (
                                            <div className="upgrade-plan-discount-line">
                                                <span className="upgrade-plan-discount">{plan.discount}% {t('upgrade.discount')}</span>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        className="upgrade-plan-btn"
                                        style={{
                                            background: isCurrentPlan ? '#e2e8f0' : 'var(--brand-primary)',
                                            color: isCurrentPlan ? '#94a3b8' : 'white',
                                            cursor: isCurrentPlan ? 'default' : 'pointer',
                                        }}
                                        onClick={() => !isCurrentPlan && handleUpgrade(plan)}
                                        disabled={isCurrentPlan || loadingPlan !== null}
                                    >
                                        {loadingPlan === plan.id
                                            ? t('upgrade.processing')
                                            : isCurrentPlan
                                                ? t('upgrade.currentPlan')
                                                : t('upgrade.startPlan')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <ul className="upgrade-plan-features">
                        {RC_PACKAGE_META.premium.featureKeys.filter(k => k !== 'upgrade.noAds').map((key, i) => (
                            <li key={i} style={i === 0 ? { display: 'flex', justifyContent: 'space-between', width: '100%' } : undefined}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Check size={14} style={{ color: '#b45309', flexShrink: 0 }} />
                                    <span>{t(key)}</span>
                                </span>
                                {i === 0 && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                        <Check size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
                                        {t('upgrade.noAds')}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
                )}

                {isSubscribed && (profile?.autoRenew === true || (isNative && profile?.tierSource === 'revenuecat')) && (
                    <CancelSubscriptionButton userId={user?.uid} t={t} />
                )}
                {isSubscribed && profile?.autoRenew === false && profile?.subscriptionExpiresAt && (
                    <div className="upgrade-cancel-notice">
                        {t('upgrade.cancelledNotice')} {
                            (() => {
                                const d = profile.subscriptionExpiresAt.toDate
                                    ? profile.subscriptionExpiresAt.toDate()
                                    : new Date(profile.subscriptionExpiresAt);
                                return d.toLocaleDateString();
                            })()
                        }
                    </div>
                )}

                {/* 구매 복원 버튼 — 네이티브(iOS/Android)에서만 표시 */}
                {isNative && (
                    <RestorePurchasesButton t={t} />
                )}

                <p className="upgrade-footer-note">
                    {t('upgrade.autoRenewNote')}
                </p>
                {/* Apple 심사(Guideline 3.1.2c) — 결제 직전 화면에 functional link 필수.
                    iOS는 Apple 표준 EULA, 그 외는 자체 약관 페이지 사용. */}
                <div className="upgrade-legal-links">
                    <a
                        href="https://pronunfit.com/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.preventDefault(); window.open('https://pronunfit.com/privacy', '_blank'); }}
                    >
                        {t('upgrade.privacyPolicy')}
                    </a>
                    <span>|</span>
                    <a
                        href={isIOS ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/' : 'https://pronunfit.com/terms'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                            e.preventDefault();
                            const url = isIOS
                                ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
                                : 'https://pronunfit.com/terms';
                            window.open(url, '_blank');
                        }}
                    >
                        {t('upgrade.termsOfUse')}
                    </a>
                </div>
            </div>
        </div>
    );

    // PayPal SDK Provider로 감싸기 (USD 웹에서만, 동적 로드)
    if (showPayPal) {
        return (
            <Suspense fallback={modalContent}>
                <PayPalScriptProvider options={{
                    'client-id': PAYPAL_CLIENT_ID,
                    vault: true,
                    intent: 'subscription',
                }}>
                    {modalContent}
                    {/* PayPal 결제 전용 팝업 */}
                    {selectedPayPalPlan && (
                        <div className="upgrade-overlay" style={{ zIndex: 10001 }} onClick={() => { setPaypalPlanId(null); setLoadingPlan(null); }}>
                            <div
                                className="upgrade-modal"
                                style={{ maxWidth: '360px', padding: '28px 24px' }}
                                onClick={e => e.stopPropagation()}
                            >
                                <button
                                    className="modal-close"
                                    onClick={() => { setPaypalPlanId(null); setLoadingPlan(null); }}
                                    aria-label="Close"
                                >
                                    <X size={20} />
                                </button>

                                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                                    <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>
                                        {selectedPayPalPlan.icon}
                                    </div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: selectedPayPalPlan.color, margin: '0 0 4px' }}>
                                        {selectedPayPalPlan.name}
                                    </h3>
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                                        {selectedPayPalPlan.months === 1
                                            ? `1 ${t('upgrade.period1m')}`
                                            : t('upgrade.period3m')}
                                        {' '}({t('upgrade.autoRenew')})
                                    </p>
                                </div>

                                <div style={{
                                    background: selectedPayPalPlan.bgColor,
                                    border: `1.5px solid ${selectedPayPalPlan.borderColor}`,
                                    borderRadius: '14px',
                                    padding: '16px',
                                    textAlign: 'center',
                                    marginBottom: '20px',
                                }}>
                                    <span style={{ fontSize: '1.6rem', fontWeight: 800, color: selectedPayPalPlan.color }}>
                                        {selectedPayPalPlan.price}
                                    </span>
                                    {selectedPayPalPlan.discount && (
                                        <span style={{
                                            display: 'inline-block', marginLeft: '8px',
                                            fontSize: '0.78rem', fontWeight: 700,
                                            color: '#dc2626', background: '#fee2e2',
                                            padding: '2px 8px', borderRadius: '10px',
                                        }}>
                                            {selectedPayPalPlan.discount}% {t('upgrade.discount')}
                                        </span>
                                    )}
                                </div>

                                <Suspense fallback={<Loader2 size={24} className="spin" style={{ display: 'block', margin: '20px auto' }} />}>
                                    <PayPalButtons
                                        style={{ layout: 'vertical', shape: 'rect', label: 'subscribe', height: 45, tagline: false }}
                                        createSubscription={(data, actions) => {
                                            // 기존 구독 만기일이 미래면 그 시점부터 첫 결제 (이중 결제 방지)
                                            // PayPal은 start_time을 승인 후 "scheduled" 상태로 대기시키고, 해당 시각에 첫 청구 발생
                                            const existingExpiryRaw = profile?.subscriptionExpiresAt;
                                            const existingExpiry = existingExpiryRaw?.toDate?.()
                                                ?? (existingExpiryRaw ? new Date(existingExpiryRaw) : null);
                                            const startTime = existingExpiry && existingExpiry > new Date()
                                                ? existingExpiry.toISOString()
                                                : undefined;

                                            return actions.subscription.create({
                                                plan_id: PAYPAL_PLAN_IDS[selectedPayPalPlan.id],
                                                custom_id: user.uid,
                                                ...(startTime ? { start_time: startTime } : {}),
                                            });
                                        }}
                                        onApprove={handlePayPalApprove}
                                        onCancel={() => { setPaypalPlanId(null); setLoadingPlan(null); }}
                                        onError={(err) => { setError(String(err)); setPaypalPlanId(null); setLoadingPlan(null); }}
                                    />
                                </Suspense>
                            </div>
                        </div>
                    )}
                </PayPalScriptProvider>
            </Suspense>
        );
    }
    return modalContent;
};

function RestorePurchasesButton({ t }) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(''); // 'restored' | 'none'

    const handleRestore = async () => {
        setLoading(true);
        setResult('');
        try {
            const { customerInfo } = await Purchases.restorePurchases();
            const hasActive = Object.keys(customerInfo.entitlements.active).length > 0;
            if (hasActive) {
                setResult('restored');
                setTimeout(() => window.location.reload(), 1200);
            } else {
                setResult('none');
            }
        } catch (e) {
            console.error('[RestorePurchases] failed:', e);
            setResult('none');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <button
                onClick={handleRestore}
                disabled={loading}
                style={{
                    background: 'none', border: 'none', color: '#6366f1',
                    fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '6px 12px', opacity: loading ? 0.6 : 1,
                }}
            >
                <RotateCcw size={14} />
                {loading ? (t('upgrade.processing')) : (t('upgrade.restorePurchases'))}
            </button>
            {result === 'restored' && (
                <p style={{ fontSize: '0.78rem', color: '#16a34a', margin: '4px 0 0' }}>
                    {t('upgrade.restoreSuccess')}
                </p>
            )}
            {result === 'none' && (
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '4px 0 0' }}>
                    {t('upgrade.restoreNone')}
                </p>
            )}
        </div>
    );
}

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function CancelSubscriptionButton({ userId, t }) {
    const [loading, setLoading] = useState(false);
    const isNativePlatform = Capacitor.isNativePlatform();

    const handleCancel = async () => {
        if (isNativePlatform) {
            // 네이티브: 구독 관리 페이지로 이동 (iOS: App Store / Android: Google Play)
            const storeFallback = Capacitor.getPlatform() === 'ios'
                ? 'https://apps.apple.com/account/subscriptions'
                : 'https://play.google.com/store/account/subscriptions';
            try {
                const { customerInfo } = await Purchases.getCustomerInfo();
                const mgmtUrl = customerInfo?.managementURL;
                if (mgmtUrl) {
                    window.open(mgmtUrl, '_blank');
                } else {
                    window.open(storeFallback, '_blank');
                }
            } catch {
                window.open(storeFallback, '_blank');
            }
            return;
        }

        // 웹: TossPayments 자동갱신 중지
        if (!confirm(t('upgrade.cancelConfirm'))) return;
        setLoading(true);
        try {
            await authFetch(`${SERVER_URL}/api/cancel-subscription`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
        } catch (e) {
            alert(t('upgrade.cancelFailed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <button className="upgrade-manage-btn" onClick={handleCancel} disabled={loading}>
            {loading ? t('upgrade.processing')
                : isNativePlatform ? t('upgrade.manageSubscription')
                : t('upgrade.cancelBtn')}
        </button>
    );
}

export default UpgradeModal;
