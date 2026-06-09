import { useT } from '../utils/i18n';
import { useAuth } from '../context/AuthContext';
import { X } from 'lucide-react';

// 2026-06-07 개편: 한도 모달 — 사유(reason)에 따라 3가지.
//   'cap'       : Trial 하드캡 도달(오늘 더 못함) → 업그레이드만. 충전 무의미.
//   'points'    : Trial 포인트 부족 → 업그레이드 + 보상광고 충전(+5) + 사용 항목별 차감 안내.
//   'proMonthly': Pro 월 한도 도달 → 다음 달 리셋 안내 + Premium 업그레이드.
const TrialLimitModal = ({
    sourceLang, pronCount, freeTalkCount = 0, listenCount = 0,
    onClose, onUpgrade, reason = 'cap', bonusPoints = 0, onCharge, rewardAdLoading = false,
    onBuyPoints, buyingPoints = false, pointsPriceString = '',
}) => {
    const t = useT(sourceLang);
    const {
        TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, TRIAL_DAILY_LISTEN_LIMIT,
        PRO_PRON_LIMIT, PRO_FREETALK_LIMIT, PRO_LISTEN_LIMIT,
        proPronCount, proFreeTalkCount, proListenCount,
    } = useAuth();
    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.(); // 충전 버튼(보상광고)은 앱 전용

    const overlay = {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'var(--modal-overlay-bg)', display: 'flex', justifyContent: 'center',
        alignItems: 'center', zIndex: 'var(--z-modal)',
        padding: '20px 20px calc(20px + max(env(safe-area-inset-bottom, 0px), var(--admob-bottom, 0px)))'
    };
    const card = {
        background: 'white', borderRadius: 'var(--modal-radius)', padding: '22px 24px',
        width: '100%', maxWidth: '400px', boxShadow: 'var(--modal-shadow)',
        position: 'relative', maxHeight: '90vh', overflowY: 'auto'
    };

    // ── Pro 월 한도 도달 모달 ──────────────────────────────────────────
    if (reason === 'proMonthly') {
        const rows = [
            { icon: '💬', label: 'Free-Talking', cur: proFreeTalkCount, lim: PRO_FREETALK_LIMIT },
            { icon: '🎤', label: t('settings.usagePron') || 'Pronunciation', cur: proPronCount, lim: PRO_PRON_LIMIT },
            { icon: '🎧', label: 'Listening', cur: proListenCount, lim: PRO_LISTEN_LIMIT },
        ];
        return (
            <div style={overlay} onClick={onClose}>
                <div onClick={e => e.stopPropagation()} style={card}>
                    <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
                    <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                        <div style={{ fontSize: '2.2rem', marginBottom: '4px' }}>📅</div>
                        <h2 style={{ margin: '0 0 4px', fontSize: '1.12rem', color: '#1e293b', fontWeight: 800, lineHeight: 1.3 }}>
                            {t('trial.proLimitTitle') || '이번 달 한도에 도달했어요'}
                        </h2>
                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.84rem', lineHeight: 1.4 }}>
                            {t('trial.proLimitDesc') || '다음 달 1일에 초기화됩니다'}
                        </p>
                    </div>
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {rows.map((r) => (
                                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#475569' }}>
                                    <span>{r.icon} {r.label}</span>
                                    <span style={{ fontWeight: 700, color: r.cur >= r.lim ? '#dc2626' : '#475569' }}>{r.cur}/{r.lim}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: '#7c3aed', fontWeight: 700, textAlign: 'center' }}>
                        ✨ {t('trial.proUpgradeHint') || 'Premium은 한도 없이 무제한'}
                    </p>
                    <button
                        onClick={onUpgrade}
                        style={{
                            width: '100%', padding: '13px', background: 'var(--brand-primary)', color: 'white',
                            border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem',
                        }}
                    >
                        ✨ {t('trial.proUpgradeBtn') || 'Premium 업그레이드'}
                    </button>
                </div>
            </div>
        );
    }

    // ── 포인트 부족 모달 ──────────────────────────────────────────────
    if (reason === 'points') {
        const costs = [
            { icon: '💬', label: 'Free-Talking', cost: 10 },
            { icon: '🎧', label: 'Listening', cost: 5 },
            { icon: '🎤', label: t('settings.usagePron') || 'Pronunciation', cost: 2 },
            { icon: '✦', label: t('trial.costOther') || 'Other', cost: 1 },
        ];
        return (
            <div style={overlay} onClick={onClose}>
                <div onClick={e => e.stopPropagation()} style={card}>
                    <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>

                    {/* 헤더 */}
                    <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                        <div style={{ fontSize: '2.2rem', marginBottom: '4px' }}>🎁</div>
                        <h2 style={{ margin: '0 0 4px', fontSize: '1.12rem', color: '#1e293b', fontWeight: 800, lineHeight: 1.3 }}>
                            {t('trial.pointsTitle') || '포인트가 부족합니다'}
                        </h2>
                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.84rem', lineHeight: 1.4 }}>
                            {t('trial.pointsDesc') || '포인트를 충전하시거나, 구독하여 주십시오'}
                        </p>
                        <p style={{ margin: '6px 0 0', color: '#dc2626', fontSize: '0.82rem', fontWeight: 700 }}>
                            🎁 {bonusPoints}
                        </p>
                    </div>

                    {/* 영역 1: 구독(Pro) */}
                    <div style={{ border: '1px solid #e0e7ff', borderRadius: '14px', padding: '12px', marginBottom: '10px', background: '#f5f7ff' }}>
                        <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: '#4338ca', fontWeight: 700, lineHeight: 1.4 }}>
                            ✨ {t('trial.pointsUpgradeHint') || '구독하면 한도·포인트 없이 무제한'}
                        </p>
                        <button
                            onClick={onUpgrade}
                            style={{
                                width: '100%', padding: '12px', background: 'var(--brand-primary)', color: 'white',
                                border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.95rem',
                            }}
                        >
                            ✨ {t('trial.upgradeBtn')}
                        </button>
                    </div>

                    {/* 영역 2: 충전(+5, 앱 전용) + 사용 항목별 차감(간략) */}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px' }}>
                        {isNative && typeof onCharge === 'function' && (
                            <button
                                onClick={() => onCharge()}
                                disabled={rewardAdLoading}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                    padding: '12px', marginBottom: '10px', borderRadius: '12px',
                                    background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #bbf7d0',
                                    cursor: rewardAdLoading ? 'default' : 'pointer', opacity: rewardAdLoading ? 0.6 : 1,
                                    fontWeight: 700, color: '#166534', fontSize: '0.9rem',
                                }}>
                                🎬 {t('reward.topUpBonus') || '보너스포인트 (광고) +5'}
                            </button>
                        )}
                        {/* 보너스포인트 구매 (+200, 인앱 결제) — 앱 전용 + 가격 조회 성공 시 */}
                        {isNative && typeof onBuyPoints === 'function' && pointsPriceString && (
                            <button
                                onClick={() => onBuyPoints()}
                                disabled={buyingPoints}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                    padding: '12px', marginBottom: '10px', borderRadius: '12px',
                                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '1px solid #bfdbfe',
                                    cursor: buyingPoints ? 'default' : 'pointer', opacity: buyingPoints ? 0.6 : 1,
                                    fontWeight: 700, color: '#1e40af', fontSize: '0.9rem',
                                }}>
                                🪙 {(t('reward.buyBonus') || '보너스포인트 (구매) +200')} · {buyingPoints ? (t('reward.buying') || '구매 처리 중...') : pointsPriceString}
                            </button>
                        )}
                        {rewardAdLoading && (
                            <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', margin: '0 0 8px' }}>
                                {t('reward.loading') || '광고 로딩 중...'}
                            </p>
                        )}
                        <p style={{ margin: '0 0 6px', fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.03em' }}>
                            {t('trial.costGuideTitle') || '사용 시 차감 포인트'}
                        </p>
                        {/* 간략: 한 줄 칩(아이콘+라벨 −비용), 줄바꿈 허용 */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', fontSize: '0.8rem', color: '#475569' }}>
                            {costs.map((c) => (
                                <span key={c.label} style={{ whiteSpace: 'nowrap' }}>
                                    {c.icon} {c.label} <b style={{ color: '#dc2626' }}>−{c.cost}</b>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── 하드캡 도달 모달 (기본) ───────────────────────────────────────
    return (
        <div style={overlay} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={card}>
                <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>

                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '2.2rem', marginBottom: '4px' }}>🎯</div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem', color: '#1e293b', fontWeight: '800', lineHeight: 1.3 }}>
                        {t('trial.limitTitle')}
                    </h2>
                    <p style={{ margin: '0 0 2px', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.4 }}>
                        {t('trial.limitDesc')}
                    </p>
                </div>

                <p style={{
                    margin: '6px 0 0', color: '#6366f1', fontSize: '0.9rem', fontWeight: '700',
                    lineHeight: 1.45, textAlign: 'center', wordBreak: 'keep-all',
                }}>
                    {t('trial.seeYouTomorrow')}
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', margin: '10px 0 0', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                        💬 {freeTalkCount}/{TRIAL_FREETALK_DAILY_LIMIT} /day
                    </span>
                    <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                        🎤 {pronCount ?? 0}/{TRIAL_DAILY_PRON_LIMIT} /day
                    </span>
                    <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                        🎧 {listenCount ?? 0}/{TRIAL_DAILY_LISTEN_LIMIT} /day
                    </span>
                </div>
                <button
                    onClick={onUpgrade}
                    style={{
                        width: '100%', marginTop: '16px', padding: '13px', background: 'var(--brand-primary)', color: 'white',
                        border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem'
                    }}
                >
                    ✨ {t('trial.upgradeBtn')}
                </button>
            </div>
        </div>
    );
};

export default TrialLimitModal;
