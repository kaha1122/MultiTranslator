// ── 자동 소감 큐 적재 — 배치 JSON → Firestore sogam_queue (멱등: titleId+lang 중복 스킵) ──
// 사용: cd server && node scripts/sogam-queue-load.js --file <batch.json> [--dry]
// JSON 형식: { "items": [ { "titleId": 123, "media": "tv", "lang": "id", "tone": 1,
//                           "title": "...", "body": "..." }, ... ] }
// 적재 시 TMDB에서 titleName(en)·posterPath·backdropPath를 보강(이미지 규칙 #7 — 원어→en 기본 1종).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { collectQuietly } = require('../lib/collectHighlights');

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
    const seenTitles = new Map(); // titleId → {media, season} — 적재 후 하이라이트 수집 대상(중복 제거)
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
            titleOriginal: d.original_name || d.original_title || null, // 원제(한국 작품이면 한국어) — 푸시 제목·표시용(2026-09-04)
            posterPath: d.poster_path || null, backdropPath: d.backdrop_path || null,
            status: 'pending', order: ++order, createdAt: new Date(),
        };
        console.log(`${dry ? '[dry] ' : ''}적재 #${order}: ${doc.titleName} (${doc.titleId}) ${doc.lang} tone=${doc.tone} img=${doc.backdropPath ? 'O' : 'X'}`);
        if (!dry) await kcultureDb.collection('sogam_queue').add(doc);
        if (!seenTitles.has(doc.titleId)) seenTitles.set(doc.titleId, { media: doc.media, season: Number(it.season) > 0 ? Number(it.season) : 1 });
        loaded++;
    }
    console.log(`[sogam-queue-load] DONE — 적재 ${loaded} / 스킵 ${skipped}${dry ? ' (dry)' : ''}`);

    // ── 회차 하이라이트 자동 수집 (2026-08-28 사용자 지시) ──────────────────────
    // 소감을 쓴 작품은 그 자리에서 에피소드 탭 하이라이트까지 채운다.
    // · **적재가 끝난 뒤** 별도 단계로 돈다 — 수집이 큐 적재를 지연시키거나 막으면 안 된다.
    // · media !== 'tv' 는 자동 건너뜀(소감은 영화 비중이 크다 — 회차 개념 없음).
    // · 이미 저장된 회차는 멱등 스킵. 실패해도 무시하고 종료 코드는 성공.
    // · 20화짜리 신규 작품이면 수 분 걸린다. 끄려면 --no-highlights.
    // ⚠ 다시즌 작품은 배치 JSON 항목에 season 을 넣을 것(없으면 S1).
    if (!dry && !process.argv.includes('--no-highlights') && seenTitles.size) {
        console.log(`\n[highlights] 대상 작품 ${seenTitles.size}건 — 수집 시작`);
        for (const [titleId, meta] of seenTitles) {
            const h = await collectQuietly(kcultureDb, { titleId, season: meta.season, media: meta.media, tag: `sogam-${titleId}` });
            if (h.skipped) console.log(`[highlights] ${titleId} 건너뜀 — ${h.skipped}`);
            else console.log(`[highlights] ${titleId} — 저장 ${h.saved.length} / 검토 ${h.ambiguous.length} / 없음 ${h.notfound.length}`);
        }
    }
    process.exit(0);
})().catch((e) => { console.error('[sogam-queue-load] FAIL', e); process.exit(1); });
