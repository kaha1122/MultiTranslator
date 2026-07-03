// ── K-DramaLingo 커뮤니티 UGC 온디맨드 번역 ──────────────────────────────
// 사용자가 "내 언어로 번역" 누를 때만 호출(비용 통제). 번역 캐시는 서버가 read-through로 관리
// (…/translations/{lang}) → Render에 CACHE-HIT/MISS 로깅(TTS durable과 동일 구조).
// requireAuthAny(kculture 토큰 허용). 기존 /api/translate(PronunFit 전용)와 별개.
const express = require('express');
const { requireAuthAny } = require('../middleware/authAny');
const { rateLimit } = require('../middleware/rateLimit');
const { callGeminiText } = require('../utils/geminiCall');
const { LANG_NAMES } = require('../config/langGuide');
const { buildDetectPrompt, parseDetected, LANG_SCRIPT_CUES } = require('../lib/langDetect'); // same 판정을 detect와 동일 단서로 통합(SSOT)
const { kcultureDb } = require('../config/firebaseKculture'); // 번역 캐시 read-through(HIT/MISS 서버 로깅)

const router = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ISO 코드 → 정식 언어명(Gemini가 코드보다 명칭에 훨씬 정확). 지역코드는 베이스로 폴백.
const langName = (code) => LANG_NAMES[code] || LANG_NAMES[String(code || '').split('-')[0]] || code;

// 번역 캐시 경로 검증 — admin SDK는 보안규칙을 우회하므로 translations 하위 doc만 read/write 허용(임의경로 차단).
// 허용: (titles|posts)/…/translations/{targetLang}, 짝수 세그먼트(문서 경로), 세그먼트당 안전 문자만.
const CACHE_ROOTS = new Set(['titles', 'posts']);
function validCachePath(p, targetLang) {
    if (typeof p !== 'string' || p.length > 200) return false;
    const seg = p.split('/');
    if (seg.length < 4 || seg.length > 8 || seg.length % 2 !== 0) return false; // 문서 경로(짝수 세그먼트)
    if (!CACHE_ROOTS.has(seg[0])) return false;
    if (seg[seg.length - 2] !== 'translations') return false; // 마지막 컬렉션은 반드시 translations
    if (seg[seg.length - 1] !== targetLang) return false;      // lang 세그먼트 = 대상 언어(불일치 캐시 차단)
    return seg.every((s) => /^[A-Za-z0-9_-]+$/.test(s));
}

router.post('/api/community/translate', requireAuthAny, rateLimit('community-translate', { perMinute: 30, perHour: 300 }), async (req, res) => {
    const { text, targetLang, maxChars, cachePath, scope } = req.body || {};
    if (!text || !targetLang) return res.status(400).json({ error: 'missing fields' });
    if (text.length > 5000) return res.status(413).json({ error: 'too long (max 5000)' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini not configured' });

    const uid = req.uid ? String(req.uid).slice(0, 8) : 'anon';
    const cacheDoc = (kcultureDb && validCachePath(cachePath, targetLang)) ? kcultureDb.doc(cachePath) : null;
    const scopeLabel = scope ? String(scope).slice(0, 12) : (cacheDoc ? 'tx' : 'nocache');

    // 캐시 HIT → Gemini 미호출(무과금). (TTS의 [AzureTTS] DURABLE-HIT 대응)
    if (cacheDoc) {
        try {
            const snap = await cacheDoc.get();
            const body = snap.exists ? (snap.data() || {}).body : null;
            if (body) {
                console.log(`[CommunityTx] uid=${uid} scope=${scopeLabel} target=${targetLang} chars=${text.length} → CACHE-HIT(Gemini 0)`);
                return res.json({ translated: body, cached: true });
            }
        } catch (e) { /* 캐시 read 실패 → MISS로 진행(번역은 계속) */ }
    }

    const targetName = langName(targetLang);
    // 선택적 길이 제약(KCulture 한줄평 등 고정 박스용). optional이라 미전송 호출(PronunFit 포함)엔 무영향.
    const lenRule = (Number.isFinite(maxChars) && maxChars > 0)
        ? `5. Length limit: keep the "translated" value within about ${maxChars} characters. If a faithful translation would be longer, condense naturally (preserve the core meaning, drop redundancy) — never cut off mid-sentence.`
        : null;
    const prompt = [
        `You are a professional translator for a multilingual community app.`,
        ``,
        `[Target language] ${targetName} (ISO code "${targetLang}")`,
        ``,
        `[Rules — read carefully, apply in order]`,
        `1. Determine the source language of the TEXT below using these decisive cues:`,
        LANG_SCRIPT_CUES,
        `2. Respond with EXACTLY {"same": true} ONLY IF the source language is genuinely the SAME as the target language (${targetName}) by the cues above. If the text is in ANY other language — even if it mentions or is about ${targetName}-speaking topics — you MUST translate it (go to rule 3). When unsure, translate.`,
        `3. Otherwise translate the ENTIRE text into ${targetName}:`,
        `   - The "translated" value MUST be written 100% in ${targetName}.`,
        `   - NEVER return, copy, paraphrase, or echo the source-language text. Returning the source language is a FAILURE.`,
        `   - NEVER mix languages. No notes, commentary, romanization, or surrounding quotes.`,
        `   - Translate naturally and idiomatically, faithfully preserving meaning, nuance, tone, register (formality / slang / emotion), emoji and line breaks.`,
        `4. Self-check before answering: if your "translated" value is still (even partly) in the source language, you FAILED — redo it fully in ${targetName}.`,
        ...(lenRule ? [lenRule] : []),
        ``,
        `Respond with ONLY one JSON object, no markdown:`,
        `  {"translated": "<the text fully translated into ${targetName}>"}   — or {"same": true} per rule 2.`,
        ``,
        `TEXT:`,
        text,
    ].join('\n');

    const r = await callGeminiText(prompt, GEMINI_API_KEY, {
        label: 'community-translate',
        // 번역 충실도 → 낮은 temperature(기본 ~1.0은 너무 높아 의역·드리프트·원문 에코 유발). 0.3 = 충실+자연스러움 균형.
        genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' },
    });
    // 여기 도달 = 캐시 MISS(또는 무캐시) → Gemini 실호출(과금). (TTS의 [AzureTTS] MISS 대응)
    if (r.error) {
        console.log(`[CommunityTx] uid=${uid} scope=${scopeLabel} target=${targetLang} chars=${text.length} model=${r.modelUsed || '?'} ERROR: ${r.error}`);
        return res.status(r.status || 502).json({ error: r.userMsg || r.error });
    }

    // Gemini가 원문=대상언어로 판별 → 번역본 없이 same_language 신호(클라가 에러 처리, 차감 없음)
    let parsed = null;
    try { parsed = JSON.parse(r.text); } catch { parsed = parseFirstJsonObject(r.text); }
    if (parsed && parsed.same === true) {
        console.log(`[CommunityTx] uid=${uid} scope=${scopeLabel} target=${targetLang} chars=${text.length} model=${r.modelUsed || '?'} → SAME-LANG(번역 안 함, 차감 없음)`);
        return res.status(409).json({ error: 'same_language' });
    }

    let translated = (r.text || '').trim();
    if (parsed && typeof parsed.translated === 'string') translated = parsed.translated;
    // 캐시에 저장(다음 사람·재조회 재사용) — best-effort, 실패해도 응답엔 영향 없음.
    if (cacheDoc) { try { await cacheDoc.set({ body: translated, translatedAt: new Date() }, { merge: true }); } catch (e) { /* best-effort */ } }
    console.log(`[CommunityTx] uid=${uid} scope=${scopeLabel} target=${targetLang} chars=${text.length}${Number.isFinite(maxChars) && maxChars > 0 ? ` maxChars=${maxChars}` : ''} model=${r.modelUsed || '?'} → MISS Gemini 번역(과금 발생)`);
    res.json({ translated });
});

// ── 언어 감지 (배지용) — 번역이 아닌 ISO 코드만 반환 → 출력 토큰 극소 = 저비용 ──────
// 작성 시 1회 호출해 글의 실제 언어를 판별(작성자 UI 언어가 아닌 텍스트 기준). 실패/모호 시 클라가 UI 언어로 폴백.
// 프롬프트·파싱은 lib/langDetect(백필 스크립트와 공유)에 단일 출처로 둠.
router.post('/api/community/detect', requireAuthAny, rateLimit('community-detect', { perMinute: 60, perHour: 600 }), async (req, res) => {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'missing text' });
    if (text.length > 5000) return res.status(413).json({ error: 'too long (max 5000)' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Gemini not configured' });

    const r = await callGeminiText(buildDetectPrompt(text), GEMINI_API_KEY, {
        label: 'community-detect',
        genConfig: { temperature: 0, topP: 0.9, responseMimeType: 'application/json' }, // 결정적 판별 → temp 0
    });
    const uid = req.uid ? String(req.uid).slice(0, 8) : 'anon';
    if (r.error) {
        console.log(`[CommunityDetect] uid=${uid} chars=${text.length} model=${r.modelUsed || '?'} ERROR: ${r.error}`);
        return res.status(r.status || 502).json({ error: r.userMsg || r.error });
    }

    // 허용 코드일 때만 반환, 아니면(und·오탐) null → 클라가 UI 언어로 폴백
    const detected = parseDetected(r.text);
    console.log(`[CommunityDetect] uid=${uid} chars=${text.length} model=${r.modelUsed || '?'} → lang=${detected || 'und'}(과금 발생)`);
    res.json({ lang: detected });
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
    const targetName = langName(targetLang);
    const prompt = [
        `You are a professional translator for a multilingual community app.`,
        `Translate each item's text into ${targetName} (ISO code "${targetLang}").`,
        ``,
        `[Judging each item's source language — apply these decisive cues]`,
        LANG_SCRIPT_CUES,
        ``,
        `[Rules]`,
        `- Each output value MUST be written 100% in ${targetName}.`,
        `- NEVER return, copy, paraphrase, or echo the source language. Returning the source language is a FAILURE.`,
        `- Keep an item as-is ONLY IF it is genuinely already in ${targetName} by the cues above. If it is in any other language — even if it mentions ${targetName} topics — you MUST translate it.`,
        `- Translate naturally and idiomatically, faithfully preserving meaning, nuance, tone, register, emoji and line breaks. No notes or commentary.`,
        `- Self-check: if any value is still in the source language, redo it fully in ${targetName}.`,
        ``,
        `Return ONLY a JSON object mapping each id to its ${targetName} translation: {"<id>":"<translated>"}.`,
        ``,
        'ITEMS (JSON):',
        JSON.stringify(payload),
    ].join('\n');

    const r = await callGeminiText(prompt, GEMINI_API_KEY, {
        label: 'community-translate-batch',
        // 번역 충실도 → 낮은 temperature(기본 ~1.0은 너무 높음). 0.3 = 충실+자연스러움 균형.
        genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' },
    });
    const uid = req.uid ? String(req.uid).slice(0, 8) : 'anon';
    if (r.error) {
        console.log(`[CommunityTx] uid=${uid} target=${targetLang} batch items=${items.length} chars=${total} model=${r.modelUsed || '?'} ERROR: ${r.error}`);
        return res.status(r.status || 502).json({ error: r.userMsg || r.error });
    }
    const map = parseFirstJsonObject(r.text) || {};
    console.log(`[CommunityTx] uid=${uid} target=${targetLang} batch items=${items.length} chars=${total} model=${r.modelUsed || '?'} → Gemini 배치번역(과금 발생)`);
    res.json({ results: map });
});

module.exports = router;
