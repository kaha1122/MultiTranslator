// ── 소감·Dari 리뷰 답글 게시 — 큐 + news-refresh 체이닝 (2026-09-01, 사용자 설계) ──────────
// 목적: 자동 소감(sogamAuto)·Dari 리뷰(curator) 게시물에 독자 답글을 달아 글을 대화면으로 만든다
//       (스레드 댓글 자동화 lib/commentAutopost.js의 게시물 댓글판).
// 구조: Claude 세션(post-replies 에이전트)이 답글을 배치 작성해 reply_queue에 적재
//       (scripts/reply-queue-load.js) → 이 모듈이 news-refresh 체이닝(2h 주기)으로 호출된다.
// ⚠ 슬롯제가 아니라 **due 기반**이다 — 큐 항목마다 notBefore(적재 시 3~20h 랜덤 오프셋으로 계산)가
//   있고, 매 호출마다 notBefore가 지난 것만 최대 2건 게시한다. 같은 글의 답글이 몰려 달리지 않게
//   오프셋 설계는 에이전트 몫(같은 원글 수 시간 이상 간격), 여기는 회당 캡 + 같은 글 동시 게시 회피만.
// 계정: 신규 답글러 7계정(REPLY_PERSONAS — 아래) + 기존 소감 페르소나 7계정(lib/sogam.js) 혼용.
//       큐 항목의 accountPool('reply'|'sogam')이 결정한다. 익명(게스트) 댓글은 앱에 개념이 없어
//       미지원(2026-09-01 확인 — posts/*/comments는 authorUid 필수 스키마).
// 저장: posts/{postId}/comments 일반 문서 — 앱 addComment(src/lib/community.js)와 동일 스키마
//       + 부모 commentCount increment + 감사용 additive 마커(replyAuto·situation·tone).
// ⚠ users/{uid} 본문 write는 계정 최초 프로비저닝 1회뿐(발열 규칙 — sogam과 동일).
const crypto = require('crypto');
const admin = require('firebase-admin');
const { kcultureDb, kcultureAuth } = require('../config/firebaseKculture');
const { ensureSogamAccount, PERSONAS: SOGAM_PERSONAS } = require('./sogam');

const MAX_PER_RUN = 2; // 2h 주기 × 2건 — 하루 상한 24건이지만 실제 물량은 큐가 정한다(평상시 3~8건)
const LANGS = ['ko', 'en', 'id', 'ru', 'es', 'ar', 'vi'];
const ACCOUNT_EMAIL = (lang) => `reply-${lang}@kdramaanylang.com`;

// 신규 답글러 페르소나 — 2026-09-01 초안(최초 게시 전까지 이름 변경 가능 — 계정은 lazy 생성).
// es·ru·ar 여성 화자, id 친근한 여성 톤(소감 계정 체계 2026-08-15와 동일 관례).
const REPLY_PERSONAS = {
    ko: '주말정주행',
    en: 'SeoulSearcher',
    id: 'HaluDrakor',
    ru: 'Чай и дорама',
    es: 'NocheDeDoramas',
    ar: 'قهوة ودراما',
    vi: 'Cày Phim Đêm',
};

// ── 계정 보장 — 언어별 고정 uid (멱등, lib/sogam.js ensureSogamAccount와 동일 패턴) ──────
const uidCache = new Map(); // lang → uid
async function ensureReplyAccount(lang) {
    if (uidCache.has(lang)) return uidCache.get(lang);
    if (!kcultureAuth || !kcultureDb) throw new Error('kculture admin 앱 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const email = ACCOUNT_EMAIL(lang);
    const name = REPLY_PERSONAS[lang];
    if (!name) throw new Error(`알 수 없는 언어: ${lang}`);
    let user = null;
    try { user = await kcultureAuth.getUserByEmail(email); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    if (!user) {
        user = await kcultureAuth.createUser({
            email, emailVerified: true,
            password: crypto.randomBytes(32).toString('base64url'), // 로그인 안 함 — 무작위 봉인
            displayName: name,
        });
        console.log(`[reply] Auth 계정 생성: ${lang} "${name}" uid=${user.uid}`);
    }
    const ref = kcultureDb.doc(`users/${user.uid}`);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : {};
    await ref.set({
        displayName: name,
        lang,
        photoURL: existing.photoURL || null,
        points: existing.points != null ? existing.points : 0,
        lastFreeDate: existing.lastFreeDate || new Date().toISOString().slice(0, 10),
        termsAcceptedAt: existing.termsAcceptedAt || new Date(),
        ...(snap.exists ? {} : { createdAt: new Date() }),
    }, { merge: true });
    uidCache.set(lang, user.uid);
    return user.uid;
}

function toMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis(); // Firestore Timestamp
    return new Date(v).getTime();
}

// ── 자동 게시 — news-refresh가 2h마다 호출. due(notBefore 경과) 항목만 회당 최대 2건(멱등) ──
// force: 수동 테스트(scripts/reply-autopost.js --force) — notBefore 게이트 우회(회당 캡은 유지).
async function runReplyAutopost({ force = false } = {}) {
    if (!kcultureDb) return { skipped: 'no-db' };
    const now = Date.now();

    // 2026-09-05 사용자 결정: 답글 자동 게시 폐지(수동 게시 모드 — 배치는 글만 만들고 사용자가 페르소나 계정으로 직접 게시).
    // config/reply_autopost.enabled === true 일 때만 동작(기본 OFF). --force 수동 검증은 그대로 우회.
    // 같은 결정: 댓글 lib/commentAutopost.js(2026-09-04) · 소감 lib/sogam.js(2026-09-05).
    const state = (await kcultureDb.doc('config/reply_autopost').get()).data() || {};
    if (!force && state.enabled !== true) return { skipped: 'disabled(manual-mode 2026-09-05)' };

    // status 단일 조건 + 메모리 필터·정렬 — 복합 인덱스 회피(큐는 상시 수십 건 규모, sogam과 동일)
    const q = await kcultureDb.collection('reply_queue')
        .where('status', '==', 'pending').limit(100).get();
    if (q.empty) return { skipped: 'empty-queue' };
    const due = q.docs
        .filter((d) => force || toMillis(d.data().notBefore) <= now)
        .sort((a, b) => toMillis(a.data().notBefore) - toMillis(b.data().notBefore)
            || (a.data().order || 0) - (b.data().order || 0));
    if (!due.length) return { skipped: `no-due(pending ${q.size})` };

    // 회당 2건 — 같은 호출에서 같은 원글에 두 건 게시하지 않는다(연달아 달리는 봇 티 방지).
    const picked = [];
    for (const d of due) {
        if (picked.length >= MAX_PER_RUN) break;
        if (picked.some((p) => p.data().postId === d.data().postId)) continue;
        picked.push(d);
    }

    const results = [];
    for (const doc of picked) {
        const item = doc.data();
        try {
            const pool = item.accountPool === 'sogam' ? 'sogam' : 'reply';
            const uid = pool === 'sogam' ? await ensureSogamAccount(item.lang) : await ensureReplyAccount(item.lang);
            const name = pool === 'sogam' ? SOGAM_PERSONAS[item.lang] : REPLY_PERSONAS[item.lang];
            const postRef = kcultureDb.doc(`posts/${item.postId}`);
            const comment = {
                authorUid: uid, authorName: name, authorPhoto: null,
                lang: item.lang, body: item.body, spoiler: false,
                likeCount: 0, images: [], createdAt: new Date(),
                replyAuto: true, // 감사·상한 집계용 additive(클라 렌더 무해)
                situation: item.situation || null, tone: item.tone || null,
            };
            const cRef = await postRef.collection('comments').add(comment);
            await postRef.update({ commentCount: admin.firestore.FieldValue.increment(1) });
            await doc.ref.set({ status: 'posted', commentId: cRef.id, postedAt: new Date() }, { merge: true });
            console.log(`[reply] 게시: posts/${item.postId}/comments/${cRef.id} ${item.lang} ${pool} "${(item.situation || '')}" ${item._note || ''}`);
            results.push({ commentId: cRef.id, postId: item.postId, lang: item.lang, pool });
        } catch (e) {
            // 개별 실패는 pending으로 남겨 다음 주기 재시도 — 회 전체를 죽이지 않는다.
            console.warn(`[reply] 게시 실패(${item.postId}/${item.lang}):`, e?.message);
        }
    }
    if (results.length) {
        await kcultureDb.doc('config/reply_autopost').set(
            { lastAt: new Date(), lastPosted: results }, { merge: true });
    }
    return { posted: results.length, items: results, pendingLeft: q.size - results.length };
}

module.exports = { runReplyAutopost, ensureReplyAccount, REPLY_PERSONAS, LANGS, MAX_PER_RUN };
