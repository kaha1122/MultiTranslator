// ── TMDB 원본 기준 카탈로그 추출 (삭제 판단용) ──────────────────────────────
// 목적: "무엇을 지우고 무엇을 남겨 다시 번역할지"를 사람이 판단할 수 있게, **TMDB가 실제로 준
//       데이터만** 보여준다. 우리가 Gemini로 만든 값은 별도 열로 분리해 섞이지 않게 한다.
//
// ⚠ 네트워크 호출 없음 — Firestore에 저장된 것만 읽는다("우리 DB에 있는 선에서만").
//   따라서 등급(19금 등)은 들어가지 않는다. meta에 저장돼 있지 않고 TMDB를 쳐야만 나오기 때문.
//
// 데이터가 어디에 있는지 (2026-07-28 확인)
//   titles/{id}                  media · poster_path · searchTitle · metaLangs · hidden …
//     └ meta (맵, 29키)          TMDB 상세 스냅샷 — 연도·장르·평점·출연·러닝타임·제작사 …
//                                ⚠ backfill-tmdb-meta.js가 채운다. **8,431편은 이 맵이 없다.**
//     └ translations/{lang}      title · overview · source('tmdb'|'gemini'|'cache')
//                                ⚠ 앱 화면과 SEO가 실제로 쓰는 값은 여기다. meta가 없어도 존재한다.
//   → 그래서 제목·줄거리는 meta가 아니라 translations에서 읽어야 한다(이전 스크립트의 실수).
//
// 출처 분리 원칙
//   source='tmdb'   → TMDB 원본(원제 폴백 포함). "TMDB 제목/줄거리" 열에 넣는다.
//   source='gemini' → 우리가 만든 값. "우리번역" 열에 따로 넣는다. 판단 근거로 쓰지 말 것.
//   실측 결과 ko 제목의 24%, en 제목의 28%가 gemini였고 그중 「탁자」(원제 「더 테이블」)처럼
//   원제와 다른 이름이 섞여 있다 — 섞어서 보여주면 삭제 판단이 오염된다.
//
// 사용법:
//   node scripts/export-tmdb-catalog.js              # 전량
//   node scripts/export-tmdb-catalog.js --limit 500  # 시범
//   node scripts/export-tmdb-catalog.js --no-cast    # 출연진 제외(스캔 빨라짐)
// 산출물: scripts/logs/tmdb-catalog-<시각>.csv (UTF-8 BOM — Excel에서 한글 정상)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    cast: !process.argv.includes('--no-cast'),
    ovMax: parseInt(arg('overview-max', '800'), 10),
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), cyan = paint('36'), green = paint('32');

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const join = (arr, f) => (arr || []).map(f).filter(Boolean).join(',');

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    console.log(`\n${bold('▶ TMDB 원본 기준 카탈로그 추출')} ${dim('(네트워크 호출 없음)')}`);

    // meta에서 필요한 키만 고른다 — images·videos·watch_providers는 크고 판단에 안 쓰여 제외.
    const metaFields = ['original_title', 'original_language', 'title', 'overview', 'tagline',
        'release_date', 'first_air_date', 'status', 'runtime', 'vote_average', 'vote_count',
        'popularity', 'genres', 'keywords', 'production_companies', 'origin_country',
        'spoken_languages', 'budget', 'revenue', 'homepage', 'external_ids',
        'belongs_to_collection', 'poster_path', 'backdrop_path'];
    if (opts.cast) metaFields.push('credits');

    console.log(dim('  1/2 titles 스캔 중…'));
    const snap = await kcultureDb.collection('titles')
        .select('media', 'hidden', 'hiddenReason', 'metaLangs', 'metaCachedAt', 'metaTranslated',
            'metaNoSource', 'poster_path', ...metaFields.map((f) => `meta.${f}`))
        .get();

    let rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    console.log(`      ${rows.length.toLocaleString()}편`);

    // ── translations/ko·en 동반 조회 ────────────────────────────────────────
    // 제목·줄거리의 진짜 출처. getAll로 묶어 읽는다(문서당 1회 읽기 = 약 5만 읽기 ≈ 40원).
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

    // ── 행 조립 ─────────────────────────────────────────────────────────────
    const out = rows.map((r) => {
        const m = r.meta || {};
        const ko = r.tko || {}, en = r.ten || {};
        const koIsTmdb = ko.source === 'tmdb', enIsTmdb = en.source === 'tmdb';
        const cast = opts.cast ? join((m.credits?.cast || []).slice(0, 6), (c) => c?.name) : '';
        const crew = opts.cast ? join((m.credits?.crew || []).filter((c) => ['Director', 'Writer'].includes(c?.job)).slice(0, 3), (c) => `${c.name}(${c.job})`) : '';
        const date = m.release_date || m.first_air_date || '';
        const koOv = koIsTmdb ? String(ko.overview || '') : '';
        // 삭제 판단 보조 — TMDB가 사실상 아무것도 안 준 작품(빈 껍데기)을 한 열로 표시.
        const thin = (!koOv && !m.overview && !Number(m.vote_count || 0) && !(m.genres || []).length) ? 'Y' : '';

        return [
            '',                                   // 판정(사람 입력)
            r.id,
            r.media === 'movie' ? '영화' : 'TV',
            m.original_title || '',               // ── TMDB 원본
            m.original_language || '',
            koIsTmdb ? (ko.title || '') : '',     // TMDB 한국어 제목
            ko.source || '(없음)',
            enIsTmdb ? (en.title || '') : '',     // TMDB 영어 제목
            en.source || '(없음)',
            !koIsTmdb ? (ko.title || '') : '',    // ── 우리가 만든 값(분리)
            !enIsTmdb ? (en.title || '') : '',
            koOv.slice(0, opts.ovMax),            // TMDB 한국어 줄거리
            koOv.length || '',
            enIsTmdb ? String(en.overview || '').slice(0, opts.ovMax) : '',
            String(m.overview || '').slice(0, opts.ovMax), // meta 줄거리(TMDB 원어 스냅샷)
            m.tagline || '',
            date, String(date).slice(0, 4),
            m.status || '',
            m.runtime ?? '',
            m.vote_average ?? '',
            m.vote_count ?? '',
            typeof m.popularity === 'number' ? m.popularity.toFixed(2) : '',
            join(m.genres, (g) => g?.name),
            join(m.keywords, (k) => k?.name),
            join(m.production_companies, (c) => c?.name),
            (m.origin_country || []).join(','),
            (m.spoken_languages || []).join(','),
            m.budget || '', m.revenue || '',
            m.external_ids?.imdb_id || '',
            m.homepage || '',
            m.belongs_to_collection?.name || '',
            cast, crew,
            thin,                                 // ── 판단 보조
            (r.metaLangs || []).length,
            r.metaCachedAt ? 'Y' : '',
            r.metaTranslated === true ? 'Y' : '',
            r.metaNoSource === true ? 'Y' : '',
            r.hidden === true ? '숨김' : '노출',
            r.hiddenReason || '',
            (m.poster_path || r.poster_path) ? `https://image.tmdb.org/t/p/w185${m.poster_path || r.poster_path}` : '',
            `https://www.themoviedb.org/${r.media}/${r.id}`,
        ];
    });

    // 원제 기준 정렬 — TMDB 원본 축으로 보는 것이 이 파일의 목적이다(원제 없으면 뒤로).
    const idxOrig = 3;
    out.sort((a, b) => String(a[idxOrig] || '￿').localeCompare(String(b[idxOrig] || '￿'), 'ko'));

    const head = ['판정', 'id', '종류',
        '원제(TMDB)', '원어',
        'TMDB 한국어 제목', 'ko출처', 'TMDB 영어 제목', 'en출처',
        '우리번역 ko제목', '우리번역 en제목',
        'TMDB 한국어 줄거리', 'ko줄거리 길이', 'TMDB 영어 줄거리', 'meta 줄거리(원어)',
        '태그라인', '개봉/방영일', '연도', '상태', '러닝타임',
        '평점', '평점수', '인기도', '장르', 'TMDB 키워드', '제작사', '제작국', '언어',
        '예산', '수익', 'IMDb', '홈페이지', '컬렉션', '주요 출연', '감독/각본',
        'TMDB정보없음', '번역언어수', 'meta보유', '사전번역완료', '번역불가',
        '현재 노출', '숨김사유', '포스터', 'TMDB 링크'];

    const lines = [head.map(cell).join(','), ...out.map((r) => r.map(cell).join(','))];
    const dir = path.join(__dirname, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `tmdb-catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    fs.writeFileSync(file, `﻿${lines.join('\r\n')}\r\n`, 'utf8');

    // ── 요약 — 무엇이 비어 있는지가 삭제 판단의 출발점이다 ────────────────────
    const c = (f) => out.filter(f).length;
    console.log(`\n${green('📄 ' + file)}  (${Math.round(fs.statSync(file).size / 1024).toLocaleString()}KB)`);
    console.log(`   ${out.length.toLocaleString()}행 · 열 ${head.length}개\n`);
    console.log('   TMDB 원본 보유 현황');
    console.log(`     원제            ${c((r) => r[3]).toLocaleString()}`);
    console.log(`     TMDB 한국어 제목 ${c((r) => r[5]).toLocaleString()}   (우리번역 ko: ${c((r) => r[9]).toLocaleString()})`);
    console.log(`     TMDB 영어 제목   ${c((r) => r[7]).toLocaleString()}   (우리번역 en: ${c((r) => r[10]).toLocaleString()})`);
    console.log(`     TMDB 한국어 줄거리 ${c((r) => r[11]).toLocaleString()}`);
    console.log(`     meta 보유        ${c((r) => r[37]).toLocaleString()}`);
    // ⚠ 인덱스는 head 배열 순서와 정확히 일치해야 한다(35=TMDB정보없음, 36=번역언어수, 37=meta보유).
    console.log(`   ${bold('TMDB정보없음(빈 껍데기)')} ${c((r) => r[35]).toLocaleString()}편 ← 삭제 1순위 후보\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
