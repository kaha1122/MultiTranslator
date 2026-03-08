import { useT } from '../utils/i18n';
import './BookmarkPromptModal.css';

const BookmarkPromptModal = ({ score, onBookmark, onDismiss, sourceLang }) => {
    const t = useT(sourceLang);
    return (
        <div className="bpm-overlay" onClick={onDismiss}>
            <div className="bpm-card" onClick={e => e.stopPropagation()}>
                <div className="bpm-score-badge">🎯 {score}Pt</div>
                <h3 className="bpm-title">{t('daily.bookmarkPromptTitle')}</h3>
                <p className="bpm-desc">{t('daily.bookmarkPromptDesc')}</p>
                <div className="bpm-actions">
                    <button className="bpm-btn-bookmark" onClick={onBookmark}>
                        ⭐ {t('daily.bookmarkNow')}
                    </button>
                    <button className="bpm-btn-later" onClick={onDismiss}>
                        {t('daily.bookmarkLater')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookmarkPromptModal;
