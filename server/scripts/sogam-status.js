// ── 자동 소감 운영 현황 1장 요약 — 매일 점검용 ─────────────────────────────────────
// 사용: cd server && node scripts/sogam-status.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

(async () => {
    const state = (await kcultureDb.doc('config/sogam_autopost').get()).data() || {};
    console.log('마지막 슬롯 :', state.lastSlotKey || '(없음)', '| 마지막 글:', state.lastPostId || '-');
    const q = await kcultureDb.collection('sogam_queue').get();
    const by = {};
    q.docs.forEach((d) => { const s = d.data().status; by[s] = (by[s] || 0) + 1; });
    console.log('큐 현황     :', JSON.stringify(by));
    const pend = q.docs.filter((d) => d.data().status === 'pending')
        .sort((a, b) => (a.data().order || 0) - (b.data().order || 0)).slice(0, 5);
    pend.forEach((d) => { const x = d.data(); console.log(`  다음 #${x.order} ${x.titleName} (${x.lang}, tone ${x.tone})`); });
    const posts = await kcultureDb.collection('posts').where('sogamAuto', '==', true).get();
    console.log('게시 누적   :', posts.size + '건');
    posts.docs.map((d) => d.data()).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 5)
        .forEach((x) => console.log(`  ${x.createdAt?.toDate?.().toISOString().slice(0, 16) || '?'} ${x.lang} ${x.titleName} — ${(x.title || '').slice(0, 40)}`));
    process.exit(0);
})().catch((e) => { console.error('[sogam-status] FAIL', e); process.exit(1); });
