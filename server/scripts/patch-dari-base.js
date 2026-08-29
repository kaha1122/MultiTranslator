// ── Dari 리뷰 base 영문 본문 교정(승인된 초안만) ─────────────────────────────────────
// 사용: cd server && node scripts/patch-dari-base.js --file <patch.json> [--apply]
//
// base 영문은 모든 언어 번역의 원본이다. 여기를 고치면 반드시 재시드해야 언어별 문서에 반영된다
//   node scripts/reseed-dari-lang.js --post <id> --lang ko,ja,... --model gemini-3.1-flash-lite --apply
//
// patch.json 형식 — 삽입(anchor 앞/뒤)과 치환을 지원한다. 전부 **정확 일치**여야 하고,
// 일치하지 않으면 그 항목은 건너뛴다(조용히 다른 곳을 고치지 않는다).
// [{ "postId": "...", "insertBefore": "💬 ", "text": "🎯 ...\n\n" },
//  { "postId": "...", "append": "\nNote: this is Dari's AI perspective, separate from user ratings." },
//  { "postId": "...", "replace": "old", "with": "new" }]
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

async function main() {
    const file = arg('file', '');
    const apply = process.argv.includes('--apply');
    if (!file || !fs.existsSync(file)) { console.error('사용법: node scripts/patch-dari-base.js --file <patch.json> [--apply]'); process.exit(1); }
    const patches = JSON.parse(fs.readFileSync(file, 'utf8'));

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(__dirname, '..', 'logs', `patch-dari-base-${ts}.jsonl`);
    const lines = [];
    const byPost = {};
    patches.forEach((p) => { (byPost[p.postId] = byPost[p.postId] || []).push(p); });

    for (const [postId, ops] of Object.entries(byPost)) {
        const enRef = kcultureDb.doc(`posts/${postId}/translations/en`);
        const postRef = kcultureDb.doc(`posts/${postId}`);
        const before = (await enRef.get()).data()?.body || (await postRef.get()).data()?.body || '';
        if (!before) { console.warn(`⚠ ${postId}: base 본문 없음 — 건너뜀`); continue; }
        let body = before;
        for (const op of ops) {
            if (op.insertBefore) {
                if (!body.includes(op.insertBefore)) { console.warn(`  ⚠ anchor 불일치: ${JSON.stringify(op.insertBefore).slice(0, 40)}`); continue; }
                body = body.replace(op.insertBefore, `${op.text}${op.insertBefore}`);
            } else if (op.append) {
                if (body.trimEnd().endsWith(op.append.trim())) { console.warn('  ⚠ 이미 존재 — 건너뜀'); continue; }
                body = `${body.trimEnd()}${op.append}`;
            } else if (op.replace) {
                if (!body.includes(op.replace)) { console.warn(`  ⚠ 대상 불일치: ${JSON.stringify(op.replace).slice(0, 40)}`); continue; }
                body = body.replace(op.replace, op.with);
            }
        }
        if (body === before) { console.log(`OK   | ${postId} | 변경 없음`); continue; }
        console.log(`${apply ? 'FIX ' : 'PLAN'} | ${postId} | ${before.length}자 → ${body.length}자`);
        lines.push(JSON.stringify({ postId, field: 'translations/en', before }));
        if (apply) {
            // base는 두 곳에 있다 — posts/{id}.body(원본)와 translations/en(시드). 둘 다 맞춘다.
            await enRef.set({ body, translatedAt: new Date() }, { merge: true });
            await postRef.set({ body }, { merge: true });
        }
    }

    if (apply) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, `${lines.join('\n')}\n`, 'utf8');
        console.log(`\n반영 완료 · 백업 ${backup}`);
        console.log('⚠ 이제 해당 글을 반드시 재시드할 것 — base만 고치면 언어별 문서는 옛 내용 그대로다.');
    } else {
        console.log('\n반영하려면 --apply 를 붙일 것.');
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
