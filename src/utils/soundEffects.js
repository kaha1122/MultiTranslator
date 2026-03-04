// src/utils/soundEffects.js
// [초보자 코딩 가이드]
// 브라우저의 AudioContext를 사용하면 외부 mp3 파일 없이도 코드로 소리(주파수 삐- 소리)를 직접 만들 수 있습니다. 
// 이 방식은 파일 로딩 딜레이가 없어 누르자마자 즉각적으로 빠르고 안정적으로 소리가 납니다. 

// AudioContext를 미리 전역으로 만들어 두면, 브라우저 정책(Autoplay)에 막히지 않고 재사용할 수 있습니다.
let audioCtx = null;

const initAudioContext = () => {
    if (!audioCtx) {
        // 브라우저마다 이름이 다를 수 있어서 호환성을 위해 체크
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    // 사용자가 상호작용하기 전에 Context가 정지되어 있을 수 있으므로 재개해 줌
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
};

// 삐- 소리를 만드는 아주 기본적인 함수
const playTone = (freq, type, duration, startTime = 0) => {
    const ctx = initAudioContext();
    const osc = ctx.createOscillator(); // 소리 발생기
    const gainNode = ctx.createGain(); // 볼륨 조절기

    osc.type = type; // sine(부드러운소리), square(고전게임소리), triangle(전자음), sawtooth(날카로운소리)
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime); // 주파수(음높이) - 예: 440은 '라'음

    // 소리가 갑자기 끊기면 '띡' 하는 잡음이 생기므로, 부드럽게 볼륨이 줄어들게 설정(Fade out)
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime + startTime); // 시작 볼륨 조절 (0.1 수준으로 작게)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

    // 스피커에 연결
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // 정해진 시간에 재생 시작하고 멈춤
    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration);
};

// 1. 일반적인 결과가 떴을 때 알림 소리 (뾰롱~)
export const playAlertSound = () => {
    try {
        playTone(600, 'sine', 0.1, 0); // 낮게 짧게
        playTone(800, 'sine', 0.2, 0.1); // 살짝 높게 길게
    } catch (e) {
        console.error("Audio playback error:", e);
    }
};

// 2. 목표 점수를 넘었을 때 축하 소리 (따단~ 따다단~ 🎉)
export const playSuccessSound = () => {
    try {
        // 슈퍼 마리오 동전 먹는 듯한 경쾌한 오름차순 멜로디 연주
        playTone(523.25, 'sine', 0.1, 0); // 도
        playTone(659.25, 'sine', 0.1, 0.1); // 미
        playTone(783.99, 'sine', 0.1, 0.2); // 솔
        playTone(1046.50, 'sine', 0.3, 0.3); // 높은 도
    } catch (e) {
        console.error("Audio playback error:", e);
    }
};

// 3. 별 저장 소리 (반짝! 오름차순 별빛 차임)
export const playStarSound = () => {
    try {
        playTone(523.25, 'sine', 0.08, 0);     // 도
        playTone(659.25, 'sine', 0.08, 0.07);  // 미
        playTone(783.99, 'sine', 0.08, 0.14);  // 솔
        playTone(1046.50, 'sine', 0.08, 0.21); // 높은 도
        playTone(1318.51, 'sine', 0.18, 0.28); // 높은 미 (반짝!)
    } catch (e) {
        console.error("Audio playback error:", e);
    }
};

// 4. 스와이프 저장 소리 (쓱~ 바람 가르는 소리)
export const playSwipeSound = () => {
    try {
        const ctx = initAudioContext();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'triangle'; // 바람 소리 느낌을 위해 triangle파형 사용
        // 조금 더 무겁고 선명한 주파수 대역 사용
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.15);

        // 볼륨을 크게(0.4) 설정하여 모바일에서도 잘 들리게 함
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.05);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        console.error("Audio playback error:", e);
    }
};
