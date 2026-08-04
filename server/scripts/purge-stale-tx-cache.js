// ── 구(舊) 파이프라인 오역 번역 캐시 퍼지 (1회성, 2026-08-04) ─────────────────
// 번역 증강(txGlossary·txNuance, 커밋 a6aa829)이 배포되기 **전에** 만들어진 UGC 번역 캐시 중,
// 새 파이프라인이 결과를 바꿀 문서(최근작 제목·배우가 원문에 등장)만 골라 지운다.
// 캐시가 사라지면 다음 독자 요청이 MISS → 새 파이프라인(용어집·캐스트 표·뉘앙스)으로 재번역된다.
// 대표 사례: 「김부장」→"Chef Kim" (라운지 · 컨텍스트 없던 시절의 번역).
//
// 대상(전부 UGC 번역 캐시 — titles/{id}/translations/{lang} **메타 번역은 절대 건드리지 않는다**):
//   titles/{poolId}/discussion/{cid}(/replies/{rid})/translations/{lang}
//   titles/{poolId}/reviews/{uid}/translations/{lang}
//   posts/{pid}(/comments/{cid}(/replies/{rid}))/translations/{lang | lang__title}
//   lounge_threads/{day}/messages/{mid}(/replies/{rid})/translations/{lang}
//
// 삭제 조건(모두 충족):
//   ① translatedAt < cutoff(새 파이프라인 배포 시각, 기본 2026-08-03T22:08Z)
//   ② 원문(bodyOriginal||body, 글 제목은 titleOriginal||title)이 용어집과 매칭
//      - 풀 작품에 anchored된 문서(코멘트·평가·풀 작품 태그 글)는 **자기 작품 제목·출연진(2자 포함)**도 매칭
//        (예: 아파트 코멘트의 "지성" — 새 캐스트 표가 개선하는 케이스)
//   ③ 시드가 아닐 것(캐시 body == 원문 body — compose EN 시드·Dari en 시드는 번역이 아니라 원문)
//   ④ 작성자가 Dari가 아닐 것(Dari 시드는 showTitles·glossary를 넣고 만든 번역 — 품질 문제 없음)
//
// 사용법 (server/.env 에 KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   node scripts/purge-stale-tx-cache.js            # dry-run(기본) — 삭제 후보만 나열
//   node scripts/purge-stale-tx-cache.js --apply    # 백업(JSONL) 후 실제 삭제
//   옵션: --cutoff 2026-08-03T22:08:00Z
// 멱등: 지운 문서는 다시 안 잡힌다. 백업: scripts/logs/purge-tx-cache-<ts>.jsonl
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { kcultureDb } = require('../config/firebaseKculture');
const txGlossary = require('../lib/txGlossary');

const DARI_UID = 'ubl7mS03tcQ1pBbKsMSfopuBZ2u1';
const APPLY = process.argv.includes('--apply');
const cutoffArg = process.argv[process.argv.indexOf('--cutoff') + 1];
const CUTOFF = new Date(process.argv.includes('--cutoff') ? cutoffArg : '2026-08-03T22:08:00Z');

const norm = (s) => String(s || '').trim();

// 자기 작품 매칭 — anchored 문서 전용(제목 별칭 + 출연진 이름, 2자 한글 포함: 자기 작품 문맥에선 안전)
function ownShowMatch(text, show) {
    if (!text || !show) return false;
    const tl = text.toLowerCase();
    if (show.aliases.some((a) => tl.includes(a.k))) return true;
    return show.cast.some((c) => c.name.length >= 2 && text.includes(c.name));
}

// 원문이 새 파이프라인의 주입 대상인가
function affected(text, anchoredShow) {
    if (!text) return false;
    const h = txGlossary.matchText(text, {});
    if (h.titleHits.length || h.actorHits.length) return true;
    return ownShowMatch(text, anchoredShow);
}

// 캐시 서브컬렉션 검사 — 후보면 목록에 적재
async function inspectCaches(parentRef, srcText, { anchoredShow = null, authorUid = null, titleText = null }, out) {
    if (authorUid === DARI_UID) return; // Dari 시드 — 건드리지 않는다
    const snap = await parentRef.collection('translations').get();
    for (const d of snap.docs) {
        const x = d.data() || {};
        const at = x.translatedAt?.toDate?.() || null;
        if (at && at >= CUTOFF) continue;                       // 새 파이프라인 산출물
        const isTitle = d.id.endsWith('__title');               // posttitle 캐시(글 제목)
        const src = isTitle ? norm(titleText) : norm(srcText);
        if (!src || !x.body) continue;
        if (norm(x.body) === src) continue;                     // 시드(원문 복사본) — 번역 아님
        if (!affected(src, anchoredShow)) continue;
        out.push({ path: d.ref.path, src: src.slice(0, 60), body: String(x.body).slice(0, 60), data: x });
    }
}

async function run() {
    if (!kcultureDb) { console.error('KCULTURE_SERVICE_ACCOUNT_BASE64 필요'); process.exit(1); }
    await txGlossary.ready();
    const pool = txGlossary.getShows();
    const poolById = new Map(pool.map((s) => [s.id, s]));
    console.log(`풀 ${pool.length}편 · cutoff ${CUTOFF.toISOString()} · ${APPLY ? '⚠ APPLY(실삭제)' : 'dry-run'}`);
    const out = [];

    // ① 풀 작품의 코멘트(discussion)·대댓글·평가(reviews)
    for (const s of pool) {
        const tRef = kcultureDb.doc(`titles/${s.id}`);
        const disc = await tRef.collection('discussion').get();
        for (const d of disc.docs) {
            const x = d.data() || {};
            const src = norm(x.bodyOriginal || x.body);
            await inspectCaches(d.ref, src, { anchoredShow: s, authorUid: x.authorUid }, out);
            const reps = await d.ref.collection('replies').get();
            for (const r of reps.docs) {
                const y = r.data() || {};
                await inspectCaches(r.ref, norm(y.bodyOriginal || y.body), { anchoredShow: s, authorUid: y.authorUid }, out);
            }
        }
        const revs = await tRef.collection('reviews').get();
        for (const r of revs.docs) {
            const y = r.data() || {};
            await inspectCaches(r.ref, norm(y.bodyOriginal || y.body), { anchoredShow: s, authorUid: y.authorUid || r.id }, out);
        }
    }

    // ② 커뮤니티 글(+토론 댓글·답글) — 풀 작품 태그 글은 anchored 취급
    const posts = await kcultureDb.collection('posts').get();
    for (const p of posts.docs) {
        const x = p.data() || {};
        const show = poolById.get(String(x.titleId || '')) || null;
        await inspectCaches(p.ref, norm(x.bodyOriginal || x.body),
            { anchoredShow: show, authorUid: x.authorUid, titleText: norm(x.titleOriginal || x.title) }, out);
        const comments = await p.ref.collection('comments').get();
        for (const c of comments.docs) {
            const y = c.data() || {};
            await inspectCaches(c.ref, norm(y.bodyOriginal || y.body), { anchoredShow: show, authorUid: y.authorUid }, out);
            const reps = await c.ref.collection('replies').get();
            for (const r of reps.docs) {
                const z = r.data() || {};
                await inspectCaches(r.ref, norm(z.bodyOriginal || z.body), { anchoredShow: show, authorUid: z.authorUid }, out);
            }
        }
    }

    // ③ 라운지(일자별 스레드 → 메시지 → 답글)
    const days = await kcultureDb.collection('lounge_threads').get();
    for (const day of days.docs) {
        const msgs = await day.ref.collection('messages').get();
        for (const m of msgs.docs) {
            const x = m.data() || {};
            await inspectCaches(m.ref, norm(x.bodyOriginal || x.body), { authorUid: x.authorUid }, out);
            const reps = await m.ref.collection('replies').get();
            for (const r of reps.docs) {
                const y = r.data() || {};
                await inspectCaches(r.ref, norm(y.bodyOriginal || y.body), { authorUid: y.authorUid }, out);
            }
        }
    }

    // ── 결과 ──
    console.log(`\n삭제 후보 ${out.length}건:`);
    for (const c of out) console.log(`  ${c.path}\n    원문: ${c.src}\n    캐시: ${c.body}`);
    if (!APPLY || !out.length) {
        if (out.length) console.log(`\n실행하려면: node scripts/purge-stale-tx-cache.js --apply`);
        return;
    }

    // 백업 → 삭제(배치 400)
    const logDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const bak = path.join(logDir, `purge-tx-cache-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    fs.writeFileSync(bak, out.map((c) => JSON.stringify({ path: c.path, data: c.data })).join('\n') + '\n');
    console.log(`\n백업: ${bak}`);
    for (let i = 0; i < out.length; i += 400) {
        const batch = kcultureDb.batch();
        for (const c of out.slice(i, i + 400)) batch.delete(kcultureDb.doc(c.path));
        await batch.commit();
    }
    console.log(`✅ ${out.length}건 삭제 완료 — 다음 독자 요청부터 새 파이프라인으로 재번역됩니다`);
}

run().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e); process.exit(1); });
