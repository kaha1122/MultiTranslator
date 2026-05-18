import { useRef, useState, useEffect, useCallback } from 'react';
import { useT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import { getCatTheme } from '../data/categoryTheme';
import './CategorySlider.css';

export default function CategorySlider({
    sourceLang,
    onCategoryClick,
    selectedCatId = null,
}) {
    const t = useT(sourceLang);
    const trackRef = useRef(null);
    const [activeIdx, setActiveIdx] = useState(0);

    // 스크롤 위치 -> activeIdx 갱신
    const handleScroll = useCallback(() => {
        const el = trackRef.current;
        if (!el) return;
        const cardWidth = el.scrollWidth / VOCAB_CATEGORIES.length;
        const idx = Math.round(el.scrollLeft / cardWidth);
        setActiveIdx(Math.max(0, Math.min(VOCAB_CATEGORIES.length - 1, idx)));
    }, []);

    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    const scrollToIdx = (idx, behavior = 'smooth') => {
        const el = trackRef.current;
        if (!el) return;
        const cardWidth = el.scrollWidth / VOCAB_CATEGORIES.length;
        el.scrollTo({ left: cardWidth * idx, behavior });
    };

    // 2026-05-19: selectedCatId 변경 시 해당 카드로 자동 스크롤 (random topic 선택 시 카테고리 동기화).
    //   - VocabTab/ListeningTab은 display:none 상태로 선마운트되므로 mount 시점엔 scrollWidth=0.
    //     단순 requestAnimationFrame으로는 부족 (display 전환 타이밍과 race).
    //   - 즉시 scroll 시도 후 실패하면 ResizeObserver로 trackRef 너비 0→양수 전환 감지 후 1회 실행.
    //   - 첫 발화는 'auto' (smooth 없이 즉시 정렬), 이후 변경엔 'smooth'.
    const didInitRef = useRef(false);
    useEffect(() => {
        if (!selectedCatId) return;
        const idx = VOCAB_CATEGORIES.findIndex(c => c.id === selectedCatId);
        if (idx < 0) return;
        const el = trackRef.current;
        if (!el) return;

        let done = false;
        const tryScroll = () => {
            if (done) return false;
            if (el.scrollWidth > 0) {
                scrollToIdx(idx, didInitRef.current ? 'smooth' : 'auto');
                didInitRef.current = true;
                done = true;
                return true;
            }
            return false;
        };

        // 즉시 시도 (display 이미 활성 케이스)
        if (tryScroll()) return;

        // layout 안 됐으면 ResizeObserver로 너비 변화 감지
        if (typeof ResizeObserver === 'undefined') {
            // 폴백: 짧은 폴링
            const tid = setInterval(() => { if (tryScroll()) clearInterval(tid); }, 100);
            setTimeout(() => clearInterval(tid), 3000);
            return () => { done = true; clearInterval(tid); };
        }
        const ro = new ResizeObserver(() => tryScroll());
        ro.observe(el);
        return () => { done = true; ro.disconnect(); };
    }, [selectedCatId]);

    return (
        <div className="cat-slider">
            <div className="cat-slider__track" ref={trackRef}>
                {VOCAB_CATEGORIES.map((cat, idx) => {
                    const isSelected = selectedCatId === cat.id;
                    const theme = getCatTheme(cat.id).base;
                    return (
                        <button
                            key={cat.id}
                            className={`cat-slider__card ${isSelected ? 'is-selected' : ''}`}
                            style={{ '--cat-theme': theme }}
                            onClick={() => onCategoryClick?.(cat.id)}
                            aria-label={t(`vocabCat.${cat.id}`)}
                        >
                            <img
                                src={`/category-cards/${cat.id}.webp`}
                                alt=""
                                loading={idx <= 1 ? 'eager' : 'lazy'}
                                draggable="false"
                                className="cat-slider__img"
                            />
                            <span className="cat-slider__shade" />
                            <span className="cat-slider__label-wrap">
                                <span className="cat-slider__icon" aria-hidden="true">{cat.icon}</span>
                                <span className="cat-slider__label">{t(`vocabCat.${cat.id}`)}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="cat-slider__dots" role="tablist" aria-label="categories">
                {VOCAB_CATEGORIES.map((cat, idx) => (
                    <button
                        key={cat.id}
                        type="button"
                        className={`cat-slider__dot ${idx === activeIdx ? 'is-active' : ''}`}
                        style={{ '--cat-theme': getCatTheme(cat.id).base }}
                        onClick={() => scrollToIdx(idx)}
                        aria-label={t(`vocabCat.${cat.id}`)}
                        aria-selected={idx === activeIdx}
                    />
                ))}
            </div>
        </div>
    );
}
