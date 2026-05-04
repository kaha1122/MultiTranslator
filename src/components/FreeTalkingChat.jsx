import { useEffect, useRef, useState } from 'react';
import { X, Mic, MicOff, RotateCcw, Gem } from 'lucide-react';
import ChatBubble from './ChatBubble';
import MessageCardModal from './MessageCardModal';
import ConversationSummaryModal from './ConversationSummaryModal';
import { useConversation } from '../hooks/useConversation';
import { useFreeTalkRecorder } from '../hooks/useFreeTalkRecorder';
import { getT } from '../utils/i18n';
import './FreeTalkingChat.css';

/**
 * 카카오톡 스타일 풀스크린 Free Talking 모달.
 *
 * Sprint 2 흐름:
 *   - 시작: 3개 메시지 자동 streaming + TTS 직렬 재생
 *   - 자유 발화: 하단 [말하기] 버튼 → 녹음 → STT → /api/converse-reply (intent 보정 + AI 응답)
 *   - 메시지 클릭 → 카드 팝업 (MessageCardModal + ScenePracticeCard 재사용)
 *   - 마지막 user_free: [수정] [다시 말하기] [듣기] 버튼
 *   - 한도 도달 → 입력 disable + "대화 한도가 완료되었습니다" 시스템 메시지
 *   - 30분 무활동 → 자동 종료 ('idle')
 */
export default function FreeTalkingChat({
    open, setupArgs, onClose, sourceLang,
    tier = 'trial',
    // 카드 팝업 마운트용 (App.jsx가 ScenePracticeCard 컴포넌트 + 콜백 주입)
    ScenePracticeCardComp,
    onSaveConversationMessage,
    onSaveConversationSummary,
    onTrialLimitReached,
    onPronSuccess,
    onSpeak,
    onBookmarkPrompt,
    languageGoals = {},
}) {
    const t = (key) => getT(sourceLang, key);
    const {
        sessionId, messages, scenarioMeta, setup,
        isStarting, startError,
        isReplying, replyError,
        freeTurnCount, turnLimit,
        sessionEnded, endedReason,
        summary, isSummarizing, summaryError,
        startSession, endSession, resetSession,
        submitFreeUtterance, removeLastUserFreePair,
        markMessagePlayed,
        requestSummary, clearSummary,
    } = useConversation({ tier });

    const [summaryModalOpen, setSummaryModalOpen] = useState(false);
    // 자동 open useEffect 가드 — 새 summary 객체일 때만 1회 trigger.
    // (모달 닫은 후 summary state 가 그대로면 useEffect 재실행으로 무한 reopen 되던 버그 차단)
    const lastSummaryRef = useRef(null);
    // 첫 진입 안내 — localStorage 'pronunfit_freetalk_guide_seen' 미존재 시 모달 진입 직후 1회 표시
    const [showFirstGuide, setShowFirstGuide] = useState(false);

    const [playbackIdx, setPlaybackIdx] = useState(-1);
    const [playbackQueueDone, setPlaybackQueueDone] = useState(false);
    const startedRef = useRef(false);
    const messagesEndRef = useRef(null);
    const [cardOpenMessage, setCardOpenMessage] = useState(null);
    const [cardSavedIds, setCardSavedIds] = useState({});  // {messageId: true}

    // STT 녹음
    const recorder = useFreeTalkRecorder({
        langCode: setupArgs?.targetLang || 'en',
        onTranscript: async (text) => {
            if (!text) return;
            await submitFreeUtterance(text);
        },
        sourceLang,
    });

    // 모달 open 시 1회 startSession 호출 + 첫 진입 안내 표시 여부 결정
    useEffect(() => {
        if (open && setupArgs && !startedRef.current) {
            startedRef.current = true;
            startSession(setupArgs);
            try {
                const seen = localStorage.getItem('pronunfit_freetalk_guide_seen');
                if (!seen) setShowFirstGuide(true);
            } catch (e) { /* noop */ }
        }
        if (!open && startedRef.current) {
            startedRef.current = false;
            setPlaybackIdx(-1);
            setPlaybackQueueDone(false);
            setCardOpenMessage(null);
            setCardSavedIds({});
            setSummaryModalOpen(false);
            lastSummaryRef.current = null;
            resetSession();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 시작 메시지 3개 모두 ttsReady=true 가 되면 자동재생 시작
    useEffect(() => {
        if (!open) return;
        if (playbackIdx >= 0) return;
        if (playbackQueueDone) return;
        if (messages.length < 3) return;
        const allReady = messages.slice(0, 3).every(m => m.ttsReady);
        if (allReady) setPlaybackIdx(0);
    }, [open, messages, playbackIdx, playbackQueueDone]);

    // 자유 발화 후 새 ai 메시지가 ttsReady가 되면 1회만 자동 재생.
    // played 가드는 markMessagePlayed(handleBubbleDone)가 set → 재진입 차단.
    // playbackIdx 가드는 현재 다른 메시지 재생 중일 때 끼어들기 방지.
    useEffect(() => {
        if (!playbackQueueDone) return;
        if (sessionEnded) return;
        if (playbackIdx >= 0) return;
        const last = messages[messages.length - 1];
        if (!last) return;
        if (last.role !== 'ai') return;
        if (!last.ttsReady) return;
        if (last.played) return;       // 한 번 재생 끝난 메시지 — 무한루프 차단
        if (!last.audio) return;       // 오디오 미도착(TTS 실패는 played=true 마킹되므로 위 가드에서 차단됨)
        setPlaybackIdx(messages.length - 1);
    }, [messages, playbackQueueDone, sessionEnded, playbackIdx]);

    // 자동 스크롤
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages.length, playbackIdx]);

    const handleBubbleDone = (idx) => () => {
        // 재생 끝난 메시지 played=true 로 마킹 (스크롤 시 깜빡임 방지)
        const m = messages[idx];
        if (m) markMessagePlayed(m.id);

        // Sprint 1 흐름: 시작 3 메시지 직렬 재생
        if (!playbackQueueDone && idx < 3) {
            if (idx + 1 < 3) {
                setPlaybackIdx(idx + 1);
            } else {
                setPlaybackIdx(-1);
                setPlaybackQueueDone(true);
            }
            return;
        }
        // Sprint 2 흐름: 자유 발화 후 ai 메시지 1회 재생 끝
        setPlaybackIdx(-1);
    };

    const handleClose = () => {
        endSession('user');
        onClose?.();
    };

    // 헤더 [💎 카드 만들기] 버튼 — 현재까지 대화로 핵심 표현 추출 → SummaryModal 표시
    const handleSummarizeBtn = async () => {
        if (isSummarizing) return;
        if (freeTurnCount < 1) return;  // 최소 1턴 자유 발화 후 활성화
        await requestSummary();
    };

    // summary 도착하면 모달 자동 open — 새 summary 객체일 때만 1회 trigger.
    // (lastSummaryRef 비교로 동일 summary 에서 reopen 차단)
    useEffect(() => {
        if (summary && summary !== lastSummaryRef.current) {
            lastSummaryRef.current = summary;
            setSummaryModalOpen(true);
        }
    }, [summary]);

    const handleSummarySaveSelected = async (selectedPhrases) => {
        if (!onSaveConversationSummary) {
            setSummaryModalOpen(false);
            clearSummary();
            return;
        }
        try {
            const result = await onSaveConversationSummary({
                selectedPhrases,
                langCode: setupArgs?.targetLang,
                sourceLang,
                scene: setupArgs?.sceneId || setupArgs?.scene,
                category: setupArgs?.category,
                difficulty: setupArgs?.difficulty,
                speechStyle: setupArgs?.speechStyle,
                scenarioMeta,
            });
            // 결과 검증 — saved=0 이면 사용자에게 알림 (모달 닫지 않고 retry 가능)
            const saved = result?.saved ?? 0;
            const skipped = result?.skipped ?? 0;
            const errors = result?.errors ?? [];
            console.log('[FreeTalkingChat] save result:', { saved, skipped, errors });
            if (saved === 0 && selectedPhrases.length > 0) {
                // 0개 저장된 경우 — alert + 모달 유지 (사용자 인지)
                const reason = errors.length > 0 ? errors.join(', ') : '알 수 없는 이유';
                alert(`저장 실패: 선택한 ${selectedPhrases.length}개 모두 저장되지 않았어요.\n원인: ${reason}\n\n브라우저 콘솔(F12)에서 [SaveSummary] 로그를 확인해주세요.`);
                return;  // 모달 유지 → 사용자가 다시 시도 / 닫기 선택
            }
            if (skipped > 0 && saved > 0) {
                console.warn(`[FreeTalkingChat] partial save: ${saved} saved, ${skipped} skipped (${errors.join(', ')})`);
            }
        } catch (e) {
            console.error('[FreeTalkingChat] summary save failed:', e?.message, e);
            alert(`저장 중 오류가 발생했어요: ${e?.message || '알 수 없는 오류'}`);
            return;  // 모달 유지
        }
        setSummaryModalOpen(false);
        clearSummary();
    };

    const handleSummarySkip = () => {
        setSummaryModalOpen(false);
        clearSummary();
    };

    const handleTalkBtn = async () => {
        if (sessionEnded || !playbackQueueDone || isReplying) return;
        if (recorder.isRecording) {
            await recorder.stopRecording();
        } else {
            await recorder.startRecording();
        }
    };

    // 마지막 user_free 메시지 인덱스
    let lastUserFreeIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user_free') { lastUserFreeIdx = i; break; }
    }

    const handleRerecord = () => {
        removeLastUserFreePair();
    };
    const handleListen = (msg) => {
        // 사용자가 의도한 텍스트(보정된 fullText)를 그대로 TTS 재생 — onSpeak 위임
        if (onSpeak && msg?.fullText) {
            onSpeak(msg.fullText, setupArgs?.targetLang, msg.selected_emotion);
        }
    };

    const handleCardOpen = (msg) => {
        if (!msg) return;
        if (msg.role === 'narration') return;
        setCardOpenMessage(msg);
    };
    const handleCardClose = () => setCardOpenMessage(null);
    const handleCardSave = async (pronunciationScore = null) => {
        if (!cardOpenMessage) return;
        if (cardSavedIds[cardOpenMessage.id]) return;
        if (!onSaveConversationMessage) { setCardSavedIds(p => ({ ...p, [cardOpenMessage.id]: true })); return; }
        try {
            await onSaveConversationMessage({
                message: cardOpenMessage,
                langCode: setupArgs?.targetLang,
                sourceLang,
                scene: setupArgs?.sceneId || setupArgs?.scene,
                category: setupArgs?.category,
                difficulty: setupArgs?.difficulty,
                speechStyle: setupArgs?.speechStyle,
                scenarioMeta,
                pronunciationScore,
            });
            setCardSavedIds(p => ({ ...p, [cardOpenMessage.id]: true }));
        } catch (e) {
            console.error('[FreeTalkingChat] save failed:', e?.message);
        }
    };

    if (!open) return null;

    const personaName = scenarioMeta?.responder_role || t('freeTalk.aiName') || 'AI';
    const headerLabel = setupArgs?.sceneI18nLabel || t('freeTalk.title') || 'Free-Talking';
    const summarizeEnabled = freeTurnCount >= 1 && !isSummarizing;
    const targetGoal = languageGoals?.[setupArgs?.targetLang] || 80;

    const inputDisabled = !playbackQueueDone || sessionEnded || isReplying || recorder.isProcessing;

    return (
        <div className="ftc-overlay" role="dialog" aria-modal="true">
            <div className="ftc-window">
                <header className="ftc-header">
                    <div className="ftc-header-info">
                        <div className="ftc-header-avatar" aria-hidden>💬</div>
                        <div className="ftc-header-text">
                            <div className="ftc-header-title">{personaName}</div>
                            <div className="ftc-header-subtitle">{headerLabel}</div>
                        </div>
                    </div>
                    <div className="ftc-header-actions">
                        <button
                            className="ftc-summary-btn"
                            onClick={handleSummarizeBtn}
                            disabled={!summarizeEnabled}
                            title={t('freeTalk.makeCard') || '카드 만들기'}
                            aria-label={t('freeTalk.makeCard') || '카드 만들기'}
                        >
                            {isSummarizing
                                ? <RotateCcw className="spin" size={16} />
                                : <Gem size={16} />}
                            <span>{t('freeTalk.makeCard') || '카드 만들기'}</span>
                        </button>
                        <button className="ftc-close-btn" onClick={handleClose} aria-label="Close">
                            <X size={22} />
                        </button>
                    </div>
                </header>

                <div className="ftc-messages">
                    {showFirstGuide && (
                        <div className="ftc-first-guide">
                            <div className="ftc-first-guide-title">
                                ✨ {t('freeTalk.guideTitle') || 'Free-Talking 사용법'}
                            </div>
                            <ol className="ftc-first-guide-list">
                                <li>👂 {t('freeTalk.guideStep1') || '먼저 상황 설명과 예시 대화를 듣고 따라 해보세요'}</li>
                                <li>🎤 {t('freeTalk.guideStep2') || '[말하기] 버튼을 눌러 자유롭게 대화하세요'}</li>
                                <li>💎 {t('freeTalk.guideStep3') || '대화 중 [카드 만들기]로 핵심 표현을 저장하세요'}</li>
                            </ol>
                            <button
                                type="button"
                                className="ftc-first-guide-btn"
                                onClick={() => {
                                    try { localStorage.setItem('pronunfit_freetalk_guide_seen', '1'); } catch (e) { /* noop */ }
                                    setShowFirstGuide(false);
                                }}
                            >
                                {t('freeTalk.guideDismiss') || '시작하기'}
                            </button>
                        </div>
                    )}
                    {isStarting && (
                        <div className="ftc-loading">
                            <RotateCcw className="spin" size={18} /> {t('freeTalk.preparing') || '대화를 준비하고 있어요...'}
                        </div>
                    )}
                    {startError && !isStarting && (
                        <div className="ftc-error">
                            {t('freeTalk.startError') || '대화를 시작하지 못했습니다.'} <br />
                            <small>{startError}</small>
                        </div>
                    )}

                    {messages.map((m, idx) => (
                        <ChatBubble
                            key={m.id}
                            message={m}
                            personaName={m.role === 'ai' ? personaName : null}
                            shouldAutoplay={idx === playbackIdx}
                            onPlaybackDone={handleBubbleDone(idx)}
                            onCardOpen={handleCardOpen}
                            onReplay={() => { /* 개별 재생: Sprint 3 보강 가능 */ }}
                            onRerecordUserFree={handleRerecord}
                            onListenUserFree={handleListen}
                            isLastUserFree={idx === lastUserFreeIdx}
                            t={t}
                        />
                    ))}

                    {sessionEnded && endedReason === 'limit' && (
                        <div className="ftc-system-msg">
                            {t('freeTalk.limitReached') || '대화 한도가 완료되었습니다'}
                        </div>
                    )}
                    {sessionEnded && endedReason === 'idle' && (
                        <div className="ftc-system-msg">
                            {t('freeTalk.idleEnded') || '오랫동안 활동이 없어 대화가 종료되었어요'}
                        </div>
                    )}
                    {replyError && (
                        <div className="ftc-error">
                            {t('freeTalk.replyError') || '응답 생성 실패'} <small>{replyError}</small>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                <footer className="ftc-footer">
                    <button
                        className={`ftc-mic-btn ${recorder.isRecording ? 'recording' : ''}`}
                        disabled={inputDisabled && !recorder.isRecording}
                        onClick={handleTalkBtn}
                        title={
                            sessionEnded
                                ? (t('freeTalk.sessionEnded') || '세션이 종료되었어요')
                                : !playbackQueueDone
                                    ? (t('freeTalk.waitingForIntro') || '인트로가 끝난 뒤 활성화돼요')
                                    : recorder.isRecording
                                        ? (t('freeTalk.stopTalking') || '말하기 종료')
                                        : (t('freeTalk.tapToTalk') || '눌러서 말하기')
                        }
                    >
                        {recorder.isProcessing
                            ? <RotateCcw className="spin" size={20} />
                            : recorder.isRecording
                                ? <MicOff size={20} />
                                : <Mic size={20} />}
                        <span>
                            {recorder.isProcessing
                                ? (t('freeTalk.processing') || '인식 중...')
                                : recorder.isRecording
                                    ? (t('freeTalk.stopTalking') || '말하기 종료')
                                    : (t('freeTalk.tapToTalk') || '말하기')}
                        </span>
                    </button>
                    {/* iOS/Android 마이크 권한 거부 시 — Settings 진입 안내 */}
                    {recorder.micDenied && (
                        <div className="ftc-mic-denied">
                            <span>{t('freeTalk.micDenied') || '마이크 권한이 필요해요'}</span>
                            <button
                                type="button"
                                className="ftc-mic-settings-btn"
                                onClick={() => recorder.openAppSettings?.()}
                            >
                                {t('freeTalk.openSettings') || '설정 열기'}
                            </button>
                        </div>
                    )}
                    {recorder.lastError && !recorder.micDenied && !recorder.isRecording && !recorder.isProcessing && (
                        <div className="ftc-mic-error">
                            <span>⚠️ {t('freeTalk.micError') || '녹음에 문제가 있었어요'}</span>
                        </div>
                    )}
                    <div className="ftc-footer-hint">
                        {sessionEnded
                            ? (t('freeTalk.sessionEnded') || '세션이 종료되었어요')
                            : !playbackQueueDone
                                ? (t('freeTalk.listenFirst') || '먼저 듣고 따라 해보세요')
                                : `${t('freeTalk.freeFlowHint') || '자유롭게 말해보세요'} · ${freeTurnCount}/${turnLimit}`}
                    </div>
                </footer>
            </div>

            <MessageCardModal
                open={!!cardOpenMessage}
                message={cardOpenMessage}
                langCode={setupArgs?.targetLang}
                sourceLang={sourceLang}
                onClose={handleCardClose}
                onSpeak={onSpeak}
                onSave={handleCardSave}
                isSaved={cardOpenMessage ? !!cardSavedIds[cardOpenMessage.id] : false}
                onTrialLimitReached={onTrialLimitReached}
                onPronSuccess={onPronSuccess}
                onBookmarkPrompt={onBookmarkPrompt}
                targetGoal={targetGoal}
                t={t}
                ScenePracticeCardComp={ScenePracticeCardComp}
            />

            <ConversationSummaryModal
                open={summaryModalOpen}
                summary={summary}
                isSummarizing={isSummarizing}
                summaryError={summaryError}
                onSaveSelected={handleSummarySaveSelected}
                onSkip={handleSummarySkip}
                t={t}
            />
        </div>
    );
}
