import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Camera, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import './CameraOCRModal.css';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const SCAN_SIZES = {
    word:     { w: '60vw', h: 56 },
    sentence: { w: '85vw', h: 70 },
};
const ZOOM_FACTOR = 2.0;

/**
 * CameraOCRModal — Live Viewfinder + Scan Box Crop OCR
 */
const CameraOCRModal = ({ onClose, onTextExtracted, sourceLang }) => {
    const { byokGeminiKey } = useAuth();
    const t = useT(sourceLang);

    // phase: 'select' | 'viewfinder' | 'preview' | 'result'
    const [phase, setPhase] = useState('select');
    const [scanMode, setScanMode] = useState('word');   // 'word' | 'sentence'
    const [previewUrl, setPreviewUrl] = useState(null);
    const [ocrText, setOcrText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const scanBoxRef = useRef(null);
    const galleryInputRef = useRef(null);

    /* ── Camera start / stop ───────────────────────── */
    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(tr => tr.stop());
            streamRef.current = null;
        }
    }, []);

    const startCamera = useCallback(async () => {
        setError('');
        if (!navigator.mediaDevices?.getUserMedia) {
            setError(t('cameraOCR.cameraNotSupported'));
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false,
            });
            streamRef.current = stream;
            setPhase('viewfinder');

            // wait for ref to be available after render
            requestAnimationFrame(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            });
        } catch (err) {
            console.error('[CameraOCR] getUserMedia error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setError(t('cameraOCR.cameraPermissionDenied'));
            } else {
                setError(t('cameraOCR.cameraNotSupported'));
            }
        }
    }, [t]);

    // Cleanup on unmount
    useEffect(() => () => stopCamera(), [stopCamera]);

    /* ── OCR helper (shared by camera capture & gallery) ── */
    const performOCR = useCallback(async (base64Data, mimeType) => {
        setIsLoading(true);
        setError('');
        try {
            const res = await fetch(`${SERVER_URL}/api/ocr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: base64Data, mimeType }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'OCR failed');
            setOcrText(data.text || '');
            setPhase('result');
        } catch (err) {
            console.error('[CameraOCR]', err);
            // BYOK fallback
            if (byokGeminiKey) {
                try {
                    const clientRes = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${byokGeminiKey}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ parts: [
                                    { inline_data: { mime_type: mimeType, data: base64Data } },
                                    { text: '이 이미지에 있는 텍스트를 원본 언어 그대로 모두 추출해줘. 설명 없이 텍스트만 출력해줘.' },
                                ]}],
                                generationConfig: { temperature: 0, maxOutputTokens: 2048 },
                            }),
                        }
                    );
                    const cd = await clientRes.json();
                    const txt = cd.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                    setOcrText(txt);
                    setPhase('result');
                    return;
                } catch (ce) {
                    console.error('[CameraOCR] client fallback failed:', ce);
                }
            }
            setError(err.message || t('cameraOCR.errorFallback'));
            setPhase('preview');
        } finally {
            setIsLoading(false);
        }
    }, [byokGeminiKey, t]);

    /* ── Capture from live viewfinder ──────────────── */
    const handleCapture = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const rect = video.getBoundingClientRect();
        if (!vw || !vh || !rect.width || !rect.height) return;

        // object-fit: cover mapping
        const displayAspect = rect.width / rect.height;
        const videoAspect = vw / vh;
        let drawW, drawH;
        if (videoAspect > displayAspect) {
            drawH = vh; drawW = vh * displayAspect;
        } else {
            drawW = vw; drawH = vw / displayAspect;
        }

        // CSS zoom — visible portion is center 1/ZOOM of cover area
        const visibleW = drawW / ZOOM_FACTOR;
        const visibleH = drawH / ZOOM_FACTOR;
        const visibleX = (vw - visibleW) / 2;
        const visibleY = (vh - visibleH) / 2;

        // scan box → video coords (read actual rendered size from DOM)
        const boxRect = scanBoxRef.current?.getBoundingClientRect();
        const scanW = boxRect ? boxRect.width : 280;
        const scanH = boxRect ? boxRect.height : 70;
        const pxPerCSS_x = visibleW / rect.width;
        const pxPerCSS_y = visibleH / rect.height;
        const cropW = scanW * pxPerCSS_x;
        const cropH = scanH * pxPerCSS_y;
        const cropX = visibleX + (visibleW - cropW) / 2;
        const cropY = visibleY + (visibleH - cropH) / 2;

        canvas.width = Math.round(cropW);
        canvas.height = Math.round(cropH);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const base64 = dataUrl.split(',')[1];

        stopCamera();
        setPreviewUrl(dataUrl);
        setPhase('preview');
        performOCR(base64, 'image/jpeg');
    }, [scanMode, stopCamera, performOCR]);

    /* ── Gallery handler (unchanged) ───────────────── */
    const handleGallerySelected = useCallback((file) => {
        if (!file) return;
        setError('');
        setOcrText('');
        const objectUrl = URL.createObjectURL(file);
        setPreviewUrl(objectUrl);
        setPhase('preview');

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            performOCR(base64, file.type || 'image/jpeg');
        };
        reader.readAsDataURL(file);
    }, [performOCR]);

    /* ── Retry ─────────────────────────────────────── */
    const handleRetry = useCallback(() => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setOcrText('');
        setError('');
        setPhase('select');
    }, [previewUrl]);

    /* ── Use for translation ───────────────────────── */
    const handleUse = () => {
        const text = ocrText.trim();
        if (!text) return;
        onTextExtracted(text);
    };

    /* ── Close with cleanup ────────────────────────── */
    const handleClose = () => {
        stopCamera();
        onClose();
    };

    /* ── Render ─────────────────────────────────────── */
    const { w: boxW, h: boxH } = SCAN_SIZES[scanMode];

    const modal = (
        <div className="camera-modal-overlay" onClick={handleClose}>
            <div className="camera-modal" onClick={(e) => e.stopPropagation()}>

                {/* Header — hide during viewfinder for full-screen feel */}
                {phase !== 'viewfinder' && (
                    <div className="camera-modal-header">
                        <span className="camera-modal-title">
                            <Camera size={18} />
                            {t('cameraOCR.title')}
                        </span>
                        <button className="camera-modal-close" onClick={handleClose} title={t('cameraOCR.close')}>✕</button>
                    </div>
                )}

                <div className="camera-modal-body">

                    {/* ── Phase: select ── */}
                    {phase === 'select' && (
                        <div className="camera-action-row">
                            <button className="camera-action-btn" onClick={startCamera}>
                                <span className="btn-icon">📷</span>
                                {t('cameraOCR.takePhoto')}
                            </button>
                            <button className="camera-action-btn" onClick={() => galleryInputRef.current?.click()}>
                                <span className="btn-icon">🖼</span>
                                {t('cameraOCR.chooseFromGallery')}
                            </button>
                            <input
                                ref={galleryInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) => { handleGallerySelected(e.target.files?.[0]); e.target.value = ''; }}
                            />
                        </div>
                    )}

                    {/* ── Phase: viewfinder ── */}
                    {phase === 'viewfinder' && (
                        <div className="vf-container">
                            {/* live video */}
                            <video
                                ref={videoRef}
                                className="vf-video"
                                autoPlay
                                playsInline
                                muted
                                style={{ transform: `scale(${ZOOM_FACTOR})` }}
                            />

                            {/* dark overlay with transparent hole */}
                            <div
                                className="vf-overlay"
                                style={{
                                    '--box-w': typeof boxW === 'number' ? `${boxW}px` : boxW,
                                    '--box-h': typeof boxH === 'number' ? `${boxH}px` : boxH,
                                }}
                            />

                            {/* scan box border + corner brackets */}
                            <div ref={scanBoxRef} className="vf-scan-box" style={{ width: boxW, height: boxH }}>
                                <span className="vf-corner tl" /><span className="vf-corner tr" />
                                <span className="vf-corner bl" /><span className="vf-corner br" />
                            </div>

                            {/* guide text */}
                            <span className="vf-guide">{t('cameraOCR.scanGuide')}</span>

                            {/* mode toggle */}
                            <div className="vf-mode-toggle">
                                <button
                                    className={`vf-mode-btn ${scanMode === 'word' ? 'active' : ''}`}
                                    onClick={() => setScanMode('word')}
                                >{t('cameraOCR.wordMode')}</button>
                                <button
                                    className={`vf-mode-btn ${scanMode === 'sentence' ? 'active' : ''}`}
                                    onClick={() => setScanMode('sentence')}
                                >{t('cameraOCR.sentenceMode')}</button>
                            </div>

                            {/* capture + close */}
                            <div className="vf-bottom-bar">
                                <button className="vf-close-btn" onClick={handleClose}>✕</button>
                                <button className="vf-capture-btn" onClick={handleCapture}>
                                    <span className="vf-capture-ring" />
                                </button>
                                <div className="vf-spacer" />
                            </div>

                            {/* hidden canvas for frame capture */}
                            <canvas ref={canvasRef} style={{ display: 'none' }} />
                        </div>
                    )}

                    {/* ── Preview image ── */}
                    {previewUrl && phase !== 'viewfinder' && (
                        <div className="camera-preview-box">
                            <img src={previewUrl} alt={t('cameraOCR.selectedImage')} />
                        </div>
                    )}

                    {/* ── Loading ── */}
                    {isLoading && (
                        <div className="ocr-loading">
                            <div className="ocr-spinner" />
                            {t('cameraOCR.recognizing')}
                        </div>
                    )}

                    {/* ── Error ── */}
                    {error && !isLoading && (
                        <div className="ocr-error">❌ {error}</div>
                    )}

                    {/* ── Result ── */}
                    {phase === 'result' && !isLoading && (
                        <div className="ocr-result-section">
                            <span className="ocr-result-label">{t('cameraOCR.resultLabel')}</span>
                            <textarea
                                className="ocr-result-textarea"
                                value={ocrText}
                                onChange={(e) => setOcrText(e.target.value)}
                                placeholder={t('cameraOCR.resultPlaceholder')}
                                autoFocus
                            />
                        </div>
                    )}
                </div>

                {/* ── Footer buttons ── */}
                {(phase === 'preview' || phase === 'result') && !isLoading && (
                    <div className="camera-modal-footer">
                        <button className="ocr-retry-btn" onClick={handleRetry}>
                            <RotateCcw size={14} />
                            {t('cameraOCR.retry')}
                        </button>
                        <button className="ocr-use-btn" onClick={handleUse} disabled={!ocrText.trim()}>
                            {t('cameraOCR.useForTranslation')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(modal, document.body);
};

export default CameraOCRModal;
