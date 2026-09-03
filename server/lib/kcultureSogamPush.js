// ── K-DramaAnyLang 소감 푸시 — 수신자 현지 시각 09시·20시에 하루 2건 ──────────────
// 2026-09-04 도입(사용자 결정). PronunFit 재참여 크론(routes/reengagement.js, Render Cron 매시간)이
// 매시간 이 함수를 fire-and-forget으로 호출한다 — Render 대시보드 작업 없이 시간 단위 해상도를 얻는다.
//
// 대상: users/{uid}/pushTokens/* 전부(collectionGroup). 토큰 문서의 `tz`(IANA, 클라 push.js가 등록 시 저장)로
//   현지 시각을 계산한다. tz가 없으면 언어별 대표 시간대로 폴백. `sogam === false`(설정 토글 OFF)는 제외.
// 선택: 최근 소감(posts where sogamAuto==true) 중 수신자 언어와 같은 것 우선, 없으면 랜덤(앱에 AI 번역이 있어
//   언어가 달라도 읽을 수 있다 — 사용자 결정 2026-09-04). 24h → 7일 → 전체 순으로 풀을 넓힌다.
// 멱등: 토큰 문서 `sogamLastSlot = 'YYYY-MM-DD-HH'`(현지 날짜·슬롯)로 같은 슬롯 재발송 차단(크론 재시도 안전).
// 죽은 토큰은 kculturePush.pruneDeadTokens로 즉시 삭제.
const admin = require('firebase-admin');
const { kcultureApp, kcultureDb } = require('../config/firebaseKculture');
const { buildTokenMessage, pruneDeadTokens, resolveLang, getPushFlags, TEXTS, FALLBACK } = require('./kculturePush');

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

// 최근 소감 — where 단일 조건 + 메모리 정렬(복합 인덱스 회피, 큐 규모 수십~수백 건)
async function loadRecentSogam() {
    const snap = await kcultureDb.collection('posts').where('sogamAuto', '==', true).limit(120).get();
    return snap.docs
        .map((d) => { const x = d.data(); return { id: d.id, ...x, createdMs: x.createdAt?.toDate?.()?.getTime?.() || 0 }; })
        .sort((a, b) => b.createdMs - a.createdMs);
}

// 같은 언어 우선 → 랜덤. 풀: 24h → 7일 → 전체.
function pickPost(rows, lang, nowMs, rnd = Math.random) {
    const day = rows.filter((r) => nowMs - r.createdMs <= 24 * 3600e3);
    const week = rows.filter((r) => nowMs - r.createdMs <= 7 * 24 * 3600e3);
    const pools = [day.filter((r) => r.lang === lang), day, week.filter((r) => r.lang === lang), week, rows];
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
    const rows = await loadRecentSogam();
    if (!rows.length) return { skipped: 'no-sogam' };

    const messages = []; const refs = []; const marks = [];
    const titleCache = new Map(); // titles/{id} 문서 — 작품별 1회 read
    let candidates = 0, dup = 0, off = 0, optout = 0;
    for (const d of snap.docs) {
        const t = d.data() || {};
        if (t.sogam === false) { optout++; continue; }
        const lang = resolveLang(t.lang);
        const lp = localParts(t.tz || DEFAULT_TZ_BY_LANG[lang] || 'UTC', now);
        if (!lp || !SLOT_HOURS.includes(lp.hour)) { off++; continue; }
        const slotKey = `${lp.date}-${String(lp.hour).padStart(2, '0')}`;
        if (t.sogamLastSlot === slotKey) { dup++; continue; }
        candidates++;
        const post = pickPost(rows, lang, now.getTime());
        if (!post) continue;
        const { title, body } = await buildTitleBody(post, lang, titleCache);
        messages.push(buildTokenMessage(d, {
            title, body,
            data: { kind: 'sogam_new', url: `/#/community/post/${post.id}`, postId: post.id },
            imageUrl: post.posterPath ? `https://image.tmdb.org/t/p/w342${post.posterPath}` : null,
        }));
        refs.push(d.ref); marks.push(slotKey);
    }
    if (!messages.length) return { candidates, sent: 0, dup, off, optout };
    if (dryRun) return { dryRun: true, candidates, would: messages.length, dup, off, optout };

    let sent = 0, pruned = 0;
    for (let i = 0; i < messages.length; i += 500) {
        const res = await admin.messaging(kcultureApp).sendEach(messages.slice(i, i + 500));
        sent += res.successCount;
        pruned += await pruneDeadTokens(res, refs.slice(i, i + 500));
        const writes = [];
        res.responses.forEach((r, j) => {
            if (r.success) writes.push(refs[i + j].set({ sogamLastSlot: marks[i + j], sogamLastAt: new Date() }, { merge: true }).catch(() => {}));
        });
        await Promise.all(writes);
    }
    console.log(`[SogamPush/KC] candidates=${candidates} sent=${sent}/${messages.length} pruned=${pruned} dup=${dup} off=${off} optout=${optout}`);
    return { candidates, sent, total: messages.length, pruned, dup, off, optout };
}

module.exports = { runSogamPushHourly, SLOT_HOURS, DEFAULT_TZ_BY_LANG, localParts, pickPost, titleFor, buildTitleBody };
