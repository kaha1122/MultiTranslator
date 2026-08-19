// ── 자동 소감(sogam) 게시 — 큐 + news-refresh 체이닝 (2026-08-18, 사용자 설계) ──────────
// 목적: 사람 UGC가 없는 작품(sitemap C/B티어)에 소감 글을 자동 게시해 A티어(12언어 색인)로 승격.
// 구조: Claude 세션이 소감을 배치 작성해 sogam_queue에 적재(scripts/sogam-queue-load.js) →
//       이 모듈이 news-refresh 체이닝(2h 주기)으로 호출되어 지정 슬롯(KST 09/17/21/01)에만 1건 게시.
// 계정: 언어별 **고정 페르소나 6계정**(이름 고정 — 2026-08-18 사용자 확정). 각 계정은 일관된
//       인격의 헤비유저로 운영한다. 로그인 없는 봉인 계정(무작위 비밀번호).
// ⚠ users/{uid} 본문 write는 이 계정들 최초 프로비저닝 1회뿐 — 실기기 로그인이 없어
//   AuthContext onSnapshot 렌더 폭주(발열 규칙 #6-1)와 무관. 일반 사용자 문서에는 쓰지 않는다.
const crypto = require('crypto');
const { kcultureDb, kcultureAuth } = require('../config/firebaseKculture');

const SLOT_HOURS_KST = [9, 17, 21, 1]; // 사용자 지정(2026-08-18) — news-refresh 2h 그리드(KST 홀수시)의 부분집합
const LANGS = ['ko', 'en', 'id', 'ru', 'es', 'ar'];
const ACCOUNT_EMAIL = (lang) => `sogam-${lang}@kdramaanylang.com`;

// 언어별 고정 페르소나 — 2026-08-15 사용자 확정 계정명(팬덤 통용어 기반).
const PERSONAS = {
    ko: '드라마에진심',
    en: 'KDramaNightOwl',
    id: 'MbakDrakor',
    ru: 'Дорамщица',
    es: 'DoramaAdicta',
    ar: 'ليالي سيول',
};

// ── 계정 보장 — 언어별 고정 uid (멱등) ────────────────────────────────────────────
const uidCache = new Map(); // lang → uid
async function ensureSogamAccount(lang) {
    if (uidCache.has(lang)) return uidCache.get(lang);
    if (!kcultureAuth || !kcultureDb) throw new Error('kculture admin 앱 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const email = ACCOUNT_EMAIL(lang);
    const name = PERSONAS[lang];
    if (!name) throw new Error(`알 수 없는 언어: ${lang}`);
    let user = null;
    try { user = await kcultureAuth.getUserByEmail(email); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    if (!user) {
        user = await kcultureAuth.createUser({
            email, emailVerified: true,
            password: crypto.randomBytes(32).toString('base64url'), // 로그인 안 함 — 무작위 봉인
            displayName: name,
        });
        console.log(`[sogam] Auth 계정 생성: ${lang} "${name}" uid=${user.uid}`);
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

function kstNow() {
    return new Date(Date.now() + 9 * 3600 * 1000); // UTC+9 — getUTC*로 읽는다
}

// ── 자동 게시 1건 — news-refresh가 2h마다 호출, 지정 슬롯에서만 동작(멱등) ────────────
// force: 수동 테스트(scripts/sogam-autopost.js --force) — 슬롯·중복 게이트 우회.
async function runAutopost({ force = false } = {}) {
    if (!kcultureDb) return { skipped: 'no-db' };
    const k = kstNow();
    const hour = k.getUTCHours();
    if (!force && !SLOT_HOURS_KST.includes(hour)) return { skipped: `offslot(kst ${hour}h)` };
    const slotKey = `${k.toISOString().slice(0, 10)}_${String(hour).padStart(2, '0')}`;

    const stateRef = kcultureDb.doc('config/sogam_autopost');
    const state = (await stateRef.get()).data() || {};
    if (!force && state.lastSlotKey === slotKey) return { skipped: `dup-slot(${slotKey})` };

    // status 단일 조건 + 메모리 정렬 — where+orderBy 복합 인덱스 회피(큐는 상시 수십 건 규모)
    const q = await kcultureDb.collection('sogam_queue')
        .where('status', '==', 'pending').limit(100).get();
    if (q.empty) { console.log('[sogam] 큐 비어 있음 — 게시 스킵'); return { skipped: 'empty-queue' }; }
    const doc = q.docs.sort((a, b) => (a.data().order || 0) - (b.data().order || 0))[0];
    const item = doc.data();

    const uid = await ensureSogamAccount(item.lang);
    const name = PERSONAS[item.lang];

    const post = {
        authorUid: uid, authorName: name, authorPhoto: null,
        lang: item.lang, title: item.title || null, body: item.body,
        titleId: Number(item.titleId), titleName: item.titleName || null,
        media: item.media || 'tv', posterPath: item.posterPath || null,
        authorRating: null,
        images: item.backdropPath ? [`https://image.tmdb.org/t/p/w780${item.backdropPath}`] : [],
        likeCount: 0, commentCount: 0, createdAt: new Date(),
        sogamAuto: true, tone: item.tone != null ? item.tone : null, // 감사·분석용(클라 렌더에 무해한 additive)
    };
    const ref = await kcultureDb.collection('posts').add(post);
    await doc.ref.set({ status: 'posted', postId: ref.id, postedAt: new Date() }, { merge: true });
    await stateRef.set({ lastSlotKey: slotKey, lastPostId: ref.id, lastAt: new Date() }, { merge: true });
    console.log(`[sogam] 게시 완료: posts/${ref.id} ${item.lang} tone=${item.tone} "${(item.title || '').slice(0, 40)}" (slot ${slotKey})`);
    return { posted: true, postId: ref.id, lang: item.lang, slotKey, titleId: item.titleId };
}

module.exports = { runAutopost, ensureSogamAccount, LANGS, PERSONAS };
