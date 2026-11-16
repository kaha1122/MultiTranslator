// ── 유사 이름·작품명 인식 규칙 (2026-11-16) ─────────────────────────────────────
// 시청자는 같은 인물을 여러 철자로 쓴다: Yun I Jun · Yijoon · Yoon Yi-jun · イジュン · Иджун · 李俊 · 이준이가.
// 언어권별 팬 반응 데이터는 없으므로 **수집이 아니라 규칙**으로 같은 인물임을 알아본다.
//
//   원문 단어 → (문자 체계별 라틴화) → 소리 골격 키(skeleton) → TMDB 배역명 키와 대조
//
//   라틴   그대로            한글  RR 로마자화(+조사 떼기)    가나  로마자(+받침 모음 제거 변형)
//   키릴   라틴 전사         한자  한국 한자음(Unihan kHangul, 두음법칙) → RR
//
// 골격 키는 g/k·d/t·b/p·j/ch/z·r/l, eo/u/o/oo/eu, ae/e, yeo/yo/you/yu, ee/i/ui, ng/n 을 같은 기호로 접고
// 공백·하이픈·대소문자를 없앤다. 성씨 관습 표기(Lee/Yi/Rhee, Park/Bak …)는 단어 단위로 먼저 통일한다.
// 서버 코드에서 결정적으로 돈다(Gemini 아님, 비용 0) — 맞은 항목만 번역 프롬프트에 줄로 주입한다.
// 작품명: 띄어쓰기 무시·한국어 줄임말(첫 음절 조합·연음/격음 변형)·초성·영어 머리글자.

const HANJA = require('./hanjaKo.json');

// ── 한글 RR ────────────────────────────────────────────────────────────────
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const isSyl = (ch) => { const c = ch.charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3; };
function hangulToRR(word) {
    let out = '';
    for (const ch of word) {
        if (!isSyl(ch)) continue;
        const c = ch.charCodeAt(0) - 0xac00;
        out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
    }
    return out;
}
const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosungOf = (s) => [...s].filter(isSyl).map((ch) => CHOSUNG[Math.floor((ch.charCodeAt(0) - 0xac00) / 588)]).join('');

// ── 가나 → 로마자 ─────────────────────────────────────────────────────────
const KANA = {
    ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko', ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
    サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo', タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
    ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do', ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
    バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo', パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
    ヤ: 'ya', ユ: 'yu', ヨ: 'yo', ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'o', ン: 'n', ヴ: 'vu',
};
const SMALL_Y = { ャ: 'a', ュ: 'u', ョ: 'o' };
const SMALL_V = { ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' };
function kanaToLatin(word) {
    const s = [...word].map((ch) => { const c = ch.charCodeAt(0); return c >= 0x3041 && c <= 0x3096 ? String.fromCharCode(c + 0x60) : ch; });
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === 'ー' || ch === 'ッ' || ch === '・') continue;
        const base = KANA[ch];
        if (base === undefined) continue;
        const nx = s[i + 1];
        if (nx && SMALL_Y[nx] && base.endsWith('i')) {
            const stem = base.slice(0, -1);
            out += (/^(sh|ch|j)$/.test(stem) ? stem : `${stem}y`) + SMALL_Y[nx]; i++;
        } else if (nx && SMALL_V[nx]) {
            const stem = base === 'u' ? 'w' : base.replace(/[aiueo]$/, '');
            out += stem + SMALL_V[nx]; i++;
        } else out += base;
    }
    return out;
}
// 한국어 받침을 가나로 적으면 모음이 붙는다(김 キム kimu · 박 パク paku · 설 ソル soru) — 그 모음을 뗀 변형
const stripKanaFinals = (lat) => lat.replace(/([kmprl])u(?=[^aeiouy]|$)/g, '$1');

// ── 키릴 → 라틴 ───────────────────────────────────────────────────────────
const CYR = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
    р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
    і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};
const cyrToLatin = (w) => [...w.toLowerCase()].map((ch) => CYR[ch] ?? '').join('');

// ── 한자 → 한국 한자음(복수 후보) ─────────────────────────────────────────
// 두음법칙: 리→이·려→여·류→유·라→나·로→노·녀→여 … (李 = 리/이 둘 다 후보)
function dueum(syl) {
    const c = syl.charCodeAt(0) - 0xac00;
    const i = Math.floor(c / 588), m = Math.floor((c % 588) / 28), f = c % 28;
    const yv = [2, 3, 6, 7, 12, 17, 20].includes(m); // ㅑㅒㅕㅖㅛㅠㅣ
    const mk = (ni) => String.fromCharCode(0xac00 + ni * 588 + m * 28 + f);
    if (i === 5) return yv ? [mk(11)] : [mk(2)];
    if (i === 2 && yv) return [mk(11)];
    return [];
}
function hanjaReadings(ch) {
    const r = HANJA[ch];
    if (!r) return null;
    const set = new Set();
    for (const s of r) { set.add(s); dueum(s).forEach((x) => set.add(x)); }
    return [...set].slice(0, 4);
}

// ── 골격 키 ────────────────────────────────────────────────────────────────
// 단어 단위 성씨 통일(골격 규칙으로 안 접히는 관습 표기만)
const WORD_CANON = {
    lee: 'i', yi: 'i', rhee: 'i', ree: 'i', ri: 'i', i: 'i', rhie: 'i',
    park: 'pak', bak: 'pak', pak: 'pak', bark: 'pak',
    lim: 'im', im: 'im', yim: 'im', rim: 'im',
    oh: 'o', ahn: 'an', noh: 'no', roh: 'no',
    ryu: 'yu', yoo: 'yu', ryoo: 'yu', yu: 'yu',
    hur: 'heo', huh: 'heo', heo: 'heo',
};
const NORM_LATIN = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
// [패턴, 기호] — 매 위치에서 가장 긴 패턴 우선
const SKEL_RULES = [
    ['chzh', 'J'], ['tch', 'J'], ['dzh', 'J'], ['zh', 'J'], ['dj', 'J'], ['ch', 'J'], ['j', 'J'], ['z', 'J'],
    ['yeo', 'Y'], ['yeu', 'Y'], ['you', 'Y'], ['yoo', 'Y'], ['yae', 'Q'], ['wae', 'W'], ['weo', 'V'], ['eui', 'I'],
    ['yo', 'Y'], ['yu', 'Y'], ['ye', 'Q'], ['ya', 'X'], ['yi', 'I'],
    ['we', 'W'], ['oe', 'W'], ['oi', 'W'], ['oy', 'W'], ['wo', 'V'], ['wa', 'Z'], ['oa', 'Z'], ['wi', 'I'], ['ui', 'I'], ['ee', 'I'], ['ie', 'I'],
    ['ae', 'E'], ['ai', 'E'], ['ay', 'E'], ['eo', 'O'], ['eu', 'O'], ['oo', 'O'], ['ou', 'O'],
    ['a', 'A'], ['e', 'E'], ['i', 'I'], ['o', 'O'], ['u', 'O'], ['y', 'I'],
    ['sh', 'S'], ['ss', 'S'], ['s', 'S'], ['ts', 'J'],
    ['kk', 'K'], ['gg', 'K'], ['kh', 'K'], ['ck', 'K'], ['k', 'K'], ['g', 'K'], ['q', 'K'], ['c', 'K'], ['x', 'K'],
    ['tt', 'T'], ['dd', 'T'], ['th', 'T'], ['t', 'T'], ['d', 'T'],
    ['pp', 'P'], ['bb', 'P'], ['ph', 'P'], ['p', 'P'], ['b', 'P'], ['f', 'P'],
    ['rr', 'L'], ['ll', 'L'], ['r', 'L'], ['l', 'L'], ['mm', 'M'], ['m', 'M'], ['ng', 'N'], ['nn', 'N'], ['n', 'N'],
    ['h', 'H'], ['v', 'B'], ['w', 'B'],
];
const VOWEL_SYM = new Set(['Y', 'Q', 'W', 'V', 'I', 'X', 'Z', 'E', 'O', 'A']);
function skeleton(latin) {
    const t = NORM_LATIN(latin);
    const out = [];
    for (let i = 0; i < t.length;) {
        let hit = null;
        for (const [p, sym] of SKEL_RULES) if (t.startsWith(p, i)) { hit = [p, sym]; break; }
        if (!hit) { i += 1; continue; }
        out.push(hit[1]);
        i += hit[0].length;
    }
    // h는 모음 앞에서만 소리(ahn·oh·Jaehee의 h는 유지) · 같은 자음 연속은 하나로(Seok-goo = Seokgu)
    const res = [];
    for (let i = 0; i < out.length; i++) {
        const s = out[i];
        if (s === 'H' && !VOWEL_SYM.has(out[i + 1])) continue;
        if (!VOWEL_SYM.has(s) && res[res.length - 1] === s) continue;
        res.push(s);
    }
    return res.join('');
}
// 단어 묶음 → 골격 키(단어마다 성씨 통일 후 이어 붙임)
const keyOfWords = (words) => skeleton(words.map((w) => WORD_CANON[NORM_LATIN(w)] ?? NORM_LATIN(w)).join(''));

// ── 원문 → 비교 후보 n-gram ─────────────────────────────────────────────────
const WORD_RE = /[\p{Script=Latin}]+(?:['’\-][\p{Script=Latin}]+)*|[\p{Script=Cyrillic}]+(?:-[\p{Script=Cyrillic}]+)*|[\p{Script=Hangul}]+|[\p{Script=Katakana}ー]+|[\p{Script=Han}]+/gu; // 히라가나는 조사(と·は·が)라 구분자로 둔다 — 이름은 가타카나
const PARTICLES = ['이랑', '이가', '이는', '이를', '이의', '이도', '이한테', '한테', '에게', '이야', '이네', '이에요', '씨가', '씨는', '씨도', '씨', '님이', '님은', '님', '이는', '은', '는', '이', '가', '을', '를', '의', '도', '랑', '와', '과', '아', '야', '하고', '까지', '만', '처럼', '보다'];
function stripParticle(w) {
    for (const p of PARTICLES) if (w.length - p.length >= 2 && w.endsWith(p)) return w.slice(0, -p.length);
    return null;
}
const scriptOf = (w) => (/\p{Script=Latin}/u.test(w) ? 'latn' : /\p{Script=Cyrillic}/u.test(w) ? 'cyrl' : /\p{Script=Hangul}/u.test(w) ? 'hang' : /\p{Script=Han}/u.test(w) ? 'hani' : 'kana');

// 단어 → 라틴 변형들
function latinForms(w, script) {
    if (script === 'latn') return [w.replace(/['’]s$/i, '')];
    if (script === 'cyrl') return [cyrToLatin(w)];
    if (script === 'kana') { const l = kanaToLatin(w); const s = stripKanaFinals(l); return s !== l ? [l, s] : [l]; }
    if (script === 'hang') { const st = stripParticle(w); return [...new Set([hangulToRR(w), st && hangulToRR(st)].filter(Boolean))]; }
    return [];
}

// @returns [{ raw, keys:Set, n, script, cap }] — 같은 문자 체계·문장 부호 없는 연속 단어끼리만 1~3-gram
function textGrams(text) {
    const src = String(text || '');
    const words = [];
    let prevEnd = -1, seg = 0, prevScript = null;
    for (const m of src.matchAll(WORD_RE)) {
        const script = scriptOf(m[0]);
        const gap = prevEnd >= 0 ? src.slice(prevEnd, m.index) : '';
        if (prevEnd >= 0 && (!/^[\s・·]*$/.test(gap) || script !== prevScript)) seg += 1;
        words.push({ raw: m[0], script, seg });
        prevEnd = m.index + m[0].length;
        prevScript = script;
    }
    const grams = [];
    for (let i = 0; i < words.length; i++) {
        const w0 = words[i];
        if (w0.script === 'hani') {
            // 한자는 띄어쓰기가 없다 — 2~3자 창을 미끄러뜨리며 한국 한자음 조합을 만든다
            const chars = [...w0.raw];
            for (let a = 0; a < chars.length; a++) {
                for (let n = 2; n <= 3 && a + n <= chars.length; n++) {
                    const win = chars.slice(a, a + n);
                    const rs = win.map(hanjaReadings);
                    if (rs.some((x) => !x)) continue;
                    let combos = [''];
                    for (const opts of rs) combos = combos.flatMap((p) => opts.map((o) => p + o)).slice(0, 64);
                    grams.push({ raw: win.join(''), keys: new Set(combos.map((h) => skeleton(hangulToRR(h)))), n, script: 'hani', cap: true });
                }
            }
            continue;
        }
        let parts = [];
        for (let n = 1; n <= 3 && i + n <= words.length; n++) {
            const w = words[i + n - 1];
            if (w.seg !== w0.seg || w.script === 'hani') break;
            parts = [...parts, w];
            // 단어별 라틴 변형의 곱(보통 1~2개)
            let combos = [[]];
            for (const p of parts) combos = combos.flatMap((c) => latinForms(p.raw, p.script).map((f) => [...c, f])).slice(0, 8);
            const raw = parts.map((p) => p.raw).join(w0.script === 'kana' ? '・' : ' ');
            grams.push({ raw, keys: new Set(combos.map(keyOfWords)), n, script: w0.script, cap: /^\p{Lu}/u.test(w0.raw) });
        }
    }
    return grams;
}

// ── 배역 인덱스 ─────────────────────────────────────────────────────────────
const SURNAMES_LATIN = new Set(('kim lee yi rhee park bak pak choi choe jung jeong chung kang gang cho jo yoon yun jang chang lim im yim han oh seo suh shin sin '
    + 'kwon gwon hwang ahn an song ryu yoo yu jeon jun chun hong ko go moon mun yang son sohn bae baek paek heo hur huh nam shim sim noh roh ha kwak '
    + 'sung seong cha joo ju woo koo gu min na ra jin ji eom um chae won cheon bang kong gong hyun hyeon byun byeon yeom yeo choo chu do doh seok sun seon '
    + 'seol sul yeon pyo myung ki gi wang keum geum tak kook guk bong tae yook yuk in je gil kil wi wee ma ok').split(' '));
// 배역 칸이 사람 이름이 아닌 경우(Yi-jun's sister · Himself · Detective · (voice))는 제외
function looksLikeName(s) {
    const t = String(s || '').trim();
    if (!t || t.length > 30 || /['’]s\b|\(|\)|\/|\bself\b|\bvoice\b|\bcameo\b|\bguest\b/i.test(t)) return false;
    const words = t.split(/\s+/);
    if (words.length > 3) return false;
    return words.every((w) => /^\p{Lu}[\p{L}\-]*$/u.test(w));
}
const STOP_1GRAM = new Set(('i a an in on so do go no oh ha na ma ya yes son song sun young hope joy may ok ah eh um mi me ko ki jo ji he hee she we you yo '
    + 'see sea high hi hey ga da sa ra la pa ka jun june min man men one won bin bae ban bang hang han hon hun jae seo ho ah-ha mom dad').split(' '));

// cast: [{ name(배우 원명), character(TMDB 배역명) }] → 인덱스
function buildCastIndex(cast, { actorKeys = [] } = {}) {
    const chars = [];
    const actorSet = new Set(actorKeys.filter(Boolean));
    for (const c of cast || []) {
        if (!looksLikeName(c.character)) continue;
        const words = c.character.trim().split(/\s+/);
        const hasSur = words.length >= 2 && SURNAMES_LATIN.has(words[0].toLowerCase());
        const surname = hasSur ? words[0] : '';
        const givenWords = hasSur ? words.slice(1) : words;
        const full = keyOfWords(words);
        const rev = hasSur ? keyOfWords([...givenWords, surname]) : null;
        const given = keyOfWords(givenWords);
        chars.push({ en: c.character.trim(), givenEn: givenWords.join(' '), surname, actor: c.name, full, rev, given, hasSur });
    }
    // 키 → 배역 (두 배역이 같은 키면 그 키는 버린다 — 모호)
    const byKey = new Map();
    const add = (k, ch, kind) => {
        if (!k || k.length < 3 || actorSet.has(k)) return;
        const prev = byKey.get(k);
        if (prev && prev.ch !== ch) { byKey.set(k, { ambiguous: true }); return; }
        if (!prev) byKey.set(k, { ch, kind });
    };
    for (const ch of chars) {
        add(ch.full, ch, 'full');
        if (ch.rev) add(ch.rev, ch, 'full');
        if (ch.hasSur || ch.given !== ch.full) add(ch.given, ch, 'given');
        else add(ch.given, ch, 'full');
    }
    return { chars, byKey };
}

// 편집 거리 ≤1 (긴 성+이름의 오타 허용용)
function within1(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, e = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++e > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return e + (a.length - i) + (b.length - j) <= 1;
}

// @returns [{ ch, written:[원문 표기], givenOnly }]
// anchored(작품 특정 글)가 아니면 약한 형태(이름만·짧은 키)는 매칭하지 않는다.
function matchCast(index, text, { anchored = false } = {}) {
    if (!index || !index.chars.length || !text) return [];
    const grams = textGrams(text).sort((a, b) => b.n - a.n || b.raw.length - a.raw.length);
    const hits = new Map();
    const used = [];
    for (const g of grams) {
        if (used.some((u) => u.includes(g.raw))) continue; // 더 긴 묶음에 이미 포함
        let found = null;
        for (const k of g.keys) {
            const v = index.byKey.get(k);
            if (v && !v.ambiguous) { found = { ...v, k }; break; }
        }
        if (!found && g.script === 'latn' && g.n >= 2) {
            // 오타 1자 — 성+이름 키(7자 이상)에만
            outer: for (const k of g.keys) {
                if (k.length < 7) continue;
                for (const ch of index.chars) if (within1(k, ch.full) || (ch.rev && within1(k, ch.rev))) { found = { ch, kind: 'full', k }; break outer; }
            }
        }
        if (!found) continue;
        const weak = found.kind === 'given' || found.k.length < 4;
        if (weak && !anchored) continue;
        if (g.n === 1 && g.script === 'latn') {
            if (STOP_1GRAM.has(g.raw.toLowerCase()) && !g.cap) continue;
            if (found.k.length < 4 && !g.cap) continue; // Min·Jun류는 대문자로 쓴 경우만
        }
        if (g.script === 'hani' && g.n === 2 && found.kind === 'given' && !anchored) continue;
        if (g.script === 'hang' && [...g.raw].length < 2) continue; // 한글 1음절(전·준)은 일반어와 겹친다
        const h = hits.get(found.ch) || { ch: found.ch, written: [], kinds: new Set(), givenForms: [] };
        if (!h.written.includes(g.raw)) h.written.push(g.raw);
        if (found.kind === 'given' && !h.givenForms.includes(g.raw)) h.givenForms.push(g.raw);
        h.kinds.add(found.kind);
        hits.set(found.ch, h);
        used.push(g.raw);
    }
    return [...hits.values()].map((h) => ({
        ch: h.ch, written: h.written.slice(0, 4),
        givenOnly: !h.kinds.has('full') && h.ch.hasSur,
        mixedGiven: h.kinds.has('full') && h.ch.hasSur ? h.givenForms.slice(0, 3) : [], // 성+이름과 이름만이 한 글에 섞인 경우의 이름만 형태
    }));
}

// ── 작품명 변형 ─────────────────────────────────────────────────────────────
// 연음·격음·경음 — 백거짓 → 배커짓·배꺼짓, 나의 → (변화 없음)
const FIN_TO_INI = { 1: 0, 4: 2, 7: 3, 8: 5, 16: 6, 17: 7, 19: 9, 22: 12, 23: 14, 24: 15, 25: 16, 26: 17, 27: 18 };
const compose = (i, m, f) => String.fromCharCode(0xac00 + i * 588 + m * 28 + f);
const parts = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28]; };
function soundVariants(word) {
    const s = [...word];
    if (s.length < 2 || !s.every(isSyl)) return [];
    const out = new Set();
    const step = (arr, k, mode) => {
        const [i1, m1, f1] = parts(arr[k]); const [i2, m2, f2] = parts(arr[k + 1]);
        if (!f1) return null;
        let ni = null;
        if (i2 === 11 && FIN_TO_INI[f1] !== undefined && f1 !== 21) ni = FIN_TO_INI[f1];        // 연음
        else if (f1 === 1 && i2 === 0) ni = mode ? 1 : 15;                                     // ㄱ+ㄱ → ㄲ/ㅋ
        else if (f1 === 1 && i2 === 18) ni = 15;                                               // ㄱ+ㅎ → ㅋ
        else if (f1 === 17 && i2 === 7) ni = mode ? 8 : 17;                                    // ㅂ+ㅂ → ㅃ/ㅍ
        else if ((f1 === 7 || f1 === 19) && i2 === 3) ni = mode ? 4 : 16;                      // ㄷ/ㅅ+ㄷ → ㄸ/ㅌ
        if (ni === null) return null;
        const a = [...arr]; a[k] = compose(i1, m1, 0); a[k + 1] = compose(ni, m2, f2);
        return a;
    };
    for (const mode of [0, 1]) {
        let a = [...s], changed = false;
        for (let k = 0; k < a.length - 1; k++) { const n = step(a, k, mode); if (n) { a = n; changed = true; } }
        if (changed) out.add(a.join(''));
    }
    out.delete(word);
    return [...out].slice(0, 3);
}
// 숫자 → 한자어 읽기(100일의 거짓말 → 백일의 거짓말 → 백거짓·배커짓). 0~9999만.
const DIG = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
function sinoNumber(n) {
    if (!Number.isFinite(n) || n < 0 || n > 9999) return null;
    if (n === 0) return '영';
    let out = '';
    for (const [u, name] of [[1000, '천'], [100, '백'], [10, '십']]) {
        const d = Math.floor(n / u) % 10;
        if (d) out += (d === 1 ? '' : DIG[d]) + name;
    }
    return out + DIG[n % 10];
}
const readNumbers = (s) => s.replace(/\d+/g, (m) => sinoNumber(Number(m)) ?? m);
// 흔한 영어 약어 — 제목 머리글자와 겹치면 일상 표현이 작품으로 오인된다(너에게 다이브 = DIY, 밑도 끝도 없이 너다 = OMG)
const COMMON_ACRONYMS = new Set(('OMG DIY TBR LOL BTW IMO IMHO FYI TBH IDK SMH WTF OTP DND NTS ASAP FOMO TLDR USA CEO TV OST MV PD ' +
    'BTS SNS DM PM AM ETA FAQ RIP POV AKA IRL GOAT ICYMI JK NGL IKR ILY TMI ROFL LMAO MDL KST EST PST UTC EP ML FL SML ' +
    'NYC UK EU UN CIA FBI NBA NFL GPS ATM DIY TBA TBD').split(/\s+/));
// @returns [{ k(소문자 비교형), d(원문 표시형), kind, strong }]
function titleVariants(titles) {
    const out = [];
    const seen = new Set();
    const push = (k, d, kind, strong) => { const kk = k.toLowerCase(); if (kk && !seen.has(kk)) { seen.add(kk); out.push({ k: kk, d, kind, strong }); } };
    const ko = readNumbers(String(titles?.ko || '').trim());
    if (ko && /\p{Script=Hangul}/u.test(ko)) {
        const words = ko.split(/\s+/).map((w) => w.replace(/[^\p{Script=Hangul}\p{N}]/gu, '')).filter(Boolean);
        const flat = words.join('');
        if (words.length > 1) push(flat, ko, 'nospace', flat.length >= 4);
        const rawFlat = String(titles?.ko || '').replace(/[^\p{Script=Hangul}\p{N}]/gu, '');
        if (rawFlat !== flat && rawFlat.length >= 4) push(rawFlat, ko, 'nospace', true); // 100일의거짓말(숫자 그대로)
        const heads = words.map((w) => (w.length >= 2 && w.endsWith('의') ? w.slice(0, -1) : w));
        const abbr = [];
        if (heads.length >= 2) {
            abbr.push(heads.map((w) => w[0]).join(''));                                              // 백일의 거짓말 → 백거
            const last = heads[heads.length - 1];
            for (let n = 2; n <= last.length; n++) abbr.push(heads.slice(0, -1).map((w) => w[0]).join('') + last.slice(0, n)); // 백거짓 · 백거짓말
            if (last.length >= 4) abbr.push(last);                                                    // 유죄인간
        }
        for (const a of abbr) {
            if (a === flat) continue;
            push(a, ko, 'abbr', a.length >= 3);
            for (const v of soundVariants(a)) push(v, ko, 'abbr-sound', v.length >= 3);              // 배커짓
        }
        const cho = chosungOf(flat);
        if (cho.length >= 4) push(cho, ko, 'chosung', true);
    }
    const en = String(titles?.en || '').trim();
    if (en) {
        const ws = en.split(/[\s:–\-]+/).filter((w) => /^\p{L}/u.test(w));
        if (ws.length >= 3) {
            const ac = ws.map((w) => w[0]).join('').toUpperCase();
            if (ac.length >= 3 && !COMMON_ACRONYMS.has(ac)) push(ac, en, 'acronym', true);
        }
    }
    return out;
}
// 줄임말 매칭: 한글은 공백 제거 후 포함 검사, 머리글자는 대문자 단어 정확 일치
function matchTitleVariant(v, text, textNoSpace) {
    if (v.kind === 'acronym') return new RegExp(`(^|[^A-Za-z])${v.k.toUpperCase()}([^A-Za-z]|$)`).test(text);
    if (v.kind === 'chosung') return new RegExp(`(^|[^ㄱ-ㅎ])${v.k}([^ㄱ-ㅎ]|$)`).test(text);
    return textNoSpace.includes(v.k);
}

module.exports = {
    skeleton, keyOfWords, hangulToRR, kanaToLatin, cyrToLatin, hanjaReadings, textGrams,
    buildCastIndex, matchCast, looksLikeName, titleVariants, soundVariants, matchTitleVariant, chosungOf,
};
