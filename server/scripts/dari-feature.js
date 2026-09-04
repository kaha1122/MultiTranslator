// ── Dari 홈 featured 관리 CLI — 홈 Dari 존 6장(방영분 3 + 선공개 3) ──
// 2026-09-04부터 매일 KST 05시 자동 배치(lib/kcultureFeatured.js, reengagement cron 체이닝)가 featured 1~6을 다시 뽑는다.
// 수동 지정(--rank)은 다음 배치에서 덮어써진다 → 자리를 지키려면 --pin. 콘솔에서 featuredPin=true를 넣어도 동일.
// 사용:
//   node scripts/dari-feature.js --list                          # 현황(고정·pin·pre 표시)
//   node scripts/dari-feature.js --auto [--dry]                  # 자동 선정 즉시 실행(시각·중복 가드 무시)
//   node scripts/dari-feature.js --config                        # config/kc_featured 보기
//   node scripts/dari-feature.js --targets 246473,294636,...     # 월간 글로벌 OTT 대상 titleId 목록(배치 후보 범위) 저장
//   node scripts/dari-feature.js --auto-on | --auto-off          # 자동 배치 킬 스위치
//   node scripts/dari-feature.js --pin <docId> | --unpin <docId> # 수동 고정 유지/해제(배치가 건너뜀)
//   node scripts/dari-feature.js --thread <docId> --rank N       # 즉시 순위 지정(다음 배치까지 유효)
//   node scripts/dari-feature.js --thread <docId> --clear        # featured 제거
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { kcultureDb } = require('../config/firebaseKculture');
const { runFeaturedDaily, getFeaturedConfig } = require('../lib/kcultureFeatured');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const has = (f) => process.argv.includes(`--${f}`);

(async () => {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const cfgRef = kcultureDb.doc('config/kc_featured');
    if (has('list')) {
        const snap = await kcultureDb.collection('curation_threads').get();
        snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => ((a.featured ?? 999) - (b.featured ?? 999)) || (String(b.createdAt) < String(a.createdAt) ? -1 : 1))
            .forEach((x) => console.log(`${x.featured != null ? `[고정 ${x.featured}]` : '        '}${x.featuredPin ? '📌' : '  '}${x.pre ? 'PRE ' : '    '} ${x.id.padEnd(16)} ${x.title}`));
        process.exit(0);
    }
    if (has('config')) { console.log(JSON.stringify(await getFeaturedConfig(), null, 2)); process.exit(0); }
    if (has('auto')) {
        const r = await runFeaturedDaily(new Date(), { dryRun: has('dry'), force: true });
        console.log(JSON.stringify(r, null, 2));
        process.exit(0);
    }
    if (has('targets')) {
        const ids = String(arg('targets', '')).split(',').map((s) => s.trim()).filter(Boolean);
        await cfgRef.set({ targetIds: ids, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        console.log(`[dari-feature] targetIds ${ids.length}건 저장:`, ids.join(','));
        process.exit(0);
    }
    if (has('auto-on') || has('auto-off')) {
        await cfgRef.set({ autoEnabled: has('auto-on'), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        console.log(`[dari-feature] autoEnabled = ${has('auto-on')}`);
        process.exit(0);
    }
    if (has('pin') || has('unpin')) {
        const id = arg(has('pin') ? 'pin' : 'unpin', '');
        const ref = kcultureDb.doc(`curation_threads/${id}`);
        if (!id || !(await ref.get()).exists) { console.error(`없음: curation_threads/${id}`); process.exit(1); }
        await ref.update(has('pin') ? { featuredPin: true } : { featuredPin: admin.firestore.FieldValue.delete() });
        console.log(`[dari-feature] ${has('pin') ? 'pin' : 'unpin'}: ${id}`);
        process.exit(0);
    }
    const id = arg('thread', '');
    if (!id) { console.error('사용법: --list | --auto [--dry] | --config | --targets a,b | --auto-on|--auto-off | --pin <id>|--unpin <id> | --thread <docId> (--rank N | --clear)'); process.exit(1); }
    const ref = kcultureDb.doc(`curation_threads/${id}`);
    if (!(await ref.get()).exists) { console.error(`없음: curation_threads/${id}`); process.exit(1); }
    if (has('clear')) {
        await ref.update({ featured: admin.firestore.FieldValue.delete() });
        console.log(`[dari-feature] 고정 해제: ${id}`);
    } else {
        const rank = parseInt(arg('rank', ''), 10);
        if (!Number.isInteger(rank) || rank < 1) { console.error('--rank: 1 이상의 정수'); process.exit(1); }
        await ref.update({ featured: rank });
        console.log(`[dari-feature] 고정: ${id} → ${rank}위 (다음 05시 자동 배치에서 재선정됨 — 유지하려면 --pin)`);
    }
    process.exit(0);
})().catch((e) => { console.error('[dari-feature] FAIL', e); process.exit(1); });
