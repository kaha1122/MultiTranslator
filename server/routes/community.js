// ── K-DramaLingo 커뮤니티 UGC 온디맨드 번역 ──────────────────────────────
// 사용자가 "내 언어로 번역" 누를 때만 호출(비용 통제). 캐시는 클라가 Firestore에 저장.
// requireAuthAny(kculture 토큰 허용). 기존 /api/translate(PronunFit 전용)와 별개.
const express = require('express');
const { requireAuthAny } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');
const { callGeminiText } = require('../utils/geminiCall');

const router = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

router.post('/api/community/translate', requireAuthAny, rateLimit('community-translate', { perMinute: 30, perHour: 300 }), async (req, res) => {
    const { text, targetLang } = req.body || {};
    if (!text || !targetLang) return res.status(400).json({ error: 'missing fields' });
    if (text.length > 5000) return res.status(413).json({ error: 'too long (max 5000)' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini not configured' });

    const prompt = [
        `You are a translation engine. The target language has ISO code "${targetLang}".`,
        'First detect the language of the TEXT below.',
        `If the TEXT is already written in the target language ("${targetLang}"), respond with exactly: {"same": true}.`,
        `Otherwise translate the TEXT into "${targetLang}", preserving meaning, tone, emoji and line breaks, and respond with: {"translated": "<result>"}.`,
        'Return ONLY the JSON object. No commentary or notes.',
        '',
        'TEXT:',
        text,
    ].join('\n');

    const r = await callGeminiText(prompt, GEMINI_API_KEY, {
        label: 'community-translate',
        genConfig: { responseMimeType: 'application/json' },
    });
    if (r.error) return res.status(r.status || 502).json({ error: r.userMsg || r.error });

    // Gemini가 원문=대상언어로 판별 → 번역본 없이 same_language 신호(클라가 에러 처리, 차감 없음)
    let parsed = null;
    try { parsed = JSON.parse(r.text); } catch { parsed = parseFirstJsonObject(r.text); }
    if (parsed && parsed.same === true) return res.status(409).json({ error: 'same_language' });

    let translated = (r.text || '').trim();
    if (parsed && typeof parsed.translated === 'string') translated = parsed.translated;
    res.json({ translated });
});

// 첫 번째 완결 JSON 객체만 추출 (flash-lite 중복 블록 글리치 방어)
function parseFirstJsonObject(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; }
        else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { if (--depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
    }
    return null;
}

// ── 페이지 전체 번역 (게시글 + 댓글들을 한 번의 Gemini 호출로 묶음) ──
router.post('/api/community/translate-batch', requireAuthAny, rateLimit('community-translate', { perMinute: 30, perHour: 300 }), async (req, res) => {
    const { items, targetLang } = req.body || {};
    if (!Array.isArray(items) || !items.length || !targetLang) return res.status(400).json({ error: 'missing fields' });
    if (items.length > 60) return res.status(413).json({ error: 'too many items (max 60)' });
    const total = items.reduce((n, it) => n + (it.text?.length || 0), 0);
    if (total > 12000) return res.status(413).json({ error: 'too long' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini not configured' });

    const payload = items.map((it) => ({ id: String(it.id), text: String(it.text || '') }));
    const prompt = [
        `Translate each item's text into the language with ISO code "${targetLang}". Preserve tone, emoji, line breaks.`,
        'Return ONLY a JSON object mapping each id to its translation, e.g. {"<id>":"<translated>"}.',
        '',
        'ITEMS (JSON):',
        JSON.stringify(payload),
    ].join('\n');

    const r = await callGeminiText(prompt, GEMINI_API_KEY, {
        label: 'community-translate-batch',
        genConfig: { responseMimeType: 'application/json' },
    });
    if (r.error) return res.status(r.status || 502).json({ error: r.userMsg || r.error });
    const map = parseFirstJsonObject(r.text) || {};
    res.json({ results: map });
});

module.exports = router;
