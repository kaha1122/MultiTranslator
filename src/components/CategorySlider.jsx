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
    //   - mount 직후엔 layout 안정 후 scroll (scrollWidth=0 회피)
    //   - 첫 mount 시 'auto' (smooth 없이 즉시), 이후 변경엔 'smooth'
    const didInitRef = useRef(false);
    useEffect(() => {
        if (!selectedCatId) return;
        const idx = VOCAB_CATEGORIES.findIndex(c => c.id === selectedCatId);
        if (idx < 0) return;
        const behavior = didInitRef.current ? 'smooth' : 'auto';
        // 다음 frame까지 대기 — trackRef layout 안정 보장
        const raf = requestAnimationFrame(() => {
            scrollToIdx(idx, behavior);
            didInitRef.current = true;
        });
        return () => cancelAnimationFrame(raf);
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
