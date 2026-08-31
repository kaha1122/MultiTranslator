// ── 소감·Dari 리뷰 답글 큐 적재 — 배치 JSON → Firestore reply_queue ──────────────────
// (post-replies 에이전트의 queue.json을 적재. 게시는 lib/replyAutopost.js가 due 기반으로 수행)
// 사용: cd server && node scripts/reply-queue-load.js --file <queue.json> [--dry]
// JSON 형식: { "items": [ { "postId": "abc123", "lang": "id", "accountPool": "reply"|"sogam",
//                           "body": "...", "situation": "①동지발견", "tone": "들뜬수다",
//                           "offsetHours": 7, "_note": "backfill"|"trickle"|null }, ... ] }
// 가드(전부 기계 검증 — 에이전트 규칙의 안전망):
// - 대상은 자동 소감(sogamAuto)·Dari 리뷰(curator) 게시물만 — 실사용자 글이면 스킵.
// - 자기 글 자기 댓글 금지: 소감 글에 accountPool=sogam + 같은 lang이면 그 글의 작성 계정이라 스킵.
// - 누적 상한: 소감 4 / 리뷰 10 — 기존 replyAuto 댓글 + 큐 잔량(pending) 합산으로 판정.
// - dedup 키: postId + lang + accountPool (pending/posted만 — cancelled-*는 재적재 허용).
// - notBefore = 적재 시각 + offsetHours(없으면 3~20h 랜덤) — 게시 분산은 이 값이 만든다.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { LANGS, REPLY_PERSONAS } = require('../lib/replyAutopost');
const { PERSONAS: SOGAM_PERSONAS } = require('../lib/sogam');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const file = arg('file', '');
const dry = process.argv.includes('--dry');

const CAP = { sogam: 4, review: 10 }; // 글당 자동 답글 평생 상한(2026-09-01 사용자 확정)

(async () => {
    if (!file) { console.error('--file <queue.json> 필요'); process.exit(1); }
    if (!kcultureDb) throw new Error('kcultureDb 없음');
    const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = batch.items || [];
    const last = await kcultureDb.collection('reply_queue').orderBy('order', 'desc').limit(1).get();
    let order = last.empty ? 0 : (last.docs[0].data().order || 0);
    const postCache = new Map();  // postId → { data, autoCount } (같은 글 여러 건 적재 시 1회 조회)
    let loaded = 0, skipped = 0;

    for (const it of items) {
        if (!it.postId || !it.lang || !it.body) {
            console.warn('필드 누락 스킵:', JSON.stringify(it).slice(0, 80)); skipped++; continue;
        }
        if (!LANGS.includes(it.lang)) { console.warn(`미지원 언어 스킵(7언어 밖): ${it.lang}`); skipped++; continue; }
        const pool = it.accountPool === 'sogam' ? 'sogam' : 'reply';

        if (!postCache.has(it.postId)) {
            const snap = await kcultureDb.doc(`posts/${it.postId}`).get();
            if (!snap.exists) { postCache.set(it.postId, null); }
            else {
                const auto = await kcultureDb.collection(`posts/${it.postId}/comments`)
                    .where('replyAuto', '==', true).get();
                postCache.set(it.postId, { data: snap.data(), autoCount: auto.size });
            }
        }
        const post = postCache.get(it.postId);
        if (!post) { console.warn(`글 없음 스킵: posts/${it.postId}`); skipped++; continue; }
        const kind = post.data.curator === true ? 'review' : post.data.sogamAuto === true ? 'sogam' : null;
        if (!kind) { console.warn(`대상 아님 스킵(실사용자 글): posts/${it.postId}`); skipped++; continue; }
        // 자기 글 자기 댓글 가드 — 소감 글의 작성 계정은 그 언어의 소감 페르소나다.
        if (kind === 'sogam' && pool === 'sogam' && it.lang === post.data.lang) {
            console.warn(`자기 댓글 스킵: ${it.postId} ${it.lang} (작성 페르소나 ${SOGAM_PERSONAS[it.lang]})`); skipped++; continue;
        }
        // 누적 상한 — 게시된 replyAuto + 이번 실행 포함 큐 잔량(pending) 합산.
        const live = await kcultureDb.collection('reply_queue')
            .where('postId', '==', it.postId).get();
        const pendingCnt = live.docs.filter((d) => d.data().status === 'pending').length;
        if (post.autoCount + pendingCnt >= CAP[kind]) {
            console.warn(`상한 도달 스킵: ${it.postId} (${kind} — 게시 ${post.autoCount} + 대기 ${pendingCnt} ≥ ${CAP[kind]})`); skipped++; continue;
        }
        // dedup: postId + lang + accountPool (pending/posted만)
        const dup = live.docs.some((d) => ['pending', 'posted'].includes(d.data().status)
            && d.data().lang === it.lang && (d.data().accountPool || 'reply') === pool);
        if (dup) { console.log(`중복 스킵: ${it.postId} ${it.lang} ${pool}`); skipped++; continue; }

        const offsetH = it.offsetHours != null ? Number(it.offsetHours) : 3 + Math.random() * 17;
        const doc = {
            postId: String(it.postId), lang: it.lang, accountPool: pool, body: it.body,
            situation: it.situation || null, tone: it.tone || null, _note: it._note || null,
            kind, titleName: post.data.titleName || null,
            notBefore: new Date(Date.now() + offsetH * 3600 * 1000),
            status: 'pending', order: ++order, createdAt: new Date(),
        };
        const who = pool === 'sogam' ? SOGAM_PERSONAS[it.lang] : REPLY_PERSONAS[it.lang];
        console.log(`${dry ? '[dry] ' : ''}적재 #${order}: ${doc.titleName || doc.postId} [${kind}] ${doc.lang} ${who} +${offsetH.toFixed(1)}h ${doc._note || ''}`);
        if (!dry) await kcultureDb.collection('reply_queue').add(doc);
        loaded++;
    }
    console.log(`[reply-queue-load] DONE — 적재 ${loaded} / 스킵 ${skipped}${dry ? ' (dry)' : ''}`);
    process.exit(0);
})().catch((e) => { console.error('[reply-queue-load] FAIL', e); process.exit(1); });
