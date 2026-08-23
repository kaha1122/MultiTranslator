// ── 자동 스레드 댓글 큐 적재 — 배치 JSON → Firestore comment_queue ─────────────────
// (멱등: titleId+episode+lang 중복 스킵 — 같은 계정이 같은 작품·회차에 두 번 달리지 않게)
// 사용: cd server && node scripts/comment-queue-load.js --file <batch.json> [--dry]
// JSON 형식: { "items": [ { "titleId": 123, "media": "tv", "episode": 5, "lang": "id",
//                           "tone": 1, "body": "..." }, ... ] }
// - lang은 소감 6계정(ko/en/id/ru/es/ar — lib/sogam.js PERSONAS)만 허용.
// - 적재 시 TMDB에서 titleName(en)·posterPath 보강(discussion 문서 비정규화 필드 — 앱과 동일).
// - order는 기존 큐에 이어붙임 → 서버(lib/commentAutopost.js)가 순서대로 슬롯당 2건 게시.
//   ⚠ 언어·톤·작품 믹스는 배치 생성 측(thread-comments 에이전트)이 order 배열로 설계한다 —
//   여기서는 섞지 않는다(적재 순서 = 게시 순서).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { PERSONAS } = require('../lib/sogam');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const file = arg('file', '');
const dry = process.argv.includes('--dry');
const TMDB_KEY = process.env.TMDB_API_KEY;

async function tmdbDetail(media, id) {
    const r = await fetch(`https://api.themoviedb.org/3/${media}/${id}?api_key=${TMDB_KEY}&language=en-US`);
    if (!r.ok) throw new Error(`TMDB ${media}/${id} ${r.status}`);
    return r.json();
}

(async () => {
    if (!file) { console.error('--file <batch.json> 필요'); process.exit(1); }
    if (!kcultureDb) throw new Error('kcultureDb 없음');
    const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = batch.items || [];
    const last = await kcultureDb.collection('comment_queue').orderBy('order', 'desc').limit(1).get();
    let order = last.empty ? 0 : (last.docs[0].data().order || 0);
    const metaCache = new Map(); // titleId → TMDB detail (같은 작품 여러 언어 적재 시 1회 조회)
    let loaded = 0, skipped = 0;
    for (const it of items) {
        if (!it.titleId || !it.lang || !it.body || it.episode == null) {
            console.warn('필드 누락 스킵:', JSON.stringify(it).slice(0, 80)); skipped++; continue;
        }
        if (!PERSONAS[it.lang]) { console.warn(`미지원 언어 스킵(소감 6계정 밖): ${it.lang}`); skipped++; continue; }
        // 중복 판정은 pending/posted만 — 취소(cancelled-*)된 문서는 재적재 허용(2026-08-23: 재작성 배치가 자기
        // 자신의 취소분에 막혀 5건 스킵된 사고).
        const dup = await kcultureDb.collection('comment_queue')
            .where('titleId', '==', Number(it.titleId)).where('lang', '==', it.lang)
            .where('episode', '==', Number(it.episode)).get();
        const live = dup.docs.some((d) => ['pending', 'posted'].includes(d.data().status));
        if (live) { console.log(`중복 스킵: ${it.titleId} ep${it.episode} ${it.lang}`); skipped++; continue; }
        const ck = `${it.media || 'tv'}/${it.titleId}`;
        if (!metaCache.has(ck)) metaCache.set(ck, await tmdbDetail(it.media || 'tv', it.titleId));
        const d = metaCache.get(ck);
        const doc = {
            titleId: Number(it.titleId), media: it.media || 'tv', episode: Number(it.episode),
            lang: it.lang, tone: it.tone != null ? it.tone : null, body: it.body,
            titleName: d.name || d.title || null, posterPath: d.poster_path || null,
            status: 'pending', order: ++order, createdAt: new Date(),
        };
        console.log(`${dry ? '[dry] ' : ''}적재 #${order}: ${doc.titleName} (${doc.titleId}) ep${doc.episode} ${doc.lang} tone=${doc.tone}`);
        if (!dry) await kcultureDb.collection('comment_queue').add(doc);
        loaded++;
    }
    console.log(`[comment-queue-load] DONE — 적재 ${loaded} / 스킵 ${skipped}${dry ? ' (dry)' : ''}`);
    process.exit(0);
})().catch((e) => { console.error('[comment-queue-load] FAIL', e); process.exit(1); });
