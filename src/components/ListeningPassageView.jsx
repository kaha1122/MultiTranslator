import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Volume2, Pause, Repeat, Loader2, Star } from 'lucide-react';
import {
    cleanDialogueForTTS, parseDialogueTurns, simpleHashString, splitIntoSentences, getServerUrl,
} from '../utils/passageText';

// ── 지문(passage) 카드 공용 뷰 ────────────────────────────────────────────────
// ListeningTab(학습) + Library(복습 조회) 양쪽에서 동일 UI 로 지문을 렌더/재생한다.
// 자체 재생 상태(재생/일시정지/반복/로딩)와 Azure TTS fetch·loop·race 가드를 모두 내장.
// UI: 1번째 줄 = 제목(+번역, 아이콘 없음) / 2번째 줄 = [반복토글 > 지문재생 > 별표] / 본문 / 발음·번역 토글.
//
// props:
//  passage: { title, titleTranslation, text, pronunciation, translation }  (sentences 는 부모가 별도 렌더)
//  passageType: 'essay' | 'dialogue'
//  langCode: 학습 대상 언어
//  onSpeak: 폴백 TTS (네이티브 실패 등)
//  onTtsGate?(cost): 신규 합성 전 포인트 게이트 — 없으면 무료(Library 복습)
//  durable?: true 면 Azure durable(Storage 공유 음성) 사용 (기본 true)
//  authFetch: 인증 fetch (ListeningTab 의 것 주입)
//  byokGeminiKey?: (미사용, 호환용)
//  t: 번역 함수
//  showSave?: 별표(저장) 버튼 노출 (ListeningTab=true / Library=false)
//  isSaved?, onSave?: 별표 상태/핸들러
//  isActive?: false 면 재생 중지(탭 이탈) — 기본 true
export default function ListeningPassageView({
    passage,
    passageType = 'essay',
    langCode,
    onSpeak,
    onTtsGate,
    durable = true,
    authFetch,
    t,
    showSave = false,
    isSaved = false,
    onSave,
    isActive = true,
}) {
    const [passagePlaying, setPassagePlaying] = useState(false);
    const [passageLoading, setPassageLoading] = useState(false);
    const [loopMode, setLoopMode] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [showPronunciation, setShowPronunciation] = useState(false);

    const passageAudioRef = useRef(null);
    const passageAudioUrlRef = useRef(null);
    const loopModeRef = useRef(false);
    const playGenRef = useRef(0);
    const ttsAbortRef = useRef(null);

    useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);

    // 재생 정리 — in-flight fetch 취소 + stale 무효화 + audio/blob 정리
    const stopPassageAudio = useCallback(() => {
        playGenRef.current += 1;
        if (ttsAbortRef.current) {
            try { ttsAbortRef.current.abort(); } catch { /* noop */ }
            ttsAbortRef.current = null;
        }
        if (passageAudioRef.current) {
            try { passageAudioRef.current.pause(); } catch { /* noop */ }
            passageAudioRef.current.onended = null;
            try { passageAudioRef.current.src = ''; } catch { /* noop */ }
            passageAudioRef.current = null;
        }
        if (passageAudioUrlRef.current) {
            try { URL.revokeObjectURL(passageAudioUrlRef.current); } catch { /* noop */ }
            passageAudioUrlRef.current = null;
        }
        setPassagePlaying(false);
        setPassageLoading(false);
    }, []);

    // 지문 변경(텍스트 기준) 시 재생 정지 + 토글 접기. passage 객체 identity 가 매 렌더 바뀌어도(예: Library)
    //   text 가 같으면 재실행 안 함 → 재생 끊김 방지.
    useEffect(() => {
        stopPassageAudio();
        setShowTranslation(false);
        setShowPronunciation(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [passage?.text]);

    // 탭 이탈 시 정지
    useEffect(() => {
        if (!isActive) stopPassageAudio();
    }, [isActive, stopPassageAudio]);

    // 언마운트 시 정지
    useEffect(() => () => stopPassageAudio(), [stopPassageAudio]);

    const handlePassagePlay = useCallback(async () => {
        if (!passage?.text) return;

        // 재생 중 → 일시정지
        if (passagePlaying && passageAudioRef.current) {
            passageAudioRef.current.pause();
            setPassagePlaying(false);
            return;
        }

        // 보존된 오디오 재사용 — 재개/재청취 (서버 재요청 0, Azure 비용 0)
        if (passageAudioRef.current && passageAudioRef.current.paused) {
            const a = passageAudioRef.current;
            if (a.ended || (a.duration && a.currentTime >= a.duration)) {
                try { a.currentTime = 0; } catch { /* noop */ }
            }
            a.play().catch(() => {});
            setPassagePlaying(true);
            return;
        }

        // 신규 합성 전 포인트 게이트 — 보존 오디오 재청취는 위에서 이미 return(무료).
        //   onTtsGate 없으면(Library 복습) 무료 통과. 0점이면 게이트가 차단(팝업) → 합성 안 함.
        //   chargeKey: 같은 지문 재진입(새 인스턴스)에도 세션 내 1회만 차감(#8) — App 이 dedup.
        const chargeKey = `passage:${langCode}:${(passage.text || '').slice(0, 80)}`;
        if (onTtsGate && !onTtsGate(2, chargeKey)) return;

        const isDialogue = passageType === 'dialogue';
        const dialogueTurns = isDialogue ? parseDialogueTurns(passage.text) : [];
        const hasTurns = dialogueTurns.length > 0;
        const ttsText = isDialogue ? cleanDialogueForTTS(passage.text) : passage.text;
        const dialogueSeed = hasTurns ? simpleHashString(passage.text) : null;
        const SERVER_URL = getServerUrl();
        const myGen = ++playGenRef.current;
        const controller = new AbortController();
        ttsAbortRef.current = controller;
        setPassageLoading(true);

        let objectUrl = null;
        try {
            const doFetch = authFetch || fetch;
            const res = await doFetch(`${SERVER_URL}/api/azure-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    hasTurns
                        ? { turns: dialogueTurns, dialogueSeed, langCode, durable }
                        : { text: ttsText, langCode, durable }
                ),
                signal: controller.signal,
            });
            if (myGen !== playGenRef.current) return;
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const blob = await res.blob();
            if (myGen !== playGenRef.current) return;

            objectUrl = URL.createObjectURL(blob);
            const audio = new Audio(objectUrl);
            audio.onended = () => {
                if (myGen !== playGenRef.current) return;
                if (loopModeRef.current) {
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                } else {
                    setPassagePlaying(false);
                }
            };
            passageAudioRef.current = audio;
            passageAudioUrlRef.current = objectUrl;
            objectUrl = null;
            await audio.play();
            if (myGen !== playGenRef.current) return;
            setPassagePlaying(true);
        } catch (e) {
            if (e?.name === 'AbortError') return;
            console.warn('[ListeningPassageView] TTS error:', e);
            // 폴백: onSpeak — onTtsGate 에서 이미 차감됐으면 재차감 방지(_skipGate)
            if (myGen === playGenRef.current && onSpeak) {
                onSpeak(ttsText, langCode, undefined, { source: 'passage.fallback', _skipGate: true });
            }
        } finally {
            if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch { /* noop */ } }
            if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
            if (myGen === playGenRef.current) setPassageLoading(false);
        }
    }, [passage, passagePlaying, passageType, langCode, onSpeak, onTtsGate, durable, authFetch]);

    if (!passage) return null;

    return (
        <div className="listening-passage-card">
            {/* 1번째 줄 — 컨트롤: 반복토글 > 지문재생 > 별표 (제목 위로 올림 — 제목/번역과 간격 최소화) */}
            <div className="listening-passage-controls">
                <div className="listening-loop-toggle">
                    <span className={`listening-loop-label ${!loopMode ? 'active' : ''}`}>
                        <Volume2 size={11} />
                    </span>
                    <button
                        className={`listening-loop-track ${loopMode ? 'on' : ''}`}
                        onClick={() => setLoopMode(m => !m)}
                    >
                        <span className="listening-loop-thumb" />
                    </button>
                    <span className={`listening-loop-label ${loopMode ? 'active' : ''}`}>
                        <Repeat size={11} />
                    </span>
                </div>
                <button
                    className={`listening-tts-btn ${passagePlaying ? 'playing' : ''}`}
                    onClick={handlePassagePlay}
                    disabled={passageLoading}
                    title={passagePlaying ? 'Pause' : 'Play'}
                >
                    {passageLoading
                        ? <Loader2 size={18} className="spin" />
                        : passagePlaying
                            ? <Pause size={18} />
                            : <Volume2 size={18} />}
                </button>
                {showSave && (
                    <button
                        className={`listening-tts-btn ${isSaved ? 'saved' : ''}`}
                        onClick={() => onSave?.()}
                        title={isSaved ? (t?.('scene.savedToLibrary') || 'Saved') : (t?.('scene.saveToLibrary') || 'Save')}
                    >
                        <Star size={18} fill={isSaved ? '#f59e0b' : 'none'} color={isSaved ? '#f59e0b' : 'currentColor'} />
                    </button>
                )}
            </div>

            {/* 2·3번째 줄 — 제목 / 번역 */}
            <div className="listening-passage-titleblock">
                <h3 className="listening-passage-title">{passage.title}</h3>
                {passage.titleTranslation && (
                    <p className="listening-passage-title-trans">{passage.titleTranslation}</p>
                )}
            </div>

            <div className="listening-passage-text">
                {splitIntoSentences(passage.text, passageType === 'dialogue').map((sentence, idx) => (
                    <span key={idx} className="listening-sentence" style={{ cursor: 'default' }}>
                        {sentence}
                        {passageType === 'dialogue' ? '\n' : ' '}
                    </span>
                ))}
            </div>

            {passage.pronunciation && (
                <>
                    <button
                        className="listening-translation-toggle"
                        onClick={() => setShowPronunciation(!showPronunciation)}
                    >
                        {showPronunciation ? t('listening.hidePronunciation') : t('listening.showPronunciation')}
                        <ChevronDown size={14} className={showPronunciation ? 'rotated' : ''} />
                    </button>
                    {showPronunciation && (
                        <div className="listening-passage-pron">{passage.pronunciation}</div>
                    )}
                </>
            )}

            {passage.translation && (
                <>
                    <button
                        className="listening-translation-toggle"
                        onClick={() => setShowTranslation(!showTranslation)}
                    >
                        {showTranslation ? t('listening.hideTranslation') : t('listening.showTranslation')}
                        <ChevronDown size={14} className={showTranslation ? 'rotated' : ''} />
                    </button>
                    {showTranslation && (
                        <div className="listening-passage-translation">{passage.translation}</div>
                    )}
                </>
            )}
        </div>
    );
}
