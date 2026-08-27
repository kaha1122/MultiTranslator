// ── 회차 하이라이트 영상 저장 (2026-08-27, 게이트 강화 2026-08-28) ─────────────────
// 댓글 Agent(thread-comments) 등이 고른 공식 회차 하이라이트/요약본의 videoId를 작품 문서에
// 귀속 저장한다. 저장 전 **하드 게이트**(lib/highlightGate)를 통과해야 한다:
//   ① oEmbed 200(존재+임베드 가능 — 우회 불가) ② 공식 채널 allowlist(--force-channel로만 우회
//   — 지양: 새 공식 채널은 lib/highlightGate.js OFFICIAL_CHANNELS 에 추가하는 것이 정도).
// 저장소: titles/{id}/media/clips 의 hls 맵 { "s{season}e{ep}": videoId } + hlsMeta(감사용
//   제목·채널·시각) — set-merge 멱등. eps 맵(선공개, dari-publish 미러)은 건드리지 않는다.
// 앱 에피소드 탭은 hls > eps 우선으로 읽어, 방영 전엔 선공개가 보이다가 저장 시 자동 승격된다.
//
// 실행: cd server && node scripts/set-title-highlight.js --title <tmdbId> --season <S> --ep <N> --video <videoId> [--dry] [--force-channel]
//   예: node scripts/set-title-highlight.js --title 296206 --season 1 --ep 8 --video yNlt-q4gLvk
// 전제: server/.env 에 KCULTURE_SERVICE_ACCOUNT_BASE64
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { gateHighlight, saveHighlight } = require('../lib/highlightGate');

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : null;
}
const dry = process.argv.includes('--dry');
const forceChannel = process.argv.includes('--force-channel');

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const id = String(arg('title') || '').replace(/\D/g, '');
    const season = parseInt(arg('season'), 10);
    const ep = parseInt(arg('ep'), 10);
    const video = String(arg('video') || '').trim();
    if (!id || !Number.isInteger(season) || season < 1 || !Number.isInteger(ep) || ep < 1
        || !/^[A-Za-z0-9_-]{6,20}$/.test(video)) {
        console.error('사용법: node scripts/set-title-highlight.js --title <tmdbId> --season <S> --ep <N> --video <youtubeVideoId> [--dry] [--force-channel]');
        process.exit(1);
    }

    // 하드 게이트 — oEmbed(존재·임베드)·공식 채널 검증. 실패 시 저장하지 않는다.
    const gate = await gateHighlight(video, { forceChannel });
    if (!gate.ok) {
        console.error(`❌ 게이트 거부(${gate.reason})${gate.author ? ` — 채널 "${gate.author}"` : ''}`);
        if (gate.reason === 'channel_not_allowlisted') {
            console.error('   공식 채널이 맞으면 lib/highlightGate.js OFFICIAL_CHANNELS 에 채널명을 추가하고 재실행(권장).');
        }
        process.exit(2);
    }
    console.log(`게이트 통과 — "${gate.title.slice(0, 60)}" (${gate.author}${forceChannel ? ', --force-channel' : ''})`);

    const key = `s${season}e${ep}`;
    const prev = await kcultureDb.doc(`titles/${id}/media/clips`).get();
    const cur = (prev.exists && (prev.data().hls || {})[key]) || null;
    console.log(`titles/${id}/media/clips  hls.${key}: ${cur || '(없음)'} → ${video}${cur === video ? ' (동일 — no-op)' : ''}`);
    if (dry) { console.log('[dry] 쓰기 없음'); process.exit(0); }
    if (cur === video) process.exit(0);
    await saveHighlight(kcultureDb, { titleId: id, season, ep, videoId: video, meta: gate });
    console.log('저장 완료');
    process.exit(0);
})().catch((e) => { console.error('[set-title-highlight] FAIL', e); process.exit(1); });
