// Dari 스레드 삭제(보호 가드 포함) — 2026-09-04 신설
// 사용: cd server && node scripts/dari-thread-delete.js --title <tmdbId> --tid dari_s1e2 [--season 1] [--force] [--dry]
// 원칙(dari-thread.md §4): 댓글·평가가 살아 있는 스레드는 삭제하지 않는다. 이 스크립트는
//   ① 루트 문서 likeCount 0 ② 해당 회차(episodes)의 discussion 코멘트(루트 제외) 0건일 때만 지운다(--force로 우회, 사유는 커밋 메시지에).
// 지우는 것: titles/{id}/discussion/{tid} 루트 + translations/* 서브컬렉션 + curation_threads/{id}_s{S}e{N}(featured 포함 소멸).
// 지우지 않는 것: titles/{id}/media/clips 미러(무해), 형제 스레드의 prevThreads(다음 개설 때 refreshSiblingPrevThreads가 재계산).
require('dotenv').config();
const { kcultureDb } = require('../config/firebaseKculture');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const tmdbId = parseInt(arg('title', ''), 10);
const tid = arg('tid', null);
const season = parseInt(arg('season', '1'), 10);
const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음');
    if (!Number.isInteger(tmdbId) || !tid) { console.error('사용법: --title <tmdbId> --tid <dari_s1e2|dari_s1pre> [--season 1] [--force] [--dry]'); process.exit(1); }
    const rootRef = kcultureDb.doc(`titles/${tmdbId}/discussion/${tid}`);
    const root = await rootRef.get();
    if (!root.exists) { console.log('루트 문서 없음 — 아무것도 하지 않음'); process.exit(0); }
    const x = root.data();
    const pointerId = `${tmdbId}_${tid.replace(/^dari_/, '')}`; // dari_s1e2 → 294095_s1e2 / dari_s1pre → 294095_s1pre
    const eps = (x.episodes || []).map((e) => e.n).filter(Boolean);
    let comments = 0;
    if (eps.length) {
        const snap = await kcultureDb.collection(`titles/${tmdbId}/discussion`).where('episode', 'in', eps.slice(0, 30)).get();
        comments = snap.docs.filter((d) => !d.data().threadRoot && !d.data().deleted).length;
    } else {
        const snap = await kcultureDb.collection(`titles/${tmdbId}/discussion`).where('episode', '==', 0).get();
        comments = snap.docs.filter((d) => !d.data().threadRoot && !d.data().deleted).length;
    }
    console.log(`대상: ${rootRef.path} | 제목 "${x.title}" | likeCount ${x.likeCount || 0} | 회차 코멘트 ${comments} | 포인터 ${pointerId}`);
    if (!force && ((x.likeCount || 0) > 0 || comments > 0)) { console.error('보호 가드: 공감 또는 코멘트가 있어 삭제하지 않음(--force로 우회 가능)'); process.exit(2); }
    if (dry) { console.log('[dry] 삭제 생략'); process.exit(0); }
    const tx = await rootRef.collection('translations').get();
    const batch = kcultureDb.batch();
    tx.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(rootRef);
    batch.delete(kcultureDb.doc(`curation_threads/${pointerId}`));
    await batch.commit();
    console.log(`삭제 완료: 루트 + translations ${tx.size} + 포인터 ${pointerId}`);
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
