// ── 카탈로그 전수 CSV 추출 (사람 전수 점검용) ───────────────────────────────
// Firestore `titles` 전량을 Excel에서 볼 수 있는 CSV로 내린다. 성인물 판정뿐 아니라
// 메타데이터 품질(제목 누락·줄거리 없음·연도 이상·사전번역 미완) 점검에도 쓴다.
//
// ⚠ 한국 등급(19금 등)은 Firestore에 없다 — `titles/{id}.meta`에 release_dates·content_ratings가
//   저장돼 있지 않기 때문(백필 스키마에 없음). --certs(기본 켜짐)면 작품마다 TMDB를 1회 쳐서 채운다.
//   전수 약 24,000회 · 동시 20 · 약 5분. 등급이 필요 없으면 --no-certs 로 1~2분에 끝난다.
//
// ⚠ meta는 통째로 읽지 말 것 — credits·images·videos까지 딸려와 문서당 평균 5.7KB(최대 85KB)다.
//   2.4만 건이면 140MB를 끌어오게 된다. 아래처럼 필요한 필드만 select 한다.
//
// 사용법:
//   node scripts/export-catalog.js                 # 등급 포함(TMDB 조회)
//   node scripts/export-catalog.js --no-certs      # 빠르게(등급 열은 빈칸)
//   node scripts/export-catalog.js --media movie   # tv|movie|both(기본)
//   node scripts/export-catalog.js --limit 500     # 시범
// 산출물: scripts/logs/catalog-<시각>.csv  (UTF-8 BOM — 한글이 Excel에서 안 깨짐)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const opts = {
    certs: !process.argv.includes('--no-certs'),
    concurrency: parseInt(arg('concurrency', '20'), 10),
    media: arg('media', 'both'),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    ovMax: parseInt(arg('overview-max', '500'), 10),
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), cyan = paint('36'), green = paint('32');

// CSV 한 칸 — 쉼표·따옴표·줄바꿈이 들어가도 Excel이 정확히 읽도록 항상 인용부호로 감싼다.
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

async function tmdb(p, params = {}) {
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${p}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    return r.json();
}

// 한국 등급만 뽑는다(movie=release_dates / tv=content_ratings). 실패는 빈 문자열 — 추출을 멈추지 않는다.
async function fetchCert(media, id) {
    try {
        const append = media === 'movie' ? 'release_dates' : 'content_ratings';
        const d = await tmdb(`/${media}/${id}`, { language: 'en-US', append_to_response: append });
        if (media === 'movie') {
            const kr = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'KR');
            return [...new Set((kr?.release_dates || []).map((x) => x.certification).filter(Boolean))].join('/');
        }
        const cr = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'KR');
        return cr?.rating || '';
    } catch { return ''; }
}

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    console.log(`\n${bold('▶ 카탈로그 전수 추출')}`);
    console.log(dim(`  등급 조회 ${opts.certs ? '켬(TMDB)' : '끔'} · 동시 ${opts.concurrency} · 미디어 ${opts.media}${opts.limit ? ` · limit ${opts.limit}` : ''}`));

    console.log(dim('\n  Firestore titles 스캔 중…'));
    const snap = await kcultureDb.collection('titles')
        .select('media', 'hidden', 'hiddenReason', 'searchTitle', 'metaLangs', 'metaCachedAt', 'metaNoSource',
            'meta.title', 'meta.original_title', 'meta.overview', 'meta.release_date', 'meta.first_air_date',
            'meta.vote_count', 'meta.vote_average', 'meta.popularity', 'meta.runtime', 'meta.genres',
            'meta.keywords', 'meta.poster_path', 'meta.production_companies', 'meta.status')
        .get();

    let rows = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        if (opts.media !== 'both' && x.media !== opts.media) return;
        const m = x.meta || {};
        rows.push({
            id: d.id,
            media: x.media || '',
            ko: x.searchTitle?.ko || '',
            en: x.searchTitle?.en || m.title || '',
            orig: m.original_title || '',
            year: String(m.release_date || m.first_air_date || '').slice(0, 4),
            date: m.release_date || m.first_air_date || '',
            cert: '',
            avg: m.vote_average ?? '',
            votes: m.vote_count ?? '',
            pop: typeof m.popularity === 'number' ? m.popularity.toFixed(2) : '',
            runtime: m.runtime ?? '',
            status: m.status || '',
            genres: (m.genres || []).map((g) => g?.name).filter(Boolean).join(','),
            keywords: (m.keywords || []).map((k) => k?.name).filter(Boolean).join(','),
            companies: (m.production_companies || []).map((c) => c?.name).filter(Boolean).join(','),
            hidden: x.hidden === true ? '숨김' : '노출',
            hiddenReason: x.hiddenReason || '',
            langs: (x.metaLangs || []).length,
            metaOk: x.metaCachedAt ? 'Y' : '',
            noSource: x.metaNoSource === true ? 'Y' : '',
            overview: String(m.overview || '').slice(0, opts.ovMax),
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w185${m.poster_path}` : '',
        });
    });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    console.log(`  대상 ${bold(rows.length)}편`);

    if (opts.certs) {
        if (!TMDB_KEY) throw new Error('TMDB_API_KEY 없음 — 등급 없이 뽑으려면 --no-certs');
        console.log(dim(`\n  TMDB 등급 조회 중… (약 ${Math.ceil(rows.length / opts.concurrency / 4 / 60)}~${Math.ceil(rows.length / opts.concurrency / 2 / 60)}분)`));
        const t0 = Date.now();
        let idx = 0, done = 0;
        async function worker() {
            while (idx < rows.length) {
                const r = rows[idx++];
                if (r.media === 'tv' || r.media === 'movie') r.cert = await fetchCert(r.media, r.id);
                done++;
                if (done % 2000 === 0) {
                    const el = (Date.now() - t0) / 1000;
                    console.log(cyan(`  ── ${done}/${rows.length} · 남은 예상 ${Math.round((rows.length - done) / (done / el) / 60)}분`));
                }
            }
        }
        await Promise.all(Array.from({ length: opts.concurrency }, worker));
        console.log(dim(`  등급 조회 완료 (${Math.round((Date.now() - t0) / 1000)}초) · 등급 보유 ${rows.filter((r) => r.cert).length}편`));
    }

    // 제목순 — 시리즈물이 붙어 있어야 훑기 쉽다. 한국어 제목 없으면 영어 제목 기준.
    rows.sort((a, b) => String(a.ko || a.en).localeCompare(String(b.ko || b.en), 'ko'));

    const head = ['판정(Y=성인물)', 'id', '종류', '한국어 제목', '영어 제목', '원제', '연도', '방영/개봉일',
        '한국등급', '평점', '평점수', '인기도', '러닝타임', '상태', '장르', 'TMDB 키워드', '제작사',
        '현재 노출', '숨김사유', '번역언어수', 'meta보유', '번역불가', '줄거리', '포스터', 'TMDB 링크'];
    const lines = [head.map(cell).join(',')];
    for (const r of rows) {
        lines.push(['', r.id, r.media === 'movie' ? '영화' : 'TV', r.ko, r.en, r.orig, r.year, r.date,
            r.cert, r.avg, r.votes, r.pop, r.runtime, r.status, r.genres, r.keywords, r.companies,
            r.hidden, r.hiddenReason, r.langs, r.metaOk, r.noSource, r.overview, r.poster,
            `https://www.themoviedb.org/${r.media}/${r.id}`].map(cell).join(','));
    }

    const dir = path.join(__dirname, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    // ﻿(BOM) — 없으면 Excel이 UTF-8을 못 알아채고 한글이 깨진다.
    fs.writeFileSync(file, `﻿${lines.join('\r\n')}\r\n`, 'utf8');

    const kb = Math.round(fs.statSync(file).size / 1024);
    console.log(`\n${green('📄 ' + file)}  (${kb.toLocaleString()}KB)`);
    console.log(dim(`   ${rows.length.toLocaleString()}행 · 줄거리 보유 ${rows.filter((r) => r.overview).length.toLocaleString()}편`
        + ` · 숨김 ${rows.filter((r) => r.hidden === '숨김').length.toLocaleString()}편\n`));
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
