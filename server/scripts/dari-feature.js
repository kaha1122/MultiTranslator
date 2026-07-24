// ── Dari 홈 고정(featured) 관리 CLI — 홈 Dari 존 3장을 최신순 대신 지정 순위로 노출 ──
// 클라(listDariCards)가 featured(숫자, 낮을수록 앞) 우선 정렬 → 나머지 최신순.
// Firebase 콘솔에서 curation_threads/{id}에 featured 필드를 직접 넣어도 동일하게 동작(무배포 운영).
// 사용:
//   node scripts/dari-feature.js --thread 279323_s1e8 --rank 1   # 고정(순위 1)
//   node scripts/dari-feature.js --thread 279323_s1e8 --clear    # 고정 해제(최신순 복귀)
//   node scripts/dari-feature.js --list                          # 현황
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { kcultureDb } = require('../config/firebaseKculture');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    if (process.argv.includes('--list')) {
        const snap = await kcultureDb.collection('curation_threads').get();
        snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => ((a.featured ?? 999) - (b.featured ?? 999)) || (String(b.createdAt) < String(a.createdAt) ? -1 : 1))
            .forEach((x) => console.log(`${x.featured != null ? `[고정 ${x.featured}]` : '        '} ${x.id}  ${x.title}`));
        process.exit(0);
    }
    const id = arg('thread', '');
    if (!id) { console.error('사용법: --thread <docId> (--rank N | --clear) | --list'); process.exit(1); }
    const ref = kcultureDb.doc(`curation_threads/${id}`);
    if (!(await ref.get()).exists) { console.error(`없음: curation_threads/${id}`); process.exit(1); }
    if (process.argv.includes('--clear')) {
        await ref.update({ featured: admin.firestore.FieldValue.delete() });
        console.log(`[dari-feature] 고정 해제: ${id}`);
    } else {
        const rank = parseInt(arg('rank', ''), 10);
        if (!Number.isInteger(rank) || rank < 1) { console.error('--rank: 1 이상의 정수'); process.exit(1); }
        await ref.update({ featured: rank });
        console.log(`[dari-feature] 고정: ${id} → ${rank}위`);
    }
    process.exit(0);
})().catch((e) => { console.error('[dari-feature] FAIL', e); process.exit(1); });
