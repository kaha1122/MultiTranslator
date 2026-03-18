const express = require('express');
const router = express.Router();

/**
 * POST /api/ocr
 * 이미지(base64)를 Gemini 2.0 Flash 멀티모달 API로 전송하여 텍스트를 추출합니다.
 * Body: { imageBase64: string, mimeType: string }
 * Response: { text: string }
 */
router.post('/api/ocr', async (req, res) => {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
        return res.status(400).json({ error: '이미지 데이터가 없습니다.' });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
        return res.status(500).json({ error: 'Gemini API 키가 설정되지 않았습니다.' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
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
