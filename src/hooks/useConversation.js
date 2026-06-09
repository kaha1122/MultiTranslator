/* global __APP_VERSION__ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { authFetch } from '../utils/authFetch';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';

// Phase 1: turn 마다 incremental Firestore update 의 debounce 간격 (ms).
// 빠른 연속 응답을 묶어 write 비용 최소화. 강제 종료 시 최대 3초 분의 turn 만 손실.
const INCREMENTAL_WRITE_DEBOUNCE_MS = 3000;

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

// 한도 정책 — 모든 tier 5턴/세션으로 통일 (한 대화 깊이는 짧고 집중, 일일 generate
// 횟수는 별도 daily quota 시스템에서 관리). Pro/Premium 은 daily quota 가 넉넉할 뿐
// 한 세션 깊이는 동일.
const TURN_LIMITS = { trial: 5, pro: 5, premium: 5 };
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

// freeTalkHistory Firestore 문서 ID — Scene 의 makeHistoryKey 와 동일 스킴(같은 카테고리 70개 안에서만 누적,
// difficulty / speechStyle / lang 분리). Scene 카드 동선은 hidden 처리됐고, sceneHistory 는 더 이상 새 데이터가
// 쌓이지 않음 → freeTalkHistory 신규 컬렉션으로 분리해 의미 명확화.
const makeFreeTalkHistoryKey = (sceneId, difficulty, style, lang) =>
    `${sceneId}--${difficulty}--${style}--${lang}`;

// ── 대화 로그(운영/버그추적용) ────────────────────────────────────────────────
// freeTalkTranscripts/{sessionId} 에 저장할 slim turn 배열로 직렬화.
// text만 보존 — audio(base64) / words 타이밍 / id / ttsReady 등 무거운 필드는 전부 제외.
// 재질문 회귀 추적이 목적이라 AI 턴엔 establishedFacts 스냅샷(f), user 턴엔 STT 원본(raw)을 같이 남긴다.
const TRANSCRIPT_ROLE = { narration: 'n', user_auto: 'ua', user_free: 'u', ai: 'a' };
const TRANSCRIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30일 (Firestore TTL: expiresAt — 기존 컬렉션 컨벤션 일치)
const TRANSCRIPT_TEXT_CAP = 2000;                     // 방어적 길이 제한 (문서 비대화 방지)

function serializeTranscriptTurns(msgs) {
    return (msgs || []).map(m => {
        const text = (m.fullText || m.text || '').slice(0, TRANSCRIPT_TEXT_CAP);
        const turn = { r: TRANSCRIPT_ROLE[m.role] || m.role || '?', t: text };
        if (m.role === 'user_free') {
            const raw = m.sttRaw || '';
            if (raw && raw !== (m.fullText || m.text)) turn.raw = raw.slice(0, TRANSCRIPT_TEXT_CAP);
            if (m.intentWasCorrected) turn.c = true;
            // AI Tip 기록(운영/분석용) — SHORT(tip) + SPOKEN(tipN) 둘 다
            if (m.learning_tip) turn.tip = String(m.learning_tip).slice(0, TRANSCRIPT_TEXT_CAP);
            if (m.learning_tip_narration) turn.tipN = String(m.learning_tip_narration).slice(0, TRANSCRIPT_TEXT_CAP);
        }
        if (m.role === 'ai' && Array.isArray(m.establishedFacts) && m.establishedFacts.length) {
            turn.f = m.establishedFacts;
        }
        return turn;
    }).filter(t => t.t || t.raw);
}

export function useConversation({ tier = 'trial' } = {}) {
    const { user } = useAuth();
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
    // freeTalkHistory Firestore 캐시 — key → situations[] 배열 (ScenePractice 의 historyCacheRef 패턴 차용).
    // ref 라 렌더 트리거 없음. 같은 키 재진입 시 Firestore 재호출 회피.
    const historyCacheRef = useRef({});
    // 대화 로그용 refs — sessionId 는 write 클로저에서 즉시 참조해야 해서 ref 병행
    // (state 동기화 effect 가 돌기 전에 첫 turn write 가 발생하는 race 회피).
    const sessionIdRef = useRef(null);
    const sessionStartedAtRef = useRef(null);
    const lastTranscriptSigRef = useRef(null);     // 동일 write 중복 방지(lifecycle 다중 발화 등)
    const terminalReasonWrittenRef = useRef(false); // 첫 종료 사유 확정 후 후행 write(특히 in_progress) clobber 방지

    useEffect(() => { tierRef.current = tier; }, [tier]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { setupRef.current = setup; }, [setup]);
    useEffect(() => { scenarioMetaRef.current = scenarioMeta; }, [scenarioMeta]);
    useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

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

    // freeTalkHistory 로드 — 같은 (sceneId, difficulty, speechStyle, lang) 키에 누적된 situation 메타.
    // 익명 유저(user 없음)는 Firestore 접근 불가 → 빈 배열 반환 (중복방지 효과 없지만 동작은 정상).
    const loadAvoidSituations = useCallback(async (key) => {
        if (!user) return [];
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key];
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/freeTalkHistory`, key));
            const situations = snap.exists() ? (snap.data().situations || []) : [];
            historyCacheRef.current = { ...historyCacheRef.current, [key]: situations };
            return situations;
        } catch (e) {
            console.warn('[useConversation] freeTalkHistory load failed:', e?.message);
            return [];
        }
    }, [user]);

    // 응답 직후 1회 호출 — situationSummary + dimensions 를 Firestore 에 누적 (merge 모드).
    // 실패해도 세션 흐름에는 영향 없게 catch 만.
    const appendFreeTalkHistory = useCallback((key, situation) => {
        const existing = historyCacheRef.current[key] || [];
        const updated = [...existing, situation];
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/freeTalkHistory`, key), {
                situations: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(e => console.warn('[useConversation] freeTalkHistory append failed:', e?.message));
        }
    }, [user]);

    // 2026-05-22: 세션 시작 시 historyKey 기억 → 종료 시 같은 key 의 마지막 situation 에
    // endedAt / durationMs / freeTurnCount / turnLimit / endedReason 추가 update.
    // freeTurnCountRef 는 latest 값 캡처 (useEffect closure 회피).
    const lastHistoryKeyRef = useRef(null);
    const freeTurnCountRef = useRef(0);
    useEffect(() => { freeTurnCountRef.current = freeTurnCount; }, [freeTurnCount]);

    // 대화 로그(운영/버그추적용) 쓰기 — users/{uid}/freeTalkTranscripts/{sessionId}.
    // text only(audio 미저장), AI 턴 establishedFacts 스냅샷 포함, 30일 TTL(expiresAt).
    // 턴마다(in_progress) + 종료/lifecycle 시(endedReason 확정) merge 저장.
    // reason+turn+msgCount 시그니처로 동일 write 중복(lifecycle 다중 발화) 방어.
    const writeTranscript = useCallback((reason) => {
        if (!user) return;
        const sid = sessionIdRef.current;
        if (!sid) return;
        // 첫 종료 사유(terminal)가 기록되면 이후 write 모두 skip — 특히 debounced flush 가
        // 종료 후 발화해 endedReason 을 'in_progress' 로 되돌리는 clobber 방지. (first terminal wins)
        if (terminalReasonWrittenRef.current) return;
        const msgs = messagesRef.current || [];
        const turns = serializeTranscriptTurns(msgs);
        if (turns.length === 0) return;
        const sig = `${sid}|${reason}|${freeTurnCountRef.current || 0}|${turns.length}`;
        if (lastTranscriptSigRef.current === sig) return;  // 중복 skip
        lastTranscriptSigRef.current = sig;
        if (reason && reason !== 'in_progress') terminalReasonWrittenRef.current = true;

        const setupNow = setupRef.current || {};
        const tier = tierRef.current || 'trial';
        const startedAt = sessionStartedAtRef.current || null;
        const endedAt = Date.now();
        let platform = 'web';
        try { platform = Capacitor?.getPlatform?.() || 'web'; } catch { /* noop */ }

        setDoc(doc(db, `users/${user.uid}/freeTalkTranscripts`, sid), {
            sessionId: sid,
            key: lastHistoryKeyRef.current || null,
            scene: setupNow.scene || null,
            category: setupNow.category || null,
            targetLang: setupNow.targetLang || null,
            sourceLang: setupNow.sourceLang || null,
            difficulty: setupNow.difficulty || null,
            speechStyle: setupNow.speechStyle || null,
            tier,
            platform,
            appVersion: (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null),
            startedAt,
            endedAt,
            durationMs: startedAt ? endedAt - startedAt : null,
            freeTurnCount: freeTurnCountRef.current || 0,
            turnLimit: TURN_LIMITS[tier] || TURN_LIMITS.trial,
            endedReason: reason || 'unknown',
            turns,
            updatedAt: serverTimestamp(),
            expiresAt: Timestamp.fromMillis(endedAt + TRANSCRIPT_TTL_MS),
        }, { merge: true }).catch(e => console.warn('[useConversation] freeTalkTranscript write failed:', e?.message));
    }, [user]);

    // Phase 1: turn 마다 incremental Firestore update 용 debounce timer.
    // 매 turn 직후 scheduleIncrementalTurnWrite() 호출 → 3초 뒤 단 1회 write.
    // 강제 종료 / 앱 kill / 크래시 시 최대 3초 분 turn 만 손실 (vs 종료 시 한 번에 쓰던 기존).
    const incrementalWriteTimerRef = useRef(null);

    const flushIncrementalTurnWrite = useCallback(() => {
        // 대화 로그(운영/버그추적) — freeTalkHistory key 유무와 무관하게 턴마다 저장.
        writeTranscript('in_progress');
        const key = lastHistoryKeyRef.current;
        if (!key) return;
        const existing = historyCacheRef.current[key] || [];
        if (existing.length === 0) return;
        const lastIdx = existing.length - 1;
        const last = existing[lastIdx];
        // 이미 종료 update 가 들어간 situation 은 덮어쓰지 않음 (race-safe)
        if (last.endedAt) return;
        const turn = freeTurnCountRef.current || 0;
        // 같은 turn 값이면 write skip (idempotent — Firestore 비용 절감)
        if (last.freeTurnCount === turn && last.lastTurnAt) return;
        const updated = [...existing];
        updated[lastIdx] = {
            ...last,
            freeTurnCount: turn,
            lastTurnAt: Date.now(),
        };
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/freeTalkHistory`, key), {
                situations: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(e => console.warn('[useConversation] freeTalkHistory incremental write failed:', e?.message));
        }
    }, [user, writeTranscript]);

    const scheduleIncrementalTurnWrite = useCallback(() => {
        if (incrementalWriteTimerRef.current) {
            clearTimeout(incrementalWriteTimerRef.current);
        }
        incrementalWriteTimerRef.current = setTimeout(() => {
            incrementalWriteTimerRef.current = null;
            flushIncrementalTurnWrite();
        }, INCREMENTAL_WRITE_DEBOUNCE_MS);
    }, [flushIncrementalTurnWrite]);

    /**
     * 마지막 freeTalkHistory situation 에 종료 데이터 추가 (idempotent: 이미 endedAt 있으면 skip).
     * sessionEnded 가 true 로 바뀌면 자동 호출됨 (아래 useEffect).
     */
    const updateLastFreeTalkHistoryEnd = useCallback((reason) => {
        const key = lastHistoryKeyRef.current;
        if (!key) return;
        const existing = historyCacheRef.current[key] || [];
        if (existing.length === 0) return;
        const lastIdx = existing.length - 1;
        const last = existing[lastIdx];
        if (last.endedAt) return;  // 중복 호출 보호
        // Phase 1: 펜딩 debounced write 가 endedAt 덮어쓰지 않도록 취소
        if (incrementalWriteTimerRef.current) {
            clearTimeout(incrementalWriteTimerRef.current);
            incrementalWriteTimerRef.current = null;
        }
        const startedAt = last.startedAt || last.createdAt || Date.now();
        const endedAt = Date.now();
        const updated = [...existing];
        updated[lastIdx] = {
            ...last,
            endedAt,
            durationMs: endedAt - startedAt,
            freeTurnCount: freeTurnCountRef.current || 0,
            turnLimit: TURN_LIMITS[tierRef.current] || TURN_LIMITS.trial,
            endedReason: reason || 'unknown',
        };
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/freeTalkHistory`, key), {
                situations: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(e => console.warn('[useConversation] freeTalkHistory end update failed:', e?.message));
        }
    }, [user]);

    // Phase 2: lifecycle 이벤트 후크 — 사용자가 X 안 눌러도 종료 데이터 캡처.
    // visibilitychange='hidden' / pagehide / Capacitor appStateChange(isActive:false) 셋 모두 등록.
    // 강제종료(앱 kill / 홈버튼 / 디바이스 OFF) 시점 직전에 OS 가 거의 항상 한 번은 발화.
    // updateLastFreeTalkHistoryEnd 는 idempotent — 중복 발화돼도 안전.
    useEffect(() => {
        const handleLifecycleHidden = (source) => {
            if (!sessionIdRef.current) return;  // 진행 중 세션 없음 → noop
            // 대화 로그 — 백그라운드/이탈 시점 캡처 (강제종료 직전 사유 보존)
            writeTranscript(`lifecycle_${source}`);
            if (lastHistoryKeyRef.current) {
                updateLastFreeTalkHistoryEnd(`lifecycle_${source}`);
            }
        };
        const onVisibilityChange = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                handleLifecycleHidden('visibility');
            }
        };
        const onPageHide = () => handleLifecycleHidden('pagehide');

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', onPageHide);
        }

        // Capacitor 네이티브 — 앱 백그라운드 진입 / 종료 직전 발화
        let capListenerHandle = null;
        if (Capacitor?.isNativePlatform?.()) {
            try {
                const p = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
                    if (!isActive) handleLifecycleHidden('appstate');
                });
                // Capacitor 8: addListener 가 Promise<PluginListenerHandle> 반환
                if (p && typeof p.then === 'function') {
                    p.then(h => { capListenerHandle = h; }).catch(() => {});
                } else {
                    capListenerHandle = p;
                }
            } catch (e) { /* noop — listener 등록 실패해도 web 이벤트로 fallback */ }
        }

        return () => {
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('pagehide', onPageHide);
            }
            if (capListenerHandle?.remove) {
                try { capListenerHandle.remove(); } catch (e) { /* noop */ }
            }
        };
    }, [updateLastFreeTalkHistoryEnd, writeTranscript]);

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

        // freeTalkHistory 키 — sceneId 가 setupArgs 에 없으면 'unknown' 으로 fallback (custom scene 처리는
        // ScenePractice 측에서 makeCustomSceneId 로 미리 생성해 setupArgs.sceneId 에 담아 보냄).
        const sceneIdForKey = setupArgs.sceneId || 'unknown';
        const historyKey = makeFreeTalkHistoryKey(
            sceneIdForKey,
            setupArgs.difficulty || 'basic',
            setupArgs.speechStyle || 'formal',
            setupArgs.targetLang || 'en',
        );
        // 누적 situations 로드 → 차원 회전용 메타로 prompt 에 inject.
        // 최근 30개만 buildStartPrompt 가 사용하지만 전송은 전체 (서버에서 slice).
        const persistedSituations = await loadAvoidSituations(historyKey);

        try {
            const res = await authFetch(`${SERVER_URL}/api/converse-start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: setupArgs.scene,
                    category: setupArgs.category,
                    isCustom: setupArgs.isCustom === true,
                    targetLang: setupArgs.targetLang,
                    sourceLang: setupArgs.sourceLang,
                    difficulty: setupArgs.difficulty,
                    speechStyle: setupArgs.speechStyle,
                    avoidSituations: persistedSituations,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server error ${res.status}`);
            }
            const data = await res.json();
            setSetup(setupArgs);
            setScenarioMeta(data.scenarioMeta || null);
            // 대화 로그용: sessionId/startedAt 을 ref 에 즉시 반영 (state sync 전 첫 write race 방지)
            const startTs = Date.now();
            const newSessionId = `s-${startTs}`;
            sessionIdRef.current = newSessionId;
            sessionStartedAtRef.current = startTs;
            lastTranscriptSigRef.current = null;
            terminalReasonWrittenRef.current = false;
            setSessionId(newSessionId);

            // freeTalkHistory append — situationSummary + dimensions 가 응답에 있으면 저장.
            // 두 필드 중 하나라도 비어있으면 skip (이전 빌드 호환). serverTimestamp 는 setDoc 호출 시 attach.
            // 2026-05-22: startedAt 추가 + lastHistoryKeyRef 기록 → 세션 종료 시 같은 situation
            // 에 endedAt/durationMs/freeTurnCount/turnLimit 추가됨 (updateLastFreeTalkHistoryEnd).
            if (data.situationSummary || data.dimensions) {
                appendFreeTalkHistory(historyKey, {
                    summary: data.situationSummary || '',
                    dimensions: data.dimensions || {},
                    createdAt: Date.now(),  // 클라이언트 epoch — Firestore 정렬엔 updatedAt 사용
                    startedAt: Date.now(),  // 세션 시작 시각 (분석/추적용)
                });
                lastHistoryKeyRef.current = historyKey;
            }

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
            // 호출자(FreeTalkingChat)가 성공/실패 분기 — 성공 시 onSessionStarted 콜백으로 카운트 차감.
            // 실패하면 사용자에게 [다시 시도] 버튼 노출하고 카운트는 보존(2026-05-21 UX 보호).
            return true;
        } catch (e) {
            console.error('[useConversation] start failed:', e?.message || e);
            setStartError(e?.message || 'Failed to start');
            return false;
        } finally {
            setIsStarting(false);
        }
    }, [fetchTTS, loadAvoidSituations, appendFreeTalkHistory]);

    // 세션 종료 자동 감지 — endSession/idle/limit 어느 경로든 sessionEnded=true 되면
    // freeTalkHistory 마지막 situation 에 종료 데이터 update (idempotent).
    useEffect(() => {
        if (!sessionEnded) return;
        // 대화 로그 — 종료 사유 확정 기록 (freeTalkHistory key 유무 무관)
        writeTranscript(endedReason || 'unknown');
        if (lastHistoryKeyRef.current) {
            updateLastFreeTalkHistoryEnd(endedReason || 'unknown');
        }
    }, [sessionEnded, endedReason, updateLastFreeTalkHistoryEnd, writeTranscript]);

    const endSession = useCallback((reason = 'user') => {
        setSessionEnded(true);
        setEndedReason(reason);
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
    }, []);

    const resetSession = useCallback(() => {
        // 사용자가 endSession 안 거치고 모달 즉시 닫는 경로 보호 — 진행 중 세션이면 종료 데이터 기록.
        // updateLastFreeTalkHistoryEnd 는 idempotent (이미 endedAt 있으면 skip).
        // 대화 로그 — 미종료 reset 이면 'closed' 가 종료 사유 (이미 terminal 기록 시 writeTranscript 내부에서 skip).
        writeTranscript('closed');
        if (lastHistoryKeyRef.current) {
            updateLastFreeTalkHistoryEnd('closed');
        }
        // Phase 1: 펜딩 debounced write 취소 (resetSession 후엔 마지막 turn 가 의미 없음)
        if (incrementalWriteTimerRef.current) {
            clearTimeout(incrementalWriteTimerRef.current);
            incrementalWriteTimerRef.current = null;
        }
        lastHistoryKeyRef.current = null;
        // 대화 로그 refs 정리 (다음 세션 startSession 에서 재초기화)
        sessionIdRef.current = null;
        sessionStartedAtRef.current = null;
        lastTranscriptSigRef.current = null;
        terminalReasonWrittenRef.current = false;
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
    }, [updateLastFreeTalkHistoryEnd, writeTranscript]);

    /**
     * 사용자가 SummaryModal을 [Skip]/[Save]/[X] 로 닫을 때 호출.
     * summary state 를 null 로 reset 해 useEffect 자동재오픈 루프를 차단.
     */
    const clearSummary = useCallback(() => {
        setSummary(null);
        setSummaryError(null);
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

        setIsReplying(true);
        setReplyError(null);
        try {
            // 2) /api/converse-reply
            // user turn에 누적된 learning_tip(이전 turn의 코칭 결과)을 coachingTip 으로 carry —
            // 서버 prompt 가 history block 에 inject 하여 AI 가 학습자의 누적 학습 맥락을
            // 인지하며 자연스럽게 상호작용하도록 한다.
            const historyForApi = historyNow
                .filter(m => m.role !== 'narration')
                .map(m => {
                    const isAi = m.role === 'ai';
                    const entry = {
                        role: isAi ? 'ai' : 'user',
                        text: m.fullText || m.text || '',
                    };
                    if (!isAi && m.learning_tip) {
                        entry.coachingTip = m.learning_tip;
                    }
                    return entry;
                });

            // B안(slot memory): 직전 턴까지 누적된 establishedFacts 를 carry.
            // 마지막 ai 메시지에 저장돼 있고, 서버가 cumulative 로 다시 반환하므로
            // 가장 최근 것 하나만 넘기면 됨. 없으면 [] (세션 첫 자유발화).
            // edit/remove 로 메시지가 trim 되면 자연스럽게 그 시점 facts 로 롤백됨.
            let priorFacts = [];
            for (let i = historyNow.length - 1; i >= 0; i--) {
                if (historyNow[i].role === 'ai' && Array.isArray(historyNow[i].establishedFacts)) {
                    priorFacts = historyNow[i].establishedFacts;
                    break;
                }
            }

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
                    establishedFacts: priorFacts,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server ${res.status}`);
            }
            const data = await res.json();

            // 3) user_free 메시지 업데이트 + ai 메시지 데이터 채우기
            //    isLoading 은 의도적으로 유지 — TTS 도착(또는 실패) 시점까지 스피너 계속 노출.
            //    이유: 응답이 먼저 도착하고 TTS 가 1~2초 늦게 도착하는 구간에 ChatBubble L67 hide 분기
            //         (!shouldAutoplay && !played && !isLoading) 가 적중해 풍선이 잠깐 사라졌다가
            //         TTS 도착 후 재등장하는 깜빡임이 발생. isLoading 을 TTS 까지 유지하면
            //         스피너 → reveal 직행으로 일관되게 동작.
            setMessages(prev => prev.map(m => {
                if (m.id === userMsgId) {
                    return {
                        ...m,
                        text: data.intentText || rawSttText,
                        fullText: data.intentText || rawSttText,
                        translation: data.intentTranslation || '',
                        intentWasCorrected: !!data.intentWasCorrected,
                        // 옵션 D — 서버에서 두 필드 동시 생성:
                        //   userCoachingTip      → learning_tip            (UI 카드 표시용 SHORT)
                        //   userCoachingNarration→ learning_tip_narration  (TTS 재생용 SPOKEN, 더 풍부)
                        // 카드 저장 시 MessageCardModal 은 learning_tip(SHORT) 만 사용.
                        // Learning Tip 버튼 클릭 시 handleLearningTip 가 narration 우선 사용
                        // (없으면 SHORT 로 fallback — 기존 누적 메시지 호환).
                        learning_tip: data.userCoachingTip || '',
                        learning_tip_narration: data.userCoachingNarration || '',
                    };
                }
                if (m.id === aiMsgId) {
                    const a = data.aiReply || {};
                    return {
                        ...m,
                        // isLoading 유지 (TTS 도착 시 풀림)
                        text: '',  // streaming reveal로 채워짐
                        fullText: a.sentence || '',
                        translation: a.translation || '',
                        pronunciation: a.pronunciation || '',
                        scene_hint: a.scene_hint || '',
                        learning_tip: a.learning_tip || '',
                        selected_emotion: a.selected_emotion || '',
                        interaction_type: a.interaction_type || '',
                        // B안(slot memory): 누적 facts 저장 → 다음 턴 carry.
                        // 모델 누락 시 priorFacts 유지(메모리 유실 방지).
                        establishedFacts: Array.isArray(a.establishedFacts) ? a.establishedFacts : priorFacts,
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
                    // 성공: isLoading=false + ttsReady=true 동시 — reveal 트리거.
                    return { ...m, isLoading: false, audio: aiTTS.audio, mimeType: aiTTS.mimeType, words: aiTTS.words, ttsReady: true };
                }
                // TTS 실패: isLoading=false + played=true 강제 마킹 → fullText fallback 즉시 노출
                return { ...m, isLoading: false, ttsReady: true, played: true, ttsFailed: true };
            }));

            // turn 카운트 +1 — AI 응답이 정상 도착한 후에만 카운트. 마지막 turn 에서 사용자
            // 발화 직후 sessionEnded 가 트리거되어 AI 응답 받기 전에 종료되던 회귀 fix.
            // AI 응답 실패 시 카운트 안 올라감 → 사용자 재시도 가능 (의도된 동작).
            // 한도 도달은 별도 useEffect 가 freeTurnCount 변화를 보고 처리.
            setFreeTurnCount(prev => prev + 1);
            // Phase 1: turn 증가 직후 3초 debounce 로 Firestore 에 incremental 저장.
            // 강제 종료 / 앱 kill 등으로 종료 update 가 안 들어가도 마지막 turn 기록 보존.
            scheduleIncrementalTurnWrite();
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
    }, [fetchTTS, sessionEnded, resetIdleTimer, scheduleIncrementalTurnWrite]);

    /**
     * ChatBubble의 onPlaybackDone에서 호출 — 메시지를 played=true 로 마킹.
     * 이로써 자동재생 차례가 끝난 메시지는 fullText 상시 표시 (스크롤로 다시 보일 때 깜빡임 없음).
     */
    const markMessagePlayed = useCallback((messageId) => {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, played: true } : m));
    }, []);

    /**
     * reply 실패한 직후 호출 — 마지막 user_free 메시지의 sttRaw 로 submitFreeUtterance 재호출.
     * 실패한 ai placeholder + user_free 를 제거하고 정상 흐름으로 재시작.
     * 2026-05-22: Gemini 503 같은 transient 외부 장애 후 사용자 1턴 손실 방지.
     */
    const retryLastReply = useCallback(async () => {
        const msgs = messagesRef.current;
        let lastUserFreeIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user_free') { lastUserFreeIdx = i; break; }
        }
        if (lastUserFreeIdx === -1) return;
        const userMsg = msgs[lastUserFreeIdx];
        const sttRaw = userMsg.sttRaw || userMsg.fullText || userMsg.text;
        if (!sttRaw) return;

        // 실패한 user_free + 그 뒤 ai placeholder(replyError) 제거. 다른 메시지는 보존.
        setMessages(prev => {
            const next = [...prev];
            const aiNext = next[lastUserFreeIdx + 1];
            if (aiNext?.role === 'ai' && aiNext?.replyError) {
                next.splice(lastUserFreeIdx, 2);
            } else {
                next.splice(lastUserFreeIdx, 1);
            }
            return next;
        });
        setReplyError(null);
        await submitFreeUtterance(sttRaw);
    }, [submitFreeUtterance]);

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
        retryLastReply,
        markMessagePlayed,
        requestSummary,
        clearSummary,
    };
}
