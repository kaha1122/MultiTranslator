// ── 자동 스레드 댓글 — 수동 실행·상태 확인 (프로덕션은 news-refresh 체이닝이 호출) ────────
// 사용: cd server && node scripts/comment-autopost.js [--force] [--status]
//   --status : 큐 잔량·최근 게시 상태만 출력(게시 안 함)
//   --force  : 슬롯·중복 게이트 우회하고 즉시 슬롯 1회분(2건) 게시 — 파이프라인 검증용
//   (인자 없음): 실제 슬롯 판정대로 실행(대개 offslot 스킵 — 체이닝과 동일 동작 확인용)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { runCommentAutopost, SLOT_HOURS_KST, POSTS_PER_SLOT } = require('../lib/commentAutopost');

(async () => {
    if (process.argv.includes('--status')) {
        const state = (await kcultureDb.doc('config/comment_autopost').get()).data() || {};
        const pending = await kcultureDb.collection('comment_queue').where('status', '==', 'pending').get();
        const posted = await kcultureDb.collection('comment_queue').where('status', '==', 'posted').get();
        console.log(`슬롯(KST): ${SLOT_HOURS_KST.join('/')}시 × ${POSTS_PER_SLOT}건 = 하루 ${SLOT_HOURS_KST.length * POSTS_PER_SLOT}건`);
        console.log(`큐: pending ${pending.size} / posted ${posted.size}`);
        console.log(`마지막 슬롯: ${state.lastSlotKey || '(없음)'} · 게시: ${JSON.stringify(state.lastPosted || null)}`);
        const rows = pending.docs.sort((a, b) => (a.data().order || 0) - (b.data().order || 0)).slice(0, 20);
        rows.forEach((d) => { const x = d.data(); console.log(`  #${x.order} ${x.titleName} ep${x.episode} ${x.lang} tone=${x.tone}`); });
        process.exit(0);
    }
    const r = await runCommentAutopost({ force: process.argv.includes('--force') });
    console.log('[comment-autopost]', JSON.stringify(r));
    process.exit(0);
})().catch((e) => { console.error('[comment-autopost] FAIL', e); process.exit(1); });
