import { useEffect } from 'react';
import { X } from 'lucide-react';
import { VocabWordCard } from './VocabTab';
import './MessageCardModal.css';

/**
 * 문장 클릭 시 뜨는 카드 팝업 — Free Talking 메시지 / Listening 문장 공용.
 *
 * 2026-06-09 단계 A: ScenePracticeCard → VocabWordCard 단일 카드로 통일.
 *   문장을 word(헤드라인)·번역을 meaning에 매핑하고 example을 비워두면 VocabWordCard가
 *   예문 박스 + 단어/예문 토글을 자동으로 숨겨 "문장 발음연습 카드"로 동작한다.
 *   (단어냐 문장이냐 + 예문 유무 차이뿐 — 발음연습/녹음/평가/저장/TTS 로직은 VocabWordCard가 이미 보유)
 *
 * message 스키마(둘 다 호환): {fullText|text, translation, pronunciation, learning_tip|learningTip}
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
    ttsSource = 'card',
    onTopicPass,   // Phase 1 단계학습(Listening 지문 섀도잉): 문장 통과 시 호출(없으면 standalone)
}) {
    // ESC 닫기
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open || !message) return null;

    // 메시지/문장 → VocabWordCard `w` 매핑
    //   word=문장, meaning=번역, example='' → 예문 박스·토글 숨김(문장 자체를 발음연습 대상으로)
    const rawTip = message.learning_tip ?? message.learningTip ?? '';
    const w = {
        word: message.fullText || message.text || '',
        pronunciation: message.pronunciation || '',
        meaning: message.translation || '',
        example: '',
        examplePronunciation: '',
        exampleTranslation: '',
        learningTip: Array.isArray(rawTip)
            ? rawTip
            : (rawTip ? [{ type: 'tip', content: rawTip }] : []),
    };

    return (
        <div className="mcm-overlay" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="mcm-window" onClick={(e) => e.stopPropagation()}>
                <button className="mcm-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>
                <div className="mcm-body">
                    <VocabWordCard
                        w={w}
                        index={0}
                        selectedLang={langCode}
                        sourceLang={sourceLang}
                        onSpeak={onSpeak}
                        ttsSource={ttsSource}
                        isSaved={isSaved}
                        onSave={onSave}
                        onTrialLimitReached={onTrialLimitReached}
                        onPronSuccess={onPronSuccess}
                        targetGoal={targetGoal}
                        onBookmarkPrompt={onBookmarkPrompt}
                        activeRecIdx={null}        /* 모달은 단일 카드 — 다른 카드 녹음 잠금 불필요 */
                        onRecordingStart={() => {}}
                        headlineBlock           /* 문장 카드: 🔊·⭐ 윗줄 / 문장 아래 전체폭 */
                        t={t}
                        onTopicPass={onTopicPass}
                    />
                </div>
            </div>
        </div>
    );
}
