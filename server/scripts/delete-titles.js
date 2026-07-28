// ── 카탈로그 작품 삭제 (사람 판정 D) ────────────────────────────────────────
// 판정 파일(판정<TAB>id)에서 지정 판정(기본 'D')인 작품을 Firestore에서 지운다.
//
// 순서가 중요하다 — **백업 → 차단목록 등록 → 삭제**
//   ① 백업: 문서 본문 + translations 전량을 JSONL로 남긴다. 삭제는 되돌릴 수 없으므로
//           이 파일이 유일한 복구 수단이다.
//   ② 차단: excluded_titles/{id} 등록. **삭제보다 먼저** 해야 한다 — 삭제와 등록 사이에
//           다른 배치가 돌면 지운 작품이 곧바로 되살아난다.
//   ③ 삭제: recursiveDelete로 문서 + 하위 translations 함께 제거.
//
// ⚠ 재유입 차단의 실제 효력은 lib/tmdbBackfill.js의 processTitle 진입 가드가 담당한다.
//   사전번역 배치는 TMDB discover로 id를 열거하므로, 차단 목록만 있고 가드가 없으면 소용없다.
//
// 사용법:
//   node scripts/delete-titles.js --file logs/FINAL_ID.MD --dry     # 대상만 확인
//   node scripts/delete-titles.js --file logs/FINAL_ID.MD           # 실제 삭제
//   node scripts/delete-titles.js --file logs/FINAL_ID.MD --verdict N --no-delete
//        → 삭제 없이 차단 목록에만 등록(번역 제외용)
// 옵션: --verdict D · --limit N · --concurrency 8 · --no-backup(권장하지 않음)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    file: arg('file', path.join(__dirname, 'logs', 'FINAL_ID.MD')),
    verdict: (arg('verdict', 'D') || 'D').toUpperCase(),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    concurrency: parseInt(arg('concurrency', '8'), 10),
    dry: process.argv.includes('--dry'),
    backup: !process.argv.includes('--no-backup'),
    del: !process.argv.includes('--no-delete'),
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36');

function loadIds(file, verdict) {
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const [v, id] = line.split('\t');
        if (!id || !/^\d+$/.test(id.trim())) continue;
        if ((v || '').trim().toUpperCase() === verdict) out.push(id.trim());
    }
    return [...new Set(out)];
}

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    let ids = loadIds(opts.file, opts.verdict);
    if (opts.limit) ids = ids.slice(0, opts.limit);

    console.log(`\n${bold('▶ 카탈로그 삭제')}${opts.dry ? yellow(' · DRY(변경 없음)') : ''}`);
    console.log(dim(`  판정 파일: ${opts.file} · 판정 '${opts.verdict}'`));
    console.log(`  대상 ${bold(ids.length.toLocaleString())}편`
        + dim(` · 백업 ${opts.backup ? '함' : red('안 함')} · 삭제 ${opts.del ? '함' : '안 함(차단만)'}`));

    // 존재 여부 확인 — 이미 없는 id는 차단만 걸고 넘어간다.
    const exist = [];
    for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const snaps = await kcultureDb.getAll(...part.map((id) => kcultureDb.doc(`titles/${id}`)));
        snaps.forEach((s, k) => { if (s.exists) exist.push(part[k]); });
    }
    console.log(`  Firestore 존재 ${exist.length.toLocaleString()}편` + dim(` · 이미 없음 ${(ids.length - exist.length).toLocaleString()}`));

    if (opts.dry) { console.log(dim('\n  DRY — 실제 변경 없음. --dry 를 빼고 다시 실행하세요.\n')); return; }

    const dir = path.join(__dirname, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bakFile = path.join(dir, `deleted-backup-${stamp}.jsonl`);

    const stat = { backed: 0, blocked: 0, deleted: 0, errors: 0 };
    let idx = 0, counted = 0;
    const t0 = Date.now();

    async function worker() {
        while (idx < ids.length) {
            const id = ids[idx++];
            try {
                // ① 백업 — 본문 + 하위 컬렉션 전량
                if (opts.backup) {
                    const ref = kcultureDb.doc(`titles/${id}`);
                    const doc = await ref.get();
                    const subs = {};
                    for (const c of await ref.listCollections()) {
                        const s = await c.get();
                        subs[c.id] = s.docs.map((d) => ({ id: d.id, data: d.data() }));
                    }
                    fs.appendFileSync(bakFile, `${JSON.stringify({ id, exists: doc.exists, data: doc.data() || null, subs })}\n`);
                    stat.backed++;
                }
                // ② 차단 등록 — 삭제보다 먼저
                await kcultureDb.doc(`excluded_titles/${id}`).set(
                    { reason: `manual:${opts.verdict}`, at: new Date() }, { merge: true },
                );
                stat.blocked++;
                // ③ 삭제 — 문서 + 하위 컬렉션 재귀 삭제
                if (opts.del) { await kcultureDb.recursiveDelete(kcultureDb.doc(`titles/${id}`)); stat.deleted++; }
            } catch (e) {
                stat.errors++;
                console.log(red(`  ✖ ${id}: ${e.message}`));
            }
            counted++;
            if (counted % 200 === 0) {
                const el = (Date.now() - t0) / 1000;
                console.log(cyan(`  ── ${counted}/${ids.length} · 삭제 ${stat.deleted} · 남은 예상 ${Math.round((ids.length - counted) / (counted / el))}초`));
            }
        }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    console.log(`\n${bold('══════ 완료 ══════')}`);
    console.log(`  백업 ${stat.backed.toLocaleString()} · 차단등록 ${stat.blocked.toLocaleString()} · 삭제 ${green(stat.deleted.toLocaleString())} · 오류 ${stat.errors}`);
    if (opts.backup) console.log(dim(`  백업 파일: ${bakFile} (${Math.round(fs.statSync(bakFile).size / 1024).toLocaleString()}KB)`));

    const left = await kcultureDb.collection('titles').select().get();
    const blocked = await kcultureDb.collection('excluded_titles').select().get();
    console.log(`\n  남은 titles ${bold(left.size.toLocaleString())}편 · 차단목록 ${blocked.size.toLocaleString()}건`);
    console.log(dim('  ※ sitemap 반영: KCulture에서 npm run sitemap:refresh 후 커밋·푸시'));
    console.log(dim('  ※ 복구는 백업 JSONL로 가능(excluded_titles의 해당 id도 함께 삭제해야 함)\n'));
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
