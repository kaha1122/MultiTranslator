// ── 베트남어 무성조 원문의 UGC 번역 캐시 퍼지 (2026-08-29) ────────────────────
// 커밋 3480b3b(무성조 지시 + KDL_TX_MODEL 3.1-flash-lite) 배포 **전에** 만들어진 번역 캐시 중,
// 원문이 무성조 베트남어(lib/txNuance isTonelessVietnamese)인 것만 골라 지운다 — 대상 언어 전부.
// 캐시가 사라지면 다음 [AI 번역] 요청이 MISS → 새 파이프라인으로 재번역된다.
//
// 대상(전부 UGC 번역 캐시): collectionGroup('translations') 중
//   ⚠ titles/{id}/translations/{lang} **메타 번역(TMDB 제목·줄거리)은 절대 제외** — 부모가 titles/{id}인 것.
//   나머지: discussion·replies·reviews·posts·comments·messages 밑의 translations/{lang | lang__title}
// 삭제 조건: ① 부모 원문(bodyOriginal||body, __title은 titleOriginal||title)이 무성조 베트남어
//           ② translatedAt < cutoff(기본: 실행 시각 — 배포 후 생성분은 이미 새 파이프라인)
//           ③ 시드가 아닐 것(캐시 body == 원문)
//
// 사용법: node scripts/purge-vi-toneless-tx-cache.js            # dry-run
//         node scripts/purge-vi-toneless-tx-cache.js --apply    # JSONL 백업 후 삭제
//         옵션: --cutoff 2026-08-29T10:00:00Z
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { isTonelessVietnamese } = require('../lib/txNuance');

const APPLY = process.argv.includes('--apply');
const ci = process.argv.indexOf('--cutoff');
const CUTOFF = ci >= 0 ? new Date(process.argv[ci + 1]) : new Date();
const norm = (s) => String(s || '').trim();

async function run() {
    if (!kcultureDb) { console.error('KCULTURE_SERVICE_ACCOUNT_BASE64 필요'); process.exit(1); }
    console.log(`cutoff ${CUTOFF.toISOString()} · ${APPLY ? '⚠ APPLY(실삭제)' : 'dry-run'}`);
    const all = await kcultureDb.collectionGroup('translations').get();
    // 부모별 그룹(메타 번역 제외)
    const byParent = new Map();
    let meta = 0;
    for (const d of all.docs) {
        const parent = d.ref.parent.parent;           // translations 컬렉션의 소유 문서
        const seg = parent.path.split('/');
        if (seg[0] === 'titles' && seg.length === 2) { meta++; continue; } // titles/{id}/translations = 메타
        if (!byParent.has(parent.path)) byParent.set(parent.path, []);
        byParent.get(parent.path).push(d);
    }
    console.log(`translations 문서 ${all.size}건 — 메타 ${meta} 제외, UGC 부모 ${byParent.size}개`);

    // 부모 원문 일괄 read
    const parentRefs = [...byParent.keys()].map((p) => kcultureDb.doc(p));
    const parents = new Map();
    for (let i = 0; i < parentRefs.length; i += 300) {
        const snaps = await kcultureDb.getAll(...parentRefs.slice(i, i + 300));
        for (const s of snaps) parents.set(s.ref.path, s.exists ? (s.data() || {}) : null);
    }

    const out = [];
    let viParents = 0;
    for (const [ppath, docs] of byParent) {
        const x = parents.get(ppath);
        if (!x) continue;
        const body = norm(x.bodyOriginal || x.body);
        const title = norm(x.titleOriginal || x.title);
        const bodyVi = isTonelessVietnamese(body);
        const titleVi = isTonelessVietnamese(title);
        if (!bodyVi && !titleVi) continue;
        viParents++;
        for (const d of docs) {
            const c = d.data() || {};
            const isTitle = d.id.endsWith('__title');
            if (isTitle ? !titleVi : !bodyVi) continue;
            const src = isTitle ? title : body;
            const at = c.translatedAt?.toDate?.() || null;
            if (at && at >= CUTOFF) continue;                    // 새 파이프라인 산출물
            if (!c.body || norm(c.body) === src) continue;       // 시드(원문 복사본)
            out.push({ path: d.ref.path, src: src.slice(0, 70), body: String(c.body).slice(0, 70), data: c });
        }
    }

    console.log(`\n무성조 베트남어 원문 문서 ${viParents}개 · 삭제 후보 ${out.length}건:`);
    for (const c of out) console.log(`  ${c.path}\n    원문: ${c.src}\n    캐시: ${c.body}`);
    if (!APPLY || !out.length) {
        if (out.length) console.log(`\n실행하려면: node scripts/purge-vi-toneless-tx-cache.js --apply`);
        return;
    }
    const logDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const bak = path.join(logDir, `purge-vi-tx-cache-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    fs.writeFileSync(bak, out.map((c) => JSON.stringify({ path: c.path, data: c.data })).join('\n') + '\n');
    console.log(`\n백업: ${bak}`);
    for (let i = 0; i < out.length; i += 400) {
        const batch = kcultureDb.batch();
        for (const c of out.slice(i, i + 400)) batch.delete(kcultureDb.doc(c.path));
        await batch.commit();
    }
    console.log(`✅ ${out.length}건 삭제 완료 — 다음 [AI 번역] 요청부터 새 파이프라인으로 재번역됩니다`);
}
run().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e); process.exit(1); });
