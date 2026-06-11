const express = require('express');
const router = express.Router();
const { geminiUrl } = require('../config/gemini');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

/**
 * POST /api/ocr
 * 이미지(base64)를 Gemini 멀티모달 API로 전송하여 텍스트를 추출합니다.
 * Body: { imageBase64: string, mimeType: string }
 * Response: { text: string }
 */
// 2026-06-11 서버 권위 확립: 무인증 Gemini 멀티모달 프록시였던 구멍 차단
router.post('/api/ocr', requireAuth, rateLimit('ocr', { perMinute: 10, perHour: 60 }), async (req, res) => {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
        return res.status(400).json({ error: '이미지 데이터가 없습니다.' });
    }
    // base64 8MB ≈ 원본 6MB — express json limit(10mb) 이하에서 한 번 더 명시 상한
    if (imageBase64.length > 8 * 1024 * 1024) {
        return res.status(413).json({ error: 'Image too large (max ~6MB)' });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
        return res.status(500).json({ error: 'Gemini API 키가 설정되지 않았습니다.' });
    }

    try {
        const response = await fetch(
            geminiUrl(GEMINI_KEY),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                inline_data: {
                                    mime_type: mimeType,
                                    data: imageBase64,
                                }
                            },
                            {
                                text: `이 이미지에 있는 텍스트를 원본 언어 그대로 모두 추출해줘.
줄바꿈과 문단 구조를 최대한 유지해줘.
설명, 번역, 요약 없이 텍스트만 출력해줘.
이미지에 텍스트가 없으면 빈 문자열을 반환해줘.`
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 2048,
                    }
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error('[OCR] Gemini API error:', data);
            return res.status(502).json({ error: data.error?.message || 'Gemini API 오류' });
        }

        const extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        return res.json({ text: extractedText });

    } catch (err) {
        console.error('[OCR] 서버 오류:', err);
        return res.status(500).json({ error: '텍스트 추출에 실패했습니다.' });
    }
});

module.exports = router;
