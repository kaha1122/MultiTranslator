import { useEffect, useRef, useState } from 'react';
import { X, Mic, MicOff, RotateCcw } from 'lucide-react';
import ChatBubble from './ChatBubble';
import MessageCardModal from './MessageCardModal';
import AITipPopup from './AITipPopup';
import { useConversation } from '../hooks/useConversation';
import { useFreeTalkRecorder } from '../hooks/useFreeTalkRecorder';
import { getT } from '../utils/i18n';
import { playStarSound } from '../utils/soundEffects';
import './FreeTalkingChat.css';

/**
 * 카카오톡 스타일 풀스크린 Free Talking 모달.
 *
 * Sprint 2 흐름:
 *   - 시작: 3개 메시지 자동 streaming + TTS 직렬 재생
 *   - 자유 발화: 하단 [말하기] 버튼 → 녹음 → STT → /api/converse-reply (intent 보정 + AI 응답)
 *   - 메시지 클릭 → 카드 팝업 (MessageCardModal + ScenePracticeCard 재사용)
 *   - 마지막 user_free: [💡 Learning Tip] [듣기] 버튼 (Learning Tip 은 서버에서 매 턴
 *       동봉된 모국어 코칭 텍스트를 narration voice 로 재생. 카드 저장 시 동일 텍스트가
 *       learning_tip 필드로 매핑됨.)
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
        startSession, endSession, resetSession,
        submitFreeUtterance,
        markMessagePlayed,
    } = useConversation({ tier });

    // 첫 진입 안내 — localStorage 'pronunfit_freetalk_guide_seen' 미존재 시 모달 진입 직후 1회 표시
    const [showFirstGuide, setShowFirstGuide] = useState(false);

    const [playbackIdx, setPlaybackIdx] = useState(-1);
    const [playbackQueueDone, setPlaybackQueueDone] = useState(false);
    const startedRef = useRef(false);
    const messagesEndRef = useRef(null);
    const [cardOpenMessage, setCardOpenMessage] = useState(null);
    const [cardSavedIds, setCardSavedIds] = useState({});  // {messageId: true}
    // Learning Tip 코칭 TTS 로딩 중인 user_free 메시지 id (스피너 노출용)
    const [learningTipLoadingId, setLearningTipLoadingId] = useState(null);
    // 음성 미지원 (sourceLang, targetLang) 조합 시 텍스트만 보여주는 popup
    const [aiTipPopup, setAiTipPopup] = useState({ open: false, text: '' });

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
            setAiTipPopup({ open: false, text: '' });
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

    // AI-Tip 버튼 — 옵션 A 보수 매트릭스:
    //   m.learning_tip           : SHORT 카드 표시용 (UI에 보이는 노란 박스, 변경 X)
    //   m.learning_tip_narration : SPOKEN 나레이션용 (2~4 문장, TTS-friendly)
    // 흐름:
    //   1) 서버 /api/converse-coach-tts 호출
    //   2) (sourceLang, targetLang) 매트릭스 매칭 → multilingual voice 음성 합성 후 재생
    //   3) 매트릭스 미지원 조합 → 서버 204 No Content → 클라가 AITipPopup 으로
    //      narration 텍스트를 시각 표시 (음성 없이 문자로 코칭 확인 가능)
    //   4) 네트워크 에러 등 → 동일하게 AITipPopup fallback
    const handleLearningTip = async (msg) => {
        const ttsText = msg?.learning_tip_narration || msg?.learning_tip;
        if (!ttsText) return;
        if (learningTipLoadingId) return;
        setLearningTipLoadingId(msg.id);
        let url = null;
        try {
            const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            const res = await fetch(`${SERVER_URL}/api/converse-coach-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipText: ttsText,
                    sourceLang,
                    targetLang: setupArgs?.targetLang,
                }),
            });
            if (res.status === 204) {
                // 매트릭스 미지원 (sourceLang, targetLang) — narration 텍스트 popup
                setAiTipPopup({ open: true, text: ttsText });
                return;
            }
            if (!res.ok) throw new Error(`coach-tts ${res.status}`);
            const blob = await res.blob();
            url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            await new Promise((resolve) => {
                audio.onended = resolve;
                audio.onerror = resolve;  // graceful — finally 에서 cleanup
                audio.play().catch(resolve);
            });
        } catch (e) {
            console.warn('[FreeTalkingChat] coach-tts failed, falling back to text popup:', e?.message);
            // 네트워크 에러 등 → 텍스트 popup fallback
            setAiTipPopup({ open: true, text: ttsText });
        } finally {
            if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }
            setLearningTipLoadingId(null);
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
            const cardId = await onSaveConversationMessage({
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
            // 저장 성공 시 별표 사운드 (cardId truthy 또는 undefined — 중복은 null 반환이므로 not null)
            if (cardId !== null) {
                try { playStarSound(); } catch (e) { /* sound is best-effort */ }
            }
            setCardSavedIds(p => ({ ...p, [cardOpenMessage.id]: true }));
        } catch (e) {
            console.error('[FreeTalkingChat] save failed:', e?.message);
        }
    };

    if (!open) return null;

    const personaName = scenarioMeta?.responder_role || t('freeTalk.aiName') || 'AI';
    const headerLabel = setupArgs?.sceneI18nLabel || t('freeTalk.title') || 'Free-Talking';
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
                        <button className="ftc-close-btn" onClick={handleClose} aria-label="Close">
                            <X size={22} />
                        </button>
                    </div>
                </header>

                {/* 항상 노출되는 컴팩트 안내 — 메시지 탭 시 카드 오픈 */}
                <div className="ftc-tap-hint" role="note">
                    💡 {t('freeTalk.tapHint') || '메시지를 탭하면 카드가 열려요 · 발음 연습 + 저장으로 Streak 유지'}
                </div>

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
                            onLearningTipUserFree={handleLearningTip}
                            isLastUserFree={idx === lastUserFreeIdx}
                            isLearningTipLoading={learningTipLoadingId === m.id}
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

            <AITipPopup
                open={aiTipPopup.open}
                text={aiTipPopup.text}
                onClose={() => setAiTipPopup({ open: false, text: '' })}
                t={t}
            />
        </div>
    );
}
