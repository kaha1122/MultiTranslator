// ── 사람 최종 판정 반영 (titles/{id}.hidden) ────────────────────────────────
// 사람이 전수 검수한 판정 파일(판정<TAB>id, Y=성인물 / N=성인물 아님)을 읽어
// Firestore의 노출/숨김을 그대로 맞춘다.
//
// ⚠ **adult-manual.json에도 함께 기록한다** — 이게 핵심이다.
//   flag-adult-titles.js는 규칙으로 hidden을 매번 다시 계산하므로, DB만 고치면
//   그 배치를 한 번만 돌려도 사람 판정이 규칙에 덮여 사라진다.
//   manual 파일의 hide/allow는 규칙보다 우선하므로 여기에 남겨야 영구적이다.
//
// 판정 의미
//   Y → hidden=true  (성인물. 검색·탐색·인물·컬렉션·sitemap에서 제외)
//   N → hidden=false (성인물 아님. 규칙이 숨겼더라도 노출)
//   파일에 없는 id는 건드리지 않는다(다른 경로로 검수된 결과를 보존).
//
// 사용법:
//   node scripts/apply-adult-verdicts.js --file logs/Adult_F.MD --dry   # 변경량만 확인
//   node scripts/apply-adult-verdicts.js --file logs/Adult_F.MD         # 실제 반영
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    file: arg('file', path.join(__dirname, 'logs', 'Adult_F.MD')),
    dry: process.argv.includes('--dry'),
    reason: arg('reason', 'manual:final'),   // hiddenReason에 남길 사유
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), cyan = paint('36');

const MANUAL = path.join(__dirname, 'adult-manual.json');

function loadVerdicts(file) {
    const y = [], n = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const [v, id] = line.split('\t');
        if (!id || !/^\d+$/.test(id.trim())) continue;
        const V = (v || '').trim().toUpperCase();
        if (V === 'Y') y.push(id.trim());
        else if (V === 'N') n.push(id.trim());
    }
    return { y: [...new Set(y)], n: [...new Set(n)] };
}

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    const { y, n } = loadVerdicts(opts.file);
    console.log(`\n${bold('▶ 최종 성인물 판정 반영')}${opts.dry ? yellow(' · DRY(쓰기 없음)') : ''}`);
    console.log(dim(`  판정 파일: ${opts.file}`));
    console.log(`  Y(성인물) ${y.length.toLocaleString()} · N(아님) ${n.length.toLocaleString()}`);

    // 현재 상태 조회 — 실제로 바뀌는 문서만 쓰기(불필요한 write·updatedAt 갱신 방지)
    const all = [...y.map((id) => ({ id, want: true })), ...n.map((id) => ({ id, want: false }))];
    const changes = []; let same = 0, missing = 0;
    for (let i = 0; i < all.length; i += 200) {
        const part = all.slice(i, i + 200);
        const snaps = await kcultureDb.getAll(...part.map((p) => kcultureDb.doc(`titles/${p.id}`)));
        part.forEach((p, k) => {
            const s = snaps[k];
            if (!s.exists) { missing++; return; }
            const cur = s.data()?.hidden === true;
            if (cur === p.want) same++; else changes.push({ ...p, cur });
        });
    }

    const toHide = changes.filter((c) => c.want).length;
    const toShow = changes.filter((c) => !c.want).length;
    console.log(`\n  변경 필요 ${bold(changes.length.toLocaleString())}건`);
    console.log(`    노출 → 숨김 : ${cyan(toHide.toLocaleString())}`);
    console.log(`    숨김 → 노출 : ${cyan(toShow.toLocaleString())}`);
    console.log(dim(`    이미 일치   : ${same.toLocaleString()}${missing ? ` · 문서 없음 ${missing}` : ''}`));

    if (opts.dry) { console.log(dim('\n  DRY — 실제 변경 없음. --dry 를 빼고 다시 실행하세요.\n')); return; }

    // ① Firestore 반영 — 배치 400건씩
    let done = 0;
    for (let i = 0; i < changes.length; i += 400) {
        const batch = kcultureDb.batch();
        for (const c of changes.slice(i, i + 400)) {
            batch.set(kcultureDb.doc(`titles/${c.id}`),
                { hidden: c.want, hiddenReason: c.want ? opts.reason : null }, { merge: true });
        }
        await batch.commit();
        done += Math.min(400, changes.length - i);
        if (done % 2000 < 400) console.log(dim(`    …${done.toLocaleString()}/${changes.length.toLocaleString()}`));
    }
    console.log(green(`  ✔ Firestore 반영 ${changes.length.toLocaleString()}건`));

    // ② adult-manual.json 갱신 — 규칙 재실행에도 사람 판정이 살아남게(가장 중요)
    let manual = { allow: [], hide: [] };
    try { manual = { ...manual, ...JSON.parse(fs.readFileSync(MANUAL, 'utf8')) }; } catch { /* 새로 만든다 */ }
    const hide = new Set((manual.hide || []).map(String));
    const allow = new Set((manual.allow || []).map(String));
    // 판정이 뒤집힌 id는 반대편 목록에서 제거해야 모순이 남지 않는다.
    for (const id of y) { hide.add(id); allow.delete(id); }
    for (const id of n) { allow.add(id); hide.delete(id); }
    manual.hide = [...hide]; manual.allow = [...allow];
    manual._comment = '성인물 자동 판정(flag-adult-titles.js)의 수동 보정. 규칙보다 항상 우선한다.';
    manual._updated = `${new Date().toISOString().slice(0, 10)} — Adult_F.MD 전수 검수 반영`;
    fs.writeFileSync(MANUAL, `${JSON.stringify(manual, null, 2)}\n`, 'utf8');
    console.log(green(`  ✔ adult-manual.json 갱신 — hide ${manual.hide.length.toLocaleString()} · allow ${manual.allow.length.toLocaleString()}`));

    // ③ 최종 확인
    const cnt = await kcultureDb.collection('titles').where('hidden', '==', true).select('hidden').get();
    console.log(`\n  ${bold('현재 hidden=true')} ${cnt.size.toLocaleString()}편`);
    console.log(dim('  ※ 서버는 30분 TTL로 숨김 목록을 다시 읽습니다(즉시 반영하려면 재배포).'));
    console.log(dim('  ※ sitemap 반영은 KCulture에서 npm run sitemap:refresh 후 커밋·푸시.\n'));
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
