import { useState, useRef } from 'react';
import axios from 'axios';
import { storage, db } from '../firebase/config';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

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

export const useAudioRecorder = (text, langCode, sourceLangCode) => {
    const { user } = useAuth(); // 로그인한 사용자 정보 가져오기
    const [isRecording, setIsRecording] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [assessmentResult, setAssessmentResult] = useState(null);
    const [coachTip, setCoachTip] = useState(null);
    const [coachAudio, setCoachAudio] = useState(null);
    const [errorMsg, setErrorMsg] = useState(null); // 에러를 화면에 띄우기 위한 상태 변수 추가
    const [saveMessage, setSaveMessage] = useState(null); // 저장 성공/에러 메시지

    const mediaRecorder = useRef(null);
    const audioChunks = useRef([]);

    // 1. 녹음 시작 함수
    const startRecording = async () => {
        setErrorMsg(null); // 녹음을 시작할 때마다 기존 에러 메시지를 지웁니다.
        setSaveMessage(null); // 저장 메시지도 초기화
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
        formData.append('lang', langCode || 'en'); // [신규] 백엔드 서버에게 평가(목표) 언어 코드를 함께 보냅니다.
        formData.append('sourceLang', sourceLangCode || 'ko'); // [신규] 피드백을 전달할 사용자의 언어(출발 언어)를 알려줍니다.

        try {
            // 1. 발음 평가 서버 요청
            const apiUrl = getApiUrl();
            const response = await axios.post(`${apiUrl}/analyze`, formData);
            const assessment = response.data.assessment;
            const coaching = response.data.coaching;

            // 2. 상태 업데이트 (여기서 점수가 보입니다)
            setAssessmentResult(assessment);
            setCoachTip(coaching?.tip || null);
            setCoachAudio(coaching?.audio || null);

            // 3. Firebase 저장 로직 (로그인한 경우만)
            if (user) {
                // Firebase Storage 버킷 설정이 안 되어 있거나 오류로 인해 무한정 로딩(빙글빙글) 도는 것을 
                // 방지하기 위해 10초 제한 시간을 주는 타임아웃 래퍼(Wrapper) 
                const uploadWithTimeout = new Promise(async (resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('Firebase Timeout')), 10000);
                    try {
                        const textHash = text ? hashCode(text) : 'unknown';
                        const audioRef = ref(storage, `pronunciation_audio/${user.uid}/${textHash}.wav`);
                        await uploadBytes(audioRef, blob);
                        const downloadUrl = await getDownloadURL(audioRef);

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
                            words: assessment.words || [],
                            audioUrl: downloadUrl
                        });
                        clearTimeout(timer);
                        resolve(downloadUrl);
                    } catch (e) {
                        clearTimeout(timer);
                        reject(e);
                    }
                });

                try {
                    const downloadUrl = await uploadWithTimeout;
                    setAssessmentResult(prev => ({ ...prev, audioUrl: downloadUrl }));
                    setSaveMessage("발음 기록과 오디오가 성공적으로 저장되었습니다! ✅");
                } catch (dbErr) {
                    console.error("Firebase 저장 실패:", dbErr);
                    // 에러 메시지를 화면에 띄워 디버깅을 돕습니다.
                    setSaveMessage(`분석 성공, 하지만 오디오 저장 실패: ${dbErr.message || '알 수 없는 오류'}`);
                }
            }

        } catch (err) {
            console.error("Analysis failed:", err);
            setErrorMsg("Cannot connect to analysis server. Please try again later. 🥺");
        } finally {
            // 무조건 버튼 빙글빙글 도는 것을 멈춤!
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
        setSaveMessage(null);
    };

    // 사용할 수 있도록 필요한 상태와 함수들을 내보내 줍니다.
    return {
        isRecording,
        isAnalyzing,
        assessmentResult,
        coachTip,
        coachAudio,
        errorMsg,
        saveMessage,
        startRecording,
        stopRecording,
        playCoachVoice,
        resetAssessment
    };
};
