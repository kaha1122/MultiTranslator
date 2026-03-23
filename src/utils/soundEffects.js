// src/utils/soundEffects.js
// AudioContext(프로그래매틱 톤) + HTML5 Audio(iOS 폴백) 하이브리드 방식
// Android/데스크톱: AudioContext로 즉각 재생
// iOS: AudioContext 실패 시 WAV 데이터 URL로 폴백 (Silent Mode에서도 재생 가능)

// ── AudioContext 관리 ────────────────────────────────────────────────────────
let audioCtx = null;

const getAudioCtx = () => {
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) audioCtx = new AC();
        }
        if (audioCtx?.state === 'suspended') {
            audioCtx.resume();
        }
    } catch (e) { /* 미지원 환경 */ }
    return audioCtx;
};

// 매 터치/클릭마다 AudioContext resume (iOS 대응)
if (typeof document !== 'undefined') {
    const resumeOnGesture = () => { try { getAudioCtx(); } catch (e) {} };
    document.addEventListener('touchend', resumeOnGesture, true);
    document.addEventListener('click', resumeOnGesture, true);
}

// ── WAV 생성 유틸 (AudioContext 없이도 소리 재생 가능) ──────────────────────
// PCM 데이터로 WAV Blob을 만들어 HTML5 Audio로 재생
const generateWav = (sampleRate, samples) => {
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);        // chunk size
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, sampleRate, true); // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);          // block align
    view.setUint16(34, 16, true);         // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // PCM data
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
};

// 주파수 톤 시퀀스 → PCM samples 생성
const generateToneSamples = (tones, sampleRate = 22050) => {
    // tones: [{ freq, duration, start, volume }]
    const totalDuration = Math.max(...tones.map(t => t.start + t.duration));
    const numSamples = Math.ceil(totalDuration * sampleRate);
    const samples = new Float32Array(numSamples);

    for (const { freq, duration, start, volume = 0.1 } of tones) {
        const startIdx = Math.floor(start * sampleRate);
        const endIdx = Math.floor((start + duration) * sampleRate);
        for (let i = startIdx; i < endIdx && i < numSamples; i++) {
            const t = (i - startIdx) / sampleRate;
            const envelope = Math.max(0, 1 - t / duration); // linear fade out
            samples[i] += Math.sin(2 * Math.PI * freq * t) * volume * envelope;
        }
    }
    return samples;
};

// ── 사운드별 톤 정의 ─────────────────────────────────────────────────────────
const TONES = {
    alert: [
        { freq: 600, duration: 0.1, start: 0, volume: 0.1 },
        { freq: 800, duration: 0.2, start: 0.1, volume: 0.1 },
    ],
    success: [
        { freq: 523.25, duration: 0.1,  start: 0,   volume: 0.1 },  // 도
        { freq: 659.25, duration: 0.1,  start: 0.1, volume: 0.1 },  // 미
        { freq: 783.99, duration: 0.1,  start: 0.2, volume: 0.1 },  // 솔
        { freq: 1046.50, duration: 0.3, start: 0.3, volume: 0.1 },  // 높은 도
    ],
    star: [
        { freq: 523.25, duration: 0.08,  start: 0,    volume: 0.1 },
        { freq: 659.25, duration: 0.08,  start: 0.07, volume: 0.1 },
        { freq: 783.99, duration: 0.08,  start: 0.14, volume: 0.1 },
        { freq: 1046.50, duration: 0.08, start: 0.21, volume: 0.1 },
        { freq: 1318.51, duration: 0.18, start: 0.28, volume: 0.1 },
    ],
    swipe: [
        { freq: 600, duration: 0.15, start: 0, volume: 0.15 },
    ],
};

// ── WAV Blob URL 캐시 (한 번만 생성) ────────────────────────────────────────
const _wavCache = {};
const getWavUrl = (name) => {
    if (!_wavCache[name]) {
        const tones = TONES[name];
        if (!tones) return null;
        const samples = generateToneSamples(tones);
        const blob = generateWav(22050, samples);
        _wavCache[name] = URL.createObjectURL(blob);
    }
    return _wavCache[name];
};

// ── AudioContext로 재생 시도 ─────────────────────────────────────────────────
const playToneViaCtx = (freq, type, duration, startTime = 0) => {
    const ctx = getAudioCtx();
    if (!ctx || ctx.state !== 'running') return false;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime + startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration);
    return true;
};

// ── HTML5 Audio 폴백 재생 ───────────────────────────────────────────────────
const playViaAudio = (name) => {
    try {
        const url = getWavUrl(name);
        if (!url) return;
        const audio = new Audio(url);
        audio.volume = 0.3;
        audio.play().catch(() => {});
    } catch (e) {}
};

// ── 하이브리드 재생 함수: AudioContext 먼저, 실패 시 HTML5 Audio ──────────────
const playSound = (name, ctxTones) => {
    try {
        const ctx = getAudioCtx();
        if (ctx?.state === 'running') {
            // AudioContext 사용 가능 → 프로그래매틱 톤 재생
            for (const t of ctxTones) {
                playToneViaCtx(t.freq, t.type || 'sine', t.duration, t.start);
            }
            return;
        }
    } catch (e) {}
    // AudioContext 불가 → HTML5 Audio 폴백
    playViaAudio(name);
};

// ── Public API ──────────────────────────────────────────────────────────────

// 1. 일반 결과 알림 소리 (뾰롱~)
export const playAlertSound = () => {
    playSound('alert', [
        { freq: 600, duration: 0.1, start: 0 },
        { freq: 800, duration: 0.2, start: 0.1 },
    ]);
};

// 2. 목표 점수 달성 축하 소리 (따단~ 따다단~)
export const playSuccessSound = () => {
    playSound('success', [
        { freq: 523.25, duration: 0.1,  start: 0 },
        { freq: 659.25, duration: 0.1,  start: 0.1 },
        { freq: 783.99, duration: 0.1,  start: 0.2 },
        { freq: 1046.50, duration: 0.3, start: 0.3 },
    ]);
};

// 3. 별 저장 소리 (반짝!)
export const playStarSound = () => {
    playSound('star', [
        { freq: 523.25, duration: 0.08,  start: 0 },
        { freq: 659.25, duration: 0.08,  start: 0.07 },
        { freq: 783.99, duration: 0.08,  start: 0.14 },
        { freq: 1046.50, duration: 0.08, start: 0.21 },
        { freq: 1318.51, duration: 0.18, start: 0.28 },
    ]);
};

// 4. 스와이프 저장 소리 (쓱~)
export const playSwipeSound = () => {
    try {
        const ctx = getAudioCtx();
        if (ctx?.state === 'running') {
            const osc = ctx.createOscillator();
            const gainNode = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.15);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
            return;
        }
    } catch (e) {}
    playViaAudio('swipe');
};
