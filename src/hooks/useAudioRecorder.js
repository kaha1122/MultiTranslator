import { useState, useRef } from 'react';
import axios from 'axios';

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
        // Create React App을 사용하는 경우 (REACT_APP_API_URL)
        if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) {
            return process.env.REACT_APP_API_URL;
        }
    } catch (e) {
        // 환경 변수를 불러오는데 실패하면 무시하고 기본값으로 넘어갑니다.
    }
    return 'http://localhost:5000'; // 기본값 (로컬 서버)
};

// 커스텀 훅: 오디오 녹음과 관련된 복잡한 로직을 이곳으로 모두 분리(모듈화)했습니다.
// 이렇게 분리하면 컴포넌트(TranslationCard)는 화면을 예쁘게 그리는 데에만 온전히 집중할 수 있습니다.
export const useAudioRecorder = (text) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [assessmentResult, setAssessmentResult] = useState(null);
    const [coachTip, setCoachTip] = useState(null);
    const [coachAudio, setCoachAudio] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null); // 에러를 화면에 띄우기 위한 상태 변수 추가

    const mediaRecorder = useRef(null);
    const audioChunks = useRef([]);

    // 1. 녹음 시작 함수
    const startRecording = async () => {
        setErrorMsg(null); // 녹음을 시작할 때마다 기존 에러 메시지를 지웁니다.
        try {
            // 마이크 권한 요청
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = [];

            // 녹음 데이터가 들어올 때마다 배열에 저장합니다.
            mediaRecorder.current.ondataavailable = (e) => audioChunks.current.push(e.data);

            // 녹음이 중지되면 분석을 시작합니다.
            mediaRecorder.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
                analyzeFullPronunciation(audioBlob);
            };

            mediaRecorder.current.start();
            setIsRecording(true);
            setAssessmentResult(null);
            setCoachTip(null);
        } catch (err) {
            console.error("Mic access error:", err);
            // alert() 대신에 상태 변수에 에러 텍스트를 담아, 부드러운 UI 텍스트로 보여주게 합니다.
            setErrorMsg("Mic access required. Please allow microphone in browser settings. 🎤");
        }
    };

    // 2. 녹음 종료 함수
    const stopRecording = () => {
        if (mediaRecorder.current && isRecording) {
            mediaRecorder.current.stop();
            setIsRecording(false);
        }
    };

    // 3. 발음 분석 서버로 전송하는 함수
    const analyzeFullPronunciation = async (blob) => {
        setIsAnalyzing(true);
        const formData = new FormData();
        formData.append('audio', blob, 'recording.wav');
        formData.append('text', text);

        try {
            const apiUrl = getApiUrl();
            // 동기화된 환경 변수 API 주소를 사용하여 백엔드와 소통합니다.
            const response = await axios.post(`${apiUrl}/analyze`, formData);
            setAssessmentResult(response.data.assessment);
            setCoachTip(response.data.coaching.tip);
            setCoachAudio(response.data.coaching.audio);
        } catch (err) {
            console.error("Analysis failed:", err);
            // 에러 시 alert()를 띄우지 않고 상태 변수를 업데이트합니다.
            setErrorMsg("Cannot connect to analysis server. Please try again later. 🥺");
        } finally {
            setIsAnalyzing(false);
        }
    };

    // 4. AI 코치 목소리 재생 함수
    const playCoachVoice = () => {
        if (coachAudio) {
            const audio = new Audio(`data:audio/mp3;base64,${coachAudio}`);
            audio.play();
        }
    };

    // 5. 발음 분석 결과 초기화 함수
    const resetAssessment = () => {
        setAssessmentResult(null);
        setCoachTip(null);
        setErrorMsg(null);
    };

    // 사용할 수 있도록 필요한 상태와 함수들을 내보내 줍니다.
    return {
        isRecording,
        isAnalyzing,
        assessmentResult,
        coachTip,
        coachAudio,
        errorMsg,
        startRecording,
        stopRecording,
        playCoachVoice,
        resetAssessment
    };
};
