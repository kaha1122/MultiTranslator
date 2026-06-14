#!/usr/bin/env node
/**
 * seed-vocab.js — Phase 2 배치 pre-seed (오프라인 수동 실행)
 *
 * 배포된 서버 API를 "첫 유저"로 호출해 vocabSeed/passageSeed를 write-through로 채우고,
 * 각 단어/예문/지문/문장 TTS를 Azure durable(Storage)로 pre-render한다.
 *   → 서버 prompt 로직 재사용(중복 0). 첫 실유저도 즉시 seed + 저장된 음성을 받음.
 *
 * 사용법:
 *   SEED_ID_TOKEN=<Firebase ID 토큰> \
 *   SERVER_URL=https://<render>.onrender.com \
 *   SOURCE_LANG=ko HEAD_LANGS=en,ja,zh-CN,vi LEVEL=basic VOCAB_PAGES=2 PASSAGES=1 \
 *   node scripts/seed-vocab.js
 *
 *   - SEED_ID_TOKEN: 로그인 세션의 Firebase ID 토큰(앱 devtools에서 획득). 엔드포인트 인증용. (필수)
 *   - idempotent: 이미 채워진 seed는 source:'seed'로 반환되어 Gemini 재호출 없음. TTS는 durable 해시로 dedup.
 *
 * 주의: 비밀키 미사용(ID 토큰만). 절대 토큰을 커밋하지 말 것.
 */
'use strict';

const SERVER_URL = (process.env.SERVER_URL || '').replace(/\/$/, '');
const ID_TOKEN = process.env.SEED_ID_TOKEN || '';
const SOURCE_LANG = process.env.SOURCE_LANG || 'ko';
const HEAD_LANGS = (process.env.HEAD_LANGS || 'en').split(',').map(s => s.trim()).filter(Boolean);
const LEVEL = process.env.LEVEL || 'basic';
const VOCAB_PAGES = Math.max(1, parseInt(process.env.VOCAB_PAGES || '2', 10)); // 5*pages 단어
const PASSAGES = Math.max(0, parseInt(process.env.PASSAGES || '1', 10));
const PASSAGE_TYPES = (process.env.PASSAGE_TYPES || 'essay').split(',').map(s => s.trim());

// Unit 1 (일상생활) 10토픽
const UNIT1_TOPICS = ['morning', 'cooking', 'cleaning', 'shopping_daily', 'weather', 'cafe', 'exercise', 'hobby', 'pet', 'fashion'];
// TOPICS env로 일부만 실행 가능(검증용). SKIP_TTS=1이면 TTS pre-render 생략(레이트리밋 회피·seed 텍스트만).
const TOPICS = (process.env.TOPICS ? process.env.TOPICS.split(',').map(s => s.trim()).filter(Boolean) : UNIT1_TOPICS);
const SKIP_TTS = process.env.SKIP_TTS === '1';

if (!SERVER_URL || !ID_TOKEN) {
    console.error('SERVER_URL and SEED_ID_TOKEN env are required.');
    process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ID_TOKEN}` };

async function post(path, body) {
    const res = await fetch(`${SERVER_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text().catch(() => '')}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.arrayBuffer();
}

// Azure durable TTS pre-render (응답 본문 무시 — Storage 저장이 목적)
async function warmTts(text, langCode) {
    if (SKIP_TTS) return;
    if (!text || !text.trim()) return;
    try { await post('/api/azure-tts', { text, langCode, durable: true }); }
    catch (e) { console.warn('  tts warm fail:', e.message); }
    await sleep(150);
}

async function seedVocab(targetLang, topic) {
    for (let page = 0; page < VOCAB_PAGES; page++) {
        const offset = page * 5;
        let data;
        try {
            data = await post('/api/vocab-words', { topic, level: LEVEL, targetLang, sourceLang: SOURCE_LANG, isCustom: false, offset });
        } catch (e) { console.warn(`  vocab ${topic}@${offset} fail:`, e.message); break; }
        const words = Array.isArray(data?.words) ? data.words : [];
        console.log(`  vocab ${targetLang}/${topic} offset=${offset} (${data?.source}) ${words.length} words`);
        for (const w of words) { await warmTts(w.word, targetLang); await warmTts(w.example, targetLang); }
        await sleep(300);
    }
}

async function seedPassages(targetLang, topic) {
    for (const type of PASSAGE_TYPES) {
        for (let p = 0; p < PASSAGES; p++) {
            let data;
            try {
                data = await post('/api/listening-passage', { topic, type, level: LEVEL, targetLang, sourceLang: SOURCE_LANG, isCustom: false, offset: p });
            } catch (e) { console.warn(`  passage ${topic}/${type}@${p} fail:`, e.message); break; }
            console.log(`  passage ${targetLang}/${topic}/${type} offset=${p} (${data?.source})`);
            await warmTts(data?.passage, targetLang);
            for (const s of (Array.isArray(data?.sentences) ? data.sentences : [])) await warmTts(s.text, targetLang);
            await sleep(400);
        }
    }
}

(async () => {
    console.log(`[seed] server=${SERVER_URL} src=${SOURCE_LANG} langs=${HEAD_LANGS.join(',')} level=${LEVEL}`);
    for (const lang of HEAD_LANGS) {
        for (const topic of TOPICS) {
            console.log(`== ${lang} / ${topic} ==`);
            await seedVocab(lang, topic);
            if (PASSAGES > 0) await seedPassages(lang, topic);
        }
    }
    console.log('[seed] done.');
})().catch(e => { console.error('[seed] fatal:', e); process.exit(1); });
