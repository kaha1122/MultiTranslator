import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { db } from '../firebase/config';
import { doc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { getT } from '../utils/i18n';
import { getAuthHeaders } from '../utils/authFetch';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { Capacitor, registerPlugin } from '@capacitor/core';

// Android 블루투스 SCO 제어 네이티브 플러그인
const BluetoothAudio = registerPlugin('BluetoothAudio');

// 초보자 설명(주석):
// 환경 변수(.env) 파일에서 API 서버 주소를 읽어옵니다.
// 서버 URL이 하드코딩 되어 있으면 배포 시 오류가 나기 때문에,
// 환경(로컬 개발환경 vs 실제 프러덕션 배포환경)에 따라 주소가 동적으로 바뀌도록 설정합니다.
const getApiUrl = () => {
    try {
        // Vite를 사용하는 경우 (VITE_API_URL)
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {
        // 환경 변수를 불러오는데 실패하면 아래 코드로 넘어갑니다.
    }

    // 모바일(같은 와이파이) 접속 시 localhost(내 폰)가 아니라 
    // 브라우저 주소창에 뜬 PC의 IP 주소(window.location.hostname)를 바라보도록 똑똑하게 바꿔줍니다!
    if (typeof window !== 'undefined') {
        return `http://${window.location.hostname}:5000`;
    }
    return 'http://localhost:5000'; // 최후의 기본값
};

// 커스텀 훅: 오디오 녹음과 관련된 복잡한 로직을 이곳으로 모두 분리(모듈화)했습니다.
// 이렇게 분리하면 컴포넌트(TranslationCard)는 화면을 예쁘게 그리는 데에만 온전히 집중할 수 있습니다.
// 텍스트를 고유한 ID(숫자)로 변환하는 간단한 해시 함수 (파일 이름 생성용)
const hashCode = (s) => Math.abs(s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0)).toString();

export const useAudioRecorder = (text, langCode, sourceLangCode, onTrialLimitReached, onPronSuccess, opts = {}) => {
    // skipCount: 온보딩 첫 발음 챌린지 등 무과금·무차감 컨텍스트 — 한도 게이트/카운터 모두 생략
    const { skipCount = false } = opts;
    const { user, tier, isTrialPronLimitReached, isProPronLimitReached, incrementPronCount, byokAzureKey, byokAzureRegion } = useAuth();
    const [isRecording, setIsRecording] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [assessmentResult, setAssessmentResult] = useState(null);
    const [coachTip, setCoachTip] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null);
    const [saveMessage, setSaveMessage] = useState(null);
    const [micDenied, setMicDenied] = useState(false); // iOS 권한 거부 → Settings 이동 안내용

    const mediaRecorder = useRef(null);
    const audioChunks = useRef([]);
    // [신규] 침묵 감지(Silence Detection)를 위한 보조 메모리(Ref) 공간
    const audioContextRef = useRef(null);
    const silenceAnimationFrameRef = useRef(null);
    const recordStartTimeRef = useRef(null);
    const hasDetectedVoiceRef = useRef(false);
    const btScoActiveRef = useRef(false);

    // 1. 녹음 시작 함수
    // iOS 설정 앱 열기 (권한 거부 후 사용자가 직접 활성화하도록 안내)
    const openAppSettings = async () => {
        try {
            const { App } = await import('@capacitor/app');
            // iOS: 앱 설정 페이지로 이동 (UIApplication.openSettingsURLString)
            // Android: 앱 상세 설정 페이지로 이동
            await App.openUrl({ url: 'app-settings:' });
        } catch {
            // fallback: 일반 설정 열기
            window.open('App-Prefs:', '_system');
        }
    };

    const startRecording = async () => {
        setErrorMsg(null);
        setMicDenied(false);
        setSaveMessage(null);

        // 발음 횟수 제한 체크 (Trial 30회 / Pro 500회) — skipCount면 무차감 컨텍스트라 게이트 생략
        if (!skipCount && (isTrialPronLimitReached || isProPronLimitReached)) {
            onTrialLimitReached?.();
            return;
        }

        // catch 경로에서도 cleanup 가능하도록 try 밖으로 호이스트
        // Why: AudioContext / 100ms setInterval / mic stream 미정리 시 iOS AVAudioSession 잠금 → 발열
        let stream = null;

        try {
            // 네이티브 환경: 마이크 하드웨어 권한 확보
            if (Capacitor.isNativePlatform()) {
                let wasFirstGrant = false;
                try {
                    const hasPermission = await VoiceRecorder.hasAudioRecordingPermission();
                    if (!hasPermission.value) {
                        const reqPermission = await VoiceRecorder.requestAudioRecordingPermission();
                        if (!reqPermission.value) {
                            setErrorMsg(getT(sourceLangCode, 'errors.micDeniedNative') || getT(sourceLangCode, 'errors.micAccess') || "Microphone permission is required.");
                            setMicDenied(true);
                            return;
                        }
                        wasFirstGrant = true;
                    }
                } catch (permErr) {
                    console.warn('[Mic] VoiceRecorder permission check failed, trying getUserMedia directly:', permErr);
                    wasFirstGrant = true;
                }
                // iOS: 최초 권한 승인 후 AVAudioSession을 재활성화해야
                // WKWebView의 getUserMedia가 실제 오디오 데이터를 받을 수 있음.
                // AppDelegate에서 권한 없이 설정한 세션이 불완전 상태이므로 갱신 필요.
                if (Capacitor.getPlatform() === 'ios') {
                    try {
                        await BluetoothAudio.activateAudioSession();
                        if (wasFirstGrant) console.log('[Mic] iOS 최초 권한 승인 → AVAudioSession 재활성화');
                    } catch (e) {
                        console.warn('[Mic] activateAudioSession failed:', e);
                    }
                }
            }

            // [Android/iOS] 블루투스 헤드셋이 연결된 경우 BT 오디오 채널 활성화
            if (Capacitor.isNativePlatform()) {
                try {
                    const { connected } = await BluetoothAudio.isBluetoothHeadsetConnected();
                    if (connected) {
                        await BluetoothAudio.startBluetoothSco();
                        btScoActiveRef.current = true;
                        console.log(`${Capacitor.getPlatform()} BT 오디오 활성화: 블루투스 마이크 사용`);
                    }
                } catch (btErr) {
                    console.warn('BT 오디오 활성화 실패 (내장 마이크 사용):', btErr);
                }
            }

            // 기기가 지원하는 오디오 형식을 먼저 확인합니다.
            // 아이폰(사파리/크롬)은 무조건 mp4 계열을 좋아하므로 audio/mp4를 우선순위로 두고,
            // 그 외(안드로이드/PC 크롬)은 기본적으로 가장 널리 쓰이는 audio/webm을 찾습니다.
            const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : MediaRecorder.isTypeSupported('audio/mp4')
                    ? 'audio/mp4'
                    : ''; // 둘 다 지원 안 하면 브라우저 기본값에 맡김

            // 블루투스 이어폰 등 외부 오디오 입력장치 자동 감지
            // Web: 먼저 임시 stream으로 마이크 권한을 확보하여 enumerateDevices()로
            //       디바이스 라벨에 접근 → BT 장치 식별 시에만 BT deviceId로 재연결
            //       BT가 없으면 첫 stream을 그대로 사용 (불필요한 재연결 방지)
            // 네이티브: 위에서 BluetoothAudio 플러그인이 이미 BT 라우팅을 설정했으므로
            //           getUserMedia({ audio: true })만으로 충분
            let isBtConnected = btScoActiveRef.current; // 네이티브 BT 상태
            // stream은 startRecording 상단에서 호이스트됨 (catch 경로 cleanup용)
            if (!Capacitor.isNativePlatform()) {
                try {
                    // 1단계: 기본 마이크로 stream 열기 (권한 팝업 + 라벨 접근 확보)
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    // 2단계: 권한 확보 후 디바이스 목록 조회 (라벨이 채워짐)
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const audioInputs = devices.filter(d => d.kind === 'audioinput');
                    const btDevice = audioInputs.find(d =>
                        d.label && /bluetooth|airpods|buds|wireless|galaxy buds|wf-|wh-|bt[- ]|헤드셋/i.test(d.label)
                    );
                    // BT 장치가 감지되었고, 현재 stream이 해당 장치가 아닌 경우에만 재연결
                    if (btDevice && btDevice.deviceId) {
                        const currentDeviceId = stream.getAudioTracks()[0]?.getSettings()?.deviceId;
                        if (currentDeviceId !== btDevice.deviceId) {
                            stream.getTracks().forEach(t => t.stop());
                            try {
                                stream = await navigator.mediaDevices.getUserMedia({
                                    audio: { deviceId: { ideal: btDevice.deviceId } }
                                });
                            } catch (btErr) {
                                console.warn('BT 마이크 재연결 실패, 기본 마이크 사용:', btErr);
                                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            }
                        }
                        isBtConnected = true;
                        console.log(`블루투스 마이크 감지: ${btDevice.label}`);
                    }
                } catch (enumErr) {
                    // enumerateDevices 실패 시 이미 열린 stream이 있으면 그대로 사용
                    if (!stream) {
                        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    }
                    console.warn('오디오 장치 목록 조회 실패:', enumErr);
                }
            } else {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            // 찾아낸 파일 형식(mimeType)을 녹음기(MediaRecorder)에 알려줍니다.
            mediaRecorder.current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunks.current = [];

            // --- 실시간 볼륨 분석기(침묵 감지) 설정 ---
            try {
                const AudioContext = window.AudioContext || window['webkitAudioContext'];
                // [샘플레이트 동기화] BT HFP 마이크는 16kHz 고정이므로,
                // BT 연결 시 AudioContext도 16kHz로 맞춰 RMS 계산의 정확도를 보장합니다.
                // 비BT 시에는 스트림의 실제 샘플레이트를 따릅니다.
                let ctxSampleRate;
                try {
                    const trackSettings = stream.getAudioTracks()[0]?.getSettings();
                    ctxSampleRate = trackSettings?.sampleRate || (isBtConnected ? 16000 : undefined);
                } catch { ctxSampleRate = isBtConnected ? 16000 : undefined; }
                audioContextRef.current = new AudioContext(ctxSampleRate ? { sampleRate: ctxSampleRate } : undefined);

                const source = audioContextRef.current.createMediaStreamSource(stream);
                const analyser = audioContextRef.current.createAnalyser();
                analyser.fftSize = 512;
                source.connect(analyser);

                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                let silenceStartTime = null;
                const SILENCE_THRESHOLD = 2000; // 2초 침묵 → 자동 종료
                const VOLUME_THRESHOLD = 0.05;
                // [BT 유예 기간] BT 연결 시 A2DP→HFP 전환(~2초) + 사용자 준비 시간을 감안하여
                // 녹음 시작 후 3초간은 침묵이어도 자동 종료하지 않습니다.
                const GRACE_PERIOD = isBtConnected ? 3000 : 1500;
                const recordingStartedAt = Date.now();

                const checkSilence = () => {
                    if (!mediaRecorder.current || mediaRecorder.current.state !== 'recording') {
                        clearInterval(silenceAnimationFrameRef.current);
                        return;
                    }

                    analyser.getByteTimeDomainData(dataArray);
                    let sumSquares = 0.0;
                    for (let i = 0; i < bufferLength; i++) {
                        const normSample = (dataArray[i] / 128.0) - 1.0;
                        sumSquares += normSample * normSample;
                    }
                    const rms = Math.sqrt(sumSquares / bufferLength);

                    if (rms >= VOLUME_THRESHOLD) {
                        // 음성 감지는 유예 기간과 무관하게 항상 수행
                        silenceStartTime = null;
                        hasDetectedVoiceRef.current = true;
                    } else {
                        // 유예 기간 중에는 침묵 타이머만 작동하지 않음 (자동 종료 방지)
                        if (Date.now() - recordingStartedAt < GRACE_PERIOD) return;

                        if (silenceStartTime === null) {
                            silenceStartTime = Date.now();
                        } else if (Date.now() - silenceStartTime > SILENCE_THRESHOLD) {
                            console.log(`침묵 2초 감지: 자동 녹음 종료 (RMS: ${rms.toFixed(4)})`);
                            clearInterval(silenceAnimationFrameRef.current);
                            if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
                                mediaRecorder.current.stop();
                                setIsRecording(false);
                            }
                            return;
                        }
                    }
                };

                silenceAnimationFrameRef.current = setInterval(checkSilence, 100);
            } catch (analyserError) {
                console.warn("오디오 분석기 설정 실패(자동 종료 미작동):", analyserError);
            }
            // --- 침묵 감지 설정 끝 ---

            // 녹음 데이터가 들어올 때마다 배열에 저장합니다.
            mediaRecorder.current.ondataavailable = (e) => audioChunks.current.push(e.data);

            // 녹음이 중지되면 분석을 시작합니다.
            mediaRecorder.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: mediaRecorder.current.mimeType || 'audio/webm' });
                const recordDuration = Date.now() - (recordStartTimeRef.current || 0);

                // 음성 미감지, 녹음 너무 짧음, 데이터 부족 → 서버 전송 없이 재시도 안내
                if (!hasDetectedVoiceRef.current || recordDuration < 2000 || audioBlob.size < 2000) {
                    setErrorMsg(getT(sourceLangCode, 'errors.retryPronunciation') || 'Please try again.');
                } else {
                    analyzeFullPronunciation(audioBlob, mediaRecorder.current.mimeType);
                }

                // --- 분석이 끝났거나 녹음이 멈추면 침묵 감지 조수도 청소(정리)시켜줍니다. ---
                if (silenceAnimationFrameRef.current) {
                    clearInterval(silenceAnimationFrameRef.current);
                    silenceAnimationFrameRef.current = null;
                }
                if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                    audioContextRef.current.close().catch(console.error);
                }
                // 마이크가 켜져 있는 상태로 아이콘이 남지 않도록 깨끗하게 꺼줍니다.
                stream.getTracks().forEach(track => track.stop());
                // [Android] 블루투스 SCO 채널 해제
                if (btScoActiveRef.current) {
                    BluetoothAudio.stopBluetoothSco().catch(e => console.warn('BT SCO 종료 실패:', e));
                    btScoActiveRef.current = false;
                }
                // [iOS v1.5.74 thermal-ios Pattern 1] 10s idle debounce.
                // 즉시 카테고리만 .playback 전환(input subsystem 휴면) + 10s 후 setActive(false)
                // 예약 → mediaserverd 완전 해제(발열 origin 차단). 10s 내 재녹음 시 activate가
                // 예약 cancel → BT(에어팟) 라우트 보존.
                //
                // 적용 컨텍스트: 발음 카드(TranslationCard/ScenePractice/VocabTab) 전용.
                // Why 10s — TTS 듣고 STT 발음 연습 반복 흐름에서 10초 침묵은 "잠시 사용 중단"의
                // 명확한 신호. Free Talking 모달은 한 세션 내 10초+ 침묵이 자연스러우므로
                // 본 메소드 미사용, 모달 닫힘에 endAudioSession(Pattern 4) 호출.
                //
                // 옵셔널 체이닝: 구 IPA(scheduleEndAudioSession 미존재) + 신 JS 콤보 silent fail.
                if (Capacitor.getPlatform() === 'ios') {
                    BluetoothAudio.scheduleEndAudioSession?.({ delayMs: 10000 }).catch(() => {});
                }
                // --- [신규 끝] ---
            };

            recordStartTimeRef.current = Date.now();
            hasDetectedVoiceRef.current = false;
            mediaRecorder.current.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Mic access error:", err);
            // [발열 수정] 에러 경로에서 onstop이 발화하지 않으므로 직접 cleanup
            // 침묵 감지 setInterval(100ms) / AudioContext / mic stream 미정리 시
            // iOS WKWebView의 AVAudioSession이 playAndRecord로 잠긴 채 유지 → 발열
            if (silenceAnimationFrameRef.current) {
                clearInterval(silenceAnimationFrameRef.current);
                silenceAnimationFrameRef.current = null;
            }
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close().catch(() => {});
                audioContextRef.current = null;
            }
            if (stream) {
                try { stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
            }
            // 블루투스 SCO가 열린 상태에서 에러 발생 시 정리
            if (btScoActiveRef.current) {
                BluetoothAudio.stopBluetoothSco().catch(() => {});
                btScoActiveRef.current = false;
            }
            // [iOS v1.5.74 Pattern 1] 에러 경로에서도 idle debounce 적용 (onstop 동일 이유)
            if (Capacitor.getPlatform() === 'ios') {
                BluetoothAudio.scheduleEndAudioSession?.({ delayMs: 10000 }).catch(() => {});
            }
            // 네이티브: 설정에서 마이크 허용 안내 / 웹: 브라우저 설정 안내
            if (Capacitor.isNativePlatform()) {
                setErrorMsg(getT(sourceLangCode, 'errors.micDeniedNative') || getT(sourceLangCode, 'errors.micAccess'));
                setMicDenied(true);
            } else {
                setErrorMsg(getT(sourceLangCode, 'errors.micAccess'));
            }
        }
    };

    // 2. 녹음 종료 함수 (버튼 직접 터치 또는 위에서 2초 침묵 감지 시 호출됨)
    const stopRecording = () => {
        // [버그 수정] isRecording 상태값은 클로저(Closure)에 의해 예전 값(false)으로 기억될 수 있습니다.
        // 그러므로 무조건 최신 상태를 가지고 있는 mediaRecorder.current.state를 직접 확인하여 멈춰줍니다!
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
            mediaRecorder.current.stop();
            setIsRecording(false);
        }
    };

    // 앱 백그라운드 진입 시 녹음 자동 중단
    // iOS: 홈 버튼/스와이프, Android: 홈 버튼 — 마이크 리소스 즉시 해제
    useEffect(() => {
        const handleBackground = () => {
            if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
                console.log('[AudioRecorder] 앱 백그라운드 → 녹음 자동 중단');
                mediaRecorder.current.stop();
                setIsRecording(false);
            }
        };
        window.addEventListener('app-background', handleBackground);
        return () => window.removeEventListener('app-background', handleBackground);
    }, []);

    // 3. 발음 분석 서버로 전송하는 함수
    const analyzeFullPronunciation = async (blob, mimeType) => {
        setAssessmentResult(null);
        setCoachTip(null);
        setIsAnalyzing(true);
        const formData = new FormData();

        // 브라우저에서 받아온 mimeType을 보고 진짜 확장자를 결정합니다.
        // mp4 형식이면 .mp4, webm 형식이면 .webm, 그 외엔 기본적으로 .webm으로 간주합니다.
        const fileExtension = mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
        formData.append('audio', blob, `recording.${fileExtension}`);

        formData.append('text', text);
        formData.append('lang', langCode || 'en');
        formData.append('sourceLang', sourceLangCode || 'ko');
        // BYOK: 사용자 본인의 Azure 키가 있으면 서버에 함께 전달
        if (byokAzureKey) {
            formData.append('userAzureKey', byokAzureKey);
            formData.append('userAzureRegion', byokAzureRegion || 'eastasia');
        }

        try {
            // 1. 발음 평가 서버 요청
            const apiUrl = getApiUrl();
            const authHeaders = await getAuthHeaders();
            const response = await axios.post(`${apiUrl}/analyze`, formData, {
                headers: authHeaders,
            });
            const assessment = response.data.assessment;
            const coaching = response.data.coaching;

            // [UX 성능 혁신 🚀] Firebase 업로드를 멍하니 기다리거나 재다운로드를 하지 않습니다!
            // 방금 녹음한 내 휴대폰/PC 안의 따끈따끈한 원본 파일(blob)을 이용해 '임시 로컬 주소'를 만듭니다.
            // 이렇게 하면 "내 목소리 재생" 버튼을 눌렀을 때 0.001초의 네트워크 지연(버퍼링)도 없이 즉시 흘러나옵니다.
            const localAudioUrl = URL.createObjectURL(blob);
            assessment.audioUrl = localAudioUrl;

            // 2. 상태 업데이트 (여기서 점수가 보입니다)
            setAssessmentResult(assessment);
            setCoachTip(coaching?.tip || null);

            // 발음 카운터 증가 (trial: trialPronCount, pro: proPronCount) — skipCount면 무차감
            if (!skipCount) {
                incrementPronCount();
                // 일간 발음 카운터 증가
                onPronSuccess?.();
            }

            // [성능 혁신] 서버에서 분석 결과를 받자마자! 빙글빙글 도는 스피너를 즉시 멈춥니다.
            // 사용자는 점수를 바로 볼 수 있고, 3번의 Firebase 클라우드 저장은 티 나지 않게 백그라운드에서 조용히 진행됩니다.
            setIsAnalyzing(false);

            // 3. Firestore 점수 기록 (로그인한 경우만, 오디오는 메모리에만 보관)
            //    skipCount(온보딩 첫발음 등)는 점수 레코드도 저장 안 함 — 일회성, 재청취 없음
            if (!skipCount && user) {
                try {
                    const textHash = text ? hashCode(text) : 'unknown';
                    const recordRef = doc(db, `users/${user.uid}/pronunciation_records`, textHash);
                    // expiresAt = 기록 시점 + 7일. Firestore TTL 정책(expiresAt 필드)이 만료된 문서를 24~72h 내 삭제.
                    // 사용자 단말 시계 의존 — 미래로 큰 시차 시 조기 삭제 가능하나 무시 가능 (영향 0, 읽기 경로 없음).
                    const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
                    await setDoc(recordRef, {
                        cardId: textHash,
                        originalText: text,
                        targetLang: langCode,
                        sourceLang: sourceLangCode,
                        platform: window.Capacitor?.isNativePlatform?.() ? 'app' : 'web',
                        timestamp: serverTimestamp(),
                        expiresAt,
                        scores: {
                            accuracy: assessment.pronunciationScore || 0,
                            fluency: assessment.fluencyScore || 0,
                            prosody: assessment.prosodyScore || 0
                        },
                        words: assessment.words || []
                    });
                    setSaveMessage(getT(sourceLangCode, 'save.audioSaved'));
                } catch (dbErr) {
                    console.error("Firestore 저장 실패:", dbErr);
                }
            }

        } catch (err) {
            console.error("Analysis failed:", err);
            setErrorMsg(getT(sourceLangCode, 'errors.serverConnect'));
            // 에러가 났을 때 확실하게 스피너를 멈춰줍니다.
            setIsAnalyzing(false);
        }
    };

    // 4. 발음 분석 결과 초기화 함수
    const resetAssessment = () => {
        setAssessmentResult(null);
        setCoachTip(null);
        setErrorMsg(null);
        setSaveMessage(null);
    };

    return {
        isRecording,
        isAnalyzing,
        assessmentResult,
        coachTip,
        errorMsg,
        saveMessage,
        micDenied,
        openAppSettings,
        startRecording,
        stopRecording,
        resetAssessment
    };
};
