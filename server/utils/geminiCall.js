/**
 * Gemini 호출 with retry + 모델 fallback (2026-05-22 v1.5.53+).
 *
 * Flash-Lite 503 outage 가 4월부터 community 다수 보고. retry 만으로는 회복 안 됨.
 * → 1~3차 Flash-Lite retry, 마지막 1회 Flash escalate. 비용 평균 ~1.25x.
 *
 * 사용 예:
 *   const result = await callGeminiJson(prompt, geminiKey, {
 *     genConfig: { temperature: 1.3, topK: 64, topP: 0.95, responseMimeType: 'application/json' },
 *     validate: (p) => Array.isArray(p?.words) && p.words.length > 0,
 *     label: 'VocabWords',
 *   });
 *   if (result.error) return res.status(result.status).json({ error: result.userMsg });
 *   const parsed = result.parsed;
 */
const axios = require('axios');
const { geminiUrl, PRIMARY_MODEL, FALLBACK_MODEL, GEMINI_MODE } = require('../config/gemini');

const DEFAULT_GEN_CONFIG = { responseMimeType: 'application/json' };
const BACKOFF_MS = [0, 800, 1600];
const PRIMARY_ATTEMPTS_DEFAULT = 3;
const TIMEOUT_MS = 30000;

// 운영자 토글 GEMINI_MODE 에 따라 primary attempts 계산.
// fast/flash 모드는 outage 시 빠른 escape — Render env 변경 후 재배포로 적용.
function getPrimaryAttempts() {
    if (GEMINI_MODE === 'flash') return 0;  // primary 건너뜀 → 바로 fallback
    if (GEMINI_MODE === 'fast') return 1;   // 1회만 시도
    return PRIMARY_ATTEMPTS_DEFAULT;        // 'auto' (기본): 3회
}

/**
 * 단일 호출 + JSON parse + validate. axios throw 포함 모든 에러를 구조화 반환.
 */
async function callOnce(model, prompt, geminiKey, genConfig, validate) {
    try {
        const response = await axios.post(
            geminiUrl(geminiKey, model),
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: genConfig,
            },
            { timeout: TIMEOUT_MS }
        );
        const raw = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        let parsed;
        try { parsed = JSON.parse(jsonStr); }
        catch (parseErr) {
            return { error: 'AI returned invalid JSON', status: 502, retryable: true, detail: `parse: ${parseErr.message} | raw: ${raw.slice(0, 200)}` };
        }
        if (validate && !validate(parsed)) {
            return { error: 'AI response missing required fields', status: 502, retryable: true, detail: `keys: ${Object.keys(parsed || {}).join(',')}` };
        }
        return { parsed, raw };
    } catch (e) {
        const status = e.response?.status;
        const geminiMsg = e.response?.data?.error?.message || e.message;
        // 503/429/500/network/timeout: transient — retry/escalate 가능.
        // 400/403/404: key/permission/prompt 거부 — retry/escalate 무의미.
        const retryable = status === 503 || status === 429 || status === 500 || !status || e.code === 'ECONNABORTED';
        return {
            error: status === 503 ? 'AI server busy' : status === 429 ? 'AI rate limited' : 'AI call failed',
            status: status || 502,
            retryable,
            detail: `${status || e.code || 'network'}: ${(geminiMsg || '').slice(0, 250)}`,
        };
    }
}

/**
 * Retry + Fallback orchestrator.
 *
 * @param {string} prompt
 * @param {string} geminiKey
 * @param {object} [opts]
 * @param {object} [opts.genConfig=DEFAULT_GEN_CONFIG]
 * @param {function} [opts.validate] — parsed JSON 검증 (return false 면 retryable invalid)
 * @param {string}   [opts.label='Gemini'] — 로그 prefix (예: 'VocabWords')
 * @returns {Promise<{parsed?, error?, status?, userMsg?, modelUsed?, attempts?, detail?}>}
 *   성공: { parsed, modelUsed, attempts }
 *   실패: { error, status, userMsg, modelUsed, attempts, detail }
 */
async function callGeminiJson(prompt, geminiKey, opts = {}) {
    const label = opts.label || 'Gemini';
    const genConfig = opts.genConfig || DEFAULT_GEN_CONFIG;
    const validate = opts.validate;
    const primaryAttempts = getPrimaryAttempts();
    let lastResult;

    // 1~N차: Primary (Flash-Lite) — GEMINI_MODE='flash' 면 N=0 (건너뜀)
    for (let i = 0; i < primaryAttempts; i++) {
        if (BACKOFF_MS[i] > 0) {
            await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
        }
        const r = await callOnce(PRIMARY_MODEL, prompt, geminiKey, genConfig, validate);
        if (r.parsed) {
            return { ...r, modelUsed: PRIMARY_MODEL, attempts: i + 1 };
        }
        lastResult = r;
        if (!r.retryable) {
            // non-retryable (400/403 등) — fallback 시도해도 무의미. 즉시 종료.
            console.error(`[${label}] non-retryable on ${PRIMARY_MODEL} attempt${i+1}:`, r.error, '|', r.detail);
            return { ...r, modelUsed: PRIMARY_MODEL, attempts: i + 1, userMsg: errToUserMsg(r) };
        }
        console.warn(`[${label}] ${PRIMARY_MODEL} attempt${i+1} retryable fail:`, r.error, '|', r.detail);
    }

    // Fallback (Flash) — Flash-Lite 소진 시 escalate. 'flash' 모드는 primary 건너뛰고 바로 진입.
    if (primaryAttempts === 0) {
        console.info(`[${label}] GEMINI_MODE=flash → using ${FALLBACK_MODEL} directly`);
    } else {
        console.warn(`[${label}] Flash-Lite exhausted → escalating to ${FALLBACK_MODEL}`);
    }
    const rFb = await callOnce(FALLBACK_MODEL, prompt, geminiKey, genConfig, validate);
    if (rFb.parsed) {
        if (primaryAttempts > 0) {
            console.info(`[${label}] ✅ ${FALLBACK_MODEL} succeeded (Flash-Lite outage rescued)`);
        }
        return { ...rFb, modelUsed: FALLBACK_MODEL, attempts: primaryAttempts + 1 };
    }
    console.error(`[${label}] ❌ ${FALLBACK_MODEL} also failed:`, rFb.error, '|', rFb.detail);
    return { ...rFb, modelUsed: FALLBACK_MODEL, attempts: primaryAttempts + 1, userMsg: errToUserMsg(rFb) };
}

function errToUserMsg(r) {
    if (r.status === 503 || r.status === 429) {
        return 'AI service is temporarily busy. Please try again in a moment.';
    }
    return 'AI request failed. Please try again.';
}

/**
 * Text 변형 — JSON parse 없이 raw text 반환. translate / translate-memo / TTS 같은
 * plain text endpoint 용. retry + fallback 동일 패턴.
 *
 * @param {string} prompt
 * @param {string} geminiKey
 * @param {object} [opts]
 * @param {object} [opts.genConfig={}] — translate 는 responseMimeType 필요할 수 있음 (호출자 결정)
 * @param {string} [opts.label='Gemini']
 * @returns {Promise<{text?, error?, status?, userMsg?, modelUsed?, attempts?, detail?}>}
 */
async function callGeminiText(prompt, geminiKey, opts = {}) {
    const label = opts.label || 'Gemini';
    const genConfig = opts.genConfig || {};
    const primaryAttempts = getPrimaryAttempts();

    async function attemptText(model) {
        try {
            const response = await axios.post(
                geminiUrl(geminiKey, model),
                { contents: [{ parts: [{ text: prompt }] }], generationConfig: genConfig },
                { timeout: TIMEOUT_MS }
            );
            const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return { text };
        } catch (e) {
            const status = e.response?.status;
            const geminiMsg = e.response?.data?.error?.message || e.message;
            const retryable = status === 503 || status === 429 || status === 500 || !status || e.code === 'ECONNABORTED';
            return {
                error: status === 503 ? 'AI server busy' : status === 429 ? 'AI rate limited' : 'AI call failed',
                status: status || 502,
                retryable,
                detail: `${status || e.code || 'network'}: ${(geminiMsg || '').slice(0, 250)}`,
            };
        }
    }

    let lastResult;
    for (let i = 0; i < primaryAttempts; i++) {
        if (BACKOFF_MS[i] > 0) await new Promise(r => setTimeout(r, BACKOFF_MS[i]));
        const r = await attemptText(PRIMARY_MODEL);
        if (r.text !== undefined) return { ...r, modelUsed: PRIMARY_MODEL, attempts: i + 1 };
        lastResult = r;
        if (!r.retryable) {
            console.error(`[${label}] non-retryable on ${PRIMARY_MODEL} attempt${i+1}:`, r.error, '|', r.detail);
            return { ...r, modelUsed: PRIMARY_MODEL, attempts: i + 1, userMsg: errToUserMsg(r) };
        }
        console.warn(`[${label}] ${PRIMARY_MODEL} attempt${i+1} retryable fail:`, r.error, '|', r.detail);
    }

    if (primaryAttempts === 0) {
        console.info(`[${label}] GEMINI_MODE=flash → using ${FALLBACK_MODEL} directly`);
    } else {
        console.warn(`[${label}] Flash-Lite exhausted → escalating to ${FALLBACK_MODEL}`);
    }
    const rFb = await attemptText(FALLBACK_MODEL);
    if (rFb.text !== undefined) {
        if (primaryAttempts > 0) {
            console.info(`[${label}] ✅ ${FALLBACK_MODEL} succeeded (Flash-Lite outage rescued)`);
        }
        return { ...rFb, modelUsed: FALLBACK_MODEL, attempts: primaryAttempts + 1 };
    }
    console.error(`[${label}] ❌ ${FALLBACK_MODEL} also failed:`, rFb.error, '|', rFb.detail);
    return { ...rFb, modelUsed: FALLBACK_MODEL, attempts: primaryAttempts + 1, userMsg: errToUserMsg(rFb) };
}

module.exports = { callGeminiJson, callGeminiText, callOnce, errToUserMsg };
