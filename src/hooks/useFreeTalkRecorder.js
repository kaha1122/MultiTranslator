import { useCallback, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { authFetch, getAuthHeaders } from '../utils/authFetch';

// Android/iOS 네이티브 오디오 세션 제어 — useAudioRecorder와 동일 인스턴스
const BluetoothAudio = registerPlugin('BluetoothAudio');

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { /* noop */ }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};
const SERVER_URL = getServerUrl();

/**
 * Free Talking 자유 발화용 녹음 hook.
 *
 * 기존 useAudioRecorder는 발음 평가(referenceText 필요) 전용이라, 자유 발화에는 reference가 없어
 * 별도 hook으로 분리. 같은 capacitor-voice-recorder / MediaRecorder 인프라 재사용.
 *
 * 사용:
 *   const { isRecording, isProcessing, startRecording, stopRecording, lastTranscript, lastError, micDenied, openAppSettings }
 *     = useFreeTalkRecorder({ langCode, onTranscript, sourceLang });
 *
 * 흐름:
 *   startRecording() → 녹음
 *   stopRecording()  → blob → /api/converse-stt → onTranscript(text) 콜백
 */
export function useFreeTalkRecorder({ langCode, onTranscript, sourceLang }) {
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [lastTranscript, setLastTranscript] = useState('');
    const [lastError, setLastError] = useState(null);
    const [micDenied, setMicDenied] = useState(false);

    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const isNativeRef = useRef(false);

    const openAppSettings = useCallback(async () => {
        try {
            const { App } = await import('@capacitor/app');
            await App.openUrl({ url: 'app-settings:' });
        } catch {
            window.open('App-Prefs:', '_system');
        }
    }, []);

    const sendToSTT = useCallback(async (blob) => {
        setIsProcessing(true);
        setLastError(null);
        try {
            const form = new FormData();
            // 파일 확장자를 실제 mimeType에 맞게 지정 (iOS는 mp4/m4a, 그 외는 webm)
            const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
            form.append('audio', blob, `free-talk-${Date.now()}.${ext}`);
            form.append('langCode', langCode || 'en');

            // authFetch + FormData: Content-Type을 비워 두어야 boundary가 자동 설정됨
            // getAuthHeaders가 Authorization만 반환하므로 그대로 사용
            const headers = await getAuthHeaders();
            // Content-Type 명시 제거 — FormData는 브라우저가 자동 설정
            delete headers['Content-Type'];

            const res = await fetch(`${SERVER_URL}/api/converse-stt`, {
                method: 'POST',
                headers,
                body: form,
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `STT server error ${res.status}`);
            }
            const data = await res.json();
            const transcript = data.transcript || '';
            setLastTranscript(transcript);
            onTranscript?.(transcript);
            return transcript;
        } catch (e) {
            console.error('[useFreeTalkRecorder] STT failed:', e?.message || e);
            setLastError(e?.message || 'STT failed');
            onTranscript?.('');
            return '';
        } finally {
            setIsProcessing(false);
        }
    }, [langCode, onTranscript]);

    const startRecording = useCallback(async () => {
        setLastError(null);
        setMicDenied(false);
        try {
            // ===== 1) 권한 확보 (네이티브) =====
            if (Capacitor.isNativePlatform()) {
                try {
                    const has = await VoiceRecorder.hasAudioRecordingPermission();
                    if (!has.value) {
                        const req = await VoiceRecorder.requestAudioRecordingPermission();
                        if (!req.value) {
                            setMicDenied(true);
                            setLastError('Microphone permission denied');
                            return;
                        }
                    }
                } catch (e) { /* noop, getUserMedia가 권한 재시도 */ }

                // ===== 2) iOS AVAudioSession 재활성화 =====
                // iOS WKWebView는 AppDelegate의 초기 세션이 불완전 상태라
                // getUserMedia가 실제 오디오 데이터를 받지 못함. useAudioRecorder와 동일 패턴.
                if (Capacitor.getPlatform() === 'ios') {
                    try {
                        await BluetoothAudio.activateAudioSession();
                    } catch (e) {
                        console.warn('[useFreeTalkRecorder] activateAudioSession failed:', e?.message);
                    }
                }
            }

            // ===== 3) MediaRecorder + getUserMedia (모든 환경 통합) =====
            // 이전: 네이티브에서 VoiceRecorder.startRecording() 사용했으나
            // iOS Capacitor 8 SPM 모드에서 capacitor-voice-recorder@7.0.6의
            // startRecording이 silent fail하는 케이스 발견 → useAudioRecorder와
            // 동일하게 MediaRecorder 통합. iOS WKWebView도 MediaRecorder 정상 지원.
            isNativeRef.current = false; // stop 시 MediaRecorder 경로로 처리

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // iOS Safari/WKWebView는 mp4 우선, 그 외는 webm
            const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : MediaRecorder.isTypeSupported('audio/mp4')
                    ? 'audio/mp4'
                    : '';

            const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
            mr.onstop = async () => {
                try { stream.getTracks().forEach(t => t.stop()); } catch (_) { /* noop */ }
                const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
                await sendToSTT(blob);
            };
            mr.start();
            mediaRecorderRef.current = mr;
            setIsRecording(true);
        } catch (e) {
            console.error('[useFreeTalkRecorder] startRecording failed:', e?.message || e);
            const msg = String(e?.message || e);
            if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('denied')) {
                setMicDenied(true);
            }
            setLastError(msg);
        }
    }, [sendToSTT]);

    const stopRecording = useCallback(async () => {
        try {
            if (!isRecording) return;
            setIsRecording(false);
            if (isNativeRef.current) {
                const result = await VoiceRecorder.stopRecording();
                // result.value.recordDataBase64, mimeType
                const base64 = result?.value?.recordDataBase64;
                const mimeType = result?.value?.mimeType || 'audio/aac';
                if (!base64) {
                    setLastError('Empty recording');
                    return;
                }
                // base64 → Blob
                const byteChars = atob(base64);
                const byteNums = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                const byteArr = new Uint8Array(byteNums);
                const blob = new Blob([byteArr], { type: mimeType });
                await sendToSTT(blob);
            } else if (mediaRecorderRef.current) {
                mediaRecorderRef.current.stop();
                // sendToSTT는 onstop 핸들러에서 자동 호출
            }
        } catch (e) {
            console.error('[useFreeTalkRecorder] stopRecording failed:', e?.message || e);
            setLastError(e?.message || 'stop failed');
        }
    }, [isRecording, sendToSTT]);

    return {
        isRecording, isProcessing,
        lastTranscript, lastError, micDenied,
        startRecording, stopRecording,
        openAppSettings,
    };
}
