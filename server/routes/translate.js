const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const { geminiUrl } = require('../config/gemini');

router.post('/api/translate', requireAuth, async (req, res) => {
    const { prompt, byokGeminiKey } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'Missing prompt' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    try {
        const response = await axios.post(geminiUrl(geminiKey), {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const textResponse = response.data.candidates[0].content.parts[0].text;
        res.json({ text: textResponse });
    } catch (err) {
        console.error('[translate] Gemini error:', err.response?.data || err.message);
        const status = err.response?.status || 500;
        res.status(status).json({ error: err.response?.data?.error?.message || 'Translation failed' });
    }
});

// TranslationCard AI 메모용
router.post('/api/translate-memo', requireAuth, async (req, res) => {
    const { prompt, byokGeminiKey } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'Missing prompt' });
    }

    const geminiKey = byokGeminiKey || GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    try {
        const response = await axios.post(geminiUrl(geminiKey), {
            contents: [{ parts: [{ text: prompt }] }]
        });

        const textResponse = response.data.candidates[0].content.parts[0].text.trim();
        res.json({ text: textResponse });
    } catch (err) {
        console.error('[translate-memo] Gemini error:', err.response?.data || err.message);
        const status = err.response?.status || 500;
        res.status(status).json({ error: err.response?.data?.error?.message || 'Memo generation failed' });
    }
});

module.exports = router;
