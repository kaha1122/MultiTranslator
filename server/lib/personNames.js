// ── 인물 이름 현지화 공용 모듈 (K-DramaAnyLang 전용, 2026-07-29) ────────────────
// 규칙(절대 규칙 #7의 인명 버전): **뷰어 언어 표기 → 영어(로마자) → 로마자 변환(RR) 생성** 순 폴백.
//
// 왜 필요한가 (오싹한 연애 tv/298610 실측 — 연출·각본 표기가 뒤섞여 노출):
//   TMDB 크레딧의 name은 인물의 "언어별 번역"이 있을 때만 현지화되고, 없으면 **인물 기본명**이
//   그대로 내려온다. 기본명은 인물마다 제각각이다 — 연출 이민수는 기본명이 로마자(Lee Min-soo,
//   한글은 also_known_as에만), 각본 최정미는 기본명이 한글(로마자 표기는 TMDB 어디에도 없음).
//   그래서 같은 화면에서 언어가 뒤섞이고, 기존 라우트 패치(비영어·비원어 뷰어만 en 크레딧로 교체)로는
//   ① 영어 뷰어(en 크레딧 자체가 한글) ② 원어 뷰어(한글명이 aka에만 있는 로마자 기본명)를 못 고친다.
//
// 해석 순서(pickPersonName):
//   ① 뷰어 문자체계 이름 — 인물 translations[뷰어언어].name → also_known_as 중 뷰어 문자 항목
//   ② 로마자 이름 — translations.en.name → 기본명(로마자면) → aka 중 로마자 항목
//   ③ 로마자 생성 — 한글 이름을 RR(국어의 로마자 표기법) + 관용 성씨 표기(김=Kim, 이=Lee…)로 변환
//      (최정미처럼 TMDB에 로마자가 아예 없는 인물의 최후 폴백 — 없으면 원어가 그대로 노출된다)
//   ④ 실패 → null(호출측이 기존 이름 유지)
//
// 인물 조회는 /person/{id}?append_to_response=translations 1회 — 모듈 메모(7일 TTL)로 재조회 억제.
// 호출측(title 크레딧)은 작품당 최대 20명으로 바운드. TMDB 무과금이라 비용은 지연뿐(병렬 1RTT).

const TMDB_BASE = 'https://api.themoviedb.org/3';

// 문자체계 판별 — 유니코드 속성 이스케이프(소스 인코딩 무관)
const SCRIPT_RE = {
    hangul: /\p{Script=Hangul}/u,
    kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
    cjk: /\p{Script=Han}/u,
    cyrl: /\p{Script=Cyrillic}/u,
    arab: /\p{Script=Arabic}/u,
};
// 각 UI 언어가 읽는 문자체계(라틴은 어느 언어나 읽으므로 목록에 없음 = 항상 허용)
const LANG_SCRIPTS = {
    ko: ['hangul', 'cjk'], ja: ['kana', 'cjk'], 'zh-CN': ['cjk'], 'zh-TW': ['cjk'],
    ru: ['cyrl'], ar: ['arab'],
};
const baseLang = (l) => String(l || '').split('-')[0];

function isForeignScript(name, clientLang) {
    if (!name) return false;
    const ok = LANG_SCRIPTS[clientLang] || LANG_SCRIPTS[baseLang(clientLang)] || [];
    for (const k of Object.keys(SCRIPT_RE)) {
        if (SCRIPT_RE[k].test(name) && !ok.includes(k)) return true;
    }
    return false;
}
// 뷰어 "고유" 문자체계를 실제로 포함하는가(라틴-온리면 false) — 원어 뷰어의 표기 승격 판단용
function hasNativeScript(name, clientLang) {
    const scripts = LANG_SCRIPTS[baseLang(clientLang)] || [];
    return scripts.some((k) => SCRIPT_RE[k].test(name || ''));
}
const isLatinOnly = (s) => !!s && !Object.values(SCRIPT_RE).some((re) => re.test(s));

// ── 한글 이름 → 로마자(RR + 관용 성씨) ──────────────────────────────────────
// 표기법 원문이 아니라 "이름 표기 관용"을 따른다: 성은 관용 철자(김=Kim), 이름 음절은 하이픈 연결.
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const SURNAME = {
    김: 'Kim', 이: 'Lee', 박: 'Park', 최: 'Choi', 정: 'Jung', 강: 'Kang', 조: 'Cho', 윤: 'Yoon',
    장: 'Jang', 임: 'Lim', 한: 'Han', 오: 'Oh', 서: 'Seo', 신: 'Shin', 권: 'Kwon', 황: 'Hwang',
    안: 'Ahn', 송: 'Song', 전: 'Jeon', 홍: 'Hong', 유: 'Yoo', 고: 'Ko', 문: 'Moon', 양: 'Yang',
    손: 'Son', 배: 'Bae', 백: 'Baek', 허: 'Heo', 노: 'Noh', 남: 'Nam', 심: 'Shim', 곽: 'Kwak',
    성: 'Sung', 차: 'Cha', 주: 'Joo', 우: 'Woo', 구: 'Koo', 민: 'Min', 류: 'Ryu', 나: 'Na',
    진: 'Jin', 지: 'Ji', 엄: 'Uhm', 채: 'Chae', 천: 'Chun', 방: 'Bang', 공: 'Kong', 현: 'Hyun',
    함: 'Ham', 변: 'Byun', 염: 'Yeom', 여: 'Yeo', 추: 'Choo', 도: 'Do', 소: 'So', 석: 'Seok',
    설: 'Seol', 마: 'Ma', 길: 'Gil', 연: 'Yeon', 표: 'Pyo', 명: 'Myung', 기: 'Ki', 반: 'Ban',
    라: 'Ra', 왕: 'Wang', 옥: 'Ok', 육: 'Yook', 인: 'In', 맹: 'Maeng', 제: 'Je', 모: 'Mo', 탁: 'Tak',
};
const SURNAME2 = { 남궁: 'Namgoong', 황보: 'Hwangbo', 제갈: 'Jegal', 선우: 'Sunwoo', 독고: 'Dokgo', 사공: 'Sagong', 서문: 'Seomoon' };

function romanizeSyllable(ch) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return ch; // 한글 음절 아님 — 그대로
    const cho = Math.floor(code / 588), jung = Math.floor((code % 588) / 28), jong = code % 28;
    return CHO[cho] + JUNG[jung] + JONG[jong];
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// "최정미" → "Choi Jeong-mi" · "남궁민" → "Namgoong Min" · 한글 아닌 문자 섞이면 null(안전)
function romanizeKorean(name) {
    const t = String(name || '').trim();
    if (!t || !/^\p{Script=Hangul}+$/u.test(t) || t.length < 2 || t.length > 5) return null;
    let surname = '', given = t;
    if (SURNAME2[t.slice(0, 2)] && t.length >= 3) { surname = SURNAME2[t.slice(0, 2)]; given = t.slice(2); }
    else if (t.length >= 2) { surname = SURNAME[t[0]] || cap(romanizeSyllable(t[0])); given = t.slice(1); }
    const givenRoman = [...given].map(romanizeSyllable).map((s, i) => (i === 0 ? cap(s) : s)).join('-');
    return `${surname} ${givenRoman}`.trim();
}

// ── 인물 조회 메모(7일) — {name, aka[], trs:{ko,en,…}} 경량만 보관 ────────────
const memo = new Map();
const MEMO_TTL = 7 * 24 * 60 * 60 * 1000;
async function fetchPersonLite(pid) {
    const hit = memo.get(pid);
    if (hit && Date.now() - hit.at < MEMO_TTL) return hit.v;
    const key = process.env.TMDB_API_KEY;
    if (!key) return null;
    try {
        const r = await fetch(`${TMDB_BASE}/person/${pid}?api_key=${key}&append_to_response=translations`);
        if (!r.ok) return null;
        const p = await r.json();
        const trs = {};
        for (const t of (p.translations?.translations || [])) {
            const n = (t.data?.name || '').trim();
            if (n) trs[t.iso_639_1] = n;
        }
        const v = { name: p.name || '', aka: p.also_known_as || [], trs };
        if (memo.size > 20000) memo.clear(); // 폭주 방지(단순 캡)
        memo.set(pid, { at: Date.now(), v });
        return v;
    } catch { return null; }
}

// 뷰어 언어에 맞는 최선의 이름. 실패 시 null(호출측이 기존 이름 유지).
function pickPersonName(p, clientLang) {
    if (!p) return null;
    const lb = baseLang(clientLang);
    // ① 뷰어 문자체계 이름(뷰어 언어가 고유 문자를 가질 때만)
    if (LANG_SCRIPTS[lb]) {
        if (p.trs[lb] && hasNativeScript(p.trs[lb], lb)) return p.trs[lb];
        const native = p.aka.find((a) => hasNativeScript(a, lb));
        if (native) return native;
    }
    // ② 로마자 — en 번역 → 기본명 → aka
    if (isLatinOnly(p.trs.en)) return p.trs.en;
    if (isLatinOnly(p.name)) return p.name;
    const latin = p.aka.find(isLatinOnly);
    if (latin) return latin;
    // ③ 한글 기본명 → RR 로마자 생성(TMDB에 로마자가 아예 없는 인물의 최후 폴백)
    return romanizeKorean(p.name) || null;
}

// ── 크레딧 일괄 해석(title 상세용) ──────────────────────────────────────────
// persons: [{id, name}...] 를 가진 배열들. 뷰어가 읽을 수 없는 이름(오표기) + 뷰어 고유 문자가
// 있는 언어의 로마자 이름(승격 후보)만 인물 조회. 작품당 최대 cap명(비정상 크레딧 폭주 방지).
async function resolveCreditNames(personArrays, clientLang, { cap: capN = 20 } = {}) {
    const lb = baseLang(clientLang);
    const targets = new Map(); // pid → [refs]
    for (const arr of personArrays) {
        for (const p of (arr || [])) {
            if (!p?.id || !p?.name) continue;
            const foreign = isForeignScript(p.name, lb);                       // 못 읽음 → 반드시 해석
            const upgrade = !!LANG_SCRIPTS[lb] && !hasNativeScript(p.name, lb); // 로마자 → 뷰어 표기 승격 시도
            if (foreign || upgrade) {
                if (!targets.has(p.id)) targets.set(p.id, []);
                targets.get(p.id).push(p);
            }
        }
    }
    const pids = [...targets.keys()].slice(0, capN);
    if (!pids.length) return 0;
    let fixed = 0;
    await Promise.all(pids.map(async (pid) => {
        const lite = await fetchPersonLite(pid);
        const better = pickPersonName(lite, clientLang);
        if (!better) return;
        for (const ref of targets.get(pid)) {
            if (better !== ref.name) { ref.name = better; fixed++; }
        }
    }));
    return fixed;
}

module.exports = {
    SCRIPT_RE, LANG_SCRIPTS, isForeignScript, hasNativeScript, isLatinOnly,
    romanizeKorean, pickPersonName, fetchPersonLite, resolveCreditNames,
};
