// ── 소감·리뷰 답글 — 수동 실행·상태 확인 (프로덕션은 news-refresh 체이닝이 호출) ────────
// 사용: cd server && node scripts/reply-autopost.js [--force] [--status]
//   --status : 큐 잔량·due 현황·최근 게시 상태만 출력(게시 안 함)
//   --force  : notBefore 게이트 우회하고 즉시 회당 캡(2건)만큼 게시 — 파이프라인 검증용
//   (인자 없음): 실제 due 판정대로 실행(대개 no-due 스킵 — 체이닝과 동일 동작 확인용)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { runReplyAutopost, MAX_PER_RUN } = require('../lib/replyAutopost');

function ms(v) { return v && typeof v.toMillis === 'function' ? v.toMillis() : new Date(v).getTime(); }

(async () => {
    if (process.argv.includes('--status')) {
        const state = (await kcultureDb.doc('config/reply_autopost').get()).data() || {};
        const pending = await kcultureDb.collection('reply_queue').where('status', '==', 'pending').get();
        const posted = await kcultureDb.collection('reply_queue').where('status', '==', 'posted').get();
        const now = Date.now();
        const due = pending.docs.filter((d) => ms(d.data().notBefore) <= now).length;
        console.log(`게시: news-refresh 2h 주기 × 회당 최대 ${MAX_PER_RUN}건 (due 기반 — 슬롯 없음)`);
        console.log(`큐: pending ${pending.size} (due ${due}) / posted ${posted.size}`);
        console.log(`마지막 게시: ${state.lastAt ? new Date(ms(state.lastAt)).toISOString() : '(없음)'} · ${JSON.stringify(state.lastPosted || null)}`);
        pending.docs.sort((a, b) => ms(a.data().notBefore) - ms(b.data().notBefore)).slice(0, 20)
            .forEach((d) => { const x = d.data(); console.log(`  #${x.order} ${x.titleName || x.postId} [${x.kind}] ${x.lang} ${x.accountPool} due=${new Date(ms(x.notBefore)).toISOString().slice(5, 16)} ${x._note || ''}`); });
        process.exit(0);
    }
    const r = await runReplyAutopost({ force: process.argv.includes('--force') });
    console.log('[reply-autopost]', JSON.stringify(r));
    process.exit(0);
})().catch((e) => { console.error('[reply-autopost] FAIL', e); process.exit(1); });
