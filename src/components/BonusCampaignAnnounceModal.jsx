import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';

// 보너스 포인트 캠페인 출시 안내 — 1회 표시 후 dismiss
// 트리거: lifecycleStage !== null && hasCompletedOnboarding && !bonusCampaignSeenAt
export default function BonusCampaignAnnounceModal({ open, onClose, onCta, sourceLang }) {
    const t = useT(sourceLang);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={onClose}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '16px',
                    }}
                >
                    <motion.div
                        initial={{ scale: 0.92, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.92, opacity: 0, y: 10 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'white', borderRadius: '20px', padding: '24px',
                            maxWidth: '420px', width: '100%', maxHeight: '90vh', overflow: 'auto',
                            boxShadow: '0 20px 60px rgba(29, 78, 216, 0.25)',
                            position: 'relative',
                        }}
                    >
                        {/* 닫기 X */}
                        <button onClick={onClose} style={{
                            position: 'absolute', top: '12px', right: '12px',
                            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                        }}>
                            <X size={20} color="#94a3b8" />
                        </button>

                        {/* 타이틀 */}
                        <div style={{
                            fontSize: '1.15rem', fontWeight: 800, color: '#1d4ed8',
                            marginBottom: '8px', textAlign: 'center', paddingTop: '4px',
                        }}>
                            {t('bonus.campaign.title')}
                        </div>

                        {/* 설명 */}
                        <div style={{
                            fontSize: '0.85rem', color: '#475569', lineHeight: 1.5,
                            marginBottom: '16px', textAlign: 'center',
                        }}>
                            {t('bonus.campaign.desc')}
                        </div>

                        {/* 3가지 혜택 */}
                        <div style={{
                            background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                            borderRadius: '12px', padding: '14px', marginBottom: '16px',
                            border: '1px solid #93c5fd',
                        }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e40af', marginBottom: '8px' }}>
                                {t('bonus.campaign.feature1')}
                            </div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e40af', marginBottom: '8px' }}>
                                {t('bonus.campaign.feature2')}
                            </div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e40af' }}>
                                {t('bonus.campaign.feature3')}
                            </div>
                        </div>

                        {/* 버튼 2개 */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={onClose} style={{
                                flex: 1, padding: '12px', borderRadius: '10px',
                                background: 'white', border: '1px solid #e2e8f0',
                                color: '#64748b', fontWeight: 600, fontSize: '0.9rem',
                                cursor: 'pointer',
                            }}>
                                {t('bonus.campaign.later')}
                            </button>
                            <button onClick={onCta} style={{
                                flex: 1, padding: '12px', borderRadius: '10px',
                                background: '#2563eb', border: 'none',
                                color: 'white', fontWeight: 700, fontSize: '0.9rem',
                                cursor: 'pointer',
                            }}>
                                {t('bonus.campaign.cta')}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
