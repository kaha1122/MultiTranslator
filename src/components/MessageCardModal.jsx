import { useEffect } from 'react';
import { X } from 'lucide-react';
import './MessageCardModal.css';

/**
 * Free Talking 채팅 메시지 클릭 시 뜨는 카드 팝업.
 *
 * 기존 ScenePracticeCard의 props 시그니처와 호환되는 generated 객체를 만들어 그대로 마운트한다:
 *   {sentence, translation, pronunciation, learning_tip, scene_hint, selected_emotion, interaction_type}
 *
 * 부모(FreeTalkingChat)는 ScenePracticeCardComp prop으로 ScenePracticeCard 컴포넌트를 주입한다
 * (순환 import 방지 + Sprint 2에서 ScenePracticeCard를 그대로 재사용).
 */
export default function MessageCardModal({
    open,
    message,
    langCode,
    sourceLang,
    onClose,
    onSpeak,
    onSave,
    isSaved,
    onTrialLimitReached,
    onPronSuccess,
    onBookmarkPrompt,
    targetGoal,
    t,
    ScenePracticeCardComp,
}) {
    // ESC 닫기
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open || !message) return null;

    // ChatBubble 메시지 스키마 → ScenePracticeCard generated 형태 매핑
    const generated = {
        sentence: message.fullText || message.text || '',
        translation: message.translation || '',
        pronunciation: message.pronunciation || '',
        learning_tip: message.learning_tip || '',
        scene_hint: message.scene_hint || '',
        selected_emotion: message.selected_emotion || '',
        interaction_type: message.interaction_type || '',
    };

    return (
        <div className="mcm-overlay" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="mcm-window" onClick={(e) => e.stopPropagation()}>
                <button className="mcm-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>
                <div className="mcm-body">
                    {ScenePracticeCardComp ? (
                        <ScenePracticeCardComp
                            generated={generated}
                            langCode={langCode}
                            sourceLang={sourceLang}
                            onTrialLimitReached={onTrialLimitReached}
                            onPronSuccess={onPronSuccess}
                            onSave={onSave}
                            isSaved={isSaved}
                            onSpeak={onSpeak}
                            t={t}
                            targetGoal={targetGoal}
                            onBookmarkPrompt={onBookmarkPrompt}
                        />
                    ) : (
                        <div className="mcm-fallback">
                            <p>{generated.sentence}</p>
                            {generated.translation && <p className="mcm-translation">{generated.translation}</p>}
                            {generated.learning_tip && <p className="mcm-tip">💡 {generated.learning_tip}</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
