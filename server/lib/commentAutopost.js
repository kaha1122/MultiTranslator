// ── 자동 스레드 댓글 게시 — 큐 + news-refresh 체이닝 (2026-08-22, 사용자 설계) ──────────
// 목적: Dari On-Air 스레드(featured 방영작)에 실제 시청자 톤의 방송후 댓글을 자동 게시해
//       스레드를 살아있는 대화면으로 만든다(소감 자동화의 댓글판).
// 구조: Claude 세션이 방송후 모드 배치로 댓글을 창작해 comment_queue에 적재
//       (scripts/comment-queue-load.js) → 이 모듈이 news-refresh 체이닝(2h 주기, KST 홀수시
//       그리드)으로 호출되어 지정 슬롯(KST 03/09/11/13/15/19/23)에 슬롯당 2건 게시.
// 계정: 소감 자동화의 언어별 고정 페르소나 6계정 재사용(lib/sogam.js ensureSogamAccount —
//       ko/en/id/ru/es/ar). 계정 생성·users 문서 규칙은 그쪽 주석 참조.
// 저장: titles/{id}/discussion 일반 문서 — 앱 createComment(src/lib/discussion.js)와 동일
//       스키마 + 감사용 additive 마커(commentAuto·tone). threadRoot 아님(스레드 댓글은
//       회차 태그 일반 discussion 문서로 저장되는 구조 — KCulture curation.js 주석 참조).
// ⚠ 서버 write는 titles/* 산하만(발열 규칙) — users 본문은 건드리지 않는다.
const { kcultureDb } = require('../config/firebaseKculture');
const { ensureSogamAccount, PERSONAS } = require('./sogam');

const SLOT_HOURS_KST = [3, 9, 11, 13, 15, 19, 23]; // 2026-08-31 사용자 지시로 09시 추가(오전 공백) — 2026-08-24 재배치(낮 시간대 확대)의 연장
const POSTS_PER_SLOT = 2;               // 하루 7슬롯 × 2건 = 14댓글 (2026-08-31 09시 슬롯 추가로 12→14)

function kstNow() {
    return new Date(Date.now() + 9 * 3600 * 1000); // UTC+9 — getUTC*로 읽는다 (sogam과 동일)
}

// ── 자동 게시 — news-refresh가 2h마다 호출, 지정 슬롯에서만 슬롯당 최대 2건(멱등) ──────
// force: 수동 테스트(scripts/comment-autopost.js --force) — 슬롯·중복 게이트 우회.
async function runCommentAutopost({ force = false } = {}) {
    if (!kcultureDb) return { skipped: 'no-db' };
    const k = kstNow();
    const hour = k.getUTCHours();
    if (!force && !SLOT_HOURS_KST.includes(hour)) return { skipped: `offslot(kst ${hour}h)` };
    const slotKey = `${k.toISOString().slice(0, 10)}_${String(hour).padStart(2, '0')}`;

    const stateRef = kcultureDb.doc('config/comment_autopost');
    const state = (await stateRef.get()).data() || {};
    // 2026-09-04 사용자 결정: 스레드 댓글 자동 게시 폐지(수동 게시 모드 — 배치는 md만 만들고 사용자가 직접 게시).
    // config/comment_autopost.enabled === true 일 때만 동작(기본 OFF). --force 수동 검증은 그대로 우회.
    if (!force && state.enabled !== true) return { skipped: 'disabled(manual-mode 2026-09-04)' };
    if (!force && state.lastSlotKey === slotKey) return { skipped: `dup-slot(${slotKey})` };

    // status 단일 조건 + 메모리 정렬 — 복합 인덱스 회피(큐는 상시 수십 건 규모, sogam과 동일)
    const q = await kcultureDb.collection('comment_queue')
        .where('status', '==', 'pending').limit(100).get();
    if (q.empty) { console.log('[comment] 큐 비어 있음 — 게시 스킵'); return { skipped: 'empty-queue' }; }
    const pending = q.docs.sort((a, b) => (a.data().order || 0) - (b.data().order || 0));

    // 슬롯당 2건 — 같은 슬롯의 두 건은 서로 다른 (작품, 언어)가 되게 고른다(봇 티 방지).
    const picked = [];
    for (const d of pending) {
        if (picked.length >= POSTS_PER_SLOT) break;
        const x = d.data();
        const clash = picked.some((p) =>
            String(p.data().titleId) === String(x.titleId) || p.data().lang === x.lang);
        if (!clash) picked.push(d);
    }
    // 다양성 확보 불가(큐 잔량이 같은 작품/언어뿐)면 순서대로 채운다 — 게시가 밀리는 것보다 낫다.
    for (const d of pending) {
        if (picked.length >= POSTS_PER_SLOT) break;
        if (!picked.includes(d)) picked.push(d);
    }

    const results = [];
    for (const doc of picked) {
        const item = doc.data();
        try {
            const uid = await ensureSogamAccount(item.lang);
            const comment = {
                authorUid: uid, authorName: PERSONAS[item.lang], authorPhoto: null,
                lang: item.lang, body: item.body,
                episode: item.episode != null ? Number(item.episode) : 0,
                spoiler: false, media: item.media || 'tv', likeCount: 0, images: [],
                titleName: item.titleName || null, posterPath: item.posterPath || null,
                createdAt: new Date(),
                commentAuto: true, tone: item.tone != null ? item.tone : null, // 감사·분석용 additive
            };
            const ref = await kcultureDb
                .collection('titles').doc(String(item.titleId)).collection('discussion').add(comment);
            await doc.ref.set({ status: 'posted', commentId: ref.id, postedAt: new Date() }, { merge: true });
            console.log(`[comment] 게시: titles/${item.titleId}/discussion/${ref.id} ${item.lang} ep${comment.episode} tone=${item.tone} (slot ${slotKey})`);
            results.push({ commentId: ref.id, titleId: item.titleId, lang: item.lang, episode: comment.episode });
        } catch (e) {
            // 개별 실패는 pending으로 남겨 다음 슬롯에서 재시도 — 슬롯 전체를 죽이지 않는다.
            console.warn(`[comment] 게시 실패(${item.titleId}/${item.lang}):`, e?.message);
        }
    }
    if (results.length) {
        await stateRef.set({ lastSlotKey: slotKey, lastAt: new Date(), lastPosted: results }, { merge: true });
    }
    return { posted: results.length, slotKey, items: results };
}

module.exports = { runCommentAutopost, SLOT_HOURS_KST, POSTS_PER_SLOT };
