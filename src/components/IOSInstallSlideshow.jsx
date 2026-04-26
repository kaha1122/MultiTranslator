import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';

// iPhone 사용자에게 "Safari 공유 → 홈 화면에 추가" 절차를 보여주는 자동 슬라이드.
// LandingPage에서 iPhone UA + 비standalone + 미열람 조건 만족 시 자동 호출.
const SLIDES = [
    { src: '/install-guide/ios-step1.png', alt: 'iOS Step 1 — Tap Share button' },
    { src: '/install-guide/ios-step2.png', alt: 'iOS Step 2 — Add to Home Screen' },
];

const SLIDE_DURATION_MS = 1000; // 사용자 요청: 1초마다 자동 전환

export default function IOSInstallSlideshow({ open, onClose, sourceLang }) {
    const t = useT(sourceLang);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (!open) return;
        setIndex(0);
        const timer = setInterval(() => {
            setIndex((i) => (i + 1) % SLIDES.length);
        }, SLIDE_DURATION_MS);
        return () => clearInterval(timer);
    }, [open]);

    if (!open) return null;

    const handleClose = () => {
        try { localStorage.setItem('iosInstallSlideshowSeen', String(Date.now())); } catch {}
        onClose();
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={handleClose}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '16px',
                    }}
                >
                    <motion.div
                        initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'white', borderRadius: '18px', padding: '14px',
                            maxWidth: '380px', width: '100%', maxHeight: '92vh', overflow: 'hidden',
                            boxShadow: '0 12px 48px rgba(0,0,0,0.3)',
                            position: 'relative',
                            display: 'flex', flexDirection: 'column',
                        }}
                    >
                        {/* 닫기 — 스크린샷 위 우상단 */}
                        <button
                            onClick={handleClose}
                            aria-label="Close"
                            style={{
                                position: 'absolute', top: '10px', right: '10px',
                                background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
                                width: '32px', height: '32px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', zIndex: 2,
                            }}
                        >
                            <X size={18} color="white" />
                        </button>

                        {/* 슬라이드 영역 */}
                        <div style={{
                            position: 'relative', width: '100%',
                            borderRadius: '12px', overflow: 'hidden',
                            background: '#000',
                            aspectRatio: '9 / 16',
                        }}>
                            <AnimatePresence mode="wait">
                                <motion.img
                                    key={SLIDES[index].src}
                                    src={SLIDES[index].src}
                                    alt={SLIDES[index].alt}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.35 }}
                                    style={{
                                        position: 'absolute', inset: 0,
                                        width: '100%', height: '100%',
                                        objectFit: 'contain',
                                    }}
                                />
                            </AnimatePresence>

                            {/* 진행 점(클릭으로 수동 전환) */}
                            <div style={{
                                position: 'absolute', bottom: '10px', left: 0, right: 0,
                                display: 'flex', justifyContent: 'center', gap: '6px',
                                pointerEvents: 'auto',
                            }}>
                                {SLIDES.map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setIndex(i)}
                                        aria-label={`Slide ${i + 1}`}
                                        style={{
                                            width: i === index ? '20px' : '8px',
                                            height: '8px',
                                            borderRadius: '4px',
                                            background: i === index ? 'white' : 'rgba(255,255,255,0.55)',
                                            border: 'none', padding: 0, cursor: 'pointer',
                                            transition: 'width 0.25s, background 0.25s',
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* 캡션 — 어떤 단계인지 텍스트로도 안내 */}
                        <div style={{
                            marginTop: '10px',
                            textAlign: 'center', fontSize: '0.85rem',
                            color: '#1e293b', fontWeight: 600, lineHeight: 1.4,
                            minHeight: '2.4em',
                        }}>
                            {index === 0
                                ? (t('install.iosStep1') || 'Tap the Share button at the bottom of Safari')
                                : (t('install.iosStep2') || 'Scroll down and tap "Add to Home Screen"')}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
