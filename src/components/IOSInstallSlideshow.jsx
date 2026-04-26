import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';

// iPhone 사용자에게 "공유 → 홈 화면에 추가" 절차를 풀스크린 슬라이드로 안내.
// LandingPage에서 iPhone UA + 비standalone + "다시 열지 않음" 미클릭 조건 만족 시 자동 호출.
// X 닫기는 "이번에만 닫기" — 재방문 시 다시 표시. "다시 열지 않음"만 영구 차단.
const SLIDES = [
    { src: '/install-guide/ios-step1.png', alt: 'iOS Step 1 — Tap Share button' },
    { src: '/install-guide/ios-step2.png', alt: 'iOS Step 2 — Add to Home Screen' },
];

const SLIDE_DURATION_MS = 3000;

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

    // X — 이번 세션만 닫기 (재방문 시 다시 표시)
    const handleSoftClose = () => onClose();

    // "다시 열지 않음" — 영구 차단
    const handleDontShowAgain = () => {
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
                        paddingTop: 'env(safe-area-inset-top, 0px)',
                        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                    }}
                >
                    {/* 상단: 캡션(왼쪽, 강조) + 닫기 X(오른쪽, 작게) */}
                    <div style={{
                        display: 'flex', alignItems: 'flex-start',
                        padding: '12px 14px 0',
                        gap: '12px',
                    }}>
                        <div style={{
                            flex: 1,
                            fontSize: '1.05rem', fontWeight: 700,
                            color: '#1d4ed8', lineHeight: 1.4,
                            paddingTop: '4px',
                        }}>
                            {index === 0
                                ? (t('install.iosStep1') || 'Tap the Share button at the bottom of your browser')
                                : (t('install.iosStep2') || 'Scroll down and tap "Add to Home Screen"')}
                        </div>
                        <button
                            onClick={handleSoftClose}
                            aria-label="Close"
                            style={{
                                flexShrink: 0,
                                width: '30px', height: '30px',
                                background: '#1e293b',
                                border: 'none', borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                                padding: 0,
                            }}
                        >
                            <X size={16} color="white" strokeWidth={2.75} />
                        </button>
                    </div>

                    {/* 이미지 영역 — 흰색 공간 최소화하기 위해 패딩 축소 */}
                    <div style={{
                        flex: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '8px 8px 4px',
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
                                    width: '100%', height: '100%',
                                    objectFit: 'cover', objectPosition: 'center',
                                    display: 'block',
                                    borderRadius: '12px',
                                }}
                            />
                        </AnimatePresence>
                    </div>

                    {/* 하단: 진행 점 + "다시 열지 않음" 버튼 */}
                    <div style={{
                        padding: '8px 20px 14px',
                        textAlign: 'center',
                        flexShrink: 0,
                    }}>
                        <div style={{
                            display: 'flex', justifyContent: 'center', gap: '8px',
                            marginBottom: '12px',
                        }}>
                            {SLIDES.map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setIndex(i)}
                                    aria-label={`Slide ${i + 1}`}
                                    style={{
                                        width: i === index ? '24px' : '9px',
                                        height: '9px',
                                        borderRadius: '5px',
                                        background: i === index ? '#1d4ed8' : '#cbd5e1',
                                        border: 'none', padding: 0, cursor: 'pointer',
                                        transition: 'all 0.25s',
                                    }}
                                />
                            ))}
                        </div>
                        <button
                            onClick={handleDontShowAgain}
                            style={{
                                background: 'transparent',
                                border: '1px solid #cbd5e1',
                                color: '#64748b',
                                padding: '8px 18px',
                                borderRadius: '999px',
                                fontSize: '0.85rem',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            {t('install.iosDontShowAgain') || "Don't show again"}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
