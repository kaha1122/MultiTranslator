// ── K-DramaAnyLang "Dari" AI 큐레이터 게시 코어 (CLI 스크립트 + /api/curation 라우트 공용) ──
// 방영작 회차 토론 스레드(titles/{id}/discussion)와 큐레이터 리뷰 글(posts)을 kculture Firestore에
// 게시한다. 문서 스키마는 클라이언트(d:\KCulture src/lib/discussion.js createComment /
// src/lib/community.js createPost)가 만드는 문서와 필드 호환 — 클라 렌더러가 그대로 읽는다.
//
// 원칙:
//   - 정보 블록(방송사·편성·출연 등)은 전부 TMDB 값 그대로(LLM 미개입) — 환각 원천 차단.
//   - Gemini는 발제 본문만 생성(근거를 제목·장르·시놉시스로 제한 → 회차 스포일러 구조적 차단).
//   - 번역 시드는 /api/community/translate 캐시 문서와 동일 형태({ body, translatedAt })로 저장
//     → 독자의 "내 언어로 번역" 요청이 서버 read-through에서 즉시 CACHE-HIT(Gemini 0, 무과금).
//   - 멱등: 스레드 doc id가 결정적(dari_s{season}e{maxEp}) — 존재 시 skip하고 기존 반환.
const crypto = require('crypto');
const { callGeminiText } = require('../utils/geminiCall');
const { kcultureAuth, kcultureDb } = require('../config/firebaseKculture');
const { LANG_NAMES } = require('../config/langGuide');
const { TARGETS } = require('./tmdbBackfill'); // 번역 대상 언어 로스터(SSOT) — 언어 추가 시 자동 동기화

const TMDB_BASE = 'https://api.themoviedb.org/3';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ── Dari 번역 시드 전용 모델(2026-08-29) ─────────────────────────────────────────────
// 기본은 전역 PRIMARY(2.5-flash-lite)를 그대로 쓴다(미지정 = 종전 동작). Render env
// DARI_TX_MODEL_ID 로 승격 가능 — KDL UGC 번역이 `KDL_TX_MODEL`로 3.1-flash-lite를 쓰는 것과 같은 발상
// (베트남어 무성조 사고: 2.5-lite는 어떤 프롬프트로도 0/4, 3.1-lite는 4/4). 전량 검수에서 34편 전부
// 2.5-lite로 시드된 것이 의미 오역 297건의 공통 배경으로 확인됐다.
const DARI_TX_MODEL = process.env.DARI_TX_MODEL_ID || null;

const DARI_EMAIL = 'dari@kdramaanylang.com';
const DARI_NAME = 'Dari';
const DARI_SIGNATURE = '— Dari, your AI curator 🌉';

// ── 꼬리 2줄(서명 + Note) 고정 테이블 — 2026-08-29 전량 검수에서 도입 ────────────────
// 내용이 매 글 동일한데도 게시마다 12개 언어로 재번역돼 왔고, 그래서 매번 다르게 틀렸다:
//   · Dari가 음역됨(ko 다리 / ja ダリ / ru Дари / ar داري) — 브랜드명 소실, 34편 중 거의 전편
//   · Note 줄이 통째로 사라짐(2026-08-26 5개 언어) / 서명만 영어 원문으로 남음
// 프롬프트 지시를 늘리는 대신 **번역 대상에서 아예 제외**하고 검증된 문구를 결정적으로 주입한다
// (사용자 원칙 2026-08-29 — 지시가 컨텍스트에 밀리면 결정적 수단을 찾을 것).
// 문구 출처: QA 완료된 2026-08-26·28·29 게시분에서 언어별 최빈값을 채택.
const TAIL_BY_LANG = {
    en: { sig: DARI_SIGNATURE, note: "Note: this is Dari's AI perspective, separate from user ratings." },
    ko: { sig: '— Dari, 당신의 AI 큐레이터 🌉', note: '참고: 이것은 Dari의 AI 관점이며 사용자 평가와는 별개입니다.' },
    ja: { sig: '— Dari、あなたのAIキュレーター 🌉', note: '注：これはDariのAIとしての見解であり、ユーザー評価とは別です。' },
    'zh-CN': { sig: '— Dari, 你的AI策展人 🌉', note: '注：这是Dari的AI视角，与用户评分无关。' },
    vi: { sig: '— Dari, AI curator của bạn 🌉', note: 'Lưu ý: đây là góc nhìn AI của Dari, tách biệt với đánh giá của người dùng.' },
    fr: { sig: '— Dari, votre curateur IA 🌉', note: 'Note : ceci est la perspective IA de Dari, distincte des évaluations des utilisateurs.' },
    de: { sig: '— Dari, deine KI-Kuratorin 🌉', note: 'Hinweis: Dies ist die KI-Perspektive von Dari, getrennt von Benutzerbewertungen.' },
    es: { sig: '— Dari, tu curadora de IA 🌉', note: 'Nota: esta es la perspectiva de IA de Dari, separada de las calificaciones de los usuarios.' },
    ru: { sig: '— Dari, ваш ИИ-куратор 🌉', note: 'Примечание: это ИИ-взгляд Dari, отдельный от пользовательских оценок.' },
    'pt-BR': { sig: '— Dari, sua curadora de IA 🌉', note: 'Nota: esta é a perspectiva de IA de Dari, separada das avaliações dos usuários.' },
    id: { sig: '— Dari, kurator AI Anda 🌉', note: 'Catatan: ini adalah perspektif AI Dari, terpisah dari peringkat pengguna.' },
    ar: { sig: '— Dari، منسقة الذكاء الاصطناعي الخاصة بك 🌉', note: 'ملاحظة: هذا هو منظور Dari للذكاء الاصطناعي، منفصل عن تقييمات المستخدمين.' },
};

// 본문에서 꼬리(서명 줄부터 끝까지)를 잘라낸다. 서명이 없으면 hasSig=false로 원문 그대로.
// 서명 표기 흔들림(em dash/hyphen, 공백)을 허용하되 "Dari," 직후 형태만 인정한다.
// ⚠ **마지막** 서명 줄을 기준으로 자른다 — 본문 중간에 같은 패턴이 나오면(인용 등) 앞쪽에서 잘라
//   뒷 내용을 통째로 날린다. 첫 매치를 쓰던 초판의 결함(2026-08-29 반영 직전 발견).
// ⚠ 쉼표는 언어별로 다르다 — ASCII `,` / 아랍 `،` / 일본 `、` / 전각 `，`. ASCII만 인정하면 ja 서명을
//   못 잘라 고정 꼬리가 **덧붙어 중복**된다(2026-08-29 P0 반영 중 5편에서 실제 발생, 문단중복 검출로 포착).
const SIG_LINE_RE = /^[ \t]*[—–-][ \t]*Dari[,،、，]/;
// 리뷰 템플릿 섹션 표식 — 번역 완결성 판정에 쓴다(원문에 있으면 번역에도 있어야 한다).
const SECTION_MARKS = ['📌', '🌉', '✅', '⚠', '🎯', '💬'];
function splitTail(body) {
    const src = String(body || '');
    const lines = src.split('\n');
    let idx = -1;
    for (let i = lines.length - 1; i >= 0; i--) { if (SIG_LINE_RE.test(lines[i])) { idx = i; break; } }
    if (idx < 0) return { head: src, hasSig: false, hasNote: false };
    return {
        head: lines.slice(0, idx).join('\n').replace(/\s+$/, ''),
        hasSig: true,
        hasNote: lines.slice(idx + 1).some((l) => /^\s*Note\s*:/i.test(l)),
    };
}

// ── Dari 음역 스크럽(결정적) — 헤더 "🌉 Dari's take"가 언어별로 음역되는 것을 되돌린다 ──
// ⚠ ko의 '다리'는 "기다리는"·"다리를 건너"처럼 정상 어휘와 충돌하므로 **Dari 문맥에서만** 치환한다
//   (2026-08-29 검수에서 단어 경계 없는 매칭이 대량 오탐을 낸 것을 확인).
const DARI_TRANSLIT = {
    ko: [/다리(?=의\s*(?:생각|관점|시선|견해|AI))/g, /(?<=[—–-]\s*)다리(?=[,،])/g],
    ja: [/ダリ/g],
    'zh-CN': [/达里|達里/g],
    ru: [/Дари(?![а-яё])/g],
    ar: [/داري/g],
};
// 한글 + 로마자/타깃문자 주석 패턴 정리 — 모델이 고유명사를 "의병 (Righteous Army)"처럼
// 한글과 함께 쓰는 일이 있다. ko 외 독자에게 한글은 읽히지 않고 괄호 안이 이미 같은 뜻을 담고
// 있으므로 한글쪽을 떼고 주석만 남긴다(주석이 비한글일 때만 — 아니면 손대지 않는다).
function scrubHangulGloss(text, code) {
    if (code === 'ko') return String(text || '');
    return String(text || '').replace(/[가-힣][가-힣\s]*\s*\(([^()]{2,60})\)/g,
        (m, gloss) => (/[A-Za-zЀ-ӿ؀-ۿ぀-ヿ一-鿿]/.test(gloss) && !/[가-힣]/.test(gloss) ? gloss : m));
}

function scrubDariTranslit(text, code) {
    let out = String(text || '');
    for (const re of DARI_TRANSLIT[code] || []) out = out.replace(re, 'Dari');
    return out;
}

// 꼬리가 여러 겹 쌓인 경우(중복 부착 사고 복구)까지 전부 제거한다 — splitTail은 한 겹만 벗긴다.
function stripAllTails(text) {
    let head = String(text || '');
    for (let i = 0; i < 4; i++) {
        const s = splitTail(head);
        if (!s.hasSig) break;
        head = s.head;
    }
    return head;
}

// 번역 결과에 고정 꼬리를 붙인다 — 모델이 만든 꼬리는 잘라내고 테이블 값으로 교체.
function applyFixedTail(text, code, hasSig, hasNote) {
    // ⚠ 순서 중요 — 스크럽을 먼저 한다. 모델이 서명까지 음역하면("— 다리, …") SIG_LINE_RE가 못 잡아
    //   꼬리가 제거되지 않고 고정 꼬리가 덧붙어 **중복**된다(회귀 테스트 [2] '꼬리 중복 없음').
    const head = stripAllTails(scrubHangulGloss(scrubDariTranslit(text, code), code));
    if (!hasSig) return head;
    const t = TAIL_BY_LANG[code] || TAIL_BY_LANG.en;
    return `${head}\n\n${t.sig}${hasNote ? `\n${t.note}` : ''}`;
}

// ISO 코드 → 정식 언어명(Gemini가 코드보다 명칭에 정확). 지역코드는 베이스로 폴백(tmdbBackfill과 동일).
const nameOf = (code) => LANG_NAMES[code] || LANG_NAMES[String(code || '').split('-')[0]] || code;

// 번역 시드 대상 = 메타 사전번역 로스터(en 제외 11개: ko,ja,zh-CN,vi,fr,de,es,ru,pt-BR,id,ar).
const SEED_LANGS = TARGETS.map((t) => t.code);

// flash-lite가 JSON 뒤에 중복 블록을 붙이는 글리치 대응: 첫 번째 완결 {…} 객체만 추출(tmdbBackfill과 동일).
function parseFirstJsonObject(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            if (--depth === 0) {
                try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
            }
        }
    }
    return null;
}

// 파싱 실패 구제 — flash-lite가 값 문자열을 닫은 뒤 마지막 조각을 중복 출력해 `}` 앞에 잔여
// 텍스트가 끼면(2026-07-22 ar 시드 실측) 객체 전체 JSON.parse는 실패하지만 `"key": "값"` 리터럴
// 자체는 온전하다 → 키별로 문자열 리터럴만 직접 추출해 살린다.
function salvageStringValue(text, key) {
    if (!text) return null;
    const kIdx = text.indexOf(`"${key}"`);
    if (kIdx < 0) return null;
    const colon = text.indexOf(':', kIdx + key.length + 2);
    if (colon < 0) return null;
    const q = text.indexOf('"', colon);
    if (q < 0) return null;
    let esc = false;
    for (let i = q + 1; i < text.length; i++) {
        const c = text[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') {
            try { return JSON.parse(text.slice(q, i + 1)); } catch { return null; }
        }
    }
    return null;
}

// 번역 응답 공통 수확: 정상 파스 → 키별 구제 폴백 순서로 요청 코드 전부 시도.
function harvestCodes(text, codes) {
    const parsed = parseFirstJsonObject(text) || {};
    const out = {};
    for (const c of codes) {
        let v = (typeof parsed[c] === 'string' && parsed[c].trim()) ? parsed[c] : salvageStringValue(text, c);
        if (typeof v === 'string' && v.trim()) out[c] = v.trim();
    }
    return out;
}

async function tmdb(path, params = {}) {
    const key = process.env.TMDB_API_KEY || '';
    if (!key) throw new Error('TMDB_API_KEY not set');
    const u = new URLSearchParams({ api_key: key, ...params });
    const r = await fetch(`${TMDB_BASE}${path}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
    return r.json();
}

// ── Dari 계정 보장 (멱등) ────────────────────────────────────────────────────
// kculture Auth에 Dari 계정이 없으면 생성(랜덤 강력 비밀번호 — 로그인 용도 아님, Auth uid 확보용),
// users/{uid} 프로필 문서를 생성/보정. 반환: uid. 프로세스 내 1회만 실제 수행(memoize).
let dariUidPromise = null;
let dariPhotoURL = null; // users/{uid}.photoURL — 게시물 denormalize용(scripts/dari-set-avatar.js가 설정)
function ensureDariAccount() {
    if (dariUidPromise) return dariUidPromise;
    dariUidPromise = (async () => {
        if (!kcultureAuth) throw new Error('kcultureAuth 없음 — kculture admin 앱 초기화 실패');
        if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
        let user = null;
        try {
            user = await kcultureAuth.getUserByEmail(DARI_EMAIL);
        } catch (e) {
            if (e.code !== 'auth/user-not-found') throw e;
        }
        if (!user) {
            user = await kcultureAuth.createUser({
                email: DARI_EMAIL,
                emailVerified: true,
                password: crypto.randomBytes(32).toString('base64url'), // 로그인 안 함 — 무작위 봉인
                displayName: DARI_NAME,
            });
            console.log(`[Dari] Auth 계정 생성: uid=${user.uid}`);
        }
        // 프로필 문서 생성/보정 (merge — 기존 값 보존, 누락 필드만 채움)
        const ref = kcultureDb.doc(`users/${user.uid}`);
        const snap = await ref.get();
        const existing = snap.exists ? snap.data() : {};
        dariPhotoURL = existing.photoURL || null;
        await ref.set({
            displayName: DARI_NAME,
            curator: true,
            lang: 'en',
            photoURL: existing.photoURL || null,
            points: existing.points != null ? existing.points : 0,
            lastFreeDate: existing.lastFreeDate || new Date().toISOString().slice(0, 10), // 오늘 UTC yyyy-mm-dd
            ...(snap.exists ? {} : { createdAt: new Date() }),
        }, { merge: true });
        console.log(`[Dari] 계정 준비 완료: uid=${user.uid}`);
        return user.uid;
    })();
    dariUidPromise.catch(() => { dariUidPromise = null; }); // 실패 시 다음 호출이 재시도
    return dariUidPromise;
}

// ── TMDB 정보 블록 (전부 TMDB 값 그대로 — LLM 미개입) ────────────────────────
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (isoDate) => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : WEEKDAY_EN[d.getUTCDay()];
};

function topProviders(wp) {
    const out = [];
    for (const region of ['KR', 'US']) {
        const flat = wp?.results?.[region]?.flatrate || [];
        for (const p of flat.slice(0, 2)) {
            if (p?.provider_name && !out.includes(p.provider_name)) out.push(p.provider_name);
        }
    }
    return out;
}

async function fetchShowInfo(tmdbId, season) {
    const detail = await tmdb(`/tv/${tmdbId}`, {
        language: 'en-US',
        append_to_response: 'credits,watch/providers',
    });
    let seasonDetail = null;
    try { seasonDetail = await tmdb(`/tv/${tmdbId}/season/${season}`, { language: 'en-US' }); }
    catch { /* 시즌 상세 실패 → 회차 방영일 없이 진행(정보 블록만 얇아짐) */ }
    const seasonEps = seasonDetail?.episodes || [];
    const crew = detail.credits?.crew || [];
    const airDates = seasonEps.map((e) => e.air_date).filter(Boolean);
    const info = {
        network: detail.networks?.[0]?.name || null,
        premiereDate: detail.first_air_date || null,
        endDate: airDates.length ? airDates[airDates.length - 1] : null, // 시즌 마지막 회차 방영일
        weekdays: [...new Set(airDates.map(weekdayOf).filter(Boolean))],
        episodesTotal: detail.number_of_episodes || null,
        genres: (detail.genres || []).map((g) => g.name),
        providers: topProviders(detail['watch/providers']),
        director: crew.find((c) => c.job === 'Director')?.name || null,
        writer: detail.created_by?.[0]?.name || crew.find((c) => c.job === 'Writer')?.name || null,
        cast: (detail.credits?.cast || []).slice(0, 5).map((c) => ({ name: c.name, role: c.character || '' })),
        synopsis: detail.overview || '',
    };
    return { detail, seasonEps, info };
}

// 영화 정보 블록 — fetchShowInfo의 movie 변형(2026-08-04, 와일드 씽 사례로 영화 스레드 지원).
// info 필드는 ThreadScreen 렌더러와 호환(값 없는 행 숨김): network·episodesTotal 없음, runtimeMin 추가.
async function fetchMovieInfo(tmdbId) {
    const detail = await tmdb(`/movie/${tmdbId}`, {
        language: 'en-US',
        append_to_response: 'credits,watch/providers',
    });
    const crew = detail.credits?.crew || [];
    const info = {
        premiereDate: detail.release_date || null,
        runtimeMin: detail.runtime || null,
        genres: (detail.genres || []).map((g) => g.name),
        providers: topProviders(detail['watch/providers']),
        director: crew.find((c) => c.job === 'Director')?.name || null,
        writer: crew.find((c) => ['Writer', 'Screenplay'].includes(c.job))?.name || null,
        cast: (detail.credits?.cast || []).slice(0, 5).map((c) => ({ name: c.name, role: c.character || '' })),
        synopsis: detail.overview || '',
    };
    return { detail, info };
}

// ── 선공개 클립 (2026-08-19, KCulture DECISIONS.md §11) ─────────────────────
// 스레드 화면 썸네일+온디맨드 재생용. videoId만 저장(URL·썸네일 조립은 클라) —
// 발제 본문 밖 별도 필드라 번역 파이프라인과 무관(URL 변형 위험 0).
// 입력: 'videoId' 문자열 또는 { videoId, ep }. ep = 클립 대상 회차(라벨 표시용, 선택).
function normClip(clip) {
    if (!clip) return null;
    const videoId = typeof clip === 'string' ? clip : clip.videoId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) throw new Error(`clip.videoId: 유튜브 영상 id(11자) 형식이 아님: ${videoId}`);
    const ep = (typeof clip === 'object' && Number.isInteger(clip.ep) && clip.ep > 0) ? clip.ep : null;
    return { videoId, ...(ep ? { ep } : {}) };
}

// 선공개 클립을 작품 문서에도 미러(2026-08-27) — 앱 상세 '에피소드' 탭이 회차별 클립을 1 read로 조회.
// titles/{id}/media/clips { eps: { "s{season}e{ep}": videoId } } — set-merge라 스레드를 열 때마다
// 회차별로 누적된다(작품이 선공개 URL 카탈로그를 갖게 되는 지점). ep 미지정 클립은 스레드 상한 회차로 귀속.
// 루트 titles/{id}가 아닌 별도 소문서인 이유: 루트는 meta 백필로 수십~수백 KB인데 클라 SDK는 필드마스크가 없다.
function mirrorClipToTitle(batch, id, season, clipData, fallbackEp) {
    const ep = clipData.ep || fallbackEp;
    if (!ep) return;
    batch.set(kcultureDb.doc(`titles/${id}/media/clips`), {
        eps: { [`s${season}e${ep}`]: clipData.videoId }, updatedAt: new Date(),
    }, { merge: true });
}

// ── Gemini 발제 생성 (근거를 제목·장르·시놉시스로 제한 → 회차 스포일러 구조적 차단) ──
function epLabel(episodes) {
    const sorted = [...episodes].sort((a, b) => a - b);
    return sorted.length > 1 ? `EP ${sorted[0]}-${sorted[sorted.length - 1]}` : `EP ${sorted[0]}`;
}

async function generateThreadCopy({ showName, genres, synopsis, episodes, hook = null }) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const expectedTitle = `${showName} [${epLabel(episodes)}]`;
    const prompt = [
        `You are Dari, the AI curator of KdramaAnyLang — a warm, thoughtful host of a multilingual K-drama community.`,
        `Write a short discussion-thread opener (in English) for new episodes of a K-drama.`,
        ``,
        `[What you know — this is ALL you may rely on. Do NOT invent or recall anything else about this show.]`,
        `- Show title: ${showName}`,
        `- Genres: ${genres.join(', ') || 'N/A'}`,
        `- Synopsis: ${synopsis || 'N/A'}`,
        `- Episodes being discussed: ${epLabel(episodes)}`,
        // 회차 훅(2026-08-15): 방송사가 공개한 선공개/예고 클립 요약 — 발제를 회차 밀착으로 만드는 유일한 회차별 근거.
        // 공식 마케팅 자료라 언급해도 스포일러가 아니지만, 클립 밖 추측·결말 암시는 아래 규칙으로 차단.
        ...(hook ? [
            `- Officially released preview/teaser for these episodes (public marketing material — safe to reference): ${hook}`,
        ] : []),
        ``,
        `[Hard rules]`,
        `- ABSOLUTELY NO SPOILERS: do not mention, guess, or hint at anything that happens in any episode beyond what the preview above states. No plot events, no character fates, no twists.`,
        ...(hook ? [
            `- The preview summary is the ONLY episode-specific material you may reference. Never guess what happens beyond it, and never present it as resolved — previews show setups, not outcomes.`,
        ] : []),
        `- Body: about 100 words. Warm and inviting, never hype-y, never provocative or divisive.`,
        `- Include EXACTLY two questions, in this ladder:`,
        `  1) one surface-level question about viewers' feelings/emotions watching these episodes${hook ? ' — anchor this question in ONE concrete element from the preview above (a scene, a line, a situation), so the thread feels specific to these episodes' : ''},`,
        `  2) one interpretive "why" question inviting deeper reflection (themes, choices, direction) — still without referencing any specific plot event.`,
        `- Include exactly one line: "no spoilers in this post — please mark spoilers in replies" (natural phrasing around it is fine).`,
        `- End the body with this exact signature on its own line: "${DARI_SIGNATURE}"`,
        ``,
        `Return ONLY one JSON object, no markdown:`,
        `  {"title": "${expectedTitle}", "body": "<the opener>"}`,
        `(Use that exact title string.)`,
    ].join('\n');

    const genConfig = { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' };
    // 빈값/초과 길이 시 1회 재생성, 재실패 시 throw (자동 검수)
    for (let attempt = 0; attempt < 2; attempt++) {
        const r = await callGeminiText(prompt, GEMINI_API_KEY, { label: 'dari-thread', genConfig });
        if (r.error) { console.warn(`[Dari] 발제 생성 실패(attempt ${attempt + 1}): ${r.error}`); continue; }
        const parsed = parseFirstJsonObject(r.text);
        const title = (parsed?.title || '').trim() || expectedTitle; // 제목은 결정적 포맷 강제(빈값 폴백)
        const body = (parsed?.body || '').trim();
        if (body && body.length <= 1200 && title.length <= 1200) return { title: expectedTitle, body };
        console.warn(`[Dari] 발제 검수 실패(attempt ${attempt + 1}): bodyLen=${body.length}`);
    }
    throw new Error('Dari 발제 생성 실패 (2회 시도 모두 빈값/길이 초과)');
}

// ── 고유명사 보호 규칙(2026-08-01) — Esom→손숙(다른 실존 배우로 치환)·hackberry→해바라기·
// Room 19→룸 19 사고 대응. glossary(선택): { "원문 표현": "타깃 확정 표기" } — 리뷰 초안 JSON의
// glossary 필드로 전달, 조사 단계에서 확정한 고유명사를 사전에 못박는다(사후 ko 패치 → 사전 예방).
// 값이 문자열이면 한국어 확정 표기(그 외 언어는 원문 기준 음역), 객체면 {lang: 표기} 언어별 지정.
function properNounRules(glossary = null) {
    const rules = [
        `- Person names (actors, directors, characters): convert only if you are CERTAIN of the established spelling in that target language; otherwise keep the original spelling as-is or transliterate it. NEVER substitute a different real person's name.`,
        `- Unfamiliar proper nouns (place names, in-show objects or terms): if unsure, keep them as-is — never replace them with a generic or different word.`,
        `- Quoted titles of books, films or shows inside the text: use the official release title in that target language if certain; otherwise keep the original title unchanged.`,
        // 2026-08-16 — D:\Thread\TRANSLATION-NOTES.md 유형 A·B 대응(막장→soap→"드라마", 합→choreography→"안무")
        `- Romanized K-fandom terms (makjang, sageuk, chemi, daebak, oppa, unnie, maknae…): keep them romanized; do NOT flatten them into generic words. When the target IS Korean, use the Korean original instead (makjang → 막장, sageuk → 사극, chemi → 케미).`,
        `- Craft terms must keep their film/TV meaning, never the everyday one: "fight choreography" = combat staging (Korean 액션 합 / 殺陣), never dance; "chemistry" = on-screen rapport, never the science; "arc" = story arc; "beat" = story beat; "run" = a show's broadcast period.`,
    ];
    if (glossary && typeof glossary === 'object') {
        const entries = Object.entries(glossary).filter(([k]) => k);
        if (entries.length) {
            rules.push(`- MANDATORY glossary — when these terms appear, use exactly these renderings:`);
            for (const [src, tgt] of entries) {
                // ⚠ 2026-08-29 — 종전 문구 `Korean: "…" (other languages: transliterate)` 는 원문이 이미
                //   영문인 고유명사에서 무력했고, 모델이 **한국어 값을 ja/zh-CN/fr/vi 본문에 그대로 삽입**했다
                //   (`"Good Data Corporation": "굿데이터코퍼레이션"` → 4개 언어에 한글 유출). ko 한정을 명시한다.
                if (typeof tgt === 'string') rules.push(`    "${src}" → in KOREAN ONLY, render it as "${tgt}". In EVERY OTHER language keep "${src}" exactly as written in the source — NEVER insert the Korean form "${tgt}" into a non-Korean translation.`);
                else if (tgt && typeof tgt === 'object') rules.push(`    "${src}" → ${Object.entries(tgt).map(([l, v]) => `${l}: "${v}"`).join(', ')}`);
            }
        }
    }
    return rules;
}

// ── 본문 다국어 묶음 번역 → 캐시 시드용 map {code: translatedBody} ──
// showTitles: { en, original, originalLang } — 작품명 음차/의역 방지("에이전트 김 리액티베이티드" 사고).
//   원어(콘텐츠 원산지) 타깃에는 공식 원어 제목을, 그 외 언어에는 영어 제목 그대로 쓰게 지시.
// 장문 × 10언어 단일 호출은 응답 잘림으로 파싱 실패(0/10)가 잦아 5언어씩 분할 호출(2026-07-20).
// 꼬리 2줄은 번역시키지 않는다 — head만 Gemini에 보내고 TAIL_BY_LANG로 결정적으로 재조립(위 주석).
async function translateBodyMulti(body, codes, showTitles = null, glossary = null, model = null) {
    const { head, hasSig, hasNote } = splitTail(body);
    const raw = await translateHeadMulti(head, codes, showTitles, glossary, model);
    const out = {};
    for (const [code, text] of Object.entries(raw)) out[code] = applyFixedTail(text, code, hasSig, hasNote);
    return out;
}

async function translateHeadMulti(head, codes, showTitles = null, glossary = null, model = null) {
    const CHUNK = 5;
    if (codes.length > CHUNK) {
        const out = {};
        for (let i = 0; i < codes.length; i += CHUNK) {
            Object.assign(out, await translateHeadMulti(head, codes.slice(i, i + CHUNK), showTitles, glossary, model));
        }
        return out;
    }
    return translateBodyChunk(head, codes, showTitles, glossary, model);
}

// flash-lite 글리치 2종(값 뒤 중복 조각 / 깨진 \u 이스케이프 — 2026-07-22 ar 시드 실측) 대응:
// 수확 실패 언어만 최대 3회 재시도(tmdbBackfill과 동일 발상 — 받은 언어는 재호출 안 함).
async function translateBodyChunk(body, codes, showTitles = null, glossary = null, model = null) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    // ⚠ titleRule은 properNounRules의 일반 인용 규칙("확신 없으면 원문 유지")보다 뒤에 배치하고
    //   명시적 우선권을 준다 — 일반 규칙이 이겨서 ko 제목에 영문 작품명이 남던 회귀(2026-08-02).
    const titleRule = showTitles?.en
        ? [`- The show title "${showTitles.en}" is a PROPER NOUN. Do NOT translate or transliterate it: keep it exactly "${showTitles.en}" in every language`,
           ...(showTitles.original && showTitles.originalLang
               ? [`  EXCEPT in ${nameOf(showTitles.originalLang)}, where you MUST replace it with its official original title "${showTitles.original}" — this show-title rule OVERRIDES every other rule about keeping titles unchanged.`]
               : ['  in every target language.'])]
        : [];
    // ⚠ 제목 불변 규칙의 예외 — 원문이 **제목의 뜻을 설명**하거나 극중 용어로 쓴 경우까지 영어를
    //   강제하면 문장이 무의미해진다. 2026-08-29 실측: 「군체」 fr/vi/ja가 `"gunche" means colony`를
    //   `"Colony" signifie colonie`(Colony는 colony를 뜻한다)로, 「환혼」 5개 언어가 극중 주술명을
    //   영어 그대로 남겨 독자가 뜻을 알 수 없게 됐다.
    const titleExceptionRule = showTitles?.en
        ? [`- EXCEPTION to the show-title rule: when the SOURCE is explaining what the title MEANS (e.g. '"gunche" means colony'), or uses the phrase as an in-story term rather than as the show's name (lower-case, or introduced as a spell/technique/concept), TRANSLATE the meaning into the target language. A sentence that defines a word must not leave that word untranslated — the reader would learn nothing.`]
        : [];
    const out = {};
    for (let attempt = 0; attempt < 3; attempt++) {
        const still = codes.filter((c) => !out[c]);
        if (!still.length) break;
        const prompt = [
            `You are a professional translator for a multilingual community app.`,
            `The SOURCE text below is in English. Translate it into EACH of these target languages:`,
            still.map((c) => `  - "${c}" → ${nameOf(c)}`).join('\n'),
            ``,
            `[Rules — apply to every target language]`,
            `- Each translation MUST be written 100% in that target language.`,
            `- NEVER return, copy, paraphrase, or echo the English source. Returning English is a FAILURE.`,
            `- Translate naturally and idiomatically, faithfully preserving meaning, warm tone, questions, emoji and line breaks.`,
            ...properNounRules(glossary),
            ...titleRule,
            ...titleExceptionRule,
            // 서명·Note 줄은 애초에 SOURCE에서 잘라내고 보낸다(TAIL_BY_LANG 결정적 주입) → 덧붙이지 못하게 막는다.
            `- "Dari" is a BRAND NAME: NEVER translate or transliterate it (not 다리, ダリ, Дари, داري, 达里) — keep the Latin spelling "Dari" in every language.`,
            `- Do NOT add a closing signature, sign-off, or disclaimer line — the source ends where it ends.`,
            `- Self-check before answering: if any value is still (even partly) in English, redo it fully in that target language.`,
            ``,
            `Return ONLY one JSON object whose keys are these EXACT codes [${still.map((c) => `"${c}"`).join(', ')}],`,
            `each mapping to the translated text (a plain string). No markdown.`,
            ``,
            `SOURCE:`,
            body,
        ].join('\n');
        const r = await callGeminiText(prompt, GEMINI_API_KEY, {
            label: 'dari-translate',
            ...((model || DARI_TX_MODEL) ? { model: model || DARI_TX_MODEL } : {}),
            genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' },
        });
        if (r.error) { console.warn(`[Dari] 번역 시드 실패(attempt${attempt + 1}): ${r.error}`); continue; }
        // ⚠ 완결성 검사 — 응답이 잘려도 harvestCodes는 **부분 문자열을 성공으로 수확**한다. 그대로 두면
        //   재시도가 걸리지 않고 본문 절반이 잘린 번역이 그대로 게시된다(2026-08-29 벌크 재시드에서
        //   vi 13편·ko 1편이 이렇게 잘렸다 — 비율 0.19~0.80). 원문에 있던 섹션 표식이 번역에 전부
        //   있어야 수확으로 인정한다(언어 무관·결정적).
        const harvested = harvestCodes(r.text, still);
        for (const [code, text] of Object.entries(harvested)) {
            const lack = SECTION_MARKS.filter((m) => body.includes(m) && !String(text).includes(m));
            if (lack.length) { console.warn(`[Dari] ${code} 응답 잘림(섹션 ${lack.join('')} 없음) — 재시도`); continue; }
            out[code] = text;
        }
    }
    const miss = codes.filter((c) => !out[c]);
    if (miss.length) console.warn(`[Dari] 번역 미수확 [${miss.join(',')}] — 재실행 시 재시도됨`);
    return out;
}

// 번역 시드를 batch에 적재 — /api/community/translate 캐시 문서와 정확히 같은 형태({ body, translatedAt }).
// en도 시드(원문 그대로): 독자의 영어 번역 요청도 즉시 CACHE-HIT(클라 seedEnCache와 동일 발상).
function seedTranslations(batch, docPath, body, translated) {
    batch.set(kcultureDb.doc(`${docPath}/translations/en`), { body, translatedAt: new Date() }, { merge: true });
    for (const [code, text] of Object.entries(translated)) {
        batch.set(kcultureDb.doc(`${docPath}/translations/${code}`), { body: text, translatedAt: new Date() }, { merge: true });
    }
}

// ── 헤드라인(제목) 전용 다국어 번역 — 본문 프롬프트(시그니처 규칙 등)와 분리해 오염 방지 ──
// "Dari"는 브랜드명(번역·음차 금지 — "다리의 선택" 사고), 원문에 없는 문구 추가 금지.
async function translateTitleMulti(title, codes, showTitles = null, glossary = null, model = null) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const titleRule = showTitles?.en
        ? [`- The show title "${showTitles.en}" is a PROPER NOUN. Do NOT translate or transliterate it: keep it exactly "${showTitles.en}"`,
           ...(showTitles.original && showTitles.originalLang
               ? [`  EXCEPT in ${nameOf(showTitles.originalLang)}, where you MUST replace it with its official original title "${showTitles.original}" — this show-title rule OVERRIDES every other rule about keeping titles unchanged.`]
               : ['  in every target language.'])]
        : [];
    const out = {};
    for (let attempt = 0; attempt < 3; attempt++) { // 글리치 재시도 — translateBodyChunk와 동일
        const still = codes.filter((c) => !out[c]);
        if (!still.length) break;
        const prompt = [
            `Translate the short review HEADLINE below into EACH of these target languages:`,
            still.map((c) => `  - "${c}" → ${nameOf(c)}`).join('\n'),
            ``,
            `[Rules — apply to every target language]`,
            `- If the word "Dari" appears, it is a BRAND NAME — NEVER translate or transliterate it; keep it exactly "Dari".`,
            `- Translate the headline naturally and completely. Do NOT add any prefix, label, or words that are not in the source.`,
            ...properNounRules(glossary),
            ...titleRule,
            `- Do NOT add, append, or omit anything that is not in the source headline.`,
            ``,
            `Return ONLY one JSON object whose keys are these EXACT codes [${still.map((c) => `"${c}"`).join(', ')}],`,
            `each mapping to the translated headline (a plain string). No markdown.`,
            ``,
            `SOURCE HEADLINE:`,
            title,
        ].join('\n');
        const r = await callGeminiText(prompt, GEMINI_API_KEY, {
            label: 'dari-title',
            ...((model || DARI_TX_MODEL) ? { model: model || DARI_TX_MODEL } : {}),
            genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' },
        });
        if (r.error) { console.warn(`[Dari] 제목 번역 실패(attempt${attempt + 1}): ${r.error}`); continue; }
        Object.assign(out, harvestCodes(r.text, still)); // 정상 파스 → 키별 구제 폴백
    }
    // 제목에도 Dari 음역 스크럽 적용(브랜드명 규칙을 프롬프트에만 맡기지 않는다 — 2026-08-29).
    for (const [code, text] of Object.entries(out)) out[code] = scrubDariTranslit(text, code);
    return out;
}

// 헤드라인(제목) 시드 — 클라 translatePostTitle의 캐시 doc id(`{lang}__title`, { body: 제목 })와 동일 키.
function seedTitleTranslations(batch, docPath, title, translatedTitles) {
    batch.set(kcultureDb.doc(`${docPath}/translations/en__title`), { body: title, translatedAt: new Date() }, { merge: true });
    for (const [code, text] of Object.entries(translatedTitles)) {
        batch.set(kcultureDb.doc(`${docPath}/translations/${code}__title`), { body: text, translatedAt: new Date() }, { merge: true });
    }
}

// ── 회차 토론 스레드 게시 ────────────────────────────────────────────────────
// 멱등: doc id = dari_s{season}e{maxEp} — 존재 시 skip하고 기존 문서 반환.
// 같은 작품의 모든 스레드에 형제 목록(prevThreads)을 재배포 — 과거분 백필 후에도 각 스레드의
// "이전 토론" 칩이 전 회차를 가리키게 유지(자기 자신 제외, 회차 내림차순, 최대 5).
async function refreshSiblingPrevThreads(titleId) {
    const snap = await kcultureDb.collection('curation_threads').where('titleId', '==', titleId).get();
    const all = snap.docs.map((d) => d.data()).filter((d) => d.tid)
        .sort((a, b) => (b.episode || 0) - (a.episode || 0));
    for (const cur of all) {
        const prev = all.filter((x) => x.tid !== cur.tid)
            .map((x) => ({ tid: x.tid, episode: x.episode || 0, title: x.title || '' }))
            .slice(0, 5);
        await kcultureDb.doc(`titles/${titleId}/discussion/${cur.tid}`).set({ prevThreads: prev }, { merge: true }).catch(() => {});
    }
}

// ── 영화 토론 스레드 게시(2026-08-04) — 회차 없는 전편형. tid='dari_movie', 포인터 id={id}_movie ──
// 클라 호환: episode 0·episodes [] → 회차 라벨·방영일 미표시, 코멘트는 episode 0(작품 상세와 동일 풀).
async function createMovieThread({ tmdbId, dryRun = false, backdate = null }) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const id = Number(tmdbId);
    if (!Number.isInteger(id) || id < 1) throw new Error('tmdbId: 양의 정수 필요');
    const tid = 'dari_movie';
    const docPath = `titles/${id}/discussion/${tid}`;
    const threadRef = kcultureDb.doc(docPath);

    if (!dryRun) {
        const existing = await threadRef.get();
        if (existing.exists) {
            console.log(`[Dari] 영화 스레드 이미 존재 → skip: ${docPath}`);
            return { skipped: true, tid, path: docPath, ...existing.data() };
        }
    }

    const uid = await ensureDariAccount();
    const { detail, info } = await fetchMovieInfo(id);
    const showName = detail.title || detail.original_title || `#${id}`;

    // 발제 — 회차 프롬프트의 영화 변형(스포일러 금지·질문 사다리 동일, 회차 언급 없음)
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const prompt = [
        `You are Dari, the AI curator of KdramaAnyLang — a warm, thoughtful host of a multilingual K-drama community.`,
        `Write a short discussion-thread opener (in English) for a Korean FILM.`,
        ``,
        `[What you know — this is ALL you may rely on. Do NOT invent or recall anything else about this film.]`,
        `- Film title: ${showName}`,
        `- Genres: ${info.genres.join(', ') || 'N/A'}`,
        `- Synopsis: ${info.synopsis || 'N/A'}`,
        ``,
        `[Hard rules]`,
        `- ABSOLUTELY NO SPOILERS: no plot events, no character fates, no twists.`,
        `- Body: about 100 words. Warm and inviting, never hype-y.`,
        `- Include EXACTLY two questions: 1) a surface-level question about viewers' feelings after watching,`,
        `  2) an interpretive "why" question inviting deeper reflection — without referencing any specific plot event.`,
        `- Include exactly one line: "no spoilers in this post — please mark spoilers in replies" (natural phrasing fine).`,
        `- End the body with this exact signature on its own line: "${DARI_SIGNATURE}"`,
        ``,
        `Return ONLY one JSON object, no markdown:`,
        `  {"title": "${showName}", "body": "<the opener>"}`,
    ].join('\n');
    let body = '';
    for (let attempt = 0; attempt < 2; attempt++) {
        const r = await callGeminiText(prompt, GEMINI_API_KEY, {
            label: 'dari-movie-thread',
            genConfig: { temperature: 0.3, topP: 0.9, responseMimeType: 'application/json' },
        });
        if (r.error) { console.warn(`[Dari] 영화 발제 생성 실패(attempt ${attempt + 1}): ${r.error}`); continue; }
        const parsed = parseFirstJsonObject(r.text);
        const b = (parsed?.body || '').trim();
        if (b && b.length <= 1200) { body = b; break; }
    }
    if (!body) throw new Error('Dari 영화 발제 생성 실패');
    const title = showName;

    if (dryRun) {
        console.log(`[Dari] dry-run — 쓰기 없음: ${docPath}`);
        return { dryRun: true, tid, path: docPath, uid, title, body, info };
    }

    const translated = await translateBodyMulti(body, SEED_LANGS, {
        en: showName, original: detail.original_title || null, originalLang: detail.original_language || null,
    });

    let now = new Date();
    if (backdate && backdate !== 'auto') {
        const d = new Date(`${backdate}T12:00:00Z`);
        if (!Number.isNaN(d.getTime())) now = d;
    }
    const batch = kcultureDb.batch();
    batch.set(threadRef, {
        authorUid: uid, authorName: DARI_NAME, authorPhoto: dariPhotoURL,
        lang: 'en', body, episode: 0, spoiler: false, media: 'movie', likeCount: 0,
        images: [],
        titleName: showName, posterPath: detail.poster_path || null,
        threadRoot: true, curator: true,
        title, srcLang: 'en',
        episodes: [],
        info,
        prevThreads: [],
        createdAt: now,
    });
    seedTranslations(batch, docPath, body, translated);
    batch.set(kcultureDb.doc(`curation_threads/${id}_movie`), {
        titleId: id, media: 'movie', episode: 0, episodes: [], tid,
        title, titleName: showName, posterPath: detail.poster_path || null,
        lang: 'en', createdAt: now,
    });
    await batch.commit();
    console.log(`[Dari] 영화 스레드 게시 완료: ${docPath} (번역 시드 ${Object.keys(translated).length}/${SEED_LANGS.length})`);
    return { tid, path: docPath, uid, title, body, info, seededLangs: ['en', ...Object.keys(translated)] };
}

// backdate: 'auto'(커버 마지막 회차 방영일) | 'YYYY-MM-DD' | null — 과거분 백필 시 최신순 정렬이
// 실제 방영 순서와 맞도록 createdAt을 소급(홈 최신 3장·전체 목록이 현재 방영분 우선 유지).
// 본문 직접 지정(2026-09-04 — 선공개 정보 브리핑): 서명이 없으면 붙인다. Note 줄은 applyFixedTail이 언어별로 처리.
function withSignature(text) {
    const t = String(text || '').trim();
    return t.includes(DARI_SIGNATURE) ? t : `${t}\n\n${DARI_SIGNATURE}`;
}

async function createEpisodeThread({ tmdbId, season = 1, episodes, dryRun = false, reseed = false, backdate = null, hook = null, rehook = false, clip = null, bodyOverride = null, rebody = false }) {
    if (!Array.isArray(episodes) || !episodes.length || episodes.some((n) => !Number.isInteger(n) || n < 1)) {
        throw new Error('episodes: 1 이상의 정수 배열 필요 (예: [5,6])');
    }
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const id = Number(tmdbId);
    if (!Number.isInteger(id) || id < 1) throw new Error('tmdbId: 양의 정수 필요');
    const clipData = normClip(clip); // 선공개 클립(선택) — 형식 오류는 여기서 즉시 실패
    const maxEp = Math.max(...episodes);
    const tid = `dari_s${season}e${maxEp}`;
    const docPath = `titles/${id}/discussion/${tid}`;
    const threadRef = kcultureDb.doc(docPath);
    const pointerRef = kcultureDb.doc(`curation_threads/${id}_s${season}e${maxEp}`);

    // 멱등 게이트 (dryRun은 통과 — 미리보기 용도)
    if (!dryRun) {
        const existing = await threadRef.get();
        if (existing.exists) {
            const data = existing.data();
            // --rehook(2026-08-15): 기존 스레드의 발제 본문을 회차 훅(선공개 요약) 반영으로 재생성 + 번역 재시드.
            // 제목·info·댓글·공감은 그대로 — Dari 본인 발제 본문만 교체.
            if ((rehook && hook) || (rebody && bodyOverride)) {
                const { detail, info } = await fetchShowInfo(id, season);
                const seasonSuffix = season >= 2 ? ` ${season}` : '';
                const showName = (detail.name || detail.original_name || `#${id}`) + seasonSuffix;
                // --rebody(2026-09-04): 브리핑 본문을 파일에서 그대로(Gemini 발제 생략) / --rehook: 훅 반영 재생성
                const body = (rebody && bodyOverride)
                    ? withSignature(bodyOverride)
                    : (await generateThreadCopy({ showName, genres: info.genres, synopsis: info.synopsis, episodes, hook })).body;
                const translated = await translateBodyMulti(body, SEED_LANGS, {
                    en: showName, original: detail.original_name || null, originalLang: detail.original_language || null,
                });
                const b = kcultureDb.batch();
                b.set(threadRef, { body, ...(clipData ? { clip: clipData } : {}) }, { merge: true });
                if (clipData) { b.set(pointerRef, { clip: clipData }, { merge: true }); mirrorClipToTitle(b, id, season, clipData, maxEp); }
                seedTranslations(b, docPath, body, translated);
                await b.commit();
                console.log(`[Dari] rehook 완료: ${docPath} (번역 재시드 ${Object.keys(translated).length}/${SEED_LANGS.length})`);
                return { rehooked: true, tid, path: docPath, title: data.title, body, seededLangs: ['en', ...Object.keys(translated)] };
            }
            // 자가치유: info 백필(2026-07-20 저장 누락 버그) / --reseed: 번역 시드 재생성(프롬프트 개선 반영)
            if (!data.info || reseed) {
                try {
                    const { detail, info } = await fetchShowInfo(id, season);
                    if (!data.info) {
                        await threadRef.set({ info }, { merge: true });
                        data.info = info;
                        console.log(`[Dari] 기존 스레드에 info 백필: ${docPath}`);
                    }
                    if (reseed && data.body) {
                        const translated = await translateBodyMulti(data.body, SEED_LANGS, {
                            en: data.titleName || detail.name,
                            original: detail.original_name || null,
                            originalLang: detail.original_language || null,
                        });
                        const b = kcultureDb.batch();
                        seedTranslations(b, docPath, data.body, translated);
                        await b.commit();
                        console.log(`[Dari] 번역 재시드: ${docPath} (${Object.keys(translated).length}/${SEED_LANGS.length})`);
                    }
                } catch (e) { console.warn(`[Dari] 자가치유/재시드 실패(무시): ${e.message}`); }
            }
            // --clip 소급 주입(2026-08-19): 기존 스레드에 선공개 클립만 추가/교체 — 발제·번역 무변경.
            if (clipData) {
                const b = kcultureDb.batch();
                b.set(threadRef, { clip: clipData }, { merge: true });
                b.set(pointerRef, { clip: clipData }, { merge: true });
                mirrorClipToTitle(b, id, season, clipData, maxEp);
                await b.commit();
                console.log(`[Dari] 기존 스레드에 클립 주입: ${docPath} ← ${clipData.videoId}${clipData.ep ? ` (EP ${clipData.ep})` : ''}`);
                // ...data를 먼저 펼친다 — 뒤에 두면 data.clip(구 값)이 방금 쓴 clipData를 덮어 CLI 출력이 낡은 값을 보여줌(2026-08-20 실측)
                return { ...data, clipped: true, tid, path: docPath, clip: clipData };
            }
            console.log(`[Dari] 스레드 이미 존재 → skip: ${docPath}`);
            return { skipped: true, tid, path: docPath, ...data };
        }
    }

    const uid = await ensureDariAccount();
    const { detail, seasonEps, info } = await fetchShowInfo(id, season);
    // 시즌 2+는 표시명에 시즌 번호를 붙인다(TMDB name엔 없음 — "Flex X Cop [EP 3-4]"가 시즌1로 오인되던 문제, 2026-08-15)
    const seasonSuffix = season >= 2 ? ` ${season}` : '';
    const showName = (detail.name || detail.original_name || `#${id}`) + seasonSuffix;

    // 발제 생성 (근거: 제목·장르·시놉시스 + 선택적 회차 훅=공식 선공개 요약)
    // --body-file(정보 브리핑)이 있으면 그 본문을 그대로 쓴다 — 제목 규칙은 동일, Gemini 발제 호출 없음(2026-09-04).
    const { title, body } = bodyOverride
        ? { title: `${showName} [${epLabel(episodes)}]`, body: withSignature(bodyOverride) }
        : await generateThreadCopy({ showName, genres: info.genres, synopsis: info.synopsis, episodes, hook });

    const episodesMeta = [...episodes].sort((a, b) => a - b).map((n) => ({
        n,
        airDate: seasonEps.find((e) => e.episode_number === n)?.air_date || null,
    }));

    if (dryRun) {
        console.log(`[Dari] dry-run — 쓰기 없음: ${docPath}`);
        return { dryRun: true, tid, path: docPath, uid, title, body, info, episodes: episodesMeta };
    }

    // 과거 스레드 목록 (같은 작품, 이번 것 제외, 최대 5) — where 단일필드(자동 인덱스)만 사용, 정렬은 메모리.
    let prevThreads = [];
    try {
        const prevSnap = await kcultureDb.collection('curation_threads').where('titleId', '==', id).get();
        prevThreads = prevSnap.docs
            .map((d) => d.data())
            .filter((d) => d.tid && d.tid !== tid)
            .sort((a, b) => (b.episode || 0) - (a.episode || 0))
            .slice(0, 5)
            .map((d) => ({ tid: d.tid, episode: d.episode || 0, title: d.title || '' }));
    } catch (e) { console.warn(`[Dari] prevThreads 조회 실패(무시): ${e.message}`); }

    // 번역 시드 (Gemini 1회 묶음) — 실패해도 게시는 진행(독자 요청 시 서버가 채움)
    const translated = await translateBodyMulti(body, SEED_LANGS, {
        en: showName, original: detail.original_name || null, originalLang: detail.original_language || null,
    });

    let now = new Date();
    if (backdate === 'auto') {
        const lastAir = [...episodesMeta].reverse().find((e) => e.airDate)?.airDate;
        if (lastAir) now = new Date(`${lastAir}T12:00:00Z`);
    } else if (backdate) {
        const d = new Date(`${backdate}T12:00:00Z`);
        if (!Number.isNaN(d.getTime())) now = d;
    }
    const batch = kcultureDb.batch();
    // 스레드 문서 — 클라 discussion 코멘트 필드 전부(createComment 참조) + Dari 확장 필드
    batch.set(threadRef, {
        authorUid: uid, authorName: DARI_NAME, authorPhoto: dariPhotoURL,
        lang: 'en', body, episode: maxEp, spoiler: false, media: 'tv', likeCount: 0,
        images: [],
        titleName: showName, posterPath: detail.poster_path || null,
        // Dari 확장 필드 (클라 렌더러엔 무해 additive)
        threadRoot: true, curator: true,
        title, srcLang: 'en',
        episodes: episodesMeta,
        info, // 정보 블록(TMDB 원값) — ThreadScreen이 i18n 라벨로 렌더
        prevThreads,
        ...(clipData ? { clip: clipData } : {}), // 선공개 클립 — 썸네일+온디맨드 재생(DECISIONS.md §11)
        createdAt: now,
    });
    seedTranslations(batch, docPath, body, translated);
    // 큐레이션 레지스트리 (prevThreads 조회·운영 현황용)
    batch.set(pointerRef, {
        titleId: id, media: 'tv', episode: maxEp, episodes: episodesMeta, tid,
        title, titleName: showName, posterPath: detail.poster_path || null,
        ...(clipData ? { clip: clipData } : {}),
        lang: 'en', createdAt: now,
    });
    if (clipData) mirrorClipToTitle(batch, id, season, clipData, maxEp);
    await batch.commit();
    await refreshSiblingPrevThreads(id).catch((e) => console.warn(`[Dari] 형제 prevThreads 갱신 실패(무시): ${e.message}`));
    console.log(`[Dari] 스레드 게시 완료: ${docPath} (번역 시드 ${Object.keys(translated).length}/${SEED_LANGS.length})`);
    return { tid, path: docPath, uid, title, body, info, episodes: episodesMeta, prevThreads, seededLangs: ['en', ...Object.keys(translated)] };
}

// ── 큐레이터 리뷰 글 게시 (posts) ────────────────────────────────────────────
// 본문은 호출자가 제공(자동 생성 아님 — 운영자/Claude가 초안 작성). 고유 id 자동 → 멱등 불필요.
// 필드는 클라 createPost(src/lib/community.js)와 동일 + { curator:true, authorRating:null }.
// glossary(선택): 초안 JSON의 { "원문 표현": "확정 표기" } — 번역 시 강제 대응표(properNounRules 참조).
// bodies/titles(12개 언어 직접 작성분)가 오면 **Gemini를 전혀 호출하지 않고** 그대로 시드한다(2026-08-29 전환).
// 없으면 종전대로 body/title 1개를 번역해 시드한다(회차 스레드·라운지는 계속 이 경로).
async function createReviewPost({ tmdbId, media, title, body, bodies = null, titles = null, spoilerBody = null, glossary = null, dryRun = false }) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const direct = !!(bodies && Object.keys(bodies).length);
    if (direct) {
        title = titles?.en || title;
        body = bodies.en || body;
        const missing = SEED_LANGS.filter((c) => !bodies[c]);
        if (!bodies.en) throw new Error('bodies.en 필수(base 영문)');
        if (missing.length) throw new Error(`bodies 누락 언어: ${missing.join(', ')} — 12개 언어를 전부 넣을 것`);
        const missingT = titles ? SEED_LANGS.filter((c) => !titles[c]) : SEED_LANGS;
        if (missingT.length) throw new Error(`titles 누락 언어: ${missingT.join(', ')}`);
    }
    if (!title || !body) throw new Error('title/body 필수');
    if (!['tv', 'movie'].includes(media)) throw new Error("media: 'tv' | 'movie'");
    const id = Number(tmdbId);
    if (!Number.isInteger(id) || id < 1) throw new Error('tmdbId: 양의 정수 필요');

    const uid = await ensureDariAccount();
    const detail = await tmdb(`/${media}/${id}`, { language: 'en-US' });
    const titleName = detail.name || detail.title || detail.original_name || detail.original_title || `#${id}`;

    if (dryRun) {
        return { dryRun: true, uid, titleId: id, media, titleName, title, body };
    }

    const showTitles = {
        en: titleName, original: detail.original_name || detail.original_title || null, originalLang: detail.original_language || null,
    };
    let translated; let translatedTitles;
    if (direct) {
        // 직접 작성 경로 — 번역 호출 없음. 꿀리 2줄과 음역 스크럽은 그대로 거친다
        // (사람이 써도 34편과 표기를 통일해야 하고, 실수로 꿀리를 직접 써넣은 경우까지 흡수한다).
        const { hasSig, hasNote } = splitTail(body);
        translated = {};
        translatedTitles = {};
        for (const code of SEED_LANGS) {
            translated[code] = applyFixedTail(bodies[code], code, hasSig, hasNote);
            translatedTitles[code] = scrubDariTranslit(titles[code], code);
        }
        console.log(`[Dari] 직접 작성분 ${SEED_LANGS.length}개 언어 — Gemini 미호출`);
    } else {
        translated = await translateBodyMulti(body, SEED_LANGS, showTitles, glossary);
        translatedTitles = await translateTitleMulti(title, SEED_LANGS, showTitles, glossary); // 헤드라인 — 자동 자국어 표시용
    }

    const now = new Date();
    const postRef = kcultureDb.collection('posts').doc(); // 고유 id 자동
    const batch = kcultureDb.batch();
    batch.set(postRef, {
        authorUid: uid, authorName: DARI_NAME, authorPhoto: dariPhotoURL,
        lang: 'en', title, body,
        titleId: id, titleName, media, posterPath: detail.poster_path || null,
        authorRating: null,
        images: [],
        ...(spoilerBody ? { spoilerBody } : {}), // 선택적 스포일러 섹션(클라 렌더 지원 전까지 보존만)
        curator: true,
        likeCount: 0, commentCount: 0, createdAt: now,
    });
    seedTranslations(batch, `posts/${postRef.id}`, body, translated);
    seedTitleTranslations(batch, `posts/${postRef.id}`, title, translatedTitles);
    await batch.commit();
    console.log(`[Dari] 리뷰 글 게시 완료: posts/${postRef.id} (번역 시드 ${Object.keys(translated).length}/${SEED_LANGS.length}, 제목 ${Object.keys(translatedTitles).length})`);
    return { postId: postRef.id, path: `posts/${postRef.id}`, uid, titleId: id, media, titleName, title, body, seededLangs: ['en', ...Object.keys(translated)] };
}

// 기존 리뷰 글 번역 재시드(본문+제목) — 프롬프트 개선·제목 시드 추가분 반영용. glossary 선택.
async function reseedReviewPost(postId, glossary = null) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const ref = kcultureDb.doc(`posts/${postId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`posts/${postId} 없음`);
    const data = snap.data();
    let showTitles = null;
    if (data.titleId && data.media) {
        try {
            const detail = await tmdb(`/${data.media}/${data.titleId}`, { language: 'en-US' });
            showTitles = {
                en: data.titleName || detail.name || detail.title,
                original: detail.original_name || detail.original_title || null,
                originalLang: detail.original_language || null,
            };
        } catch { /* 작품명 규칙 없이 진행 */ }
    }
    const translated = await translateBodyMulti(data.body, SEED_LANGS, showTitles, glossary);
    const translatedTitles = data.title ? await translateTitleMulti(data.title, SEED_LANGS, showTitles, glossary) : {};
    const batch = kcultureDb.batch();
    seedTranslations(batch, `posts/${postId}`, data.body, translated);
    if (data.title) seedTitleTranslations(batch, `posts/${postId}`, data.title, translatedTitles);
    await batch.commit();
    console.log(`[Dari] 리뷰 재시드: posts/${postId} (본문 ${Object.keys(translated).length}, 제목 ${Object.keys(translatedTitles).length})`);
    return { postId, seededLangs: ['en', ...Object.keys(translated)] };
}

// ── 빠진 언어만 증분 시드 — SEED_LANGS에 새 언어 추가 시(예: 2026-07-22 ar) 기존 게시물 보강 ──
// reseed(전량 재번역)와 달리 이미 시드된 언어는 건드리지 않는다 → 비용 = 빠진 언어만.
// 대상: ① curation_threads 레지스트리의 전 스레드 ② posts에서 curator==true 전 리뷰(본문+제목).
// 멱등 — 몇 번을 다시 돌려도 빠진 언어가 없으면 skip. 새 언어 추가 시 이 함수만 1회 실행하면 끝.
async function seedMissingLangs({ dryRun = false } = {}) {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    const stat = { threads: 0, posts: 0, skipped: 0, errors: 0 };

    // 작품당 TMDB detail 1회 캐시 — showTitles(작품명 음차/의역 방지 규칙)용
    const detailCache = new Map();
    const showTitlesOf = async (titleId, media = 'tv') => {
        const key = `${media}:${titleId}`;
        if (!detailCache.has(key)) {
            try {
                const detail = await tmdb(`/${media}/${titleId}`, { language: 'en-US' });
                detailCache.set(key, {
                    en: detail.name || detail.title || '',
                    original: detail.original_name || detail.original_title || null,
                    originalLang: detail.original_language || null,
                });
            } catch { detailCache.set(key, null); }
        }
        return detailCache.get(key);
    };

    // docPath의 translations 서브컬렉션에서 body가 비어 있는 SEED_LANGS 목록(suffix='__title'은 제목 시드)
    const missingOf = async (docPath, suffix = '') => {
        const snaps = await kcultureDb.getAll(...SEED_LANGS.map((c) => kcultureDb.doc(`${docPath}/translations/${c}${suffix}`)));
        return SEED_LANGS.filter((c, i) => !(snaps[i].exists && (snaps[i].data()?.body || '').trim()));
    };
    const writeSeeds = (batch, docPath, suffix, translated) => {
        for (const [code, text] of Object.entries(translated)) {
            batch.set(kcultureDb.doc(`${docPath}/translations/${code}${suffix}`), { body: text, translatedAt: new Date() }, { merge: true });
        }
    };

    // ① 스레드
    const reg = await kcultureDb.collection('curation_threads').get();
    for (const d of reg.docs) {
        const { titleId, tid, media } = d.data();
        if (!titleId || !tid) continue;
        const docPath = `titles/${titleId}/discussion/${tid}`;
        try {
            const snap = await kcultureDb.doc(docPath).get();
            const body = snap.exists ? snap.data()?.body : null;
            if (!body) continue;
            const missing = await missingOf(docPath);
            if (!missing.length) { stat.skipped++; continue; }
            console.log(`[Dari] 스레드 ${d.id}: 누락 [${missing.join(',')}]${dryRun ? ' (dry-run)' : ''}`);
            if (dryRun) { stat.threads++; continue; }
            const st = await showTitlesOf(titleId, media || 'tv');
            const translated = await translateBodyMulti(body, missing,
                st ? { en: snap.data().titleName || st.en, original: st.original, originalLang: st.originalLang } : null);
            const b = kcultureDb.batch();
            writeSeeds(b, docPath, '', translated);
            await b.commit();
            console.log(`[Dari]   → 시드 ${Object.keys(translated).length}/${missing.length}`);
            stat.threads++;
        } catch (e) { stat.errors++; console.warn(`[Dari] 스레드 ${d.id} 실패(계속): ${e.message}`); }
    }

    // ② 큐레이터 리뷰 글 (본문 + 제목)
    const posts = await kcultureDb.collection('posts').where('curator', '==', true).get();
    for (const d of posts.docs) {
        const data = d.data();
        const docPath = `posts/${d.id}`;
        try {
            if (!data.body) continue;
            const missingBody = await missingOf(docPath);
            const missingTitle = data.title ? await missingOf(docPath, '__title') : [];
            if (!missingBody.length && !missingTitle.length) { stat.skipped++; continue; }
            console.log(`[Dari] 리뷰 ${d.id}: 본문 누락 [${missingBody.join(',')}] 제목 누락 [${missingTitle.join(',')}]${dryRun ? ' (dry-run)' : ''}`);
            if (dryRun) { stat.posts++; continue; }
            const st = data.titleId ? await showTitlesOf(data.titleId, data.media || 'tv') : null;
            const showTitles = st ? { en: data.titleName || st.en, original: st.original, originalLang: st.originalLang } : null;
            const b = kcultureDb.batch();
            if (missingBody.length) writeSeeds(b, docPath, '', await translateBodyMulti(data.body, missingBody, showTitles));
            if (missingTitle.length) writeSeeds(b, docPath, '__title', await translateTitleMulti(data.title, missingTitle, showTitles));
            await b.commit();
            stat.posts++;
        } catch (e) { stat.errors++; console.warn(`[Dari] 리뷰 ${d.id} 실패(계속): ${e.message}`); }
    }

    console.log(`[Dari] 증분 시드 완료 — 스레드 ${stat.threads} · 리뷰 ${stat.posts} · 완비 skip ${stat.skipped} · 오류 ${stat.errors}`);
    return stat;
}

module.exports = { ensureDariAccount, createEpisodeThread, createMovieThread, createReviewPost, reseedReviewPost, seedMissingLangs, SEED_LANGS };
// QA·회귀 테스트용 내부 노출(community.js `_tx`와 동일 패턴) — 프로덕션 호출부는 위 공개 API만 쓴다.
module.exports._qa = { splitTail, stripAllTails, applyFixedTail, scrubDariTranslit, scrubHangulGloss, TAIL_BY_LANG, properNounRules };
// 특정 언어만 재번역하는 운영 스크립트용(scripts/reseed-dari-lang.js) — 게시 경로와 동일 규칙 보장.
// ⚠ seedMissingLangs 안의 showTitlesOf는 그 함수의 지역 변수라 여기서 참조할 수 없다(모듈 로드 시
//   ReferenceError로 서버가 죽는다 — 2026-08-29 반영 직전 발견). 모듈 스코프 구현을 따로 둔다.
async function showTitlesOfStandalone(titleId, media = 'tv') {
    try {
        const detail = await tmdb(`/${media}/${titleId}`, { language: 'en-US' });
        return {
            en: detail.name || detail.title || '',
            original: detail.original_name || detail.original_title || null,
            originalLang: detail.original_language || null,
        };
    } catch { return null; }
}
module.exports._reseed = { translateBodyMulti, translateTitleMulti, showTitlesOf: showTitlesOfStandalone };
