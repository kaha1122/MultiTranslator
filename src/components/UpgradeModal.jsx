import { useState } from 'react';
import { X, Zap, Crown, Check } from 'lucide-react';
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';
import { useAuth } from '../context/AuthContext';
import './UpgradeModal.css';

const TOSS_CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY;
const FRONTEND_URL = window.location.origin;

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

const UpgradeModal = ({ onClose }) => {
    const { user, profile } = useAuth();
    const [loadingTier, setLoadingTier] = useState(null);
    const [error, setError] = useState('');

    const handleUpgrade = async (tierId) => {
        if (!user) return;
        setLoadingTier(tierId);
        setError('');
        try {
            const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY);
            // customerKey = Firebase UID (구독자 식별자)
            const billing = tossPayments.billing({ customerKey: user.uid });
            await billing.requestBillingAuth({
                method: 'CARD',
                successUrl: `${FRONTEND_URL}?billing=success&tier=${tierId}&customerKey=${user.uid}&email=${encodeURIComponent(user.email || '')}`,
                failUrl:    `${FRONTEND_URL}?billing=fail`,
                customerEmail: user.email || undefined,
                customerName:  user.displayName || undefined,
            });
            // requestBillingAuth는 페이지를 리디렉트하므로 이 아래 코드는 실행되지 않음
        } catch (e) {
            setError('결제 페이지를 열 수 없습니다. 잠시 후 다시 시도해 주세요.');
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

                {isSubscribed && (
                    <CancelSubscriptionButton userId={user?.uid} />
                )}

                <p className="upgrade-footer-note">
                    언제든지 취소 가능 · 카드 정보는 토스페이먼츠에서 안전하게 처리됩니다
                </p>
            </div>
        </div>
    );
};

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function CancelSubscriptionButton({ userId }) {
    const [loading, setLoading] = useState(false);

    const handleCancel = async () => {
        if (!confirm('구독을 취소하시겠습니까? 즉시 Free Trial로 변경됩니다.')) return;
        setLoading(true);
        try {
            await fetch(`${SERVER_URL}/api/cancel-subscription`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
        } catch (e) {
            alert('취소 처리에 실패했습니다. 다시 시도해 주세요.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <button className="upgrade-manage-btn" onClick={handleCancel} disabled={loading}>
            {loading ? '처리 중...' : '구독 취소'}
        </button>
    );
}

export default UpgradeModal;
