// ── K-DramaAnyLang 소감 푸시 — 수신자 현지 시각 09시·20시에 하루 2건 ──────────────
// 2026-09-04 도입(사용자 결정). PronunFit 재참여 크론(routes/reengagement.js, Render Cron 매시간)이
// 매시간 이 함수를 fire-and-forget으로 호출한다 — Render 대시보드 작업 없이 시간 단위 해상도를 얻는다.
//
// 대상: users/{uid}/pushTokens/* 전부(collectionGroup). 토큰 문서의 `tz`(IANA, 클라 push.js가 등록 시 저장)로
//   현지 시각을 계산한다. tz가 없으면 언어별 대표 시간대로 폴백. `sogam === false`(설정 토글 OFF)는 제외.
// 선택(2026-09-05 개정 — 사용자 결정): 후보 풀 = ① 페르소나 14계정(sogam-*/reply-*@kdramaanylang.com)이 올린 글
//   (자동 게시분 + 사용자가 그 계정으로 직접 게시한 분 — 소감 자동 게시가 같은 날 폐지돼 `sogamAuto` 마커만으론 풀이 멈춘다)
//   ② Dari 리뷰(posts where curator==true). **7일 신선도 상한** — 7일 안에 새 글이 없으면 그 슬롯은 보내지 않는다
//   (종전 24h→7일→전체 폴백은 옛글을 하루 2번 영원히 재탕하는 구조라 폐기). 수신자 언어와 같은 글 우선, 없으면 랜덤
//   (앱에 AI 번역이 있어 언어가 달라도 읽을 수 있다 — 2026-09-04). 같은 글은 기기당 1회(토큰 문서 `sogamSent`).
// 멱등: 토큰 문서 `sogamLastSlot = 'YYYY-MM-DD-HH'`(현지 날짜·슬롯)로 같은 슬롯 재발송 차단(크론 재시도 안전).
// 죽은 토큰은 kculturePush.pruneDeadTokens로 즉시 삭제.
const admin = require('firebase-admin');
const { kcultureApp, kcultureDb, kcultureAuth } = require('../config/firebaseKculture');
const { buildTokenMessage, pruneDeadTokens, resolveLang, getPushFlags, TEXTS, FALLBACK } = require('./kculturePush');

const FRESH_MS = 7 * 24 * 3600e3;      // 후보 신선도 상한
const SENT_KEEP = 50;                   // 토큰 문서에 남기는 최근 발송 postId 수
// 페르소나 계정 이메일 — lib/sogam.js(sogam-{lang}) · lib/replyAutopost.js(reply-{lang})와 동일 규칙. 언어 추가 시 양쪽 동기.
const PERSONA_LANGS = ['ko', 'en', 'id', 'ru', 'es', 'ar', 'vi'];
const PERSONA_EMAILS = ['sogam', 'reply'].flatMap((p) => PERSONA_LANGS.map((l) => `${p}-${l}@kdramaanylang.com`));
let personaUidsCache = null; // 프로세스 수명 캐시 — 계정은 고정이라 매시간 재조회 불필요
async function personaUids() {
    if (personaUidsCache) return personaUidsCache;
    const uids = [];
    for (const email of PERSONA_EMAILS) {
        try { uids.push((await kcultureAuth.getUserByEmail(email)).uid); } catch { /* 미생성 계정은 건너뜀 */ }
    }
    if (uids.length) personaUidsCache = uids;
    return uids;
}

const SLOT_HOURS = [9, 20]; // 수신자 현지 시각(24h)
const DEFAULT_TZ_BY_LANG = {
    ko: 'Asia/Seoul', ja: 'Asia/Tokyo', 'zh-CN': 'Asia/Shanghai', vi: 'Asia/Ho_Chi_Minh', id: 'Asia/Jakarta',
    ar: 'Asia/Riyadh', ru: 'Europe/Moscow', de: 'Europe/Berlin', fr: 'Europe/Paris', es: 'Europe/Madrid',
    'pt-BR': 'America/Sao_Paulo', en: 'UTC',
};

// IANA tz 기준 현지 {hour, date}. 잘못된 tz 문자열이면 null.
function localParts(tz, now = new Date()) {
    try {
        const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
        const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
        return { hour: Number(p.hour) % 24, date: `${p.year}-${p.month}-${p.day}` };
    } catch { return null; }
}

// 후보 글(7일 이내) — ① 페르소나 계정 글(authorUid in 14 — Firestore `in` 상한 30) ② Dari 리뷰(curator==true).
// where 단일 조건 + 메모리 필터·정렬(복합 인덱스 회피). 페르소나 글은 자동 게시분(sogamAuto)과 직접 게시분을 모두 포함한다.
async function loadCandidates(nowMs = Date.now()) {
    const toRow = (d) => { const x = d.data(); return { id: d.id, ...x, createdMs: x.createdAt?.toDate?.()?.getTime?.() || 0 }; };
    const byId = new Map();
    const uids = await personaUids();
    if (uids.length) {
        const s = await kcultureDb.collection('posts').where('authorUid', 'in', uids).limit(200).get();
        s.docs.forEach((d) => byId.set(d.id, toRow(d)));
    }
    const c = await kcultureDb.collection('posts').where('curator', '==', true).limit(120).get();
    c.docs.forEach((d) => byId.set(d.id, toRow(d)));
    return [...byId.values()]
        .filter((r) => r.createdMs && nowMs - r.createdMs <= FRESH_MS)
        .sort((a, b) => b.createdMs - a.createdMs);
}
// 하위 호환(테스트·다른 모듈 참조용) — 종전 이름
const loadRecentSogam = loadCandidates;

// 같은 언어 우선 → 랜덤. 풀: 24h → 7일. exclude(이 기기에 이미 보낸 postId)는 제외. 없으면 null(그 슬롯은 안 보냄).
function pickPost(rows, lang, nowMs, rnd = Math.random, exclude = new Set()) {
    const fresh = rows.filter((r) => nowMs - r.createdMs <= FRESH_MS && !exclude.has(r.id));
    const day = fresh.filter((r) => nowMs - r.createdMs <= 24 * 3600e3);
    const pools = [day.filter((r) => r.lang === lang), day, fresh.filter((r) => r.lang === lang), fresh];
    for (const p of pools) if (p.length) return p[Math.floor(rnd() * p.length)];
    return null;
}

// 작품명 — 수신자 언어 제목(titles/{id}.searchTitle[lang]) → 원제(meta.original_title / post.titleOriginal) → 영문(post.titleName).
// 한국어 수신자에게는 원제(한국어)가, 다른 언어 수신자에게는 그 언어 공식 제목이 간다(2026-09-04 사용자 결정 — "원제가 좋겠어").
// titles 문서는 실행당 작품별 1회만 읽어 캐시.
async function titleFor(post, lang, cache) {
    const key = `${post.media || 'tv'}/${post.titleId}`;
    if (!cache.has(key)) {
        let doc = null;
        try { const s = await kcultureDb.collection('titles').doc(String(post.titleId)).get(); doc = s.exists ? s.data() : null; } catch { doc = null; }
        cache.set(key, doc);
    }
    const doc = cache.get(key);
    const byLang = doc?.searchTitle && typeof doc.searchTitle === 'object' ? doc.searchTitle[lang] : null;
    return byLang || doc?.meta?.original_title || post.titleOriginal || post.titleName || '';
}

// 알림 구성(2026-09-04 사용자 확정): 제목 = 드라마 제목(수신자 언어) · 본문 = 현지어 문장 "{name}님이 「{title}」의 리뷰를 남기셨습니다."
// 리뷰(소감)의 제목·본문 텍스트는 싣지 않는다 — 원문 언어가 수신자와 다를 수 있고, 내용은 탭 후 앱에서(AI 번역) 읽는다.
async function buildTitleBody(post, lang, cache) {
    const tpl = (TEXTS[lang] && TEXTS[lang].sogam_new) || TEXTS[FALLBACK].sogam_new;
    const titleName = await titleFor(post, lang, cache);
    const title = titleName || (post.titleName || '');
    const body = tpl.replaceAll('{name}', post.authorName || 'Dari').replaceAll('{title}', titleName);
    return { title, body };
}

async function runSogamPushHourly(now = new Date(), { dryRun = false } = {}) {
    if (!kcultureDb || !kcultureApp) return { skipped: 'no-db' };
    if (!(await getPushFlags()).sogamEnabled) return { skipped: 'disabled(config/kc_push.sogamEnabled)' }; // 킬스위치 — 검증 후 켠다
    const snap = await kcultureDb.collectionGroup('pushTokens').get();
    if (snap.empty) return { skipped: 'no-tokens' };
    const rows = await loadCandidates(now.getTime());
    if (!rows.length) return { skipped: 'no-fresh-posts(7d)' }; // 7일 내 새 글 없음 — 이 슬롯은 보내지 않는다

    const messages = []; const refs = []; const marks = []; const postIds = [];
    const titleCache = new Map(); // titles/{id} 문서 — 작품별 1회 read
    let candidates = 0, dup = 0, off = 0, optout = 0, exhausted = 0;
    for (const d of snap.docs) {
        const t = d.data() || {};
        if (t.sogam === false) { optout++; continue; }
        const lang = resolveLang(t.lang);
        const lp = localParts(t.tz || DEFAULT_TZ_BY_LANG[lang] || 'UTC', now);
        if (!lp || !SLOT_HOURS.includes(lp.hour)) { off++; continue; }
        const slotKey = `${lp.date}-${String(lp.hour).padStart(2, '0')}`;
        if (t.sogamLastSlot === slotKey) { dup++; continue; }
        candidates++;
        const sentBefore = new Set(Array.isArray(t.sogamSent) ? t.sogamSent : []);
        const post = pickPost(rows, lang, now.getTime(), Math.random, sentBefore);
        if (!post) { exhausted++; continue; } // 이 기기엔 7일 내 글을 전부 보냈다 — 재탕하지 않음
        const { title, body } = await buildTitleBody(post, lang, titleCache);
        messages.push(buildTokenMessage(d, {
            title, body,
            data: { kind: 'sogam_new', url: `/#/community/post/${post.id}`, postId: post.id },
            imageUrl: post.posterPath ? `https://image.tmdb.org/t/p/w342${post.posterPath}` : null,
        }));
        refs.push(d.ref); marks.push(slotKey); postIds.push({ id: post.id, prev: [...sentBefore] });
    }
    if (!messages.length) return { candidates, sent: 0, dup, off, optout, exhausted, pool: rows.length };
    if (dryRun) return { dryRun: true, candidates, would: messages.length, dup, off, optout, exhausted, pool: rows.length };

    let sent = 0, pruned = 0;
    for (let i = 0; i < messages.length; i += 500) {
        const res = await admin.messaging(kcultureApp).sendEach(messages.slice(i, i + 500));
        sent += res.successCount;
        pruned += await pruneDeadTokens(res, refs.slice(i, i + 500));
        const writes = [];
        res.responses.forEach((r, j) => {
            if (!r.success) return;
            const k = i + j;
            const sentList = [...postIds[k].prev, postIds[k].id].slice(-SENT_KEEP);
            writes.push(refs[k].set({ sogamLastSlot: marks[k], sogamLastAt: new Date(), sogamSent: sentList }, { merge: true }).catch(() => {}));
        });
        await Promise.all(writes);
    }
    console.log(`[SogamPush/KC] pool=${rows.length} candidates=${candidates} sent=${sent}/${messages.length} pruned=${pruned} dup=${dup} off=${off} optout=${optout} exhausted=${exhausted}`);
    return { candidates, sent, total: messages.length, pruned, dup, off, optout, exhausted, pool: rows.length };
}

module.exports = { runSogamPushHourly, loadCandidates, loadRecentSogam, personaUids, SLOT_HOURS, DEFAULT_TZ_BY_LANG, localParts, pickPost, titleFor, buildTitleBody, FRESH_MS };
