// ── 관련작(related) 백필 — SEO 내부 링크 메쉬용 (멱등, 증분) ──────────────────
// 목적: 크롤러 HTML의 작품→작품 링크(KCulture middleware.js)가 읽을 titles/{id}.related 를 채운다.
//       2026-08 색인 붕괴의 근본 원인이 "작품 페이지에서 다른 작품으로 가는 href 0개 → sitemap이
//       유일한 크롤 경로"였고, 그 해소의 데이터 절반이 이 스크립트다(주입 절반은 KCulture repo).
// 소스: TMDB /{media}/{id}/recommendations — 앱 상세 화면(TitleDetailScreen data?.recommendations)과
//       동일 소스라 클로킹이 아니다. 단 카탈로그에 있는(=우리 페이지가 존재하는) 작품만 남긴다.
// 저장: titles/{id} 에 { related: [{id, media}] (최대 12), relatedAt } merge.
//       추천이 0건이어도 relatedAt 을 찍는다(매 실행 재시도 방지 — 멱등의 핵심).
// 증분: relatedAt 없는 문서만 처리 → 신작은 다음 실행에서 자동으로 잡힌다(cron-daily ⑤에서 매일 실행).
//
// 로컬 실행 (server/.env 에 TMDB_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/backfill-related.js [옵션]
// 옵션:
//   --dry             쓰기 없이 대상·표본만 출력
//   --limit N         처리 상한(테스트용 — 먼저 소수로 시범 권장)
//   --concurrency N   TMDB 동시 처리 수(기본 6)
//   --force           relatedAt 있어도 재수집(추천 갱신용 — 평시 불필요)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const CAP_RELATED = 12; // middleware 주입 상한과 동일

async function tmdb(p, params = {}) {
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${p}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status} ${p}`);
    return r.json();
}

async function runRelatedBackfill({ dry = false, limit = Infinity, concurrency = 6, force = false, onProgress } = {}) {
    if (!TMDB_KEY) throw new Error('TMDB_API_KEY not set');
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const db = kcultureDb;

    // 카탈로그 전량 스캔(select 마스크 — meta 전송 없음). id→media 맵 + hidden 집합.
    // ⚠ 문서 id = tmdbId 단독(media 미포함)이라 tv/movie id 충돌 가능 → 추천 결과의
    //   media_type 이 카탈로그의 media 와 일치할 때만 채택한다(엉뚱한 작품으로 링크 방지).
    const snap = await db.collection('titles').select('media', 'hidden', 'relatedAt').get();
    const catalog = new Map(); // id -> media (노출 가능작만: hidden 제외)
    const targets = [];
    for (const d of snap.docs) {
        const v = d.data();
        if (!v.media || (v.media !== 'tv' && v.media !== 'movie')) continue;
        if (v.hidden !== true) catalog.set(d.id, v.media);
        if ((force || !v.relatedAt) && v.hidden !== true) targets.push({ id: d.id, media: v.media });
    }
    const work = targets.slice(0, limit === Infinity ? undefined : limit);
    console.log(`[related] 카탈로그 ${snap.size} | 노출작 ${catalog.size} | 대상(relatedAt 없음) ${targets.length} | 이번 실행 ${work.length}${dry ? ' (dry)' : ''}`);

    let done = 0, empty = 0, errors = 0;
    const worker = async () => {
        for (;;) {
            const t = work.shift();
            if (!t) return;
            try {
                const j = await tmdb(`/${t.media}/${t.id}/recommendations`, { language: 'en-US', page: '1' });
                const related = (j.results || [])
                    // media_type 은 tv 추천엔 안 실릴 수 있음 → 요청 media 로 폴백(같은 타입 추천이 기본)
                    .map((r) => ({ id: String(r.id), media: r.media_type || t.media }))
                    .filter((r) => catalog.get(r.id) === r.media && r.id !== t.id)
                    .slice(0, CAP_RELATED)
                    .map((r) => ({ id: Number(r.id), media: r.media }));
                if (!related.length) empty++;
                if (!dry) {
                    await db.collection('titles').doc(t.id).set(
                        { related, relatedAt: new Date().toISOString() }, { merge: true });
                }
                done++;
                if (done % 200 === 0) {
                    console.log(`[related] ${done}/${done + work.length} (빈 추천 ${empty}, 오류 ${errors})`);
                    if (onProgress) onProgress({ done, remaining: work.length, empty, errors });
                }
            } catch (e) {
                errors++;
                if (errors <= 5) console.warn(`[related] ${t.media}/${t.id} 실패:`, e.message);
                // relatedAt 을 안 찍고 넘어감 → 다음 실행이 자동 재시도(부분 실패 재시도 게이트와 동일 사상)
            }
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    console.log(`[related] DONE — 처리 ${done} | 빈 추천 ${empty} | 오류 ${errors}`);
    return { done, empty, errors };
}

module.exports = { runRelatedBackfill };

if (require.main === module) {
    const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
    runRelatedBackfill({
        dry: process.argv.includes('--dry'),
        force: process.argv.includes('--force'),
        limit: arg('limit') ? parseInt(arg('limit'), 10) : Infinity,
        concurrency: parseInt(arg('concurrency', '6'), 10),
    }).then(() => process.exit(0)).catch((e) => { console.error('[related] FAIL', e); process.exit(1); });
}
