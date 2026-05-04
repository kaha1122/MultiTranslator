import { useEffect, useRef, useState } from 'react';

/**
 * 서버 /api/converse-tts 응답({audio: base64, words: [{word, offsetMs, durationMs}]})을
 * 받아서 audio 재생 + 단어 단위 텍스트 reveal 을 동기화한다.
 *
 * 사용:
 *   const { revealedText, isPlaying, isDone, start, stop } = useTTSSyncedReveal({
 *       fullText: 'Hello world',
 *       audioBase64, words, mimeType,
 *       autoplay: true,
 *       onDone: () => {...},
 *   });
 *
 * 설계:
 *   - 단어 timing 배열의 offsetMs <= audio.currentTime*1000 인 단어들을 누적 표시.
 *   - words 배열이 비어 있으면(예: word boundary 미지원) fullText 그대로 즉시 노출 + audio만 재생.
 *   - 컴포넌트 unmount / stop / 재호출 시 audio 정지 + raf 취소 (race 방지).
 */
export function useTTSSyncedReveal({ fullText, audioBase64, words, mimeType, autoplay = true, onDone, generation }) {
    const [revealedText, setRevealedText] = useState('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [isDone, setIsDone] = useState(false);
    const audioRef = useRef(null);
    const rafRef = useRef(null);
    const genRef = useRef(0);

    const stop = () => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (audioRef.current) {
            try {
                audioRef.current.pause();
                // src='' 는 일부 브라우저에서 'error' event 트리거 → 콘솔 노이즈.
                // removeAttribute + load 로 깔끔히 정리. 실패하면 ref null 만으로도 GC 처리.
                audioRef.current.removeAttribute('src');
                audioRef.current.load();
            } catch (e) { /* noop */ }
            audioRef.current = null;
        }
        setIsPlaying(false);
    };

    const start = () => {
        if (!audioBase64) return;
        // 새 세대 토큰 — 이전 raf 콜백이 들어오면 무시
        genRef.current += 1;
        const myGen = genRef.current;

        // 이미 재생 중인 게 있으면 정리
        if (audioRef.current) {
            try { audioRef.current.pause(); } catch (e) { /* noop */ }
            audioRef.current = null;
        }
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        const src = `data:${mimeType || 'audio/mpeg'};base64,${audioBase64}`;
        const audio = new Audio(src);
        audioRef.current = audio;
        setIsDone(false);
        setRevealedText('');

        // word timing 이 없으면 fullText 그대로 노출 + 오디오만 재생
        if (!Array.isArray(words) || words.length === 0) {
            setRevealedText(fullText || '');
        }

        const tick = () => {
            if (myGen !== genRef.current) return;
            const a = audioRef.current;
            if (!a) return;
            const curMs = a.currentTime * 1000;
            if (Array.isArray(words) && words.length > 0) {
                // 마지막으로 offsetMs <= curMs 인 단어까지 누적 표시
                let lastIdx = -1;
                for (let i = 0; i < words.length; i++) {
                    if (words[i].offsetMs <= curMs) lastIdx = i;
                    else break;
                }
                if (lastIdx >= 0) {
                    // Azure word 결과는 토큰 단위(공백 미포함). 원문 fullText에서 누적 길이만큼 표시하면
                    // 공백/구두점이 자연스럽게 살아있는 표시가 됨.
                    // 다만 안전한 폴백으로 단어들을 공백으로 잇는 방식도 병행 — fullText가 비어있을 때.
                    if (fullText) {
                        // fullText에서 lastIdx+1 번째 단어의 끝 위치까지 표시.
                        // 한자/일본어처럼 공백 없는 언어는 fullText 그대로 점진 노출.
                        let cursor = 0;
                        let shown = 0;
                        for (let i = 0; i <= lastIdx && i < words.length; i++) {
                            const w = words[i].word || '';
                            if (!w) continue;
                            // fullText 안에서 cursor 이후 첫 매칭 위치까지 포함
                            const found = fullText.indexOf(w, cursor);
                            if (found >= 0) {
                                shown = found + w.length;
                                cursor = shown;
                            }
                        }
                        if (shown > 0) {
                            setRevealedText(fullText.slice(0, shown));
                        }
                    } else {
                        const shown = words.slice(0, lastIdx + 1).map(w => w.word).join(' ');
                        setRevealedText(shown);
                    }
                }
            }
            rafRef.current = requestAnimationFrame(tick);
        };

        audio.addEventListener('ended', () => {
            if (myGen !== genRef.current) return;
            if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
            setRevealedText(fullText || '');
            setIsPlaying(false);
            setIsDone(true);
            onDone && onDone();
        });
        audio.addEventListener('error', (e) => {
            if (myGen !== genRef.current) return;
            // 의도적 stop (src 비우기) 시에도 error event 가 트리거됨 — 그 경우는 무시
            const hasSrc = !!(audio.currentSrc || audio.getAttribute('src'));
            if (!hasSrc) return;  // 정리 과정의 부산물 — 무시
            console.warn('[useTTSSyncedReveal] audio error', e);
            setRevealedText(fullText || '');
            setIsPlaying(false);
            setIsDone(true);
            onDone && onDone();
        });

        audio.play().then(() => {
            if (myGen !== genRef.current) return;
            setIsPlaying(true);
            rafRef.current = requestAnimationFrame(tick);
        }).catch((err) => {
            // autoplay block 등 — 텍스트는 즉시 fully reveal, done 처리
            console.warn('[useTTSSyncedReveal] audio.play() failed:', err?.message || err);
            if (myGen !== genRef.current) return;
            setRevealedText(fullText || '');
            setIsPlaying(false);
            setIsDone(true);
            onDone && onDone();
        });
    };

    // generation 토큰이 바뀌거나 audioBase64가 새로 들어오면 자동 재생 (autoplay)
    useEffect(() => {
        if (!autoplay) return;
        if (!audioBase64) return;
        start();
        return () => stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioBase64, generation]);

    useEffect(() => {
        return () => stop();
    }, []);

    return { revealedText, isPlaying, isDone, start, stop };
}
