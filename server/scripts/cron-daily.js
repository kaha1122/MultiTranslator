// ── 신작 K-Content 메타 번역 DAILY (Render Cron Job 대상) ─────────────────────
// Render Cron Job command 예: `cd server && node scripts/cron-daily.js`
//   스케줄 `0 20 * * *` (20:00 UTC = 다음날 05:00 KST).
// 필요 env (Render Cron Job 환경 / 로컬은 server/.env):
//   TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64, PRIMARY_CONTENT_LANG(옵션)
// 하는 일: ① runIncremental(신규=릴리스일 최근 N일 한국작) ② runRetry(부분실패 metaTranslated=false)
//   ③ refreshOfficialTitles(TMDB가 뒤늦게 채운 공식 제목으로 교체) ④ 신작 성인물 자동 숨김분 즉시 반영.
//   전부 바운드(수백 건)라 빠르고 싸다. 멱등 — 이미 번역된 작품은 skip.
//
// ⚠ 이 스크립트가 **프로덕션의 실제 일일 경로**다(Render Cron `kculture-tmdb-daily`).
//   routes/cronTmdb.js의 `/api/cron/tmdb-pretranslate`는 같은 일을 하는 HTTP 버전이며,
//   **둘 중 하나만 고치면 프로덕션이 그 기능을 못 받는다.** 2026-07-31에 실제로 벌어진 일:
//     · ③ refreshOfficialTitles가 라우트에만 있어서 프로덕션에서 한 번도 돈 적이 없었다.
//     · ④ 숨김 인덱스 재생성도 라우트에만 있어서, 자동 숨김이 생겨도 웹 서버가 최대 12시간
//       (hiddenTitles TTL) 동안 그 작품을 계속 노출할 상태였다.
//   → 기능을 추가할 때는 **양쪽 다** 갱신할 것(`itemPathOf`·`BOT_UA`와 같은 이중 관리 지점).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runIncremental, runRetry, refreshOfficialTitles } = require('../lib/tmdbBackfill');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const days = parseInt(arg('days', '14'), 10);
const maxTitles = parseInt(arg('maxTitles', '200'), 10);
const retryLimit = parseInt(arg('retryLimit', '100'), 10);

(async () => {
    const t0 = Date.now();
    console.log('[cron-daily] start', { days, maxTitles, retryLimit });
    const incremental = await runIncremental({ days, maxTitles });
    console.log('[cron-daily] incremental', JSON.stringify(incremental));
    const retry = await runRetry({ limit: retryLimit });
    console.log('[cron-daily] retry', JSON.stringify(retry));

    // ③ 공식 제목 뒤늦은 반영 — 공식 제목이 없는 언어는 영어 폴백을 들고 있으므로(2026-08-01 정책:
    //    현지어 제목 발명 금지), TMDB에 공식 현지어 제목이 등록되는 대로 갈아끼운다(Gemini 호출 0).
    //    예산 절반은 신작·방영중, 나머지는 전 카탈로그 순환(구작에 뒤늦게 등록돼도 승격).
    //    ⚠ ①로는 안 된다 — discover가 물어와도 processTitle이 완비된 작품을 skip하기 때문.
    const titles = await refreshOfficialTitles({
        days: parseInt(arg('titleDays', '400'), 10),
        maxTitles: parseInt(arg('titleMax', '500'), 10),
    });
    console.log('[cron-daily] titles', JSON.stringify(titles));

    // ④ 신작 성인물 자동 숨김분 즉시 반영 — 이 프로세스는 웹 서버와 별개라, 인덱스를 다시 만들고
    //    서버에 알려주지 않으면 웹 서버 메모리 Set이 최대 12시간(TTL) 옛 목록을 쓴다.
    //    적중 0이면 아무것도 하지 않는다(원본 전량 스캔 1회를 아낀다).
    const adultHidden = (incremental.adultHidden || 0) + (retry.adultHidden || 0);
    if (adultHidden > 0) {
        try {
            const { refreshHiddenFilter } = require('./refresh-hidden-filter');
            const r = await refreshHiddenFilter({ quiet: true });
            console.log('[cron-daily] hidden', JSON.stringify({
                adultHidden, index: r.rebuilt?.count ?? null, notified: r.notified, error: r.error || null,
            }));
        } catch (e) {
            // 번역 작업은 이미 끝났다 — 반영 실패로 cron 전체를 실패시키지 않는다(TTL이 받아준다).
            console.warn(`[cron-daily] 자동 숨김 ${adultHidden}건이나 인덱스 반영 실패: ${e.message}`);
        }
    }

    // ⑤ 관련작(related) 증분 — relatedAt 없는 신작만 TMDB recommendations 수집(멱등, 통상 수십 건).
    //    KCulture middleware의 작품→작품 크롤 링크가 이 필드를 읽는다(2026-08 색인 붕괴 대응).
    //    실패해도 cron 전체를 실패시키지 않는다 — 다음 실행이 자동 재시도.
    try {
        const { runRelatedBackfill } = require('./backfill-related');
        const rel = await runRelatedBackfill({ limit: 500 });
        console.log('[cron-daily] related', JSON.stringify(rel));
    } catch (e) {
        console.warn(`[cron-daily] related 백필 실패(다음 실행 재시도): ${e.message}`);
    }

    console.log(`[cron-daily] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(0);
})().catch((e) => { console.error('[cron-daily] FAIL', e); process.exit(1); });
