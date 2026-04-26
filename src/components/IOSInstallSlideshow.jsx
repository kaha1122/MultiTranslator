import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';

// iPhone 사용자에게 "Safari 공유 → 홈 화면에 추가" 절차를 풀스크린 슬라이드로 안내.
// LandingPage에서 iPhone UA + 비standalone + 미열람 조건 만족 시 자동 호출.
const SLIDES = [
    { src: '/install-guide/ios-step1.png', alt: 'iOS Step 1 — Tap Share button' },
    { src: '/install-guide/ios-step2.png', alt: 'iOS Step 2 — Add to Home Screen' },
];

const SLIDE_DURATION_MS = 3000; // 3초 — 0.4s fade 양옆을 빼도 ~2.2s 시청 확보

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
                    style={{
                        position: 'fixed', inset: 0,
                        background: 'white',
                        zIndex: 10000,
                        display: 'flex', flexDirection: 'column',
                        // safe-area 반영 (notch / home indicator)
                        paddingTop: 'env(safe-area-inset-top, 0px)',
                        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                    }}
                >
                    {/* 닫기 — 풀스크린 우상단 안전 영역, 큰 탭 타깃 */}
                    <button
                        onClick={handleClose}
                        aria-label="Close"
                        style={{
                            position: 'absolute',
                            top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
                            right: '14px',
                            width: '44px', height: '44px',
                            background: '#1e293b',
                            border: 'none', borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', zIndex: 10001,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                            padding: 0,
                        }}
                    >
                        <X size={24} color="white" strokeWidth={2.5} />
                    </button>

                    {/* 이미지 영역 — 중앙 차지, contain으로 비율 유지 */}
                    <div style={{
                        flex: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '74px 16px 8px', // 상단 닫기 버튼 영역 확보
                        overflow: 'hidden',
                        minHeight: 0,
                    }}>
                        <AnimatePresence mode="wait">
                            <motion.img
                                key={SLIDES[index].src}
                                src={SLIDES[index].src}
                                alt={SLIDES[index].alt}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.4 }}
                                style={{
                                    maxWidth: '100%', maxHeight: '100%',
                                    objectFit: 'contain',
                                    display: 'block',
                                    borderRadius: '14px',
                                }}
                            />
                        </AnimatePresence>
                    </div>

                    {/* 하단: 진행 점 + 캡션 */}
                    <div style={{
                        padding: '12px 20px 18px',
                        textAlign: 'center',
                        flexShrink: 0,
                    }}>
                        <div style={{
                            display: 'flex', justifyContent: 'center', gap: '8px',
                            marginBottom: '10px',
                        }}>
                            {SLIDES.map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setIndex(i)}
                                    aria-label={`Slide ${i + 1}`}
                                    style={{
                                        width: i === index ? '28px' : '10px',
                                        height: '10px',
                                        borderRadius: '5px',
                                        background: i === index ? '#1d4ed8' : '#cbd5e1',
                                        border: 'none', padding: 0, cursor: 'pointer',
                                        transition: 'all 0.25s',
                                    }}
                                />
                            ))}
                        </div>
                        <div style={{
                            fontSize: '0.95rem', fontWeight: 600,
                            color: '#1e293b', lineHeight: 1.4,
                            minHeight: '2.6em',
                        }}>
                            {index === 0
                                ? (t('install.iosStep1') || 'Tap the Share button at the bottom of Safari')
                                : (t('install.iosStep2') || 'Scroll down and tap "Add to Home Screen"')}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
