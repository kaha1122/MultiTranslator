import { useEffect, useState, useMemo } from 'react';
import { Star, X, RotateCcw } from 'lucide-react';
import './ConversationSummaryModal.css';

/**
 * Free Talking 세션 종료 시 표시되는 핵심 표현 추출 모달.
 *
 * Props:
 *   - open: boolean
 *   - summary: { keyPhrases: [{phrase, translation, why_useful, source_role, pronunciation}] } | null
 *   - isSummarizing: boolean
 *   - summaryError: string | null
 *   - onSaveSelected: async (selectedPhrases[]) => void   (Library 일괄 저장)
 *   - onSkip: () => void                                  (저장 안 하고 닫기)
 *   - t: i18n 함수
 *
 * UX:
 *   - 모든 phrase 기본 체크 ON (학습자가 필요한 것만 끄도록 — Save default 패턴)
 *   - 저장 버튼 클릭 → 진행 spinner → 모두 저장 후 onSaveSelected 콜백
 *   - 건너뛰기 / X → onSkip
 */
export default function ConversationSummaryModal({
    open,
    summary,
    isSummarizing,
    summaryError,
    onSaveSelected,
    onSkip,
    t,
}) {
    const phrases = useMemo(() => Array.isArray(summary?.keyPhrases) ? summary.keyPhrases : [], [summary]);
    const [checkedSet, setCheckedSet] = useState(() => new Set());
    const [saving, setSaving] = useState(false);

    // 기본값: 모든 phrase ON
    useEffect(() => {
        if (open && phrases.length > 0) {
            setCheckedSet(new Set(phrases.map((_, i) => i)));
        }
    }, [open, phrases]);

    if (!open) return null;

    const toggle = (idx) => {
        setCheckedSet(prev => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const checkedCount = checkedSet.size;

    const handleSave = async () => {
        if (saving) return;
        const selected = phrases.filter((_, i) => checkedSet.has(i));
        if (selected.length === 0) {
            onSkip?.();
            return;
        }
        setSaving(true);
        try {
            await onSaveSelected?.(selected);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="csm-overlay" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onSkip?.(); }}>
            <div className="csm-window" onClick={(e) => e.stopPropagation()}>
                <header className="csm-header">
                    <div className="csm-title">
                        <span className="csm-emoji">💎</span>
                        <span>{t?.('freeTalk.summaryTitle') || '이번 대화의 핵심 표현'}</span>
                    </div>
                    <button className="csm-close" onClick={onSkip} aria-label="Close">
                        <X size={20} />
                    </button>
                </header>

                <div className="csm-body">
                    {isSummarizing && (
                        <div className="csm-loading">
                            <RotateCcw className="spin" size={18} />
                            <span>{t?.('freeTalk.summarizing') || '표현을 정리하고 있어요...'}</span>
                        </div>
                    )}
                    {summaryError && !isSummarizing && (
                        <div className="csm-error">
                            {t?.('freeTalk.summaryError') || '핵심 표현을 가져오지 못했습니다.'}
                            <small>{summaryError}</small>
                        </div>
                    )}
                    {!isSummarizing && !summaryError && phrases.length === 0 && (
                        <div className="csm-empty">
                            {t?.('freeTalk.summaryEmpty') || '저장할만한 표현을 찾지 못했어요.'}
                        </div>
                    )}
                    {!isSummarizing && phrases.length > 0 && (
                        <ul className="csm-list">
                            {phrases.map((p, idx) => {
                                const isChecked = checkedSet.has(idx);
                                const sourceLabel = p.source_role === 'partner'
                                    ? (t?.('freeTalk.fromPartner') || '상대 발화')
                                    : (t?.('freeTalk.fromLearner') || '내 발화');
                                return (
                                    <li
                                        key={idx}
                                        className={`csm-item ${isChecked ? 'checked' : ''}`}
                                        onClick={() => toggle(idx)}
                                    >
                                        <div className="csm-check">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => toggle(idx)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </div>
                                        <div className="csm-content">
                                            <div className="csm-phrase">
                                                <span className={`csm-source-tag csm-source-${p.source_role}`}>{sourceLabel}</span>
                                                <span className="csm-phrase-text">{p.phrase}</span>
                                            </div>
                                            {p.pronunciation && (
                                                <div className="csm-pronunciation">{p.pronunciation}</div>
                                            )}
                                            <div className="csm-translation">{p.translation}</div>
                                            {p.why_useful && (
                                                <div className="csm-why">💡 {p.why_useful}</div>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <footer className="csm-footer">
                    <button
                        className="csm-skip-btn"
                        onClick={onSkip}
                        disabled={saving}
                    >
                        {t?.('freeTalk.summarySkip') || '건너뛰기'}
                    </button>
                    <button
                        className="csm-save-btn"
                        onClick={handleSave}
                        disabled={saving || isSummarizing || phrases.length === 0}
                    >
                        {saving
                            ? <RotateCcw className="spin" size={16} />
                            : <Star size={16} />}
                        <span>
                            {checkedCount > 0
                                ? `${t?.('freeTalk.summarySaveN') || '선택 저장'} (${checkedCount})`
                                : (t?.('freeTalk.summarySaveZero') || '선택 저장')}
                        </span>
                    </button>
                </footer>
            </div>
        </div>
    );
}
