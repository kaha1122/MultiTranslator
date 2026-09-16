// Dari 리뷰 글 삭제(보호 가드 포함) — 2026-09-16 신설
// 사용: cd server && node scripts/dari-review-delete.js --post <postId> [--force] [--apply]
// 왜 필요한가: /api/curation/publish(review_v2)는 멱등이 아니라 같은 페이로드를 두 번 보내면
//   같은 리뷰가 두 벌 생긴다(2026-09-16 「연모」 사고). 삭제 라우트가 없어 콘솔 수동 삭제밖에
//   없었다 → 가드 달린 CLI로 대체. 게시 가드(lib/dari.js createReviewPost)와 한 세트.
// 원칙: 사람의 반응(공감·댓글)이 붙은 글은 지우지 않는다(--force로만 우회).
// 지우는 것: posts/{id} + translations/* (본문·제목 시드). comments/likes는 가드에 걸려 없을 때만.
require('dotenv').config();
const { kcultureDb } = require('../config/firebaseKculture');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const postId = arg('post', null);
const force = process.argv.includes('--force');
const apply = process.argv.includes('--apply');

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    if (!postId) { console.error('사용법: --post <postId> [--force] [--apply]  (기본 dry-run)'); process.exit(1); }
    const ref = kcultureDb.doc(`posts/${postId}`);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`posts/${postId} 없음 — 아무것도 하지 않음`); process.exit(0); }
    const x = snap.data();
    const [tx, comments, likes] = await Promise.all([
        ref.collection('translations').get(),
        ref.collection('comments').get(),
        ref.collection('likes').get(),
    ]);
    console.log(`대상: posts/${postId}`);
    console.log(`  작품 ${x.media} ${x.titleId} "${x.titleName}" | curator=${!!x.curator} | 작성 ${x.createdAt?.toDate?.()?.toISOString?.() || x.createdAt}`);
    console.log(`  제목 ${String(x.title || '').slice(0, 70)}`);
    console.log(`  likeCount ${x.likeCount || 0} · commentCount ${x.commentCount || 0} · translations ${tx.size} · comments ${comments.size} · likes ${likes.size}`);
    if (!x.curator && !force) { console.error('보호 가드: curator 글이 아님 — 사용자 글은 이 스크립트로 지우지 않는다(--force)'); process.exit(2); }
    if (!force && ((x.likeCount || 0) > 0 || (x.commentCount || 0) > 0 || comments.size > 0 || likes.size > 0)) {
        console.error('보호 가드: 공감 또는 댓글이 있어 삭제하지 않음(--force로 우회 가능)'); process.exit(2);
    }
    if (!apply) { console.log('[dry-run] 삭제 생략 — 실제로 지우려면 --apply'); process.exit(0); }
    const batch = kcultureDb.batch();
    tx.docs.forEach((d) => batch.delete(d.ref));
    comments.docs.forEach((d) => batch.delete(d.ref));
    likes.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
    console.log(`삭제 완료: posts/${postId} + translations ${tx.size}${comments.size ? ` + comments ${comments.size}` : ''}${likes.size ? ` + likes ${likes.size}` : ''}`);
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
