// ── 기존 Dari 스레드 선공개 클립 → titles/{id}/media/clips 소급 미러 (2026-08-27, 멱등) ──
// 배경: 앱 상세 '에피소드' 탭이 회차별 클립을 titles/{id}/media/clips에서 읽는데,
// 이 미러는 dari-publish(lib/dari.js mirrorClipToTitle)가 2026-08-27부터 쓰기 시작했다.
// 그 전에 개설된 스레드들의 clip은 curation_threads 포인터에만 있으므로 여기서 1회 소급한다.
// 실행: cd server && node scripts/backfill-title-clips.js [--dry]
// ep 귀속 규칙(dari.js와 동일): clip.ep 있으면 그 회차, 없으면 doc id의 상한 회차(_s{S}e{E}).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const dry = process.argv.includes('--dry');

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const snap = await kcultureDb.collection('curation_threads').get();
    const byTitle = new Map(); // titleId → { "s{S}e{E}": videoId }
    for (const d of snap.docs) {
        const x = d.data();
        if (!x.clip || !x.clip.videoId) continue;
        const m = d.id.match(/_s(\d+)e(\d+)$/);
        if (!m) { console.warn(`skip(doc id 형식 불일치 — 영화 등): ${d.id}`); continue; }
        const season = Number(m[1]);
        const maxEp = Number(m[2]);
        const ep = (Number.isInteger(x.clip.ep) && x.clip.ep > 0) ? x.clip.ep : maxEp;
        if (!byTitle.has(x.titleId)) byTitle.set(x.titleId, {});
        byTitle.get(x.titleId)[`s${season}e${ep}`] = x.clip.videoId;
        console.log(`${d.id.padEnd(18)} → titles/${x.titleId}/media/clips  s${season}e${ep} = ${x.clip.videoId}  (${x.titleName || ''})`);
    }
    if (dry) { console.log(`[dry] 작품 ${byTitle.size}개 — 쓰기 없음`); process.exit(0); }
    for (const [id, eps] of byTitle) {
        await kcultureDb.doc(`titles/${id}/media/clips`).set({ eps, updatedAt: new Date() }, { merge: true });
    }
    const total = [...byTitle.values()].reduce((a, e) => a + Object.keys(e).length, 0);
    console.log(`완료: 작품 ${byTitle.size}개, 클립 ${total}개 미러`);
    process.exit(0);
})().catch((e) => { console.error('[backfill-title-clips] FAIL', e); process.exit(1); });
