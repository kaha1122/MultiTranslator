// ── 특정 작품의 UGC 번역 캐시 중 본문이 지정 문자열과 일치하는 문서만 삭제 (2026-09-13) ──────────
// 용도: 짧은 단어 오역 사고(Vero→베로, Pavitra 원문 유지)처럼 **몇 건을 콕 집어** 되돌릴 때.
//   전량 기준 정리는 purge-stale-tx-cache.js(cutoff 기반), 베트남어 무성조는 purge-vi-toneless-tx-cache.js.
// 범위: titles/{id}/reviews/*/translations/*, titles/{id}/discussion/*/translations/*,
//       titles/{id}/discussion/*/replies/*/translations/*  (해당 작품 1편만 스캔 — 컬렉션 그룹 인덱스 불필요)
// 사용: cd server
//   node scripts/purge-tx-cache-by-text.js --title 12345 --match 베로 --match Pavitra          # dry-run(기본)
//   node scripts/purge-tx-cache-by-text.js --title 12345 --match 베로 --match Pavitra --apply  # JSONL 백업 후 삭제
//   --find "폭싹 속았수다"  : titles.searchLower.ko 접두 일치로 id 후보만 출력하고 종료
// 삭제 후 다음 AI 번역 요청이 MISS → 수정된 프롬프트로 재번역(1pt 규칙은 클라 txState 기준이라 재차감 없음).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const getAll = (k) => argv.map((a, i) => (a === k ? argv[i + 1] : null)).filter(Boolean);
const TITLE = getAll('--title')[0];
const MATCH = new Set(getAll('--match').map((s) => s.trim()));
const FIND = getAll('--find')[0];

async function findTitle(q) {
    const lower = q.toLowerCase();
    const snap = await kcultureDb.collection('titles').where('searchLower.ko', '>=', lower).where('searchLower.ko', '<=', lower + '').limit(10).get();
    for (const d of snap.docs) console.log(`  ${d.id}  media=${d.data().media}  ${d.data().searchTitle?.ko || d.data().searchLower?.ko}`);
    if (snap.empty) console.log('  (searchLower 접두 일치 없음)');
}

async function scanTitle(tmdbId) {
    const base = kcultureDb.collection('titles').doc(String(tmdbId));
    const out = [];
    const pushTx = async (parentRef, kind) => {
        const tx = await parentRef.collection('translations').get();
        for (const t of tx.docs) {
            const body = t.data().body;
            if (typeof body === 'string') out.push({ kind, ref: t.ref, body, parent: parentRef.path });
        }
    };
    const reviews = await base.collection('reviews').get();
    for (const r of reviews.docs) await pushTx(r.ref, 'review');
    const disc = await base.collection('discussion').get();
    for (const c of disc.docs) {
        await pushTx(c.ref, 'dcomment');
        const replies = await c.ref.collection('replies').get();
        for (const rp of replies.docs) await pushTx(rp.ref, 'dreply');
    }
    return out;
}

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb not configured');
    if (FIND) { console.log(`[find] "${FIND}"`); await findTitle(FIND); return; }
    if (!TITLE || !MATCH.size) { console.error('usage: --title <tmdbId> --match <text> [--match <text>] [--apply]'); process.exit(2); }
    const all = await scanTitle(TITLE);
    console.log(`[scan] titles/${TITLE}: 번역 캐시 ${all.length}건`);
    const hits = all.filter((x) => MATCH.has(x.body.trim()));
    for (const h of hits) {
        const parent = await kcultureDb.doc(h.parent).get();
        const src = parent.exists ? (parent.data().bodyOriginal || parent.data().body || '') : '(parent missing)';
        console.log(`  ${APPLY ? 'DELETE' : 'candidate'} ${h.kind} ${h.ref.path}\n      cache="${h.body}"  ← source="${String(src).slice(0, 80)}" (lang=${parent.data()?.lang || '?'})`);
    }
    if (!hits.length) { console.log('  일치 없음'); return; }
    if (!APPLY) { console.log(`\n${hits.length}건 — 실제 삭제는 --apply`); return; }
    const logDir = path.join(__dirname, 'logs'); fs.mkdirSync(logDir, { recursive: true });
    const backup = path.join(logDir, `purge-tx-by-text-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    for (const h of hits) {
        const snap = await h.ref.get();
        fs.appendFileSync(backup, JSON.stringify({ path: h.ref.path, data: snap.data() }) + '\n');
        await h.ref.delete();
    }
    console.log(`\n삭제 ${hits.length}건, 백업 ${backup}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
