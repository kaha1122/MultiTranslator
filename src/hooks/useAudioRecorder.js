import { useState, useRef } from 'react';
import axios from 'axios';
import { db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { getT } from '../utils/i18n';
import { getAuthHeaders } from '../utils/authFetch';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { Capacitor } from '@capacitor/core';

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

export const useAudioRecorder = (text, langCode, sourceLangCode, onTrialLimitReached) => {
    const { user, tier, isTrialPronLimitReached, isProPronLimitReached, incrementPronCount, byokAzureKey, byokAzureRegion } = useAuth();
    const [isRecording, setIsRecording] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [assessmentResult, setAssessmentResult] = useState(null);
    const [coachTip, setCoachTip] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null);
    const [saveMessage, setSaveMessage] = useState(null);

    const mediaRecorder = useRef(null);
    const audioChunks = useRef([]);
    // [신규] 침묵 감지(Silence Detection)를 위한 보조 메모리(Ref) 공간
    const audioContextRef = useRef(null);
    const silenceAnimationFrameRef = useRef(null);

    // 1. 녹음 시작 함수
    const startRecording = async () => {
        setErrorMsg(null);
        setSaveMessage(null);

        // 발음 횟수 제한 체크 (Trial 30회 / Pro 500회)
        if (isTrialPronLimitReached || isProPronLimitReached) {
            onTrialLimitReached?.();
            return;
        }

        try {
            // [신규] 안드로이드/iOS 네이티브 환경일 경우 마이크 하드웨어 권한 팝업 요청
            if (Capacitor.isNativePlatform()) {
                const hasPermission = await VoiceRecorder.hasAudioRecordingPermission();
                if (!hasPermission.value) {
                    const reqPermission = await VoiceRecorder.requestAudioRecordingPermission();
                    if (!reqPermission.value) {
                        setErrorMsg(getT(sourceLangCode, 'errors.micAccess') || "Microphone permission is required.");
                        return; // 권한 거부 시 녹음 시작 안 함
                    }
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

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // 찾아낸 파일 형식(mimeType)을 녹음기(MediaRecorder)에 알려줍니다.
            mediaRecorder.current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunks.current = [];

            // --- [신규] 실시간 볼륨 분석기(침묵 감지 조수) 설정 ---
            try {
                // 웹 브라우저에서 제공하는 오디오 분석 도구를 꺼냅니다.
                const AudioContext = window.AudioContext || window['webkitAudioContext'];
                audioContextRef.current = new AudioContext();
                const source = audioContextRef.current.createMediaStreamSource(stream);
                const analyser = audioContextRef.current.createAnalyser();

                // 소리를 얼마나 세밀하게 쪼개서 볼지 결정합니다
                analyser.fftSize = 512;
                source.connect(analyser); // 마이크 소리를 분석기랑 연결!

                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                let silenceStartTime = null;
                // 💡 설정값: 2000밀리초(2초) 동안 소리가 없으면 자동으로 멈춥니다!
                const SILENCE_THRESHOLD = 2000;
                // 💡 설정값: 소음(숨소리, PC 팬 잡음 등)을 무시할 최소 파동 에너지(RMS) 크기입니다.
                // 0.02에서 0.05로 2.5배 높여서 약간 시끄러운 환경에서도 확실히 멈추도록 개선했습니다.
                const VOLUME_THRESHOLD = 0.05;

                const checkSilence = () => {
                    // 녹음 중이 아니면 감지를 멈춥니다.
                    if (!mediaRecorder.current || mediaRecorder.current.state !== 'recording') {
                        clearInterval(silenceAnimationFrameRef.current);
                        return;
                    }

                    // 주파수 전체의 평균이 아닌, [시간에 따른 실제 파동(파형) 데이터]를 가져옵니다 (정확도 대폭 상승)
                    analyser.getByteTimeDomainData(dataArray);

                    let sumSquares = 0.0;
                    for (let i = 0; i < bufferLength; i++) {
                        // 기본값 128을 중심(0)으로 두고, -1.0 ~ 1.0 사이의 파도로 변환합니다.
                        const normSample = (dataArray[i] / 128.0) - 1.0;
                        sumSquares += normSample * normSample;
                    }
                    // 파동 에너지의 평균 제곱근(RMS: 진짜 소리의 '힘'을 나타냄)을 계산합니다.
                    const rms = Math.sqrt(sumSquares / bufferLength);

                    // 파동 에너지가 우리가 정한 기준치(VOLUME_THRESHOLD)보다 작다 = '조용하다(침묵)'고 판단!
                    if (rms < VOLUME_THRESHOLD) {
                        // 처음 조용해진 순간의 시간을 기록합니다.
                        if (silenceStartTime === null) {
                            silenceStartTime = Date.now();
                        } else if (Date.now() - silenceStartTime > SILENCE_THRESHOLD) {
                            // 앗, 조용한 상태가 2초(SILENCE_THRESHOLD) 이상 지속되었어요!
                            console.log(`침묵 2초 감지: 자동으로 녹음을 종료합니다! (최종 소음 크기: ${rms.toFixed(4)})`);
                            clearInterval(silenceAnimationFrameRef.current);
                            if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
                                mediaRecorder.current.stop();
                                setIsRecording(false);
                            }
                            return; // 더 이상 감지하지 않고 끝냅니다.
                        }
                    } else {
                        // 소리가 컸다 = 사용자가 다시 말을 시작했다!
                        // 침묵 타이머를 다시 0으로 초기화(리셋)해줍니다.
                        silenceStartTime = null;
                    }
                };

                // requestAnimationFrame 대신 setInterval을 사용하여 컴퓨터 성능 부하를 최소화하고, 
                // 브라우저 탭이 백그라운드에 있어도 안정적으로 0.1초마다 체크하게 변경했습니다.
                silenceAnimationFrameRef.current = setInterval(checkSilence, 100);
            } catch (analyserError) {
                console.warn("오디오 분석기 설정 실패(자동 종료 미작동):", analyserError);
                // 혹시 마이크 권한 문제나 구형 브라우저 등의 이유로 이 기능이 실패해도, 
                // 수동 녹음은 정상적으로 되어야 하므로 그냥 넘어갑니다.
            }
            // --- [신규 끝] ---

            // 녹음 데이터가 들어올 때마다 배열에 저장합니다.
            mediaRecorder.current.ondataavailable = (e) => audioChunks.current.push(e.data);

            // 녹음이 중지되면 분석을 시작합니다.
            mediaRecorder.current.onstop = async () => {
                // 저장할 때, 고정된 'audio/wav'가 아니라, 기기가 만든 진짜 타입으로 덩어리(Blob)를 만듭니다.
                const audioBlob = new Blob(audioChunks.current, { type: mediaRecorder.current.mimeType || 'audio/webm' });
                analyzeFullPronunciation(audioBlob, mediaRecorder.current.mimeType); // mimeType도 같이 넘겨줍니다.

                // --- [신규] 분석이 끝났거나 녹음이 멈추면 침묵 감지 조수도 청소(정리)시켜줍니다. ---
                if (silenceAnimationFrameRef.current) {
                    clearInterval(silenceAnimationFrameRef.current);
                    silenceAnimationFrameRef.current = null;
                }
                if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                    audioContextRef.current.close().catch(console.error);
                }
                // 마이크가 켜져 있는 상태로 아이콘이 남지 않도록 깨끗하게 꺼줍니다.
                stream.getTracks().forEach(track => track.stop());
                // --- [신규 끝] ---
            };

            mediaRecorder.current.start();
            setIsRecording(true);
            setAssessmentResult(null);
            setCoachTip(null);
        } catch (err) {
            console.error("Mic access error:", err);
            // alert() 대신에 상태 변수에 에러 텍스트를 담아, 부드러운 UI 텍스트로 보여주게 합니다.
            setErrorMsg(getT(sourceLangCode, 'errors.micAccess'));
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

    // 3. 발음 분석 서버로 전송하는 함수
    const analyzeFullPronunciation = async (blob, mimeType) => {
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

            // 발음 카운터 증가 (trial: trialPronCount, pro: proPronCount)
            incrementPronCount();

            // [성능 혁신] 서버에서 분석 결과를 받자마자! 빙글빙글 도는 스피너를 즉시 멈춥니다.
            // 사용자는 점수를 바로 볼 수 있고, 3번의 Firebase 클라우드 저장은 티 나지 않게 백그라운드에서 조용히 진행됩니다.
            setIsAnalyzing(false);

            // 3. Firestore 점수 기록 (로그인한 경우만, 오디오는 메모리에만 보관)
            if (user) {
                try {
                    const textHash = text ? hashCode(text) : 'unknown';
                    const recordRef = doc(db, `users/${user.uid}/pronunciation_records`, textHash);
                    await setDoc(recordRef, {
                        cardId: textHash,
                        originalText: text,
                        timestamp: serverTimestamp(),
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
        startRecording,
        stopRecording,
        resetAssessment
    };
};
