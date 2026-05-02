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

    const scrollToIdx = (idx) => {
        const el = trackRef.current;
        if (!el) return;
        const cardWidth = el.scrollWidth / VOCAB_CATEGORIES.length;
        el.scrollTo({ left: cardWidth * idx, behavior: 'smooth' });
    };

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
