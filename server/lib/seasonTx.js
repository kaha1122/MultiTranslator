// ── 회차 줄거리 read-through 번역 (2026-08-27, K-DramaAnyLang 에피소드 탭) ──────
// TMDB는 회차(overview) 번역이 기여자 등록에 의존해 언어별로 구멍이 크다
// (실측 김부장: ko/en/es 10/10, id 4/10, vi·ar·ja 0/10 — 메인 타깃이 정확히 결측 지대).
// 전 카탈로그 사전번역은 작품 메타의 10배 규모(25k×평균 10+회차×10언어)라 하지 않는다.
// 대신 UGC 번역 캐시와 같은 on-demand read-through:
//   어떤 언어의 사용자가 그 작품 에피소드 탭을 처음 열 때(= /api/tmdb/season 호출)
//   ① 그 언어 TMDB 응답의 결측 회차 확인 → ② Firestore 캐시 병합 → ③ 남은 결측을
//   ko 피벗(없으면 en)에서 Gemini 1회 묶음 번역 → 캐시 저장(영구) → 병합 응답.
// 사용자 버튼·포인트와 무관한 메타 번역 계층(무료). 모든 실패는 fail-open(미번역 반환).
// allowTx=false(크롤러/미들웨어 ?noTx=1)는 Gemini 미호출 — 기번역 캐시분만 병합해
// 봇 크롤이 번역 비용을 유발하지 않게 한다(비용은 실사용자 조회만 발생).
//
// Firestore: titles/{id}/media/season{n}_{lang} { eps: { "<epNum>": "<번역 줄거리>" }, updatedAt }
//   — 회차가 늘면 다음 조회가 결측분만 증분 번역해 같은 문서에 merge(멱등 누적).
//   클라 규칙(titles/{id}/media 공개 읽기)상 노출돼도 무해(공개 콘텐츠).
const { kcultureDb } = require('../config/firebaseKculture');
const { callGeminiText, callOnce } = require('../utils/geminiCall');
const { FALLBACK_MODEL } = require('../config/gemini');
const { LANG_NAMES } = require('../config/langGuide');
const { PRIMARY_CONTENT_LANG } = require('../config/contentLang');
const { parseFirstJsonObject } = require('./tmdbBackfill');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 번역 대상 언어 = UI 로케일 중 ko(원어)·en(TMDB가 최선) 제외 10개. 그 외 코드는 미개입.
const TX_LANGS = new Set(['ja', 'zh-CN', 'vi', 'fr', 'de', 'es', 'ru', 'pt-BR', 'id', 'ar']);
const CHUNK = 50;          // Gemini 1회당 회차 상한(장편 일일극 방어 — 프롬프트/응답 길이 안전선)
const MAX_TX_PER_REQ = 100; // 요청당 번역 총량 상한(그 이상은 다음 조회가 증분 처리)

const inflight = new Map(); // `${id}:${n}:${lang}` → Promise — 동시 첫 방문자의 중복 Gemini 방지

const nameOf = (c) => LANG_NAMES[c] || c;

async function geminiEpisodeBatch(srcLangCode, targetLang, srcMap) {
    const prompt = [
        `You are a professional translator localizing Korean TV episode synopses for a multilingual app.`,
        `Translate EACH episode synopsis below from ${nameOf(srcLangCode)} into ${nameOf(targetLang)} ("${targetLang}").`,
        `- Natural and idiomatic, faithfully preserving meaning, tone and nuance. Each value 100% in ${nameOf(targetLang)}.`,
        `- Transliterate ALL proper nouns (person/character names) into the target script or romanization — never leave ${nameOf(PRIMARY_CONTENT_LANG)} characters.`,
        `- Do not add information, notes, or commentary. NEVER echo the source language — that is a FAILURE.`,
        `Return ONLY one JSON object with the SAME keys (episode numbers) mapping to the translated synopses. No markdown.`,
        ``,
        `SOURCE (${nameOf(srcLangCode)}):`,
        JSON.stringify(srcMap),
    ].join('\n');
    const genConfig = { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' };
    const r = await callGeminiText(prompt, GEMINI_API_KEY, { label: 'season-tx', genConfig });
    let parsed = r.error ? null : parseFirstJsonObject(r.text);
    if (!parsed) {
        // 안전 필터 차단은 HTTP 200 + 빈 텍스트로 옴 → 폴백 모델 1회(geminiMulti와 동일 대응)
        const fb = await callOnce(FALLBACK_MODEL, prompt, GEMINI_API_KEY, genConfig);
        parsed = fb.error ? null : parseFirstJsonObject(fb.raw);
    }
    if (!parsed) return {};
    // 키·값 검증: 요청한 회차만, 비어있지 않은 문자열만 채택
    const out = {};
    for (const k of Object.keys(srcMap)) {
        const v = parsed[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
}

// episodes: 라우트가 만든 축약 배열(episode_number·overview 포함). 변경이 있으면 새 배열, 없으면 null.
// fetchPivot: (tmdbLang) => Promise<원본 episodes[]> — 피벗(ko→en) 줄거리 조달용(라우트의 tmdbFetch 위임).
async function fillSeasonOverviews({ id, season, clientLang, episodes, allowTx = true, fetchPivot }) {
    if (!TX_LANGS.has(clientLang)) return null;
    const missing = (episodes || []).filter((e) => !e.overview || !String(e.overview).trim());
    if (!missing.length) return null;
    if (!kcultureDb) return null;

    const docRef = kcultureDb.doc(`titles/${id}/media/season${season}_${clientLang}`);
    let cached = {};
    try { const s = await docRef.get(); cached = (s.exists && s.data().eps) || {}; }
    catch (e) { console.warn('[seasonTx] 캐시 read 실패(무시):', e.message); }

    const merged = episodes.map((e) => (
        (!e.overview || !String(e.overview).trim()) && cached[String(e.episode_number)]
            ? { ...e, overview: cached[String(e.episode_number)] }
            : e
    ));
    let still = merged.filter((e) => !e.overview || !String(e.overview).trim());
    const cacheHit = still.length < missing.length;
    if (!still.length || !allowTx || !GEMINI_API_KEY) return cacheHit ? merged : null;

    // ── Gemini 증분 번역(동시 요청 dedup) ──
    const flightKey = `${id}:${season}:${clientLang}`;
    if (!inflight.has(flightKey)) {
        inflight.set(flightKey, (async () => {
            try {
                // 피벗 조달: ko 우선, ko도 빈 회차만 en 보충(tmdbBackfill V2와 동일 서열)
                const pivotKo = await fetchPivot(`${PRIMARY_CONTENT_LANG}-KR`).catch(() => []);
                const koMap = new Map(pivotKo.map((e) => [e.episode_number, (e.overview || '').trim()]));
                const wantNums = still.slice(0, MAX_TX_PER_REQ).map((e) => e.episode_number);
                const srcKo = {}, needEn = [];
                for (const n of wantNums) {
                    if (koMap.get(n)) srcKo[String(n)] = koMap.get(n);
                    else needEn.push(n);
                }
                const srcEn = {};
                if (needEn.length) {
                    const pivotEn = await fetchPivot('en-US').catch(() => []);
                    const enMap = new Map(pivotEn.map((e) => [e.episode_number, (e.overview || '').trim()]));
                    for (const n of needEn) if (enMap.get(n)) srcEn[String(n)] = enMap.get(n);
                }
                const translated = {};
                for (const [srcLang, srcAll] of [[PRIMARY_CONTENT_LANG, srcKo], ['en', srcEn]]) {
                    const keys = Object.keys(srcAll);
                    for (let i = 0; i < keys.length; i += CHUNK) {
                        const chunk = Object.fromEntries(keys.slice(i, i + CHUNK).map((k) => [k, srcAll[k]]));
                        Object.assign(translated, await geminiEpisodeBatch(srcLang, clientLang, chunk));
                    }
                }
                if (Object.keys(translated).length) {
                    await docRef.set({ eps: translated, updatedAt: new Date() }, { merge: true });
                    console.log(`[seasonTx] ${id} S${season} ${clientLang}: ${Object.keys(translated).length}개 번역·저장`);
                }
                return translated;
            } finally { inflight.delete(flightKey); }
        })());
    }
    let fresh = {};
    try { fresh = await inflight.get(flightKey); } catch (e) { console.warn('[seasonTx] 번역 실패(무시):', e.message); }

    if (!Object.keys(fresh).length) return cacheHit ? merged : null;
    return merged.map((e) => (
        (!e.overview || !String(e.overview).trim()) && fresh[String(e.episode_number)]
            ? { ...e, overview: fresh[String(e.episode_number)] }
            : e
    ));
}

module.exports = { fillSeasonOverviews, TX_LANGS };
