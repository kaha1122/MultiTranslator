import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import { AlertTriangle, X } from 'lucide-react';
import './RenewalReminderPopup.css';

const REMINDER_DAYS = [10, 7, 2];

const RenewalReminderPopup = ({ sourceLang, onUpgrade }) => {
    const { profile, tier } = useAuth();
    const t = useT(sourceLang);
    const [visible, setVisible] = useState(false);
    const [daysLeft, setDaysLeft] = useState(null);

    useEffect(() => {
        if (tier !== 'pro' && tier !== 'premium') return;
        if (!profile?.subscriptionExpiresAt) return;
        // autoRenew가 true이고 결제 정상이면 알림 불필요 → autoRenew false일 때만 표시
        if (profile?.autoRenew === true) return;

        const expiresAt = profile.subscriptionExpiresAt.toDate
            ? profile.subscriptionExpiresAt.toDate()
            : new Date(profile.subscriptionExpiresAt);
        const now = new Date();
        const diffMs = expiresAt.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays <= 0 || diffDays > 10) return;

        // 15, 7, 2일 구간에 해당하는지 확인
        const matchedReminder = REMINDER_DAYS.find(d => diffDays <= d);
        if (!matchedReminder) return;

        // 같은 구간에서 이미 닫았으면 다시 안 보여줌 (localStorage)
        const dismissKey = `renewal_reminder_${matchedReminder}d_${expiresAt.toISOString().slice(0, 10)}`;
        if (localStorage.getItem(dismissKey)) return;

        setDaysLeft(diffDays);
        setVisible(true);
    }, [tier, profile?.subscriptionExpiresAt, profile?.autoRenew]);

    const handleDismiss = () => {
        if (!profile?.subscriptionExpiresAt) return;
        const expiresAt = profile.subscriptionExpiresAt.toDate
            ? profile.subscriptionExpiresAt.toDate()
            : new Date(profile.subscriptionExpiresAt);
        const matchedReminder = REMINDER_DAYS.find(d => daysLeft <= d);
        if (matchedReminder) {
            const dismissKey = `renewal_reminder_${matchedReminder}d_${expiresAt.toISOString().slice(0, 10)}`;
            localStorage.setItem(dismissKey, '1');
        }
        setVisible(false);
    };

    const handleUpgrade = () => {
        setVisible(false);
        onUpgrade();
    };

    if (!visible || daysLeft === null) return null;

    const urgency = daysLeft <= 2 ? 'urgent' : daysLeft <= 7 ? 'warning' : 'info';

    return (
        <div className="renewal-overlay" onClick={handleDismiss}>
            <div className={`renewal-popup renewal-${urgency}`} onClick={e => e.stopPropagation()}>
                <button className="renewal-close" onClick={handleDismiss}>
                    <X size={18} />
                </button>

                <div className="renewal-icon">
                    <AlertTriangle size={32} />
                </div>

                <h3 className="renewal-title">
                    {t('renewal.title')}
                </h3>

                <p className="renewal-desc">
                    {t('renewal.daysLeft').replace('{days}', daysLeft)}
                </p>

                <p className="renewal-sub">
                    {t('renewal.actionNeeded')}
                </p>

                <button className="renewal-btn" onClick={handleUpgrade}>
                    {t('renewal.renewBtn')}
                </button>

                <button className="renewal-dismiss" onClick={handleDismiss}>
                    {t('renewal.later')}
                </button>
            </div>
        </div>
    );
};

export default RenewalReminderPopup;
