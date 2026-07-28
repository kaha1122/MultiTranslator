// ── 성인물 3단계 재판정 추출 (FINAL_ID.MD 기준) ─────────────────────────────
// 사람이 확정한 판정 파일(logs/FINAL_ID.MD: D=삭제 / N=번역제외 / Y=번역대상)을 읽어,
// 그 위에 **성인물 여부를 다시 판정**해 매칭된 행만 같은 포맷으로 내보낸다.
//
// 판정 순서(먼저 걸리면 거기서 확정 — 매칭단계 열에 기록)
//   1) 원제(original_title)      에 한국어 성인 어휘        → Y
//   2) (1) 아니면 meta 줄거리(원어)에 한국어 성인 어휘        → Y
//   3) (1)(2) 아니면 TMDB 영어 줄거리에 영어 성인 어휘        → Y
//
// ⚠ 자동으로 숨기지 않는다. 사람이 검수하는 목록을 만드는 것이 목적이다.
//   특히 2)·3)의 줄거리 매칭은 오탐이 많다(2026-07-28 실측): 강한 표현으로 뽑아도
//   「사마리아」(김기덕)·「다른 나라에서」(홍상수)·군사기지 다큐가 걸렸다. 한국 예술·독립영화
//   시놉시스에는 성 서술이 흔해 "성인물"과 "성을 다룬 진지한 작품"이 같은 단어를 쓴다.
//   → 그래서 매칭 단계·어휘·등급을 열로 남겨 사람이 근거를 보고 거를 수 있게 한다.
//
// 사용법:
//   node scripts/export-adult-rescan.js                 # 전량
//   node scripts/export-adult-rescan.js --verdict Y     # 번역대상(Y)만 대상으로
//   node scripts/export-adult-rescan.js --limit 500
// 산출물: scripts/logs/adult-rescan-<시각>.csv (UTF-8 BOM)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    verdict: arg('verdict', ''),          // 'Y'|'N'|'D' 로 대상 한정
    ovMax: parseInt(arg('overview-max', '800'), 10),
    final: arg('final', path.join(__dirname, 'logs', 'FINAL_ID.MD')),
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), cyan = paint('36'), green = paint('32'), yellow = paint('33');
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const join = (arr, f) => (arr || []).map(f).filter(Boolean).join(',');

// ── 성인 어휘 ───────────────────────────────────────────────────────────────
// 제목용 3단 (export-title-review.js와 동일 — 검수 순서를 위해 등급을 나눈다)
//   T1 확실   : 정상 작품 제목에는 사실상 안 나오는 표현
//   T2 관계   : 한국 성인물이 상습적으로 쓰는 관계·직업 프레임(정상작에도 나옴)
//   T3 수식어 : 단독으로는 근거가 약함(오탐 다수 예상)
// ⚠ '정사'는 부분문자열 충돌이 있어 lookbehind로 차단한다(「공정사회」·「탐정사무소」).
const T1 = /(섹스|야동|19금|에로|음란|색녀|색기|알몸|나체|애무|노출|젖|맨살|아랫도리|후배위|자위|스와핑|성인영화|매춘|창녀|콜걸|안마방|룸살롱|정욕|음탕|섹시)/;
const T2 = /(처제|형수|시누이|올케|이모|새엄마|계모|며느리|과부|유부녀|사모님|여대생|여직원|비서|간호사|조교|과외|스폰|원나잇|하룻밤|동창회|불륜|외도|(?<![탐공])정사(?!회)|밀회|동거|첫경험|모텔|여관)/;
const T3 = /(은밀|아찔|달콤|뜨거운|짜릿|야한|농염|관능|욕정|욕망|유혹|가슴|몸매|대물|밤일|본능)/;

// 한국어 줄거리용 — 제목보다 오탐이 크므로 **강한 표현만** 쓴다(약한 표현은 정상작 대량 적중).
const OV_KO = /(성관계|섹스|정사를|육체관계|알몸|나체|자위|애무|성욕|음란|야동|에로|성인영화|몸을 섞|잠자리를 가|원나잇|불륜을|외도를|유부녀|스와핑|매춘|성매매|콜걸|안마시술|젖가슴|애액|신음)/;

// 영어 줄거리용 — 강/약 분리. 약한 쪽(sexual·affair 등)은 진지한 작품에도 흔해 등급으로 구분만 한다.
const OV_EN_S = /(softcore|hardcore|pornograph|\bporn\b|erotic|eroticism|masturbat|orgasm|prostitut|brothel|call girl|threesome|incest|voyeur|fetish|intercourse|nudity|explicit sex|sex scene|adult film|adult video)/i;
const OV_EN_W = /(seduc|lust|sensual|mistress|adultery|affair|naked|nude|make love|lovemaking|arous|stepmother|sister-in-law|one-night|infidelity)/i;

const hit = (s, re) => (re.exec(String(s || '')) || [])[0] || null;

// 1) 원제 → 2) 한국어 줄거리 → 3) 영어 줄거리. 먼저 걸린 단계에서 확정.
function judge(orig, koOv, enOv) {
    let m;
    if ((m = hit(orig, T1))) return { step: '1-원제', term: m, tier: 'T1' };
    if ((m = hit(orig, T2))) return { step: '1-원제', term: m, tier: 'T2' };
    if ((m = hit(orig, T3))) return { step: '1-원제', term: m, tier: 'T3' };
    if ((m = hit(koOv, OV_KO))) return { step: '2-한국어줄거리', term: m, tier: 'OV-KO' };
    if ((m = hit(enOv, OV_EN_S))) return { step: '3-영어줄거리', term: m, tier: 'EN-강' };
    if ((m = hit(enOv, OV_EN_W))) return { step: '3-영어줄거리', term: m, tier: 'EN-약' };
    return null;
}

// ── FINAL_ID.MD 로드 ────────────────────────────────────────────────────────
// 형식: "판정<TAB>id" (헤더 1줄). 중복 id는 같은 판정이 반복된 것이라 첫 값을 쓴다.
function loadFinal(file) {
    const map = new Map();
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
        const [v, id] = line.split('\t');
        if (!id || !/^\d+$/.test(id.trim())) continue;
        if (!map.has(id.trim())) map.set(id.trim(), (v || '').trim());
    }
    return map;
}

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    console.log(`\n${bold('▶ 성인물 3단계 재판정')} ${dim('(FINAL_ID.MD 기준 · 네트워크 호출 없음)')}`);

    const final = loadFinal(opts.final);
    const tally = {}; for (const v of final.values()) tally[v] = (tally[v] || 0) + 1;
    console.log(dim(`  판정 파일: ${final.size.toLocaleString()}건 — ` + Object.entries(tally).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(' · ')));

    const metaFields = ['original_title', 'original_language', 'title', 'overview', 'tagline',
        'release_date', 'first_air_date', 'status', 'runtime', 'vote_average', 'vote_count',
        'popularity', 'genres', 'keywords', 'production_companies', 'origin_country',
        'spoken_languages', 'budget', 'revenue', 'homepage', 'external_ids',
        'belongs_to_collection', 'poster_path', 'backdrop_path', 'credits'];

    console.log(dim('  1/2 titles 스캔 중…'));
    const snap = await kcultureDb.collection('titles')
        .select('media', 'hidden', 'hiddenReason', 'metaLangs', 'metaCachedAt', 'metaTranslated',
            'metaNoSource', 'poster_path', ...metaFields.map((f) => `meta.${f}`))
        .get();

    let rows = [];
    snap.forEach((d) => {
        const v = final.get(d.id) || '';
        if (opts.verdict && v !== opts.verdict) return;
        rows.push({ id: d.id, verdict: v, ...d.data() });
    });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    console.log(`      대상 ${rows.length.toLocaleString()}편`);

    console.log(dim(`  2/2 translations(ko·en) 조회 중… ${(rows.length * 2).toLocaleString()}건`));
    const t0 = Date.now();
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        const refs = [];
        for (const r of part) {
            refs.push(kcultureDb.doc(`titles/${r.id}/translations/ko`));
            refs.push(kcultureDb.doc(`titles/${r.id}/translations/en`));
        }
        const snaps = await kcultureDb.getAll(...refs);
        part.forEach((r, k) => {
            r.tko = snaps[k * 2]?.exists ? snaps[k * 2].data() : null;
            r.ten = snaps[k * 2 + 1]?.exists ? snaps[k * 2 + 1].data() : null;
        });
        if ((i + CHUNK) % 4000 < CHUNK) {
            const el = (Date.now() - t0) / 1000;
            console.log(cyan(`      ${Math.min(i + CHUNK, rows.length).toLocaleString()}/${rows.length.toLocaleString()} · 남은 예상 ${Math.round((rows.length - i) / ((i + CHUNK) / el) / 60)}분`));
        }
    }

    // ── 판정 + 행 조립 ──────────────────────────────────────────────────────
    const out = []; const stat = { '1-원제': 0, '2-한국어줄거리': 0, '3-영어줄거리': 0 };
    const byVerdict = {}; const byTier = {};
    for (const r of rows) {
        const m = r.meta || {};
        const ko = r.tko || {}, en = r.ten || {};
        const koIsTmdb = ko.source === 'tmdb', enIsTmdb = en.source === 'tmdb';
        const koOv = koIsTmdb ? String(ko.overview || '') : '';
        const enOv = enIsTmdb ? String(en.overview || '') : '';
        // 2)의 대상은 **meta 줄거리(원어)** — 사용자 지정. 없으면 translations/ko로 보완.
        const metaOv = String(m.overview || '') || koOv;

        const j = judge(m.original_title || '', metaOv, enOv);
        if (!j) continue;
        stat[j.step]++;
        byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
        byTier[j.tier] = (byTier[j.tier] || 0) + 1;

        const date = m.release_date || m.first_air_date || '';
        out.push([
            r.verdict, 'Y', j.step, j.term, j.tier,          // ── 재판정 결과
            r.id, r.media === 'movie' ? '영화' : 'TV',
            m.original_title || '', m.original_language || '',
            koIsTmdb ? (ko.title || '') : '', ko.source || '(없음)',
            enIsTmdb ? (en.title || '') : '', en.source || '(없음)',
            !koIsTmdb ? (ko.title || '') : '', !enIsTmdb ? (en.title || '') : '',
            koOv.slice(0, opts.ovMax), koOv.length || '',
            enOv.slice(0, opts.ovMax),
            String(m.overview || '').slice(0, opts.ovMax),
            m.tagline || '', date, String(date).slice(0, 4), m.status || '', m.runtime ?? '',
            m.vote_average ?? '', m.vote_count ?? '',
            typeof m.popularity === 'number' ? m.popularity.toFixed(2) : '',
            join(m.genres, (g) => g?.name), join(m.keywords, (k) => k?.name),
            join(m.production_companies, (c) => c?.name),
            (m.origin_country || []).join(','), (m.spoken_languages || []).join(','),
            m.budget || '', m.revenue || '', m.external_ids?.imdb_id || '', m.homepage || '',
            m.belongs_to_collection?.name || '',
            join((m.credits?.cast || []).slice(0, 6), (c) => c?.name),
            join((m.credits?.crew || []).filter((c) => ['Director', 'Writer'].includes(c?.job)).slice(0, 3), (c) => `${c.name}(${c.job})`),
            (r.metaLangs || []).length, r.metaCachedAt ? 'Y' : '',
            r.metaTranslated === true ? 'Y' : '', r.metaNoSource === true ? 'Y' : '',
            r.hidden === true ? '숨김' : '노출', r.hiddenReason || '',
            (m.poster_path || r.poster_path) ? `https://image.tmdb.org/t/p/w185${m.poster_path || r.poster_path}` : '',
            `https://www.themoviedb.org/${r.media}/${r.id}`,
        ]);
    }

    // 단계 → 등급 → 원제 순 정렬(1단계 T1부터 보면 실제 성인물이 몰려 있다)
    const ord = { '1-원제': 0, '2-한국어줄거리': 1, '3-영어줄거리': 2 };
    const tord = { T1: 0, T2: 1, T3: 2, 'OV-KO': 3, 'EN-강': 4, 'EN-약': 5 };
    out.sort((a, b) => ord[a[2]] - ord[b[2]] || tord[a[4]] - tord[b[4]] || String(a[7]).localeCompare(String(b[7]), 'ko'));

    const head = ['FINAL판정', '성인판정', '매칭단계', '매칭어휘', '어휘등급',
        'id', '종류', '원제(TMDB)', '원어',
        'TMDB 한국어 제목', 'ko출처', 'TMDB 영어 제목', 'en출처',
        '우리번역 ko제목', '우리번역 en제목',
        'TMDB 한국어 줄거리', 'ko줄거리 길이', 'TMDB 영어 줄거리', 'meta 줄거리(원어)',
        '태그라인', '개봉/방영일', '연도', '상태', '러닝타임',
        '평점', '평점수', '인기도', '장르', 'TMDB 키워드', '제작사', '제작국', '언어',
        '예산', '수익', 'IMDb', '홈페이지', '컬렉션', '주요 출연', '감독/각본',
        '번역언어수', 'meta보유', '사전번역완료', '번역불가',
        '현재 노출', '숨김사유', '포스터', 'TMDB 링크'];

    const dir = path.join(__dirname, 'logs');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    // ① 판정/id 2열 TSV — FINAL_ID.MD와 **완전히 같은 포맷**(헤더 "판정\tid").
    //    사용자가 기존 판정 파일과 나란히 놓고 병합·대조할 수 있게 이걸 1차 산출물로 삼는다.
    const mdFile = path.join(dir, `ADULT_ID-${stamp}.MD`);
    fs.writeFileSync(mdFile, ['판정\tid', ...out.map((r) => `Y\t${r[5]}`)].join('\r\n') + '\r\n', 'utf8');

    // ② 근거까지 담은 상세 CSV — 왜 걸렸는지(단계·어휘·등급) 확인·검수용.
    const lines = [head.map(cell).join(','), ...out.map((r) => r.map(cell).join(','))];
    const file = path.join(dir, `adult-rescan-${stamp}.csv`);
    fs.writeFileSync(file, `﻿${lines.join('\r\n')}\r\n`, 'utf8');

    console.log(`\n${green('📄 판정/id 2열 : ' + mdFile)}`);
    console.log(`${dim('📄 근거 상세    : ' + file)}  (${Math.round(fs.statSync(file).size / 1024).toLocaleString()}KB)`);
    console.log(`   성인 판정 Y: ${bold(out.length.toLocaleString())}편 / 대상 ${rows.length.toLocaleString()}편\n`);
    console.log('   매칭 단계별');
    for (const [k, v] of Object.entries(stat)) console.log(`     ${k.padEnd(16)} ${String(v).padStart(6)}`);
    console.log('   어휘 등급별');
    for (const [k, v] of Object.entries(byTier)) console.log(`     ${k.padEnd(16)} ${String(v).padStart(6)}`);
    console.log('   FINAL 판정별');
    for (const [k, v] of Object.entries(byVerdict)) console.log(`     ${(k || '(없음)').padEnd(16)} ${String(v).padStart(6)}`);
    console.log(`\n   ${yellow('※ 자동 반영 없음')} — 검수 후 성인물 확정분만 adult-manual.json 의 hide 로 넣으세요.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
