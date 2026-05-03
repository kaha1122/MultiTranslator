import { Volume2, MessageCircle, Edit2, Mic, Check, X as XIcon, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTTSSyncedReveal } from '../hooks/useTTSSyncedReveal';

/**
 * 카카오톡 스타일 단일 말풍선.
 *
 * role:
 *   - 'narration'  : 중앙 정렬 회색 안내 (sourceLang)
 *   - 'user_auto'  : 우측 정렬, "💡 이렇게 시작해볼 수 있어요" 회색 라벨, 클릭 시 onCardOpen
 *   - 'user_free'  : 우측 정렬, sttRaw가 다르면 회색으로 표시. 마지막 user_free만 액션바 노출.
 *   - 'ai'         : 좌측 정렬, 페르소나 아바타+이름, 클릭 시 onCardOpen
 *
 * autoplay 제어:
 *   - shouldAutoplay=true 일 때만 audio 재생 시작 (직렬 재생 흐름은 부모가 결정)
 *   - 부모는 onPlaybackDone 콜백으로 다음 메시지 차례를 알 수 있음
 */
export default function ChatBubble({
    message,
    personaName,
    shouldAutoplay,
    onPlaybackDone,
    onCardOpen,
    onReplay,
    onEditUserFree,
    onRerecordUserFree,
    onListenUserFree,
    isLastUserFree,
    t,
}) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(message.fullText || message.text || '');

    const { revealedText, isPlaying, isDone } = useTTSSyncedReveal({
        fullText: message.fullText || message.text || '',
        audioBase64: shouldAutoplay ? message.audio : null,
        words: message.words,
        mimeType: message.mimeType,
        autoplay: shouldAutoplay,
        onDone: onPlaybackDone,
        generation: message.id + (shouldAutoplay ? '-play' : '-idle'),
    });

    const displayText = (shouldAutoplay
        ? (revealedText || (isDone ? message.fullText : ''))
        : (message.text || message.fullText || ''));

    useEffect(() => { /* placeholder for future telemetry */ }, [isDone]);

    if (message.role === 'narration') {
        return (
            <div className="ftc-msg ftc-msg-narration">
                <div className="ftc-narration-bubble">
                    {displayText || ' '}
                </div>
                {message.audio && !shouldAutoplay && isDone && (
                    <button className="ftc-replay-btn" onClick={() => onReplay?.(message.id)} title={t?.('freeTalk.replay') || 'Replay'}>
                        <Volume2 size={14} />
                    </button>
                )}
            </div>
        );
    }

    const isUser = message.role === 'user_auto' || message.role === 'user_free';
    const sideClass = isUser ? 'ftc-msg-right' : 'ftc-msg-left';

    return (
        <div className={`ftc-msg ${sideClass}`}>
            {!isUser && (
                <div className="ftc-avatar" aria-hidden>
                    <MessageCircle size={18} />
                </div>
            )}
            <div className="ftc-msg-body">
                {!isUser && personaName && (
                    <div className="ftc-persona-name">{personaName}</div>
                )}
                {message.role === 'user_auto' && (
                    <div className="ftc-user-auto-hint">
                        💡 {t?.('freeTalk.userAutoHint') || '이렇게 시작해볼 수 있어요'}
                    </div>
                )}

                {editing ? (
                    <div className="ftc-edit-row">
                        <input
                            type="text"
                            className="ftc-edit-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && editValue.trim()) {
                                    setEditing(false);
                                    onEditUserFree?.(editValue.trim());
                                } else if (e.key === 'Escape') {
                                    setEditing(false);
                                    setEditValue(message.fullText || message.text || '');
                                }
                            }}
                            autoFocus
                        />
                        <button
                            className="ftc-edit-confirm"
                            onClick={() => {
                                if (!editValue.trim()) return;
                                setEditing(false);
                                onEditUserFree?.(editValue.trim());
                            }}
                            title={t?.('freeTalk.confirmEdit') || '확정'}
                        >
                            <Check size={14} />
                        </button>
                        <button
                            className="ftc-edit-cancel"
                            onClick={() => {
                                setEditing(false);
                                setEditValue(message.fullText || message.text || '');
                            }}
                            title={t?.('freeTalk.cancelEdit') || '취소'}
                        >
                            <XIcon size={14} />
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className={`ftc-bubble ${isUser ? 'ftc-bubble-user' : 'ftc-bubble-ai'} ${message.isLoading ? 'ftc-bubble-loading' : ''}`}
                        onClick={() => !message.isLoading && onCardOpen?.(message)}
                        title={t?.('freeTalk.tapForCard') || '카드 열기'}
                        disabled={!!message.isLoading}
                    >
                        <span className="ftc-bubble-text">
                            {message.isLoading
                                ? <RotateCcw className="spin" size={14} />
                                : (displayText || ' ')}
                        </span>
                    </button>
                )}

                {/* user_free 액션 바 — 마지막 user_free 만 노출 */}
                {message.role === 'user_free' && isLastUserFree && !editing && !message.isLoading && (
                    <div className="ftc-user-actions">
                        <button
                            className="ftc-user-action-btn"
                            onClick={() => {
                                setEditValue(message.fullText || message.text || '');
                                setEditing(true);
                            }}
                            title={t?.('freeTalk.edit') || '수정'}
                        >
                            <Edit2 size={13} /> {t?.('freeTalk.edit') || '수정'}
                        </button>
                        <button
                            className="ftc-user-action-btn"
                            onClick={() => onRerecordUserFree?.()}
                            title={t?.('freeTalk.rerecord') || '다시 말하기'}
                        >
                            <Mic size={13} /> {t?.('freeTalk.rerecord') || '다시 말하기'}
                        </button>
                        <button
                            className="ftc-user-action-btn"
                            onClick={() => onListenUserFree?.(message)}
                            title={t?.('freeTalk.listen') || '듣기'}
                        >
                            <Volume2 size={13} /> {t?.('freeTalk.listen') || '듣기'}
                        </button>
                    </div>
                )}

                {message.role === 'user_free' && message.sttRaw && message.sttRaw !== message.fullText && !editing && (
                    <div className="ftc-stt-raw">
                        🎙️ {t?.('freeTalk.heardAs') || '들린 결과'}: <em>"{message.sttRaw}"</em>
                    </div>
                )}
                {message.replyError && (
                    <div className="ftc-reply-error">
                        ⚠️ {t?.('freeTalk.replyError') || '응답 생성 실패'} <small>{message.replyError}</small>
                    </div>
                )}
            </div>
        </div>
    );
}
