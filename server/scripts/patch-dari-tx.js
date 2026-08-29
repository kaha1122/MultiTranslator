// ── Dari 리뷰 언어별 번역 문서 교정 ──────────────────────────────────────────────────
// 사용: cd server && node scripts/patch-dari-tx.js --file <patch.json> [--apply]
//
// L2 의미 검수 + 2차 검증에서 **확정된** 오역만 여기로 넣는다(스크리닝 결과를 그대로 넣지 말 것).
// base 영문은 건드리지 않으므로 재시드하면 되살아난다 — 재시드 후에는 L2를 다시 돌릴 것.
//
// patch.json: [{ "postId":"...", "lang":"ko", "replace":"틀린 구절", "with":"고친 구절", "_why":"..." }]
// replace가 정확히 일치하지 않으면 그 항목은 건너뛴다(다른 곳을 조용히 고치지 않는다).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

async function main() {
    const file = arg('file', '');
    const apply = process.argv.includes('--apply');
    if (!file || !fs.existsSync(file)) { console.error('사용법: node scripts/patch-dari-tx.js --file <patch.json> [--apply]'); process.exit(1); }
    const ops = JSON.parse(fs.readFileSync(file, 'utf8'));

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(__dirname, '..', 'logs', `patch-dari-tx-${ts}.jsonl`);
    const lines = [];
    let ok = 0, skip = 0;

    // (post,lang)별로 모아 한 번에 쓴다
    const grouped = {};
    ops.forEach((o) => { (grouped[`${o.postId}|${o.lang}`] = grouped[`${o.postId}|${o.lang}`] || []).push(o); });

    for (const [key, list] of Object.entries(grouped)) {
        const [postId, lang] = key.split('|');
        const ref = kcultureDb.doc(`posts/${postId}/translations/${lang}`);
        const before = (await ref.get()).data()?.body || '';
        if (!before) { console.warn(`⚠ ${key}: 문서 없음`); skip += list.length; continue; }
        let body = before;
        for (const o of list) {
            if (!body.includes(o.replace)) { console.warn(`  ⚠ 불일치 [${lang}] ${JSON.stringify(o.replace).slice(0, 50)}`); skip++; continue; }
            const next = body.replace(o.replace, o.with);
            // ⚠ 중복 생성 가드 — 모델의 fix가 **주변 문맥까지 다시 써서** 인접 문구가 두 번 나오는 일이 있다
            //   (2026-08-29 실측: ar·fr 각 1건). 치환 결과에 40자 이상 연속 반복이 새로 생기면 적용하지 않는다.
            const dup = /(.{40,}?)\1/s;
            if (dup.test(next) && !dup.test(body)) {
                console.warn(`  ⚠ 중복 생성 [${lang}] ${JSON.stringify(o.replace).slice(0, 46)} — 건너뜀`);
                skip++; continue;
            }
            body = next;
            ok++;
            console.log(`  ${apply ? 'FIX ' : 'PLAN'} [${lang}] ${JSON.stringify(o.replace).slice(0, 46)} → ${JSON.stringify(o.with).slice(0, 46)}`);
        }
        if (body === before) continue;
        lines.push(JSON.stringify({ postId, lang, before }));
        if (apply) await ref.set({ body }, { merge: true });
    }

    if (apply && lines.length) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, `${lines.join('\n')}\n`, 'utf8');
        console.log(`\n반영 ${ok}건 · 건너뜀 ${skip}건 · 백업 ${backup}`);
    } else {
        console.log(`\n${apply ? '반영할 것 없음' : `예정 ${ok}건 · 건너뜀 ${skip}건 — 반영하려면 --apply`}`);
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
