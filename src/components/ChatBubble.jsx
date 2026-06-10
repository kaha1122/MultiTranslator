import { MessageCircle, RotateCcw, Lightbulb } from 'lucide-react';
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
    onReplay,
    onLearningTipUserFree,
    isLearningTipLoading,
    onRetryReply,
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
        // 2026-05-08: 나레이션 스피커 replay 버튼 제거 — onReplay 콜백 미연결로 작동 안 했고
        //   상황 안내 문장은 다시 들을 가치 낮음. UI 단순화.
        return (
            <div className="ftc-msg ftc-msg-narration">
                <div className="ftc-narration-bubble">
                    {displayText || ' '}
                </div>
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

                {/* 2026-06-09: 메시지 탭→카드 기능 제거 → 비클릭 표시(div) */}
                <div
                    className={`ftc-bubble ${isUser ? 'ftc-bubble-user' : 'ftc-bubble-ai'} ${message.isLoading ? 'ftc-bubble-loading' : ''}`}
                >
                    <span className="ftc-bubble-text">
                        {message.isLoading
                            ? <RotateCcw className="spin" size={14} />
                            : (displayText || ' ')}
                    </span>
                </div>

                {/* user_free 액션 바 — 모든 user_free 에 노출 (지난 턴 피드백 다시보기 유지, AI-Tip 단일, 우측 정렬).
                    팁 데이터(learning_tip/narration)는 메시지 객체에 보존되므로 대화창 닫힐 때까지 동작. */}
                {message.role === 'user_free' && !message.isLoading && (
                    <div className="ftc-user-actions">
                        <button
                            className="ftc-user-action-btn"
                            onClick={() => onLearningTipUserFree?.(message)}
                            disabled={(!message.learning_tip && !message.learning_tip_narration) || isLearningTipLoading}
                            title={t?.('freeTalk.learningTip') || 'AI-Tip'}
                        >
                            {isLearningTipLoading
                                ? <RotateCcw className="spin" size={13} />
                                : <Lightbulb size={13} />}
                            {' '}{t?.('freeTalk.learningTip') || 'AI-Tip'}
                        </button>
                    </div>
                )}

                {message.role === 'user_free' && message.sttRaw && message.sttRaw !== message.fullText && (
                    <div className="ftc-stt-raw">
                        🎙️ {t?.('freeTalk.heardAs') || '들린 결과'}: <em>"{message.sttRaw}"</em>
                    </div>
                )}
                {message.replyError && (
                    <div className="ftc-reply-error" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                        <div>⚠️ {t?.('freeTalk.replyError') || '응답 생성을 잠시 후 다시 시도해주세요.'}</div>
                        {onRetryReply && (
                            <button
                                type="button"
                                onClick={onRetryReply}
                                style={{
                                    padding: '5px 12px',
                                    background: '#7c3aed',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                }}
                            >
                                <RotateCcw size={12} /> {t?.('freeTalk.retry') || '다시 시도'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
