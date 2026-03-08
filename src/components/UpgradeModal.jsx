import { useState } from 'react';
import { X, Zap, Crown, Check } from 'lucide-react';
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import './UpgradeModal.css';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY;
const FRONTEND_URL = window.location.origin;

const PLAN_CONFIGS = [
    {
        id: 'pro',
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '₩4,900',
        color: '#4338ca',
        borderColor: '#e0e7ff',
        bgColor: '#f5f3ff',
        featureKeys: ['upgrade.proFeature1', 'upgrade.proFeature2', 'upgrade.proFeature3'],
    },
    {
        id: 'premium',
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '₩16,900',
        color: '#b45309',
        borderColor: '#fde68a',
        bgColor: '#fffbeb',
        badge: 'BEST',
        featureKeys: ['upgrade.premiumFeature1', 'upgrade.premiumFeature2', 'upgrade.premiumFeature3', 'upgrade.premiumFeature4'],
    },
];

const UpgradeModal = ({ onClose, sourceLang }) => {
    const { user, profile } = useAuth();
    const t = useT(sourceLang);
    const [loadingTier, setLoadingTier] = useState(null);
    const [error, setError] = useState('');

    const handleUpgrade = async (tierId) => {
        if (!user) return;
        setLoadingTier(tierId);
        setError('');
        try {
            const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY);
            const billing = tossPayments.billing({ customerKey: user.uid });
            await billing.requestBillingAuth({
                method: 'CARD',
                successUrl: `${FRONTEND_URL}?billing=success&tier=${tierId}&customerKey=${user.uid}&email=${encodeURIComponent(user.email || '')}`,
                failUrl:    `${FRONTEND_URL}?billing=fail`,
                customerEmail: user.email || undefined,
                customerName:  user.displayName || undefined,
            });
        } catch (e) {
            setError(t('upgrade.paymentError'));
            setLoadingTier(null);
        }
    };

    const currentTier = profile?.tier || 'trial';
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

                <div className="upgrade-plans">
                    {PLAN_CONFIGS.map(plan => {
                        const isCurrentPlan = currentTier === plan.id;
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
                                <div className="upgrade-plan-header">
                                    <span className="upgrade-plan-icon" style={{ color: plan.color }}>
                                        {plan.icon}
                                    </span>
                                    <span className="upgrade-plan-name" style={{ color: plan.color }}>
                                        {plan.name}
                                    </span>
                                    <div className="upgrade-plan-price">
                                        <span className="upgrade-plan-amount" style={{ color: plan.color }}>
                                            {plan.price}
                                        </span>
                                        <span className="upgrade-plan-period">{t('upgrade.period')}</span>
                                    </div>
                                </div>

                                <ul className="upgrade-plan-features">
                                    {plan.featureKeys.map((key, i) => (
                                        <li key={i}>
                                            <Check size={14} style={{ color: plan.color, flexShrink: 0 }} />
                                            <span>{t(key)}</span>
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    className="upgrade-plan-btn"
                                    style={{
                                        background: isCurrentPlan ? '#e2e8f0' : plan.color,
                                        color: isCurrentPlan ? '#94a3b8' : 'white',
                                        cursor: isCurrentPlan ? 'default' : 'pointer',
                                    }}
                                    onClick={() => !isCurrentPlan && handleUpgrade(plan.id)}
                                    disabled={isCurrentPlan || loadingTier !== null}
                                >
                                    {loadingTier === plan.id
                                        ? t('upgrade.processing')
                                        : isCurrentPlan
                                            ? t('upgrade.currentPlan')
                                            : `${plan.name} ${t('upgrade.startPlan')}`}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {isSubscribed && (
                    <CancelSubscriptionButton userId={user?.uid} t={t} />
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
