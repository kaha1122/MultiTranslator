import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, GraduationCap } from 'lucide-react';
import './AITipPopup.css';

/**
 * AI-Tip Popup — 음성 narration 미지원 (sourceLang, targetLang) 조합에서
 * userCoachingNarration 텍스트만 시각적으로 보여주는 작은 모달.
 *
 * 호출 경로:
 *   FreeTalkingChat.handleLearningTip → /api/converse-coach-tts → 204 응답 →
 *   setAiTipPopup({open:true, text: msg.learning_tip_narration})
 *
 * 카드 모달의 learning_tip 박스(SHORT, m.learning_tip)와는 별개 — 이건 풍부한
 * SPOKEN expansion(m.learning_tip_narration)을 텍스트로 표시.
 */
export default function AITipPopup({ open, text, onClose, t }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open || !text) return null;

    // Portal: document.body 에 직접 mount → 부모 (FreeTalkingChat .ftc-overlay)
    // 의 flex/stretch layout 영향 0, 화면 정확한 중앙 보장.
    return createPortal(
        <div className="aitp-overlay" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="aitp-window" onClick={(e) => e.stopPropagation()}>
                <div className="aitp-header">
                    <div className="aitp-title">
                        <GraduationCap size={18} />
                        <span>{t?.('freeTalk.aiTipTitle') || 'AI-Tip'}</span>
                    </div>
                    <button className="aitp-close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </div>
                <div className="aitp-body">
                    {text}
                </div>
            </div>
        </div>,
        document.body
    );
}
