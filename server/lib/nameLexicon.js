// ── 작품 호칭 사전(title_lexicon) — 배역명 표기 변형·애칭·작품 줄임말 (2026-11-16) ──────────
// 왜: 시청자는 같은 인물·작품을 공식 메타데이터와 다르게 부른다.
//   - 로마자 표기 흔들림: 가경 = Gakyoung · Ga-kyoung · Kakyoung · Gagyeong …
//   - 언어별 관습 표기: 이준 = zh 李俊 (TMDB에는 영문 배역명만 있다)
//   - 애칭·직함 호칭: 강비서, ~오빠 / 작품 줄임말: 백일의 거짓말 = 배커짓
// 번역 프롬프트가 이것을 모르면 직역·오역한다. 이 모듈은
//   ① 한글 이름에서 흔한 로마자 변형 집합을 **규칙으로 생성**하고(저장하지 않음),
//   ② 사전(title_lexicon/{titleId}, 리포 content/lexicon/{id}.json과 같은 형식)의 관측 표기와 합쳐
//   ③ 원문에 실제로 등장한 항목만 골라(매칭 게이트) 프롬프트 줄로 만든다.
// 입력은 모든 변형을 알아보고, 출력은 언어별 대표 표기(render) 하나로 통일한다.
// fail-open — 사전이 없거나 읽기 실패면 빈 결과(번역은 그대로 진행).

const HANGUL_RE = /\p{Script=Hangul}/u;
const LATIN_WORD_RE = /[\p{Script=Latin}]+(?:['’\-][\p{Script=Latin}]+)*/gu;

// ── 자모별 로마자 후보 ─────────────────────────────────────────────────────────
// 개정 로마자(RR) + 매큔-라이샤워(MR, 반달표 생략형) + 팬·관습 표기. 너무 넓히면 이름끼리 충돌하므로
// "실제로 흔히 보이는 것"만 둔다.
const INI = [
    ['g', 'k'], ['kk', 'gg', 'k'], ['n'], ['d', 't'], ['tt', 'dd'], ['r', 'l'], ['m'], ['b', 'p'], ['pp', 'bb'],
    ['s', 'sh'], ['ss', 's'], [''], ['j', 'ch'], ['jj', 'tch'], ['ch', 'c'], ['k', 'kh'], ['t', 'th'], ['p', 'ph'], ['h'],
];
const MED = [
    ['a'], ['ae', 'ai', 'e'], ['ya'], ['yae', 'ye'], ['eo', 'u', 'o'], ['e'], ['yeo', 'yo', 'you', 'yu'], ['ye'],
    ['o'], ['wa', 'oa'], ['wae', 'we'], ['oe', 'oi', 'we'], ['yo'], ['u', 'oo', 'ou'], ['wo', 'weo'], ['we'],
    ['wi', 'ui'], ['yu', 'you', 'yoo'], ['eu', 'u'], ['ui', 'eui', 'i', 'ee'], ['i', 'ee'],
];
// 종성 — 대표음 기준(받침 ㅅ·ㅈ·ㅊ·ㅌ·ㅎ → t)
const FIN = [
    [''], ['k', 'g'], ['k'], ['k'], ['n'], ['n'], ['n'], ['t', 'd'], ['l', 'r'], ['k', 'l'], ['m', 'l'], ['l'], ['l'], ['l'], ['p', 'l'], ['l'],
    ['m'], ['p', 'b'], ['p'], ['t', 's'], ['t', 's'], ['ng'], ['t'], ['t'], ['k'], ['t'], ['p'], ['t'],
];
// 성씨 관습 표기(성은 규칙 생성보다 관습이 압도적이다)
const SURNAME = {
    이: ['lee', 'yi', 'rhee', 'i', 'ri'], 박: ['park', 'bak', 'pak'], 김: ['kim', 'gim'], 최: ['choi', 'choe'],
    정: ['jung', 'jeong', 'chung', 'joung'], 강: ['kang', 'gang'], 조: ['cho', 'jo'], 윤: ['yoon', 'yun'],
    장: ['jang', 'chang'], 임: ['lim', 'im', 'yim'], 한: ['han'], 오: ['oh', 'o'], 서: ['seo', 'suh'], 신: ['shin', 'sin'],
    권: ['kwon', 'gwon'], 황: ['hwang'], 안: ['ahn', 'an'], 송: ['song'], 류: ['ryu', 'yoo', 'yu', 'ryoo'], 유: ['yoo', 'yu'],
    전: ['jeon', 'jun', 'chun'], 홍: ['hong'], 고: ['ko', 'go'], 문: ['moon', 'mun'], 양: ['yang'], 손: ['son', 'sohn'],
    배: ['bae'], 백: ['baek', 'paek'], 허: ['heo', 'hur', 'huh'], 남: ['nam'], 심: ['shim', 'sim'], 노: ['noh', 'roh', 'no'],
    하: ['ha'], 곽: ['kwak', 'gwak'], 성: ['sung', 'seong'], 차: ['cha'], 주: ['joo', 'ju'], 우: ['woo', 'wu'], 구: ['koo', 'gu'],
    민: ['min'], 나: ['na', 'ra'], 진: ['jin'], 지: ['ji'], 엄: ['eom', 'um'], 채: ['chae'], 원: ['won'], 천: ['cheon', 'chun'],
    방: ['bang'], 공: ['kong', 'gong'], 현: ['hyun', 'hyeon'], 변: ['byun', 'byeon'], 염: ['yeom', 'yum'], 여: ['yeo', 'yuh'],
    추: ['choo', 'chu'], 도: ['do', 'doh'], 석: ['seok', 'suk'], 선: ['sun', 'seon'], 설: ['seol', 'sul'], 연: ['yeon', 'yun'],
    표: ['pyo'], 명: ['myung', 'myeong'], 기: ['ki', 'gi'], 왕: ['wang'], 금: ['keum', 'geum'], 탁: ['tak'], 국: ['kook', 'guk'],
    봉: ['bong'], 태: ['tae'], 육: ['yook', 'yuk'], 인: ['in'], 제: ['je'], 길: ['gil', 'kil'], 위: ['wi', 'wee'],
};
const MAX_FORMS = 20000;

function decompose(ch) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) return null;
    return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28];
}
// 음절 하나의 로마자 후보. ㅇ+ㅣ(이)는 yi도 허용(Yi-jun).
function syllableForms(ch) {
    const j = decompose(ch);
    if (!j) return null;
    const [i, m, f] = j;
    const out = new Set();
    for (const a of INI[i]) for (const b of MED[m]) for (const c of FIN[f]) out.add(a + b + c);
    if (i === 11 && m === 20) { out.add('yi' + FIN[f][0]); if (!f) out.add('lee'); } // 이준 = Yi-jun · Lee Jun(李俊식)
    return [...out];
}
// 한 단어(한글) → 정규화된 로마자 후보 집합. 정규화 = 소문자·공백/하이픈/아포스트로피 제거.
function romanForms(hangul, { surname = false } = {}) {
    const chars = [...String(hangul || '').replace(/\s+/g, '')];
    if (!chars.length || !chars.every((ch) => decompose(ch))) return new Set();
    let acc = [''];
    chars.forEach((ch, idx) => {
        const opts = idx === 0 && surname && SURNAME[ch] ? SURNAME[ch] : syllableForms(ch);
        const next = [];
        for (const p of acc) for (const o of opts) { next.push(p + o); if (next.length > MAX_FORMS) break; }
        acc = next;
    });
    return new Set(acc);
}
const normLatin = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const normOther = (s) => String(s || '').toLowerCase().replace(/[\s\-·・.'’"]/g, '');

// ── 사전 → 매칭 인덱스 ─────────────────────────────────────────────────────────
// 엔트리 종류: character(배역) · title(작품 별칭) · couple(커플명) · nickname은 character에 소속.
// 각 엔트리에서 만드는 매칭 형태:
//   latin  : 규칙 생성(성+이름 전체, 이름만) ∪ 관측 라틴 표기 → normLatin 문자열 집합
//   other  : 한글 원명·이름·관측 비라틴 표기·애칭 → 원문 부분 문자열 검사
// 짧은 형태(라틴 정규화 4자 미만, 한글 2자 이하)는 "약한 형태" — 작품이 특정된 글(anchored)에서만 쓴다.
function buildIndex(lex) {
    if (!lex || !Array.isArray(lex.characters)) return null;
    const entries = [];
    for (const ch of lex.characters) {
        const ko = String(ch.ko || '').trim();
        const sur = ch.surname || (ko.length >= 3 ? ko[0] : '');
        const given = ch.given || (sur ? ko.slice(sur.length) : ko);
        const latin = new Map();      // norm → 'gen' | 관측 원형
        let givenSet = new Set();
        const addLatin = (n, tag) => { if (n && !latin.has(n)) latin.set(n, tag); };
        // nameless = 직함으로만 불리는 인물(예: 한비서) — 규칙 생성·이름 부분 매칭을 하지 않는다("비서"가 수행비서에 걸림)
        if (ko && HANGUL_RE.test(ko) && !ch.nameless) {
            const surF = sur ? romanForms(sur, { surname: true }) : new Set(['']);
            const givF = romanForms(given);
            givenSet = givF;
            for (const g of givF) {
                addLatin(g, 'gen');
                for (const s of surF) { addLatin(s + g, 'gen'); addLatin(g + s, 'gen'); } // 서양식 어순(Jaehee Kang)도
            }
        }
        for (const v of [ch.en, ...(ch.latinAlt || []), ...Object.keys(ch.observed?.latn || {})]) addLatin(normLatin(v), v);
        const other = new Set();
        for (const v of [ko, ch.nameless ? null : given, ...Object.values(ch.render || {}), ...Object.entries(ch.observed || {}).filter(([k]) => k !== 'latn').flatMap(([, o]) => Object.keys(o || {}))]) {
            if (v && !/^[\p{Script=Latin}\s\-.'’]+$/u.test(v)) other.add(v);
        }
        const nick = (ch.nicknames || []).map((n) => ({ ...n, form: String(n.form || '').trim() })).filter((n) => n.form);
        entries.push({ kind: 'character', key: ch.key, ko, en: ch.en, given, givenSet, hasSurname: !!sur && !ch.nameless, ch, latin, other: [...other], nick });
    }
    const titleAliases = [];
    for (const [lang, arr] of Object.entries(lex.title?.aliases || {})) {
        for (const a of arr || []) {
            const form = typeof a === 'string' ? a : a.form;
            if (form) titleAliases.push({ lang, form, means: typeof a === 'string' ? null : a.means || null });
        }
    }
    const couples = (lex.couples || []).filter((c) => c?.form).map((c) => ({ form: String(c.form).trim(), means: c.means || null }));
    return { lex, entries, titleAliases, couples };
}

// 원문의 라틴 단어 n-gram(1~3)을 정규화해 집합 대조 — "Ga Kyoung"·"Ga-kyoung"·"gakyoung" 모두 같은 키.
function latinGrams(text) {
    const words = [];
    const src = String(text || '');
    let prevEnd = -1, seg = 0;
    for (const m of src.matchAll(LATIN_WORD_RE)) {
        // 단어 사이에 공백 외 문자(마침표·쉼표·한글 등)가 있으면 이름 묶음을 끊는다 — "Secretary Kang. Jaehui" ≠ "Kang Jaehui"
        if (prevEnd >= 0 && !/^\s+$/.test(src.slice(prevEnd, m.index))) seg += 1;
        words.push({ raw: m[0].replace(/['’]s$/i, ''), at: m.index, seg });
        prevEnd = m.index + m[0].length;
    }
    const grams = [];
    for (let i = 0; i < words.length; i++) {
        let raw = '';
        for (let n = 1; n <= 3 && i + n <= words.length && words[i + n - 1].seg === words[i].seg; n++) {
            raw = n === 1 ? words[i].raw : `${raw} ${words[i + n - 1].raw}`;
            grams.push({ raw, norm: normLatin(raw), n });
        }
    }
    return grams;
}

// @returns hits: [{ entry, written, how }] — written = 원문에 실제로 적힌 형태
function match(index, text, { anchored = false } = {}) {
    if (!index || !text) return { characters: [], titles: [], couples: [] };
    const src = String(text);
    const lower = src.toLowerCase();
    const grams = latinGrams(src);
    const hits = [];
    for (const e of index.entries) {
        const found = [];
        // 라틴: 긴 n-gram 우선(성+이름이 이름만보다 먼저)
        for (const g of [...grams].sort((a, b) => b.n - a.n)) {
            if (!e.latin.has(g.norm)) continue;
            const weak = g.norm.length < 4 || (g.n === 1 && g.norm === normLatin(e.given) && g.norm.length < 5);
            if (weak && !anchored) continue;
            if (found.some((f) => normLatin(f).includes(g.norm))) continue;
            found.push(g.raw);
        }
        for (const o of e.other) {
            const weak = HANGUL_RE.test(o) ? [...o].length <= 2 : normOther(o).length < 2;
            if (weak && !anchored) continue;
            if (lower.includes(o.toLowerCase()) && !found.some((f) => f.includes(o))) found.push(o);
        }
        const nicks = e.nick.filter((n) => lower.includes(n.form.toLowerCase()));
        if (found.length || nicks.length) hits.push({ entry: e, written: found.slice(0, 4), nicks });
    }
    const titles = index.titleAliases.filter((a) => lower.includes(a.form.toLowerCase()) && (a.form.length >= 3 || anchored));
    const couples = (index.couples || []).filter((c) => lower.includes(c.form.toLowerCase()));
    return { characters: hits, titles, couples };
}

// 대표 표기(render) — 사전 render[lang] → 비라틴 타깃은 비워 둠(모델이 원 한글명 음차, 기존 castContext 규칙) → 라틴 타깃은 en
// givenOnly — 글쓴이가 이름만 썼으면(재희·Yijoon) 출력도 이름만(성을 붙여 늘리지 않는다).
//   render 키 '<lang>:given' 이 있으면 그것, 없으면 ko=given / 라틴=en에서 성(첫 단어) 제거 / 비라틴=null(음차 지시).
// pins — 자동 고정 표기(번역 결과에서 모은 표, title_lexicon.auto.votes) {charKey: 값, 'charKey~g': 이름만}
function renderFor(e, lang, { givenOnly = false, pins = null } = {}) {
    const r = e.ch.render || {};
    const ck = charKey(e.en);
    if (givenOnly && e.hasSurname) {
        if (r[`${lang}:given`]) return r[`${lang}:given`];
        if (lang === 'ko') return e.given || null;
        if (/^(ja|zh|th|ar|ru|hi)/.test(lang)) return pins?.[`${ck}~g`] || null;
        const parts = String(e.en || '').trim().split(/\s+/);
        return parts.length > 1 ? parts.slice(1).join(' ') : (e.en || null);
    }
    if (r[lang]) return r[lang];
    if (lang === 'ko') return e.ko || null;
    const nonLatin = /^(ja|zh|th|ar|ru|hi|ko)/.test(lang);
    return nonLatin ? (pins?.[ck] || null) : (e.en || null);
}
function isGivenOnly(e, written) {
    if (!e.hasSurname || !written.length) return false;
    return written.every((w) => (HANGUL_RE.test(w) ? w === e.given : e.givenSet.has(normLatin(w))));
}

function promptLines(m, lex, targetLang, targetName, pins = null) {
    if (!m || (!m.characters?.length && !m.titles?.length && !m.couples?.length)) return [];
    const lines = ['', `[Show lexicon — how viewers of 「${lex.title?.canonical?.ko || lex.titleId}」 write names; detected in this text]`];
    for (const { entry: e, written, nicks } of m.characters) {
        const givenOnly = isGivenOnly(e, written);
        const out = renderFor(e, targetLang, { givenOnly, pins });
        const srcName = givenOnly ? e.given : e.ko;
        if (written.length) {
            lines.push(`- ${written.map((w) => `「${w}」`).join(', ')} = the CHARACTER ${e.en}${e.ko ? ` (${e.ko})` : ''} — the same person, just a different spelling${givenOnly ? '; the writer used the given name only' : ''}. `
                + (out ? `Write it as "${out}" in ${targetName}${givenOnly ? ' (given name only — do not add the surname)' : ''}.` : `Transliterate ${givenOnly ? 'the given name only' : "this character's name"} (${srcName}) into ${targetName} script by its sound.`)
                + ` This OVERRIDES the rule about keeping the writer's spelling.`);
        }
        for (const n of nicks) {
            const rr = n.render?.[targetLang];
            lines.push(`- 「${n.form}」 is a viewer nickname for the CHARACTER ${e.en}${n.means ? ` (${n.means})` : ''}. `
                + (rr ? `Render it as "${rr}".` : `Keep its affectionate/teasing tone; ${out ? `you may render it as "${renderFor(e, targetLang, { givenOnly: true, pins }) || out}" plus a natural equivalent nickname` : 'render it naturally'} — never translate it word-for-word into a different meaning.`));
        }
    }
    for (const t of m.titles) {
        const tt = lex.title?.canonical?.[targetLang] || lex.title?.canonical?.en;
        lines.push(`- 「${t.form}」 is a viewer abbreviation of the show 「${lex.title?.canonical?.ko}」${tt ? ` — render it as "${tt}"` : ''}. Do not translate it literally.`);
    }
    for (const c of m.couples || []) {
        lines.push(`- 「${c.form}」 is a fan couple/ship name${c.means ? ` (${c.means})` : ''} — translate it as the pairing of those two characters, not as one person.`);
    }
    return lines;
}

// ── 적재 — Firestore title_lexicon/{id} (6시간 메모, fail-open) ─────────────────
// 문서 = 수동 사전(characters·title·couples — 리포 content/lexicon/{id}.json 업로드, 선택)
//      + 자동 고정 표기(auto.votes.{lang}.{charKey}.{표기} = 횟수 — 번역 결과에서 모음, recordNames)
const CACHE = new Map();
const TTL = 6 * 60 * 60 * 1000;
const charKey = (en) => String(en || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function loadDoc(titleId) {
    const id = String(titleId || '');
    if (!id) return { data: null, index: null };
    const c = CACHE.get(id);
    if (c && Date.now() - c.at < TTL) return c;
    let data = null, index = null;
    try {
        const { kcultureDb } = require('../config/firebaseKculture');
        if (kcultureDb) {
            const d = await kcultureDb.doc(`title_lexicon/${id}`).get();
            if (d.exists) { data = d.data(); index = buildIndex(data); }
        }
    } catch (e) {
        console.warn('[nameLexicon] 적재 실패(사전 없이 진행):', e.message);
    }
    const v = { at: Date.now(), data, index };
    if (CACHE.size > 3000) CACHE.clear();
    CACHE.set(id, v);
    return v;
}
async function load(titleId) { return (await loadDoc(titleId)).index; }

// ── 자동 고정 표기 — 비라틴 대상 언어의 배역 표기를 언어마다 하나로 ─────────────
// 규칙으로 음차를 정하지 않고, 모델이 실제로 쓴 표기를 모아 같은 표기가 반복되면 고정한다(첫 번역 고정의 안전판).
// 기록 전 검증: 대상 문자 체계 · 배우 이름 아님 · 골격 키가 그 배역과 일치(한·일·중·러). 태국어·아랍어는 키 검증이
// 불가능해 3회 일치를 요구한다.
const PIN_MIN = { th: 3, ar: 3 };
function pinsFrom(data, lang) {
    const v = data?.auto?.votes?.[lang] || {};
    const out = {};
    for (const [ck, vals] of Object.entries(v)) {
        let best = null, n = 0;
        for (const [val, cnt] of Object.entries(vals || {})) if (cnt > n) { best = val; n = cnt; }
        if (best && n >= (PIN_MIN[lang] || 2)) out[ck] = best;
    }
    return out;
}
const NON_LATIN = /^(ko|ja|zh|th|ar|ru|hi)/;
const SCRIPT_OK = {
    ko: /^[\p{Script=Hangul}\s·]+$/u,
    ja: /^[\p{Script=Katakana}\p{Script=Han}ー・\s]+$/u,
    'zh-CN': /^[\p{Script=Han}·・\s]+$/u,
    ru: /^[\p{Script=Cyrillic}\s\-]+$/u,
    th: /^[\p{Script=Thai}\s]+$/u,
    ar: /^[\p{Script=Arabic}\s]+$/u,
};
const looseKey = (s) => String(s || '').toLowerCase().replace(/[\s\-·・.'’]/g, '');
// @returns 'full' | 'given' | 'unverified' | null
function verifyName(value, ch, lang) {
    if (lang === 'th' || lang === 'ar') return 'unverified';
    for (const g of rules.textGrams(value)) {
        for (const k of g.keys) {
            if (k === ch.full || (ch.rev && k === ch.rev)) return 'full';
            if (ch.hasSur && k === ch.given) return 'given';
        }
    }
    return null;
}
async function recordNames({ titleId, lang, raw, castIndex, actorForms = [] }) {
    if (!titleId || !castIndex || !SCRIPT_OK[lang] || !raw) return 0;
    let p = null;
    try { p = JSON.parse(raw); } catch { const i = raw.indexOf('{'); try { p = JSON.parse(raw.slice(i, raw.lastIndexOf('}') + 1)); } catch { p = null; } }
    const names = p && typeof p.names === 'object' && !Array.isArray(p.names) ? p.names : null;
    if (!names) return 0;
    const actors = new Set(actorForms.map(looseKey).filter((k) => k.length >= 2));
    const votes = {};
    let n = 0;
    for (const [en, val0] of Object.entries(names).slice(0, 8)) {
        const ch = castIndex.chars.find((c) => c.en === en);
        const val = String(val0 || '').trim();
        if (!ch || !val || [...val].length > 24 || !SCRIPT_OK[lang].test(val)) continue;
        if (actors.has(looseKey(val))) continue; // 배우 이름을 배역 표기로 쓴 경우(치환 사고) 기록 금지
        const kind = verifyName(val, ch, lang);
        if (!kind) continue;
        const key = kind === 'given' ? `${charKey(ch.en)}~g` : charKey(ch.en);
        (votes[key] ||= {})[val] = 1;
        n += 1;
    }
    if (!n) return 0;
    try {
        const { kcultureDb, admin } = require('../config/firebaseKculture');
        const FV = (admin && admin.firestore && admin.firestore.FieldValue) || require('firebase-admin').firestore.FieldValue;
        const inc = {};
        for (const [k, vals] of Object.entries(votes)) { inc[k] = {}; for (const v of Object.keys(vals)) inc[k][v] = FV.increment(1); }
        await kcultureDb.doc(`title_lexicon/${titleId}`).set({ auto: { votes: { [lang]: inc } }, autoUpdatedAt: new Date() }, { merge: true });
    } catch (e) {
        console.warn('[nameLexicon] 표기 기록 실패(무시):', e.message);
        return 0;
    }
    return n;
}

// ── 번역 라우트용 종합 — 수동 사전 매칭 + 규칙 매칭 → 프롬프트 줄 ──────────────────
// cast: [{ name(배우 원명), character(TMDB 배역명) }] · actorNames: 배우 원명(배우 키와 겹치는 배역 키 제외용)
// @returns { lines, namesFor:[배역 영문명 — 응답 "names" 요청 대상], castIndex, pins }
async function analyze({ titleId, text, targetLang, targetName, cast = [], anchored = true }) {
    const { data, index } = titleId ? await loadDoc(titleId) : { data: null, index: null };
    const pins = pinsFrom(data, targetLang);
    const nonLatin = NON_LATIN.test(targetLang);
    const lines = [];
    const namesFor = [];
    const covered = new Set();
    if (index) {
        const m = match(index, text, { anchored });
        for (const h of m.characters) {
            covered.add(charKey(h.entry.en));
            if (nonLatin && h.written.length && !renderFor(h.entry, targetLang, { givenOnly: isGivenOnly(h.entry, h.written), pins })) namesFor.push(h.entry.en);
        }
        lines.push(...promptLines(m, index.lex, targetLang, targetName, pins));
    }
    const actorKeys = cast.map((c) => romanizeKorean(c.name) || c.name).map((n) => rules.keyOfWords(String(n).split(/\s+/)));
    const castIndex = rules.buildCastIndex(cast, { actorKeys });
    const hits = rules.matchCast(castIndex, text, { anchored }).filter((h) => !covered.has(charKey(h.ch.en)));
    if (hits.length) {
        if (!lines.length) lines.push('', '[Name spellings detected in this text — matched to the cast by spelling rules]');
        for (const h of hits) {
            const ck = charKey(h.ch.en);
            const out = nonLatin ? (h.givenOnly ? pins[`${ck}~g`] : pins[ck]) : (h.givenOnly ? h.ch.givenEn : h.ch.en);
            const soundOf = h.givenOnly ? h.ch.givenEn : h.ch.en;
            lines.push(`- ${h.written.map((w) => `「${w}」`).join(', ')} = the CHARACTER "${h.ch.en}" — the same person in a different spelling or script${h.givenOnly ? ' (the writer used the given name only)' : ''}. `
                + (out ? `Write it as "${out}" in ${targetName}${h.givenOnly ? ' — given name only, do not add the surname' : ''}.`
                    : `Write it in ${targetName} by the sound of "${soundOf}"${h.givenOnly ? ' — given name only, do not add the surname' : ''}.`)
                + (h.mixedGiven?.length ? ` Where the writer used only the given name (${h.mixedGiven.map((w) => `「${w}」`).join(', ')}), write the given name only${nonLatin ? '' : ` ("${h.ch.givenEn}")`}.` : '')
                + ` It is NOT the actor ${h.ch.actor}. This OVERRIDES the rule about keeping the writer's spelling.`);
            if (nonLatin && !out) namesFor.push(h.ch.en);
        }
    }
    return { lines, namesFor: [...new Set(namesFor)].filter((en) => castIndex.chars.some((c) => c.en === en)), castIndex, pins };
}

const rules = require('./nameRules');
const { romanizeKorean } = require('./personNames');

module.exports = {
    romanForms, normLatin, buildIndex, match, promptLines, renderFor, load, loadDoc, pinsFrom, recordNames, analyze, charKey, verifyName,
    _cache: CACHE,
};
