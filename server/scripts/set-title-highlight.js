// ── 회차 하이라이트 영상 저장 (2026-08-27, K-DramaAnyLang 에피소드 탭) ─────────────
// 댓글 Agent(thread-comments)가 방송후 모드 소스 사다리 ①에서 고른 공식 회차 하이라이트/요약본
// (tvN DRAMA "N화 하이라이트", MBC 드파밍, SBS Catch 등)의 videoId를 작품 문서에 귀속 저장한다.
// 저장소: titles/{id}/media/clips 의 **hls 맵** { "s{season}e{ep}": videoId } — set-merge 멱등.
//   같은 문서의 eps 맵(선공개, dari-publish 미러)은 건드리지 않는다. 앱 에피소드 탭은
//   hls > eps 우선으로 읽어, 방영 전엔 선공개가 보이다가 하이라이트 저장 시 자동 승격된다.
//
// 실행: cd server && node scripts/set-title-highlight.js --title <tmdbId> --season <S> --ep <N> --video <videoId> [--dry]
//   예: node scripts/set-title-highlight.js --title 296140 --season 1 --ep 8 --video eAgh4laD5QY
// 전제: server/.env 에 KCULTURE_SERVICE_ACCOUNT_BASE64
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : null;
}
const dry = process.argv.includes('--dry');

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const id = String(arg('title') || '').replace(/\D/g, '');
    const season = parseInt(arg('season'), 10);
    const ep = parseInt(arg('ep'), 10);
    const video = String(arg('video') || '').trim();
    if (!id || !Number.isInteger(season) || season < 1 || !Number.isInteger(ep) || ep < 1
        || !/^[A-Za-z0-9_-]{6,20}$/.test(video)) {
        console.error('사용법: node scripts/set-title-highlight.js --title <tmdbId> --season <S> --ep <N> --video <youtubeVideoId> [--dry]');
        process.exit(1);
    }
    const key = `s${season}e${ep}`;
    const ref = kcultureDb.doc(`titles/${id}/media/clips`);
    const prev = await ref.get();
    const cur = (prev.exists && (prev.data().hls || {})[key]) || null;
    console.log(`titles/${id}/media/clips  hls.${key}: ${cur || '(없음)'} → ${video}${cur === video ? ' (동일 — no-op)' : ''}`);
    if (dry) { console.log('[dry] 쓰기 없음'); process.exit(0); }
    if (cur === video) process.exit(0);
    await ref.set({ hls: { [key]: video }, updatedAt: new Date() }, { merge: true });
    console.log('저장 완료');
    process.exit(0);
})().catch((e) => { console.error('[set-title-highlight] FAIL', e); process.exit(1); });
