import { useT } from '../utils/i18n';
import { useAuth } from '../context/AuthContext';
import { X } from 'lucide-react';

const TrialLimitModal = ({ sourceLang, pronCount, freeTalkCount = 0, listenCount = 0, onClose, onUpgrade, onWatchAd, rewardAdLoading = false }) => {
    const t = useT(sourceLang);
    // 2026-05-07 v1.5.0: 카드 한도 폐기. 발음/FT/Listen 한도(+credits 영구)만 표시.
    // 2026-05-23: Listening 한도 3 + listenCredits 추가 표시.
    const {
        TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, TRIAL_DAILY_LISTEN_LIMIT,
        pronCredits, freeTalkCredits, listenCredits,
    } = useAuth();
    // 네이티브 앱(Android/iOS)에서는 보상형 광고 버튼을 팝업에 직접 노출 → 바로 학습 재개.
    // 웹에서는 보상형 광고가 없으므로 기존 안내 + 업그레이드 흐름 유지.
    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    const showAdButtons = isNative && typeof onWatchAd === 'function';

    // 2026-06-03: 광고 시청 완료(보상 적립) 후 모달 닫기 — credits 반영되어 한도 해제됨.
    //   onWatchAd(=App.handleRewardedAd)는 Rewarded/Dismissed resolve 시까지 await.
    const handleWatch = async (type) => {
        if (!onWatchAd) return;
        await onWatchAd(type);
        onClose?.();
    };

    // 사이드바 보상형 광고 버튼과 동일한 디자인 — 색상만 종류별 차등.
    const rewardButtons = [
        {
            type: 'freeTalks', icon: '🎬',
            bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '#bbf7d0',
            titleColor: '#166534', descColor: '#4ade80',
            title: t('reward.watchForFreeTalk') || '+2 Free Talking',
            desc: t('reward.watchAdFreeTalk') || '광고 시청 후 Free Talking 2회 추가',
        },
        {
            type: 'prons', icon: '🎬',
            bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '#bfdbfe',
            titleColor: '#1e40af', descColor: '#60a5fa',
            title: t('reward.watchForProns') || '+5 발음',
            desc: t('reward.watchAdPron') || '광고 시청 후 발음 5회 추가',
        },
        {
            type: 'listens', icon: '🎬',
            bg: 'linear-gradient(135deg, #faf5ff, #ede9fe)', border: '#ddd6fe',
            titleColor: '#6d28d9', descColor: '#a78bfa',
            title: t('reward.watchForListen') || '+3 Listening',
            desc: t('reward.watchAdListen') || '광고 시청 후 Listening 3회 추가',
        },
    ];

    return (
        <div
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center',
                alignItems: 'center', zIndex: 2000,
                padding: '20px 20px calc(20px + max(env(safe-area-inset-bottom, 0px), var(--admob-bottom, 0px)))'
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'white', borderRadius: '24px', padding: '22px 24px',
                    width: '100%', maxWidth: '400px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
                    position: 'relative', maxHeight: '90vh', overflowY: 'auto'
                }}
            >
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}
                >
                    <X size={22} />
                </button>

                {/* 헤더 */}
                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '2.2rem', marginBottom: '4px' }}>🎯</div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem', color: '#1e293b', fontWeight: '800', lineHeight: 1.3 }}>
                        {t('trial.limitTitle')}
                    </h2>
                    <p style={{ margin: '0 0 2px', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.4 }}>
                        {t('trial.limitDesc')}
                    </p>
                </div>

                {showAdButtons ? (
                    <>
                        {/* 2026-06-03: 한도 도달 팝업에서 바로 보상형 광고 시청 → 학습 재개 유도 */}
                        {rewardButtons.map((b) => (
                            <button
                                key={b.type}
                                onClick={() => handleWatch(b.type)}
                                disabled={rewardAdLoading}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                                    padding: '12px 14px', marginBottom: '8px', borderRadius: '12px',
                                    background: b.bg, border: `1px solid ${b.border}`,
                                    cursor: rewardAdLoading ? 'default' : 'pointer', textAlign: 'left',
                                    opacity: rewardAdLoading ? 0.6 : 1,
                                }}>
                                <span style={{ fontSize: '1.3rem' }}>{b.icon}</span>
                                <div>
                                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: b.titleColor }}>
                                        {b.title}
                                    </div>
                                    <div style={{ fontSize: '0.74rem', color: b.descColor }}>
                                        {b.desc}
                                    </div>
                                </div>
                            </button>
                        ))}
                        {rewardAdLoading && (
                            <p style={{ fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center', margin: '6px 0 2px' }}>
                                {t('reward.loading') || '광고 로딩 중...'}
                            </p>
                        )}
                        {/* 업그레이드는 작은 보조 링크로 유지 (광고 없이 무제한 학습 안내) */}
                        <button
                            onClick={onUpgrade}
                            disabled={rewardAdLoading}
                            style={{
                                width: '100%', marginTop: '8px', padding: '8px', background: 'none',
                                border: 'none', color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600,
                                cursor: rewardAdLoading ? 'default' : 'pointer', textDecoration: 'underline',
                            }}
                        >
                            ✨ {t('trial.upgradeBtn')}
                        </button>
                    </>
                ) : (
                    <>
                        {/* 웹: 보상형 광고 미지원 → 기존 안내 + 사용량 + 업그레이드 버튼 유지 */}
                        <p style={{
                            margin: '6px 0 0',
                            color: '#6366f1',
                            fontSize: '0.9rem',
                            fontWeight: '700',
                            lineHeight: 1.45,
                            textAlign: 'center',
                            wordBreak: 'keep-all',
                        }}>
                            {t('trial.seeYouTomorrow')}
                        </p>
                        {/* 사용량 표시 — Free Talk + Pronunciation + Listening 3종 */}
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', margin: '10px 0 0', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                                💬 {freeTalkCount}/{TRIAL_FREETALK_DAILY_LIMIT + freeTalkCredits} /day
                            </span>
                            <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                                🎤 {pronCount ?? 0}/{TRIAL_DAILY_PRON_LIMIT + pronCredits} /day
                            </span>
                            <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '4px 10px', borderRadius: '20px', color: '#475569' }}>
                                🎧 {listenCount ?? 0}/{TRIAL_DAILY_LISTEN_LIMIT + listenCredits} /day
                            </span>
                        </div>
                        <button
                            onClick={onUpgrade}
                            style={{
                                width: '100%', marginTop: '16px', padding: '13px', background: '#4338ca', color: 'white',
                                border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer',
                                fontSize: '1rem'
                            }}
                        >
                            ✨ {t('trial.upgradeBtn')}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default TrialLimitModal;
