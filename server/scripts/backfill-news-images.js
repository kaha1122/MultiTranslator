// ── K-뉴스 이미지 언어별 백필 (수동, 멱등) ────────────────────────────────────
// 크론을 기다리지 않고 언어별로 여러 패스를 돌려 원문 디코드+og:image를 단계적으로 채운다.
// 디코드는 구글 rate-limited라 패스당 상한(기본 12)씩 → 여러 패스로 40건 전부 커버.
// og:image는 매체 사이트라 안전 → --refresh로 캐시 이미지 버리고 전부 재스크레이프 가능.
//
// 로컬/서버 실행 (server/.env 에 GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/backfill-news-images.js [옵션]
// 옵션:
//   --lang ko,en           대상 언어(콤마, 기본 전체 10개)
//   --passes 4             언어당 패스 수(디코드 상한×패스 = 총 디코드, 기본 4 → 48건 시도)
//   --decode 12            패스당 디코드 상한(구글 429 방지, 기본 12)
//   --gap 20000            언어 간 대기(ms, 429 회복 여유 — 기본 20초)
//   --refresh              캐시 이미지 버리고 매체 og:image 전부 재스크레이프(잘못된 이미지 정리)
// 멱등: 미러(news_cache/{lang})를 prev로 읽어 디코드/이미지 누적. 중단 후 재실행 안전.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { LANG_FEEDS, fetchNewsForLang } = require('../lib/newsFetch');
const { kcultureDb } = require('../config/firebaseKculture');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const langs = (arg('lang') ? arg('lang').split(',') : Object.keys(LANG_FEEDS)).filter((l) => LANG_FEEDS[l]);
const passes = parseInt(arg('passes', '4'), 10);
const decodeBudget = parseInt(arg('decode', '12'), 10);
const gap = parseInt(arg('gap', '20000'), 10);
const refreshImages = process.argv.includes('--refresh');

const ref = (lang) => kcultureDb?.collection('news_cache').doc(lang);

async function readMirror(lang) {
    try { const s = await ref(lang)?.get(); return s?.exists ? (s.data().items || []) : []; }
    catch { return []; }
}
async function writeMirror(lang, items) {
    try { await ref(lang)?.set({ items, ts: Date.now() }); } catch (e) { console.warn('  mirror write fail', e.message); }
}

(async () => {
    if (!kcultureDb) { console.error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요'); process.exit(1); }
    console.log('[news-backfill] langs', langs.join(','), '| passes', passes, '| decode/pass', decodeBudget, '| refresh', refreshImages);

    for (const lang of langs) {
        // 크론과 별개 실행이라 언어마다 자체 서킷(한 언어 429가 다음 언어를 막지 않도록 — 언어 간 gap이 완충)
        const state = { blocked: false };
        for (let p = 0; p < passes; p++) {
            const prevItems = await readMirror(lang);
            const items = await fetchNewsForLang(lang, {
                prevItems, state, decodeBudget, imageMax: 40, imageConc: 5,
                refreshImages: refreshImages && p === 0, // 리프레시는 첫 패스만(이후는 누적)
            });
            if (items.length) await writeMirror(lang, items);
            const imaged = items.filter((it) => it.image).length;
            const decoded = items.filter((it) => !it.url.includes('news.google.com')).length;
            console.log(`  ${lang} pass ${p + 1}/${passes}: items ${items.length}, decoded ${decoded}, images ${imaged}${state.blocked ? ' (429)' : ''}`);
            if (decoded >= items.length && imaged >= decoded) break; // 전부 채워짐 → 조기 종료
            await sleep(3000); // 패스 간 소폭 대기
        }
        await sleep(gap); // 언어 간 대기 — 구글 쿼터 회복
    }
    console.log('[news-backfill] done');
    process.exit(0);
})();
