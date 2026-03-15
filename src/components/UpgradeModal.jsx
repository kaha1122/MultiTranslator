import { useState } from 'react';
import { X, Zap, Crown, Check, ShieldCheck } from 'lucide-react';
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import './UpgradeModal.css';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY;
const FRONTEND_URL = window.location.origin;

const PLAN_CONFIGS = [
    {
        id: 'pro_1',
        tier: 'pro',
        months: 1,
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '₩9,900',
        priceNum: 9900,
        color: '#4338ca',
        borderColor: '#e0e7ff',
        bgColor: '#f5f3ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3'],
    },
    {
        id: 'pro_3',
        tier: 'pro',
        months: 3,
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '₩16,500',
        priceNum: 16500,
        discount: 44,
        badge: 'BEST',
        color: '#4338ca',
        borderColor: '#c7d2fe',
        bgColor: '#eef2ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature3'],
    },
    {
        id: 'premium_1',
        tier: 'premium',
        months: 1,
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '₩19,900',
        priceNum: 19900,
        color: '#b45309',
        borderColor: '#fde68a',
        bgColor: '#fffbeb',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4'],
    },
    {
        id: 'premium_3',
        tier: 'premium',
        months: 3,
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '₩55,000',
        priceNum: 55000,
        discount: 8,
        badge: 'BEST',
        color: '#b45309',
        borderColor: '#fcd34d',
        bgColor: '#fef9c3',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4'],
    },
];

const UpgradeModal = ({ onClose, sourceLang, onRequestPhoneVerify }) => {
    const { user, profile } = useAuth();
    const t = useT(sourceLang);
    const [loadingPlan, setLoadingPlan] = useState(null);
    const [error, setError] = useState('');
    const [showPhoneWarning, setShowPhoneWarning] = useState(false);

    const handleUpgrade = async (plan) => {
        if (!user) return;

        // 전화번호 인증 확인
        if (!profile?.phoneVerified) {
            setShowPhoneWarning(true);
            return;
        }

        setLoadingPlan(plan.id);
        setError('');
        try {
            const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY);
            const payment = tossPayments.payment({ customerKey: user.uid });
            await payment.requestBillingAuth({
                method: 'CARD',
                successUrl: `${FRONTEND_URL}?billing=success&tier=${plan.tier}&planId=${plan.id}&months=${plan.months}&customerKey=${user.uid}&email=${encodeURIComponent(user.email || '')}`,
                failUrl:    `${FRONTEND_URL}?billing=fail`,
                customerEmail: user.email || undefined,
                customerName:  user.displayName || undefined,
            });
        } catch (e) {
            setError(t('upgrade.paymentError'));
            setLoadingPlan(null);
        }
    };

    const currentTier = profile?.tier || 'trial';
    const currentPlanId = profile?.planId || null;
    const isSubscribed = currentTier === 'pro' || currentTier === 'premium';

    return (
        <div className="upgrade-overlay" onClick={onClose}>
            <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
                <button className="upgrade-close-btn" onClick={onClose}>
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

                {showPhoneWarning && (
                    <div style={{
                        background: '#fef3c7', border: '1.5px solid #fbbf24', borderRadius: '12px',
                        padding: '14px 16px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '10px'
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

                {/* Pro Plans */}
                <div className="upgrade-tier-group">
                    <div className="upgrade-tier-label" style={{ color: '#4338ca' }}>
                        <Zap size={16} /> Pro
                    </div>
                    <div className="upgrade-plans-row">
                        {PLAN_CONFIGS.filter(p => p.tier === 'pro').map(plan => {
                            const isCurrentPlan = currentPlanId === plan.id || (currentTier === plan.tier && !currentPlanId && plan.months === 1);
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
                                        {plan.months === 1 ? `1${t('upgrade.period1m')}` : t('upgrade.period3m')}
                                        {plan.months === 3 && <span className="upgrade-plan-onetag">{t('upgrade.oneTime')}</span>}
                                    </div>
                                    <div className="upgrade-plan-price-block">
                                        <span className="upgrade-plan-amount" style={{ color: plan.color }}>
                                            {plan.price}
                                        </span>
                                    </div>
                                    <div className="upgrade-plan-discount-line">
                                        {plan.discount ? (
                                            <span className="upgrade-plan-discount">{plan.discount}% {t('upgrade.discount')}</span>
                                        ) : (
                                            <span className="upgrade-plan-discount-spacer">&nbsp;</span>
                                        )}
                                    </div>

                                    <button
                                        className="upgrade-plan-btn"
                                        style={{
                                            background: isCurrentPlan ? '#e2e8f0' : plan.color,
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
                    {/* Pro features (shared) */}
                    <ul className="upgrade-plan-features">
                        {PLAN_CONFIGS[0].featureKeys.map((key, i) => (
                            <li key={i}>
                                <Check size={14} style={{ color: '#4338ca', flexShrink: 0 }} />
                                <span>{t(key)}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Premium Plans */}
                <div className="upgrade-tier-group" style={{ marginTop: '16px' }}>
                    <div className="upgrade-tier-label" style={{ color: '#b45309' }}>
                        <Crown size={16} /> Premium
                    </div>
                    <div className="upgrade-plans-row">
                        {PLAN_CONFIGS.filter(p => p.tier === 'premium').map(plan => {
                            const isCurrentPlan = currentPlanId === plan.id || (currentTier === plan.tier && !currentPlanId && plan.months === 1);
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
                                        {plan.months === 1 ? `1${t('upgrade.period1m')}` : t('upgrade.period3m')}
                                        {plan.months === 3 && <span className="upgrade-plan-onetag">{t('upgrade.oneTime')}</span>}
                                    </div>
                                    <div className="upgrade-plan-price-block">
                                        <span className="upgrade-plan-amount" style={{ color: plan.color }}>
                                            {plan.price}
                                        </span>
                                    </div>
                                    <div className="upgrade-plan-discount-line">
                                        {plan.discount ? (
                                            <span className="upgrade-plan-discount">{plan.discount}% {t('upgrade.discount')}</span>
                                        ) : (
                                            <span className="upgrade-plan-discount-spacer">&nbsp;</span>
                                        )}
                                    </div>

                                    <button
                                        className="upgrade-plan-btn"
                                        style={{
                                            background: isCurrentPlan ? '#e2e8f0' : plan.color,
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
                        {PLAN_CONFIGS[2].featureKeys.map((key, i) => (
                            <li key={i}>
                                <Check size={14} style={{ color: '#b45309', flexShrink: 0 }} />
                                <span>{t(key)}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {isSubscribed && profile?.autoRenew === true && (
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

                <p className="upgrade-footer-note">
                    {t('upgrade.footerNote')}
                </p>
            </div>
        </div>
    );
};

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function CancelSubscriptionButton({ userId, t }) {
    const [loading, setLoading] = useState(false);

    const handleCancel = async () => {
        if (!confirm(t('upgrade.cancelConfirm'))) return;
        setLoading(true);
        try {
            await fetch(`${SERVER_URL}/api/cancel-subscription`, {
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
            {loading ? t('upgrade.processing') : t('upgrade.cancelBtn')}
        </button>
    );
}

export default UpgradeModal;
