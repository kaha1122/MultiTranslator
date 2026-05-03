import { Volume2, MessageCircle, Mic, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { useTTSSyncedReveal } from '../hooks/useTTSSyncedReveal';

/**
 * 카카오톡 스타일 단일 말풍선.
 *
 * role:
 *   - 'narration'  : 중앙 정렬 회색 안내 (sourceLang)
 *   - 'user_auto'  : 우측 정렬, "💡 이렇게 시작해볼 수 있어요" 회색 라벨, 클릭 시 onCardOpen
 *   - 'user_free'  : 우측 정렬, sttRaw가 다르면 회색으로 표시. 마지막 user_free에 [다시 말하기/듣기].
 *   - 'ai'         : 좌측 정렬, 페르소나 아바타+이름, 클릭 시 onCardOpen
 *
 * displayText 규칙 (TTS pre-flash 방지):
 *   - shouldAutoplay=true → revealedText 사용 (단어 단위 reveal)
 *   - shouldAutoplay=false + audio 미재생 (played=false) + audio 보유 → '' (재생 차례 대기)
 *   - shouldAutoplay=false + 재생 완료 (played=true) → fullText 그대로
 *   - audio 없음 (TTS 실패 등) → fullText 즉시 표시 (graceful)
 */
export default function ChatBubble({
    message,
    personaName,
    shouldAutoplay,
    onPlaybackDone,
    onCardOpen,
    onReplay,
    onRerecordUserFree,
    onListenUserFree,
    isLastUserFree,
    t,
}) {
    const { revealedText, isPlaying, isDone } = useTTSSyncedReveal({
        fullText: message.fullText || message.text || '',
        audioBase64: shouldAutoplay ? message.audio : null,
        words: message.words,
        mimeType: message.mimeType,
        autoplay: shouldAutoplay,
        onDone: onPlaybackDone,
        generation: message.id + (shouldAutoplay ? '-play' : '-idle'),
    });

    // displayText 규칙 (TTS pre-flash 방지):
    //   - shouldAutoplay=true → revealedText (재생 끝나면 fullText)
    //   - shouldAutoplay=false + played=true (재생 완료) → fullText
    //   - shouldAutoplay=false + played=false → ''
    //
    // played=false 상태에서 audio 도착 여부 무관하게 무조건 빈칸 — 사전 flash 완전 차단.
    // TTS 영구 실패로 audio가 영영 안 오는 케이스는 부모(useConversation)가 message.played=true로
    // 강제 마킹해 fullText fallback이 노출되도록 한다.
    const fullText = message.fullText || message.text || '';
    let displayText;
    if (shouldAutoplay) {
        displayText = revealedText || (isDone ? fullText : '');
    } else if (message.played) {
        displayText = fullText;
    } else {
        displayText = '';
    }

    useEffect(() => { /* placeholder for future telemetry */ }, [isDone]);

    // 자기 차례가 아직 오지 않은 메시지(played=false + shouldAutoplay=false)는 전체 숨김.
    // 빈 말풍선 / 'user_auto 힌트 라벨' / 페르소나 이름 등이 미리 보이는 것을 방지.
    // 예외:
    //   - isLoading=true: AI placeholder 스피너는 보여야 함 (자유 발화 후 응답 대기 표시)
    //   - user_free: 사용자가 즉시 말한 발화라 마운트 시 played=true 또는 sttRaw 표시 필요
    if (!shouldAutoplay && !message.played && !message.isLoading && message.role !== 'user_free') {
        return null;
    }

    if (message.role === 'narration') {
        return (
            <div className="ftc-msg ftc-msg-narration">
                <div className="ftc-narration-bubble">
                    {displayText || ' '}
                </div>
                {message.audio && !shouldAutoplay && message.played && (
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

                {/* user_free 액션 바 — 마지막 user_free 만 노출 (수정 버튼은 제거, 다시말하기/듣기만) */}
                {message.role === 'user_free' && isLastUserFree && !message.isLoading && (
                    <div className="ftc-user-actions">
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

                {message.role === 'user_free' && message.sttRaw && message.sttRaw !== message.fullText && (
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
