const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { callGeminiText } = require('../utils/geminiCall');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 2026-05-22 — Flash-Lite 503 outage 대응: callGeminiText 사용 (3회 retry + Flash fallback).
// 클라이언트가 응답 text 를 JSON.parse 하므로 서버는 raw text 그대로 반환.

router.post('/api/translate', requireAuth, rateLimit('translate', { perMinute: 30, perHour: 300 }), async (req, res) => {
    const { prompt, byokGeminiKey } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (prompt.length > 8000) return res.status(413).json({ error: 'Prompt too long (max 8000 chars)' });
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const result = await callGeminiText(prompt, geminiKey, {
        genConfig: { responseMimeType: 'application/json' },
        label: 'translate',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || result.error });
    }
    res.json({ text: result.text });
});

// TranslationCard AI 메모용 (plain text)
router.post('/api/translate-memo', requireAuth, rateLimit('translate-memo', { perMinute: 10, perHour: 100 }), async (req, res) => {
    const { prompt, byokGeminiKey } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (prompt.length > 8000) return res.status(413).json({ error: 'Prompt too long (max 8000 chars)' });
    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const result = await callGeminiText(prompt, geminiKey, {
        // memo 는 plain text — responseMimeType 미지정
        label: 'translate-memo',
    });
    if (result.error) {
        return res.status(result.status).json({ error: result.userMsg || result.error });
    }
    res.json({ text: (result.text || '').trim() });
});

module.exports = router;
