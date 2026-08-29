// ── Dari 리뷰/스레드 번역 시드 기계 검수 (읽기 전용 · Gemini 미호출 · 비용 0) ──────────
// 사용: cd server && node scripts/qa-dari-reviews.js [--post <id>] [--json logs/qa.json] [--verbose]
//
// 2026-08-29 전량 검수에서 신설. 형식·표기 결함만 잡는다 — **의미 오역은 원리적으로 못 잡으므로**
// scripts/qa-dari-semantic.js(L2, Gemini 대조)와 함께 써야 한다.
//
// ⚠ 오탐 주의(초판에서 실제로 겪음 — 규칙을 바꿀 때 반드시 실물로 확인할 것):
//   · vi의 Note는 "Lưu ý:"다. 언어별 사전 없이 'Note|注' 류로 검사하면 34편 전부 오탐이 난다.
//   · CJK는 en 대비 길이비 0.33~0.55가 정상이다(zh-CN 0.35, ja 0.47, ko 0.51). 일괄 0.45 하한은 전부 오탐.
//   · ko '다리'는 "기다리는"·"다리를 건너"와 충돌한다 → 반드시 Dari 문맥 한정 정규식(lib/dari DARI_TRANSLIT).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { SEED_LANGS } = require('../lib/dari');
const { scrubDariTranslit, TAIL_BY_LANG } = require('../lib/dari')._qa;

const LANGS = ['en', ...SEED_LANGS];
const HANGUL = /[가-힣]/;
const SECTIONS = ['📌', '🌉', '✅', '⚠', '🎯', '💬'];

// en 본문 대비 정상 길이비 — 34편 실측 분포에서 여유를 둔 밴드(문자 정보밀도 차이).
const LEN_BAND = {
    ko: [0.40, 0.75], ja: [0.36, 0.70], 'zh-CN': [0.26, 0.55],
    vi: [0.85, 1.45], fr: [0.90, 1.50], de: [0.85, 1.45], es: [0.90, 1.50],
    ru: [0.80, 1.35], 'pt-BR': [0.90, 1.50], id: [0.85, 1.45], ar: [0.65, 1.20],
};

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

// 한 언어 문서 1개 검사 → 결함 배열
// 꼬리 기대값은 **base 영문 기준**이다 — 영문에 Note 줄이 없는 글(2026-07-29 초기 게시분)에
// 다른 언어만 Note를 붙이면 원문에 없는 문장을 만들어내는 것이 된다(그 자체가 en:서명/Note불일치로 잡힘).
function tailExpectation(enBody) {
    const lines = String(enBody || '').trim().split('\n');
    return {
        sig: lines.some((l) => l.trim() === TAIL_BY_LANG.en.sig),
        note: /^Note\s*:/i.test((lines[lines.length - 1] || '').trim()),
    };
}

function checkOne({ lang, body, title, enBody, expect }) {
    const out = [];
    const add = (code, detail) => out.push({ lang, code, detail });

    if (!body) { add('본문시드없음', ''); return out; }
    if (!title) add('제목시드없음', '');

    // 1) 비-ko 문서에 한글 — 해당 언어 독자가 읽을 수 없는 글자(glossary 유출 패턴)
    if (lang !== 'ko') {
        const hits = [...body.matchAll(/[가-힣]+/g)].map((m) => m[0]);
        if (hits.length) add('본문한글혼입', [...new Set(hits)].slice(0, 6).join(' '));
        if (title && HANGUL.test(title)) add('제목한글혼입', title.slice(0, 40));
    }

    // 2) Dari 음역 — 문맥 한정 규칙(lib/dari와 SSOT 공유)으로 검사
    if (scrubDariTranslit(body, lang) !== body) add('Dari음역', '본문');
    if (title && scrubDariTranslit(title, lang) !== title) add('Dari음역', '제목');
    if (!/Dari/.test(body)) add('Dari표기소실', '본문에 라틴 "Dari"가 없음');

    // 3) 섹션 이모지 — 리뷰 템플릿 6종
    const miss = SECTIONS.filter((s) => !body.includes(s));
    if (miss.length) add('섹션누락', miss.join(''));

    // 4) 꼬리 2줄 — 고정 테이블과 **완전 일치**해야 한다(2026-08-29 결정적 주입 도입 후의 정답)
    const tail = TAIL_BY_LANG[lang];
    if (tail && expect.sig) {
        const lines = body.trim().split('\n');
        const note = lines[lines.length - 1];
        const sig = expect.note ? lines[lines.length - 2] : note;
        if (sig !== tail.sig) add('서명불일치', JSON.stringify(sig || '').slice(0, 70));
        if (expect.note && note !== tail.note) add('Note불일치', JSON.stringify(note || '').slice(0, 70));
    } else if (tail && !expect.sig) {
        add('base서명없음', 'en 원문에 서명 줄이 없다 — base 본문을 먼저 고칠 것');
    }

    // 5) 길이비 — 누락·폭주 탐지
    if (lang !== 'en' && enBody) {
        const r = body.length / enBody.length;
        const band = LEN_BAND[lang];
        if (band && (r < band[0] || r > band[1])) add('길이이상', `${r.toFixed(2)} (정상 ${band[0]}~${band[1]})`);
    }

    // 6) 깨진 문자·중복 — flash-lite 글리치 잔재
    if (/�/.test(body)) add('깨진문자', '');
    if (/(.{40,}?)\1/s.test(body)) add('문단중복', '');
    return out;
}

async function main() {
    const only = arg('post', '');
    const verbose = process.argv.includes('--verbose');
    let posts;
    if (only) {
        const d = await kcultureDb.doc(`posts/${only}`).get();
        posts = [{ id: d.id, ...d.data() }];
    } else {
        const s = await kcultureDb.collection('posts').where('curator', '==', true).get();
        posts = s.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    }

    console.log(`# Dari 리뷰 기계 검수 — ${posts.length}편 × ${LANGS.length}언어\n`);
    const tally = {};
    const report = [];

    for (const p of posts) {
        const snap = await kcultureDb.collection(`posts/${p.id}/translations`).get();
        const doc = {};
        snap.docs.forEach((d) => { doc[d.id] = d.data()?.body || ''; });
        const issues = [];
        const expect = tailExpectation(doc.en);
        for (const L of LANGS) {
            issues.push(...checkOne({ lang: L, body: doc[L], title: doc[`${L}__title`], enBody: doc.en, expect }));
        }
        issues.forEach((i) => { tally[i.code] = (tally[i.code] || 0) + 1; });
        const name = (p.titleName || p.title || '?').slice(0, 32);
        report.push({ postId: p.id, name, titleId: p.titleId, media: p.media, issues });
        const label = issues.length ? `⚠${String(issues.length).padStart(3)}` : 'OK  ';
        const brief = [...new Set(issues.map((i) => `${i.lang}:${i.code}`))].join(', ');
        console.log(`${label} | ${name.padEnd(32)} | ${p.id} | ${brief}`);
        if (verbose) issues.forEach((i) => console.log(`        ${i.lang} ${i.code} ${i.detail}`));
    }

    console.log('\n## 유형별 집계');
    Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(12)} ${v}`));
    const bad = report.filter((r) => r.issues.length).length;
    console.log(`\n대상 ${report.length}편 / 지적 ${bad}편 / 총 ${Object.values(tally).reduce((a, b) => a + b, 0)}건`);

    const jsonPath = arg('json', '');
    if (jsonPath) {
        const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(__dirname, '..', jsonPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, JSON.stringify({ at: new Date().toISOString(), tally, report }, null, 2), 'utf8');
        console.log(`\n리포트 저장: ${abs}`);
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
