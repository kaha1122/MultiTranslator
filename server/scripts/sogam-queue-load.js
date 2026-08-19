// ── 자동 소감 큐 적재 — 배치 JSON → Firestore sogam_queue (멱등: titleId+lang 중복 스킵) ──
// 사용: cd server && node scripts/sogam-queue-load.js --file <batch.json> [--dry]
// JSON 형식: { "items": [ { "titleId": 123, "media": "tv", "lang": "id", "tone": 1,
//                           "title": "...", "body": "..." }, ... ] }
// 적재 시 TMDB에서 titleName(en)·posterPath·backdropPath를 보강(이미지 규칙 #7 — 원어→en 기본 1종).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

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
    // 현재 큐의 최대 order — 이어붙이기
    const last = await kcultureDb.collection('sogam_queue').orderBy('order', 'desc').limit(1).get();
    let order = last.empty ? 0 : (last.docs[0].data().order || 0);
    let loaded = 0, skipped = 0;
    for (const it of items) {
        if (!it.titleId || !it.lang || !it.body) { console.warn('필드 누락 스킵:', JSON.stringify(it).slice(0, 80)); skipped++; continue; }
        const dup = await kcultureDb.collection('sogam_queue')
            .where('titleId', '==', Number(it.titleId)).where('lang', '==', it.lang).limit(1).get();
        if (!dup.empty) { console.log(`중복 스킵: ${it.titleId} ${it.lang}`); skipped++; continue; }
        const d = await tmdbDetail(it.media || 'tv', it.titleId);
        const doc = {
            titleId: Number(it.titleId), media: it.media || 'tv', lang: it.lang,
            tone: it.tone != null ? it.tone : null,
            title: it.title || null, body: it.body,
            titleName: d.name || d.title || null,
            posterPath: d.poster_path || null, backdropPath: d.backdrop_path || null,
            status: 'pending', order: ++order, createdAt: new Date(),
        };
        console.log(`${dry ? '[dry] ' : ''}적재 #${order}: ${doc.titleName} (${doc.titleId}) ${doc.lang} tone=${doc.tone} img=${doc.backdropPath ? 'O' : 'X'}`);
        if (!dry) await kcultureDb.collection('sogam_queue').add(doc);
        loaded++;
    }
    console.log(`[sogam-queue-load] DONE — 적재 ${loaded} / 스킵 ${skipped}${dry ? ' (dry)' : ''}`);
    process.exit(0);
})().catch((e) => { console.error('[sogam-queue-load] FAIL', e); process.exit(1); });
