import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import { getCatTheme } from '../data/categoryTheme';
import { playStarSound } from '../utils/soundEffects';
import './TopicPickerModal.css';

export default function TopicPickerModal({
    catId,
    sourceLang,
    selectedTopic,
    onTopicSelect,
    onClose,
}) {
    const t = useT(sourceLang);
    const sheetRef = useRef(null);
    const cat = VOCAB_CATEGORIES.find(c => c.id === catId);

    // ESC로 닫기 + body 스크롤 잠금
    useEffect(() => {
        if (!cat) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [cat, onClose]);

    if (!cat) return null;

    const theme = getCatTheme(cat.id);
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) onClose?.();
    };

    const handlePick = (subId, topicId) => {
        try { playStarSound(); } catch { /* sound is best-effort */ }
        onTopicSelect?.(cat.id, subId, topicId);
        onClose?.();
    };

    return (
        <div
            className="topic-picker-backdrop"
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-label={t(`vocabCat.${cat.id}`)}
        >
            <div
                className="topic-picker-sheet"
                ref={sheetRef}
                style={{
                    '--cat-theme': theme.base,
                    '--cat-theme-dark': theme.dark,
                }}
            >
                {/* Header — image thumb + title + close */}
                <div className="topic-picker-header">
                    <div className="topic-picker-thumb">
                        <img
                            src={`/category-cards/${cat.id}.webp`}
                            alt=""
                            loading="eager"
                            draggable="false"
                        />
                    </div>
                    <div className="topic-picker-title-wrap">
                        <div className="topic-picker-icon" aria-hidden="true">{cat.icon}</div>
                        <h3 className="topic-picker-title">{t(`vocabCat.${cat.id}`)}</h3>
                    </div>
                    <button
                        type="button"
                        className="topic-picker-close"
                        onClick={onClose}
                        aria-label="close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body — 2 sub-categories × 5 topics each */}
                <div className="topic-picker-body">
                    {cat.subs.map(sub => (
                        <section key={sub.id} className="topic-picker-section">
                            <h4 className="topic-picker-sub-label">
                                {t(`vocabSub.${sub.id}`)}
                            </h4>
                            <div className="topic-picker-grid">
                                {sub.topics.map(topic => {
                                    const isSelected =
                                        selectedTopic?.catId === cat.id &&
                                        selectedTopic?.topicId === topic.id;
                                    return (
                                        <button
                                            key={topic.id}
                                            type="button"
                                            className={`topic-pill-3d ${isSelected ? 'is-selected' : ''}`}
                                            onClick={() => handlePick(sub.id, topic.id)}
                                        >
                                            {t(`vocabTopic.${topic.id}`)}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
