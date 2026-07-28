// ── 제목 어휘 적중 작품 CSV 추출 (사람 전수 검수용) ─────────────────────────
// flag-adult-titles.js의 자동 판정이 **메타데이터에 의존**하는데, TMDB에 키워드·등급이 전혀 없는
// 성인물이 다수 있다(「여대생: 스폰 찾기」류). 그런 건 남은 신호가 제목뿐이고, 제목 매칭은 오탐이
// 섞여 자동 숨김에 못 쓴다(「공정사회」에 '정사', 「핑크퐁 탐정사무소」에 '정사').
// → **넓게 뽑아 사람이 전수로 판단**하고, 그 결과만 adult-manual.json으로 반영한다.
//
// ⚠ 줄거리(overview) 매칭은 일부러 쓰지 않는다 (2026-07-28 실측으로 기각):
//   강한 표현(성관계·매춘·알몸)으로 뽑아도 「사마리아」(김기덕)·「다른 나라에서」(홍상수)·
//   군사기지 다큐·의학드라마가 대량으로 걸렸다. 한국 예술·독립영화 시놉시스에는 성 서술이 흔해서,
//   "성인물"과 "성을 다룬 진지한 작품"이 같은 단어를 쓴다. 제목은 그 작품이 무엇으로 팔리는지를
//   드러내지만 줄거리는 무엇을 다루는지를 쓴다 — 그래서 제목이 훨씬 정확한 신호다.
//
// 사용법:
//   node scripts/export-title-review.js               # 미숨김 전체에서 추출
//   node scripts/export-title-review.js --include-hidden   # 이미 숨긴 것도 포함(오탐 재검수용)
// 산출물: scripts/logs/title-review-<시각>.csv  (UTF-8 BOM — 한글이 Excel에서 안 깨짐)
//
// 검수 후 반영:
//   판정 열에 Y(성인물) 표시 → 그 id들을 scripts/adult-manual.json의 "hide" 배열에 넣고
//   node scripts/flag-adult-titles.js 재실행. (N/빈칸은 아무 일도 하지 않는다)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const INCLUDE_HIDDEN = process.argv.includes('--include-hidden');

// ── 어휘 3단 ────────────────────────────────────────────────────────────────
// 등급을 나눈 이유는 **검수 순서**를 위해서다. T1부터 보면 실제 성인물이 몰려 있어 빨리 끝난다.
// T1 확실 — 정상 작품 제목에는 사실상 안 나오는 표현
const T1 = /(섹스|야동|19금|에로|음란|색녀|색기|알몸|나체|애무|노출|젖|맨살|아랫도리|후배위|자위|스와핑|성인영화|매춘|창녀|콜걸|안마방|룸살롱|정욕|음탕|섹시)/g;
// T2 관계 어휘 — 한국 성인물이 상습적으로 쓰는 관계·직업 프레임(정상작에도 나오므로 확인 필요)
const T2 = /(처제|형수|시누이|올케|이모|새엄마|계모|며느리|과부|유부녀|사모님|여대생|여직원|비서|간호사|조교|과외|스폰|원나잇|하룻밤|동창회|불륜|외도|(?<![탐공])정사(?!회)|밀회|동거|첫경험|모텔|여관)/g;
// T3 수식어 — 단독으로는 근거가 약함(오탐 다수 예상, 마지막에 훑는 용도)
const T3 = /(은밀|아찔|달콤|뜨거운|짜릿|야한|농염|관능|욕정|욕망|유혹|가슴|몸매|대물|밤일|본능)/g;

const uniq = (s, re) => [...new Set(String(s || '').match(re) || [])];

// CSV 한 칸 — 쉼표·따옴표·줄바꿈이 들어가도 Excel이 정확히 읽도록 항상 인용부호로 감싼다.
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    console.log('\nFirestore titles 스캔 중…');
    const snap = await kcultureDb.collection('titles')
        .select('media', 'hidden', 'hiddenReason', 'searchTitle',
            'meta.title', 'meta.overview', 'meta.vote_count',
            'meta.release_date', 'meta.first_air_date')
        .get();

    const rows = [];
    let total = 0, hidden = 0;
    snap.forEach((d) => {
        const x = d.data() || {};
        total++;
        if (x.hidden === true) { hidden++; if (!INCLUDE_HIDDEN) return; }
        if (x.media !== 'tv' && x.media !== 'movie') return;

        const m = x.meta || {};
        const ko = x.searchTitle?.ko || '';
        const en = x.searchTitle?.en || m.title || '';
        // 매칭은 모든 언어 제목을 합쳐서 — 성인물 신호는 대개 한국어 제목에만 있다.
        const all = [m.title, ...Object.values(x.searchTitle || {})].filter(Boolean).join(' ');

        const h1 = uniq(all, T1), h2 = uniq(all, T2), h3 = uniq(all, T3);
        if (!h1.length && !h2.length && !h3.length) return;

        rows.push({
            tier: h1.length ? 'T1' : (h2.length ? 'T2' : 'T3'),
            id: d.id,
            media: x.media,
            ko: ko || en,
            en,
            year: String(m.release_date || m.first_air_date || '').slice(0, 4),
            votes: Number(m.vote_count || 0),
            hits: [...h1, ...h2, ...h3].join(' '),
            state: x.hidden === true ? `숨김(${x.hiddenReason || ''})` : '노출중',
            overview: String(m.overview || '').slice(0, 150),
        });
    });

    // T1 → T2 → T3, 같은 단계 안에서는 제목순(시리즈물이 붙어 있어야 훑기 쉽다)
    const order = { T1: 0, T2: 1, T3: 2 };
    rows.sort((a, b) => order[a.tier] - order[b.tier] || String(a.ko).localeCompare(String(b.ko)));

    const head = ['판정(Y=성인물)', '단계', 'id', '종류', '한국어 제목', '영어 제목', '연도', '평점수', '적중 어휘', '현재 상태', '줄거리(150자)', 'TMDB 링크'];
    const lines = [head.map(cell).join(',')];
    for (const r of rows) {
        lines.push([
            '', r.tier, r.id, r.media === 'movie' ? '영화' : 'TV', r.ko, r.en, r.year, r.votes,
            r.hits, r.state, r.overview, `https://www.themoviedb.org/${r.media}/${r.id}`,
        ].map(cell).join(','));
    }

    const dir = path.join(__dirname, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `title-review-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    // ﻿(BOM) — 없으면 Excel이 UTF-8을 못 알아채고 한글이 깨진다.
    fs.writeFileSync(file, `﻿${lines.join('\r\n')}\r\n`, 'utf8');

    const by = (t) => rows.filter((r) => r.tier === t).length;
    console.log(`\n전체 ${total}편 · 이미 숨김 ${hidden}편${INCLUDE_HIDDEN ? '(포함)' : '(제외)'}`);
    console.log(`추출 ${rows.length}편 — T1 ${by('T1')} · T2 ${by('T2')} · T3 ${by('T3')}`);
    console.log(`\n📄 ${file}`);
    console.log('   Excel로 열어 A열(판정)에 성인물이면 Y를 적으세요.');
    console.log('   T1부터 보시면 실제 성인물이 몰려 있어 빨리 끝납니다.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
