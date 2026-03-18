import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Image, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './CameraOCRModal.css';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * CameraOCRModal
 * 카메라 촬영 또는 갤러리에서 이미지를 선택해 Gemini OCR로 텍스트를 추출합니다.
 *
 * Props:
 *   onClose()           — 모달 닫기
 *   onTextExtracted(text) — 추출된 텍스트를 부모에게 전달
 *   sourceLang          — UI 언어 (현재 미사용, 향후 다국어 확장용)
 */
const CameraOCRModal = ({ onClose, onTextExtracted }) => {
    const { byokGeminiKey } = useAuth();

    const [previewUrl, setPreviewUrl] = useState(null);   // 이미지 미리보기 URL
    const [ocrText, setOcrText] = useState('');            // 추출된 텍스트 (편집 가능)
    const [isLoading, setIsLoading] = useState(false);     // OCR 처리 중
    const [error, setError] = useState('');                // 오류 메시지
    const [phase, setPhase] = useState('select');          // 'select' | 'preview' | 'result'

    const cameraInputRef = useRef(null);
    const galleryInputRef = useRef(null);

    // 이미지를 base64로 변환 후 OCR API 호출
    const handleImageSelected = async (file) => {
        if (!file) return;
        setError('');
        setOcrText('');

        // 미리보기 URL 생성
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        setPhase('preview');

        // FileReader로 base64 변환
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result; // data:image/jpeg;base64,XXXX...
            const base64Data = dataUrl.split(',')[1];
            const mimeType = file.type || 'image/jpeg';

            setIsLoading(true);
            try {
                // 서버 사이드 OCR (Gemini API Key 노출 방지)
                const res = await fetch(`${SERVER_URL}/api/ocr`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageBase64: base64Data, mimeType }),
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'OCR 실패');

                setOcrText(data.text || '');
                setPhase('result');
            } catch (err) {
                console.error('[CameraOCR]', err);
                // 서버 실패 시 클라이언트에서 Gemini 직접 호출 (BYOK Key 사용 시)
                if (byokGeminiKey) {
                    try {
                        const clientRes = await fetch(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${byokGeminiKey}`,
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{
                                        parts: [
                                            { inline_data: { mime_type: mimeType, data: base64Data } },
                                            { text: '이 이미지에 있는 텍스트를 원본 언어 그대로 모두 추출해줘. 설명 없이 텍스트만 출력해줘.' }
                                        ]
                                    }],
                                    generationConfig: { temperature: 0, maxOutputTokens: 2048 }
                                }),
                            }
                        );
                        const clientData = await clientRes.json();
                        const text = clientData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                        setOcrText(text);
                        setPhase('result');
                        return;
                    } catch (clientErr) {
                        console.error('[CameraOCR] client fallback failed:', clientErr);
                    }
                }
                setError(err.message || '텍스트 추출에 실패했습니다. 다시 시도해 주세요.');
                setPhase('preview');
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    // 다시 찍기
    const handleRetry = () => {
        setPreviewUrl(null);
        setOcrText('');
        setError('');
        setPhase('select');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    };

    // "번역에 사용" 클릭
    const handleUse = () => {
        const text = ocrText.trim();
        if (!text) return;
        onTextExtracted(text);
    };

    const modal = (
        <div className="camera-modal-overlay" onClick={onClose}>
            <div className="camera-modal" onClick={(e) => e.stopPropagation()}>

                {/* 헤더 */}
                <div className="camera-modal-header">
                    <span className="camera-modal-title">
                        <Camera size={18} />
                        카메라로 텍스트 읽기
                    </span>
                    <button className="camera-modal-close" onClick={onClose} title="닫기">✕</button>
                </div>

                <div className="camera-modal-body">

                    {/* 단계 1: 이미지 선택 버튼 */}
                    {phase === 'select' && (
                        <div className="camera-action-row">
                            {/* 카메라 촬영 — capture="environment" 로 후면 카메라 우선 */}
                            <button
                                className="camera-action-btn"
                                onClick={() => cameraInputRef.current?.click()}
                            >
                                <span className="btn-icon">📷</span>
                                카메라 촬영
                            </button>
                            {/* 갤러리 선택 */}
                            <button
                                className="camera-action-btn"
                                onClick={() => galleryInputRef.current?.click()}
                            >
                                <span className="btn-icon">🖼</span>
                                갤러리 선택
                            </button>

                            {/* hidden file inputs */}
                            <input
                                ref={cameraInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                style={{ display: 'none' }}
                                onChange={(e) => handleImageSelected(e.target.files?.[0])}
                            />
                            <input
                                ref={galleryInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) => handleImageSelected(e.target.files?.[0])}
                            />
                        </div>
                    )}

                    {/* 이미지 미리보기 */}
                    {previewUrl && (
                        <div className="camera-preview-box">
                            <img src={previewUrl} alt="선택된 이미지" />
                        </div>
                    )}

                    {/* 로딩 스피너 */}
                    {isLoading && (
                        <div className="ocr-loading">
                            <div className="ocr-spinner" />
                            텍스트를 인식하는 중...
                        </div>
                    )}

                    {/* 오류 메시지 */}
                    {error && !isLoading && (
                        <div className="ocr-error">❌ {error}</div>
                    )}

                    {/* OCR 결과 텍스트 (편집 가능) */}
                    {phase === 'result' && !isLoading && (
                        <div className="ocr-result-section">
                            <span className="ocr-result-label">인식된 텍스트 (수정 가능)</span>
                            <textarea
                                className="ocr-result-textarea"
                                value={ocrText}
                                onChange={(e) => setOcrText(e.target.value)}
                                placeholder="인식된 텍스트가 여기에 표시됩니다."
                                autoFocus
                            />
                        </div>
                    )}
                </div>

                {/* 하단 버튼 — 미리보기 이후부터 표시 */}
                {(phase === 'preview' || phase === 'result') && !isLoading && (
                    <div className="camera-modal-footer">
                        <button className="ocr-retry-btn" onClick={handleRetry}>
                            <RotateCcw size={14} />
                            다시 찍기
                        </button>
                        <button
                            className="ocr-use-btn"
                            onClick={handleUse}
                            disabled={!ocrText.trim()}
                        >
                            번역에 사용 →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(modal, document.body);
};

export default CameraOCRModal;
