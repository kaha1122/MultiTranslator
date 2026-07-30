// ── 성인 에로물 문맥 판정 (Gemini) ──────────────────────────────────────────
// 규칙(lib/adultRules.js)이 못 잡는 것을 잡는 최종 판정자. **신작 전용** — 하루 수십 건이라
// 작품당 1회 호출이 비용상 무의미한 수준이고, 대량 백필에는 쓰지 않는다(그건 규칙+사람 몫).
//
// 왜 필요한가 (2026-07-30 실측)
//   사람이 성인물로 판정해 삭제한 2,496편의 제목을 현행 어휘 규칙에 돌려보니 **15%만 걸렸다.**
//   못 잡는 85%가 이런 것들이다:
//     「아내의 질문」「옆집 여자」「구멍 친구」「믿어줘, 오빠」「온 가족을 먹여 살리다」
//     「중독: 위층 여자」「그의 오일 마사지」「세탁하는 여자」「첫 경험의 날」
//   전부 완곡어라 문자열 매칭으로는 원리적으로 못 잡는다.
//
// ⚠ 그리고 제목만으로는 사람도 못 맞힌다 — 「진짜 사나이」「내 가족처럼」「생 로랑」「에피소드」가
//   전부 실제 성인물 판정분인데, 「진짜 사나이」는 동명의 MBC 예능이 있다. 그래서 이 판정기는
//   **줄거리·장르·러닝타임·등급·제작사·평점수를 함께** 넣고, 부족하면 unsure를 내게 한다.
//
// ⚠ video:true(direct-to-video)를 차단 근거로 쓰지 않는 이유 — 2026-07-30에 그렇게 했다가
//   BTS·SMTOWN·ITZY·임영웅 공연 실황 645편이 함께 숨겨졌다. K-Contents 앱에서 그건 핵심 자산이다.
//   유통 형태는 이제 프롬프트의 **정황 힌트**로만 들어간다.
const { callGeminiText, callOnce } = require('../utils/geminiCall');
const { FALLBACK_MODEL } = require('../config/gemini');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// 프롬프트는 영어로 보낸다(사용자 지시 2026-07-30). 판정 대상은 한국 콘텐츠지만, 지시문은
// 영어가 모델의 지시 준수도가 높고 토큰도 적다. 판정 근거(reason)만 한국어로 받는다 — 검수 화면에
// 그대로 뜨기 때문.
const SYSTEM = [
    'You are a content classifier for a Korean-entertainment catalog app.',
    'Decide whether the given title is ADULT EROTIC CONTENT.',
    'This decision feeds an app-store age-rating policy, so both careless blocking and careless approval are costly.',
    '',
    '[What counts as "adult"]',
    'Commercial video whose PRIMARY purpose is sexual arousal: softcore erotica, adult erotic drama,',
    'straight-to-video pornographic-adjacent releases.',
    '',
    '[What is NOT adult — must be "clean"]',
    '- Narrative films that depict sex but have clear dramatic or artistic intent.',
    '  Real examples from this catalog: "아가씨"(The Handmaiden), "하녀", "섬", "나쁜 남자", "사마리아", "뫼비우스", "씨받이".',
    '- Titles rated 19+ because of violence, horror or crime rather than sex.',
    '- K-pop concert films, showcases, tour documentaries, fan documentaries',
    '  (e.g. BTS / SMTOWN / ITZY / MAMAMOO / aespa / 임영웅 concert releases).',
    '- General documentaries, educational programs, children\'s content, variety shows.',
    'A Korean 19+ rating BY ITSELF is never sufficient evidence — ordinary commercial films get it too.',
    '',
    '[How to judge]',
    '1. NEVER decide from the title alone.',
    '   Adult titles here are usually euphemistic ("아내의 질문", "옆집 여자", "믿어줘, 오빠"),',
    '   while some adult releases have completely ordinary titles ("진짜 사나이") that collide with',
    '   well-known mainstream shows of the same name.',
    '2. Weigh the overview, genres, runtime, production companies, vote count and distribution format TOGETHER.',
    '3. Circumstantial signals — none is sufficient alone, but they compound:',
    '   - Overview missing or one line describing only a sexual relationship setup',
    '   - Runtime 60-80 min, no production company, no cast, vote count 0-3',
    '   - Family/workplace relation words (sister-in-law, stepmother, cousin, boss) combined with situational innuendo',
    '   - Numbered sequels of the same erotic series (e.g. "애마부인 12")',
    '   - Straight-to-video release with no theatrical history',
    '4. If the available information is not enough to decide, you MUST answer "unsure".',
    '   Do NOT guess "adult". "unsure" is routed to a human reviewer, so it is the safe answer.',
    '',
    '[Output] Return ONLY this JSON object. No markdown, no commentary.',
    '{"verdict":"adult|clean|unsure","confidence":0.0-1.0,"reason":"<one sentence IN KOREAN stating the basis>","signals":["<field names you relied on>"]}',
].join('\n');

const cut = (s, n) => (s == null ? '' : String(s).slice(0, n));

// TMDB 상세 → 프롬프트 입력 블록. 없는 필드는 "(none)"으로 명시한다 —
// 빈칸으로 두면 모델이 "정보가 없다"는 사실 자체를 신호로 못 쓴다(성인물은 메타가 텅 비어 있다).
function buildInput(media, detail, extra = {}) {
    const d = detail || {};
    const none = (v) => (v && String(v).length ? v : '(none)');
    const kws = (d.keywords?.keywords || d.keywords?.results || []).map((k) => k?.name).filter(Boolean);
    let certs = [];
    if (media === 'movie') {
        const kr = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'KR');
        certs = (kr?.release_dates || []).map((x) => x.certification).filter(Boolean);
    } else {
        const cr = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'KR');
        if (cr?.rating) certs = [cr.rating];
    }
    return [
        `media type: ${media}`,
        `original title: ${none(d.original_title || d.original_name)}`,
        `korean title: ${none(extra.koTitle)}`,
        `english/display title: ${none(d.title || d.name)}`,
        `overview: ${none(cut(d.overview || extra.overview, 700))}`,
        `genres: ${none((d.genres || []).map((g) => g.name).join(', '))}`,
        `runtime(min): ${none(d.runtime || (d.episode_run_time || [])[0])}`,
        `korea certification: ${none(certs.join('/'))}`,
        `tmdb keywords: ${none(kws.join(', '))}`,
        `production companies: ${none((d.production_companies || []).map((c) => c.name).join(', '))}`,
        `release date: ${none(d.release_date || d.first_air_date)}`,
        `straight-to-video flag: ${d.video === true ? 'true' : 'false'}`,
        `vote count: ${Number(d.vote_count || 0)} · popularity: ${Number(d.popularity || 0).toFixed(2)}`,
        ...(media === 'tv' ? [`seasons: ${none(d.number_of_seasons)} · episodes: ${none(d.number_of_episodes)}`] : []),
    ].join('\n');
}

function parseFirstJsonObject(text) {
    const s = String(text || '');
    const i = s.indexOf('{');
    if (i < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let k = i; k < s.length; k++) {
        const c = s[k];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, k + 1)); } catch { return null; } }
    }
    return null;
}

const VERDICTS = new Set(['adult', 'clean', 'unsure']);

// 판정. 실패는 throw하지 않고 null을 반환한다 — 호출측이 **규칙 판정으로 폴백**해야 하며,
// "AI를 못 불렀다"가 "노출해도 된다"로 해석되면 안 된다(fail-open 금지).
async function judgeAdultAI(media, detail, extra = {}) {
    if (!GEMINI_API_KEY) return null;
    const prompt = `${SYSTEM}\n\n[Title data]\n${buildInput(media, detail, extra)}`;
    // temperature 0 — 분류 작업이라 창의성이 필요 없고, 같은 입력에 같은 답이 나와야 재현·감사가 된다.
    const genConfig = { temperature: 0, topP: 0.8, responseMimeType: 'application/json' };
    let raw = null;
    try {
        const r = await callGeminiText(prompt, GEMINI_API_KEY, { label: 'adult-judge', genConfig });
        raw = r.error ? null : r.text;
    } catch { raw = null; }
    let out = raw ? parseFirstJsonObject(raw) : null;
    // 안전필터 차단(PROHIBITED_CONTENT)은 HTTP 200 + 빈 텍스트로 온다. 성인물 판정은 그 소재 자체가
    // 필터에 걸리기 쉬워 폴백 모델 1회를 반드시 둔다 — 여기서 포기하면 진짜 성인물일수록 판정이 빈다.
    if (!out) {
        try {
            const fb = await callOnce(FALLBACK_MODEL, prompt, GEMINI_API_KEY, genConfig);
            if (!fb.error) out = parseFirstJsonObject(fb.raw);
        } catch { /* 폴백도 실패 → null */ }
    }
    if (!out || !VERDICTS.has(out.verdict)) return null;
    return {
        verdict: out.verdict,
        confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
        reason: cut(out.reason, 300),
        signals: Array.isArray(out.signals) ? out.signals.slice(0, 8).map((s) => cut(s, 40)) : [],
    };
}

module.exports = { judgeAdultAI, buildInput, SYSTEM };
