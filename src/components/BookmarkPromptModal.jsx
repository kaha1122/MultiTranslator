import { useState } from 'react';
import { useT } from '../utils/i18n';
import './BookmarkPromptModal.css';

const BookmarkPromptModal = ({ score, onDismiss, sourceLang }) => {
    const t = useT(sourceLang);
    const [dontShow, setDontShow] = useState(false);

    const handleDismiss = () => {
        if (dontShow) localStorage.setItem('hideBookmarkPrompt', 'true');
        onDismiss();
    };

    return (
        <div className="bpm-overlay" onClick={handleDismiss}>
            <div className="bpm-card" onClick={e => e.stopPropagation()}>
                <div className="bpm-score-badge">🎯 {score}Pt</div>
                <h3 className="bpm-title">{t('daily.bookmarkPromptTitle')}</h3>
                <p className="bpm-desc">{t('daily.bookmarkPromptDesc')}</p>
                <label className="bpm-dont-show">
                    <input
                        type="checkbox"
                        checked={dontShow}
                        onChange={e => setDontShow(e.target.checked)}
                    />
                    <span>{t('daily.dontShowAgain')}</span>
                </label>
                <div className="bpm-actions">
                    <button className="bpm-btn-later" onClick={handleDismiss}>
                        {t('daily.bookmarkConfirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BookmarkPromptModal;
