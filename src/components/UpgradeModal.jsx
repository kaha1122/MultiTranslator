import { useState } from 'react';
import { X, Zap, Crown, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './UpgradeModal.css';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const PLANS = [
    {
        id: 'pro',
        icon: <Zap size={22} />,
        name: 'Pro',
        price: '₩4,900',
        period: '/월',
        color: '#4338ca',
        borderColor: '#e0e7ff',
        bgColor: '#f5f3ff',
        features: [
            '발음 평가 월 500회',
            '개발자 API 사용 (키 불필요)',
            '모든 탭 무제한 이용',
        ],
    },
    {
        id: 'premium',
        icon: <Crown size={22} />,
        name: 'Premium',
        price: '₩16,900',
        period: '/월',
        color: '#b45309',
        borderColor: '#fde68a',
        bgColor: '#fffbeb',
        badge: 'BEST',
        features: [
            '발음 평가 무제한',
            '개발자 API 사용 (키 불필요)',
            '광고 없음',
            '모든 탭 무제한 이용',
        ],
    },
];

const UpgradeModal = ({ sourceLang, onClose }) => {
    const { user, profile } = useAuth();
    const [loadingTier, setLoadingTier] = useState(null);
    const [error, setError] = useState('');

    const handleUpgrade = async (tierId) => {
        if (!user) return;
        setLoadingTier(tierId);
        setError('');
        try {
            const res = await fetch(`${SERVER_URL}/api/create-checkout-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.uid,
                    userEmail: user.email,
                    tier: tierId,
                }),
            });
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                setError(data.error || '결제 페이지를 열 수 없습니다.');
            }
        } catch (e) {
            setError('서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            setLoadingTier(null);
        }
    };

    const handleManageSubscription = async () => {
        if (!profile?.stripeCustomerId) return;
        setLoadingTier('manage');
        try {
            const res = await fetch(`${SERVER_URL}/api/customer-portal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: profile.stripeCustomerId }),
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch (e) {
            setError('구독 관리 페이지를 열 수 없습니다.');
        } finally {
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
                    <h2>플랜 업그레이드</h2>
                    <p>더 많은 연습으로 빠르게 실력을 키우세요</p>
                </div>

                {error && (
                    <div className="upgrade-error">{error}</div>
                )}

                <div className="upgrade-plans">
                    {PLANS.map(plan => {
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
                                        <span className="upgrade-plan-period">{plan.period}</span>
                                    </div>
                                </div>

                                <ul className="upgrade-plan-features">
                                    {plan.features.map((f, i) => (
                                        <li key={i}>
                                            <Check size={14} style={{ color: plan.color, flexShrink: 0 }} />
                                            <span>{f}</span>
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
                                        ? '처리 중...'
                                        : isCurrentPlan
                                            ? '현재 플랜'
                                            : `${plan.name} 시작하기`}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {isSubscribed && profile?.stripeCustomerId && (
                    <button
                        className="upgrade-manage-btn"
                        onClick={handleManageSubscription}
                        disabled={loadingTier === 'manage'}
                    >
                        {loadingTier === 'manage' ? '처리 중...' : '구독 관리 / 취소'}
                    </button>
                )}

                <p className="upgrade-footer-note">
                    언제든지 취소 가능 · 카드 정보는 Stripe에서 안전하게 처리됩니다
                </p>
            </div>
        </div>
    );
};

export default UpgradeModal;
