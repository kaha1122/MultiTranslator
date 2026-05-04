import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch';

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { /* noop */ }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

/**
 * Free Talking 세션 상태/턴/한도 관리.
 *
 * 메시지 객체 스키마 (turn 단위):
 *   {
 *     id: string,
 *     role: 'narration' | 'user_auto' | 'user_free' | 'ai',
 *     text: string,                  // 표시용 (의도 보정된 텍스트)
 *     translation?: string,
 *     pronunciation?: string,
 *     scene_hint?: string,
 *     learning_tip?: string,
 *     selected_emotion?: string,
 *     interaction_type?: string,
 *     sttRaw?: string,               // user_free 만: STT 원본 (오인식 회색 표시용)
 *     edited?: boolean,
 *     // TTS 데이터 (서버에서 받음)
 *     audio?: string,                // base64
 *     mimeType?: string,
 *     words?: Array<{word, offsetMs, durationMs}>,
 *     ttsGen?: number,               // useTTSSyncedReveal 재생 트리거용 generation
 *   }
 */

const SERVER_URL = getServerUrl();

// 한도 정책 — Sprint 2 확정
//   - Trial: 8턴/세션 (자유 발화 카운트)
//   - Pro: 25턴/세션
//   - Premium: 무제한 (300 soft cap)
const TURN_LIMITS = { trial: 8, pro: 25, premium: 300 };
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30분

// voiceSwap 결정 — 세션 시작 시 50% 확률로 swap.
// false (default): User=female, AI=male
// true  (swap)  : User=male,   AI=female
function pickVoices() {
    const swap = Math.random() < 0.5;
    return {
        userSpeaker: swap ? 'male' : 'female',
        aiSpeaker:   swap ? 'female' : 'male',
        swap,
    };
}

export function useConversation({ tier = 'trial' } = {}) {
    const [sessionId, setSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [setup, setSetup] = useState(null);     // {scene, category, targetLang, sourceLang, difficulty, speechStyle, sceneI18nLabel}
    const [scenarioMeta, setScenarioMeta] = useState(null);
    const [isStarting, setIsStarting] = useState(false);
    const [startError, setStartError] = useState(null);
    const [freeTurnCount, setFreeTurnCount] = useState(0);
    const [sessionEnded, setSessionEnded] = useState(false);
    const [endedReason, setEndedReason] = useState(null);  // 'limit' | 'user' | 'idle'
    const [isReplying, setIsReplying] = useState(false);
    const [replyError, setReplyError] = useState(null);
    const [summary, setSummary] = useState(null);              // {keyPhrases: [...]}
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summaryError, setSummaryError] = useState(null);
    const idGenRef = useRef(0);
    const idleTimerRef = useRef(null);
    const messagesRef = useRef([]);
    const setupRef = useRef(null);
    const scenarioMetaRef = useRef(null);
    const tierRef = useRef(tier);

    useEffect(() => { tierRef.current = tier; }, [tier]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { setupRef.current = setup; }, [setup]);
    useEffect(() => { scenarioMetaRef.current = scenarioMeta; }, [scenarioMeta]);

    const turnLimit = TURN_LIMITS[tier] || TURN_LIMITS.trial;

    const newId = () => {
        idGenRef.current += 1;
        return `m-${Date.now()}-${idGenRef.current}`;
    };

    const fetchTTS = useCallback(async ({ text, langCode, emotion, speaker }) => {
        try {
            const res = await authFetch(`${SERVER_URL}/api/converse-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, langCode, emotion, speaker }),
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.warn('[useConversation] TTS fetch failed:', e?.message);
            return null;
        }
    }, []);

    // 세션 시작 시 결정되는 voice swap (랜덤). ref로 보존되어 자유 발화 흐름에서도 일관 적용.
    const voicesRef = useRef({ userSpeaker: 'female', aiSpeaker: 'male', swap: false });

    const startSession = useCallback(async (setupArgs) => {
        setIsStarting(true);
        setStartError(null);
        setMessages([]);
        setScenarioMeta(null);
        setFreeTurnCount(0);
        setSessionEnded(false);
        setEndedReason(null);
        // voice 선택 — 세션마다 랜덤 (User=female/AI=male  또는  User=male/AI=female)
        voicesRef.current = pickVoices();
        try {
            const res = await authFetch(`${SERVER_URL}/api/converse-start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: setupArgs.scene,
                    category: setupArgs.category,
                    targetLang: setupArgs.targetLang,
                    sourceLang: setupArgs.sourceLang,
                    difficulty: setupArgs.difficulty,
                    speechStyle: setupArgs.speechStyle,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server error ${res.status}`);
            }
            const data = await res.json();
            setSetup(setupArgs);
            setScenarioMeta(data.scenarioMeta || null);
            setSessionId(`s-${Date.now()}`);

            // 3개 메시지 골격을 즉시 마운트 (text는 빈 채로 — TTS reveal로 채워짐)
            // played: false → ChatBubble이 fullText pre-flash 차단 (자기 차례에 reveal 시작)
            const introMsg = {
                id: newId(),
                role: 'narration',
                text: '',
                fullText: data.intro?.text || '',
                played: false,
            };
            const userAutoMsg = {
                id: newId(),
                role: 'user_auto',
                text: '',
                fullText: data.firstUserTurn?.sentence || '',
                translation: data.firstUserTurn?.translation,
                pronunciation: data.firstUserTurn?.pronunciation,
                scene_hint: data.firstUserTurn?.scene_hint,
                learning_tip: data.firstUserTurn?.learning_tip,
                selected_emotion: data.firstUserTurn?.selected_emotion,
                interaction_type: data.firstUserTurn?.interaction_type,
                played: false,
            };
            const aiMsg = {
                id: newId(),
                role: 'ai',
                text: '',
                fullText: data.firstAiReply?.sentence || '',
                translation: data.firstAiReply?.translation,
                pronunciation: data.firstAiReply?.pronunciation,
                scene_hint: data.firstAiReply?.scene_hint,
                learning_tip: data.firstAiReply?.learning_tip,
                selected_emotion: data.firstAiReply?.selected_emotion,
                interaction_type: data.firstAiReply?.interaction_type,
                played: false,
            };
            setMessages([introMsg, userAutoMsg, aiMsg]);

            // TTS 3개 병렬 fetch — 도착하는 대로 메시지에 audio/words 주입
            // 재생 순서는 FreeTalkingChat 컴포넌트가 ttsGen 토큰으로 직렬화 제어
            const { userSpeaker, aiSpeaker } = voicesRef.current;
            // TTS 실패 시 메시지에 ttsReady=true + played=true 마킹 → fullText fallback 노출
            // (ChatBubble은 played=true 면 fullText 상시 표시. 재생 큐도 audio 없어도 통과)
            const applyTTS = (msgId, ttsResult) => {
                setMessages(prev => prev.map(m => {
                    if (m.id !== msgId) return m;
                    if (ttsResult) {
                        return { ...m, audio: ttsResult.audio, mimeType: ttsResult.mimeType, words: ttsResult.words, ttsReady: true };
                    }
                    return { ...m, ttsReady: true, played: true, ttsFailed: true };
                }));
            };
            (async () => {
                const introTTS = await fetchTTS({
                    text: data.intro.text,
                    langCode: setupArgs.sourceLang,
                    speaker: userSpeaker,
                });
                applyTTS(introMsg.id, introTTS);
            })();
            (async () => {
                const userTTS = await fetchTTS({
                    text: data.firstUserTurn.sentence,
                    langCode: setupArgs.targetLang,
                    emotion: data.firstUserTurn.selected_emotion,
                    speaker: userSpeaker,
                });
                applyTTS(userAutoMsg.id, userTTS);
            })();
            (async () => {
                const aiTTS = await fetchTTS({
                    text: data.firstAiReply.sentence,
                    langCode: setupArgs.targetLang,
                    emotion: data.firstAiReply.selected_emotion,
                    speaker: aiSpeaker,
                });
                applyTTS(aiMsg.id, aiTTS);
            })();
        } catch (e) {
            console.error('[useConversation] start failed:', e?.message || e);
            setStartError(e?.message || 'Failed to start');
        } finally {
            setIsStarting(false);
        }
    }, [fetchTTS]);

    const endSession = useCallback((reason = 'user') => {
        setSessionEnded(true);
        setEndedReason(reason);
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    const resetSession = useCallback(() => {
        setSessionId(null);
        setMessages([]);
        setSetup(null);
        setScenarioMeta(null);
        setFreeTurnCount(0);
        setSessionEnded(false);
        setEndedReason(null);
        setStartError(null);
        setReplyError(null);
        setIsReplying(false);
        setSummary(null);
        setIsSummarizing(false);
        setSummaryError(null);
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    /**
     * 세션 종료 후 1회 호출 — 핵심 표현 3~5개 추출.
     * narration / user_auto / user_free / ai 모두 포함하여 전송.
     * (narration은 sourceLang이라 학습 가치 낮지만 컨텍스트 제공용)
     */
    const requestSummary = useCallback(async () => {
        if (isSummarizing) return;
        const setupNow = setupRef.current;
        const scenarioNow = scenarioMetaRef.current;
        const all = messagesRef.current;
        if (!setupNow) return;
        const turnsForApi = all
            .filter(m => m.role !== 'narration')
            .filter(m => (m.fullText || m.text || '').trim().length > 0)
            .map(m => ({ role: m.role === 'ai' ? 'ai' : 'user', text: m.fullText || m.text || '' }));
        if (turnsForApi.length === 0) return;

        setIsSummarizing(true);
        setSummaryError(null);
        try {
            const res = await authFetch(`${SERVER_URL}/api/converse-summarize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    history: turnsForApi,
                    scenarioMeta: scenarioNow,
                    targetLang: setupNow.targetLang,
                    sourceLang: setupNow.sourceLang,
                    difficulty: setupNow.difficulty,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server ${res.status}`);
            }
            const data = await res.json();
            setSummary(data);
        } catch (e) {
            console.error('[useConversation] summarize failed:', e?.message || e);
            setSummaryError(e?.message || 'Summarize failed');
        } finally {
            setIsSummarizing(false);
        }
    }, [isSummarizing]);

    // 30분 무활동 자동 종료
    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            setSessionEnded(true);
            setEndedReason('idle');
        }, IDLE_TIMEOUT_MS);
    }, []);

    /**
     * 자유 발화 STT 결과를 받아 의도 보정 + AI 응답을 생성한다.
     * 1) user_free 메시지를 즉시 messages에 append (STT raw + intentText 자리)
     * 2) /api/converse-reply 호출로 intent 보정 + AI 응답 생성
     * 3) user_free 의 fullText/text를 intentText로 교체, ai 메시지 append
     * 4) ai 메시지에 TTS fetch
     */
    const submitFreeUtterance = useCallback(async (rawSttText) => {
        if (!rawSttText || !rawSttText.trim()) return;
        if (sessionEnded) return;

        const setupNow = setupRef.current;
        const scenarioNow = scenarioMetaRef.current;
        const historyNow = messagesRef.current;
        if (!setupNow) return;

        resetIdleTimer();

        // 1) user_free 즉시 표시 — intentText 미정 상태에서는 sttRaw 그대로 보여줌
        // user_free는 사용자가 "이미 말한" 발화라 played=true (TTS reveal 대상 아님 — 텍스트만)
        const userMsgId = newId();
        const userMsg = {
            id: userMsgId,
            role: 'user_free',
            text: rawSttText,
            fullText: rawSttText,
            sttRaw: rawSttText,
            edited: false,
            ttsReady: false,
            played: true,
        };
        const aiMsgId = newId();
        const aiPlaceholder = {
            id: aiMsgId,
            role: 'ai',
            text: '',
            fullText: '',
            ttsReady: false,
            isLoading: true,
            played: false,
        };
        setMessages(prev => [...prev, userMsg, aiPlaceholder]);

        // 카운트 +1 (functional updater — stale closure race 방지)
        // limit 도달 차단은 별도 useEffect 에서 freeTurnCount 변화를 보고 처리.
        setFreeTurnCount(prev => prev + 1);

        setIsReplying(true);
        setReplyError(null);
        try {
            // 2) /api/converse-reply
            const historyForApi = historyNow
                .filter(m => m.role !== 'narration')
                .map(m => ({
                    role: m.role === 'ai' ? 'ai' : 'user',
                    text: m.fullText || m.text || '',
                }));

            const res = await authFetch(`${SERVER_URL}/api/converse-reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rawSttText,
                    history: historyForApi,
                    scenarioMeta: scenarioNow,
                    targetLang: setupNow.targetLang,
                    sourceLang: setupNow.sourceLang,
                    difficulty: setupNow.difficulty,
                    speechStyle: setupNow.speechStyle,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server ${res.status}`);
            }
            const data = await res.json();

            // 3) user_free 메시지 업데이트 + ai 메시지 채우기
            setMessages(prev => prev.map(m => {
                if (m.id === userMsgId) {
                    return {
                        ...m,
                        text: data.intentText || rawSttText,
                        fullText: data.intentText || rawSttText,
                        translation: data.intentTranslation || '',
                        intentWasCorrected: !!data.intentWasCorrected,
                    };
                }
                if (m.id === aiMsgId) {
                    const a = data.aiReply || {};
                    return {
                        ...m,
                        isLoading: false,
                        text: '',  // streaming reveal로 채워짐
                        fullText: a.sentence || '',
                        translation: a.translation || '',
                        pronunciation: a.pronunciation || '',
                        scene_hint: a.scene_hint || '',
                        learning_tip: a.learning_tip || '',
                        selected_emotion: a.selected_emotion || '',
                        interaction_type: a.interaction_type || '',
                    };
                }
                return m;
            }));

            // 4) ai 메시지 TTS fetch — 세션 voiceSwap 일관 적용
            const aiTTS = await fetchTTS({
                text: data.aiReply?.sentence || '',
                langCode: setupNow.targetLang,
                emotion: data.aiReply?.selected_emotion,
                speaker: voicesRef.current.aiSpeaker,
            });
            setMessages(prev => prev.map(m => {
                if (m.id !== aiMsgId) return m;
                if (aiTTS) {
                    return { ...m, audio: aiTTS.audio, mimeType: aiTTS.mimeType, words: aiTTS.words, ttsReady: true };
                }
                // TTS 실패: played=true 강제 마킹 → fullText fallback 즉시 노출
                return { ...m, ttsReady: true, played: true, ttsFailed: true };
            }));

            // 한도 도달은 freeTurnCount 변화를 보는 별도 useEffect 에서 처리
        } catch (e) {
            console.error('[useConversation] reply failed:', e?.message || e);
            setReplyError(e?.message || 'Reply failed');
            // 실패 시 placeholder 제거하지 않고 에러 표기 — 사용자가 재시도 가능하도록
            setMessages(prev => prev.map(m => m.id === aiMsgId
                ? { ...m, isLoading: false, replyError: e?.message || 'Reply failed', ttsReady: true }
                : m));
        } finally {
            setIsReplying(false);
        }
    }, [fetchTTS, sessionEnded, resetIdleTimer]);

    /**
     * ChatBubble의 onPlaybackDone에서 호출 — 메시지를 played=true 로 마킹.
     * 이로써 자동재생 차례가 끝난 메시지는 fullText 상시 표시 (스크롤로 다시 보일 때 깜빡임 없음).
     */
    const markMessagePlayed = useCallback((messageId) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, played: true } : m));
    }, []);

    /**
     * 마지막 user_free 메시지의 텍스트를 사용자가 직접 수정하고, 직후 AI 응답을 재생성한다.
     */
    const editLastUserFree = useCallback(async (newText) => {
        if (!newText || !newText.trim()) return;
        const all = messagesRef.current;
        // 마지막 user_free 메시지 찾기
        let lastUserIdx = -1;
        for (let i = all.length - 1; i >= 0; i--) {
            if (all[i].role === 'user_free') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) return;
        const lastUser = all[lastUserIdx];
        // 직후 ai 메시지 (있으면) 제거, user_free 텍스트 갱신
        const trimmed = all.slice(0, lastUserIdx + 1).map((m, i) =>
            i === lastUserIdx
                ? { ...m, text: newText, fullText: newText, edited: true }
                : m
        );
        setMessages(trimmed);
        // 카운트 차감 — submitFreeUtterance가 +1 할 것이므로 재생성 시 카운트 보존
        setFreeTurnCount(prev => Math.max(0, prev - 1));
        // submit 다시 (rawSttText로 새 newText 사용; intent recovery에서 그대로 통과될 것)
        await submitFreeUtterance(newText);
    }, [submitFreeUtterance]);

    /**
     * 마지막 user_free + 그 직후 ai 메시지를 제거한다 (재녹음 진입용).
     */
    const removeLastUserFreePair = useCallback(() => {
        const all = messagesRef.current;
        let lastUserIdx = -1;
        for (let i = all.length - 1; i >= 0; i--) {
            if (all[i].role === 'user_free') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) return;
        // user_free 와 그 뒤의 모든 메시지 제거 (보통 직후 ai 1개)
        setMessages(all.slice(0, lastUserIdx));
        setFreeTurnCount(prev => Math.max(0, prev - 1));
    }, []);

    // 한도/턴 변경 시 idle timer 갱신
    useEffect(() => {
        if (sessionId && !sessionEnded) resetIdleTimer();
        return () => {
            if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
                idleTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, sessionEnded, freeTurnCount]);

    // 자유 발화 카운트가 tier 한도에 도달하면 세션 종료
    useEffect(() => {
        if (!sessionId) return;
        if (sessionEnded) return;
        const limit = TURN_LIMITS[tierRef.current] || TURN_LIMITS.trial;
        if (freeTurnCount >= limit) {
            setSessionEnded(true);
            setEndedReason('limit');
        }
    }, [freeTurnCount, sessionId, sessionEnded]);

    return {
        sessionId, messages, setup, scenarioMeta,
        isStarting, startError,
        isReplying, replyError,
        freeTurnCount, turnLimit,
        sessionEnded, endedReason,
        summary, isSummarizing, summaryError,
        startSession, endSession, resetSession,
        submitFreeUtterance, editLastUserFree, removeLastUserFreePair,
        markMessagePlayed,
        requestSummary,
    };
}
