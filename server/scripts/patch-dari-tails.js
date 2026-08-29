// ── Dari 리뷰 번역 시드 꼬리 정규화 · Dari 음역 복원 일괄 패치 ─────────────────────────
// 사용: cd server && node scripts/patch-dari-tails.js [--apply] [--post <id>]
//   기본은 dry-run(변경 미반영). --apply 시 logs/patch-dari-tails-<ts>.jsonl 로 원본 백업 후 반영.
//
// 배경(2026-08-29 전량 검수): 서명·Note 2줄은 내용이 항상 같은데도 게시마다 12개 언어로 재번역돼
// 매번 다르게 틀렸다(Dari 음역 104건 · 꼬리 불일치 361건). lib/dari.js에 TAIL_BY_LANG 결정적 주입을
// 도입했으므로, 기존 34편도 같은 기준으로 소급 정규화한다.
//
// ⚠ 기대값은 **base 영문 기준**이다 — 영문에 Note 줄이 없는 글에 다른 언어만 Note를 붙이면
//   원문에 없는 문장을 만들어내는 것이다(그런 글은 base를 먼저 고치고 reseed 할 것).
// ⚠ 본문(의미) 오역은 이 스크립트의 대상이 아니다 — scripts/qa-dari-semantic.js 담당.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { SEED_LANGS } = require('../lib/dari');
const { stripAllTails, scrubDariTranslit, TAIL_BY_LANG } = require('../lib/dari')._qa;

const LANGS = ['en', ...SEED_LANGS];
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

function tailExpectation(enBody) {
    const lines = String(enBody || '').trim().split('\n');
    return {
        sig: lines.some((l) => l.trim() === TAIL_BY_LANG.en.sig),
        note: /^Note\s*:/i.test((lines[lines.length - 1] || '').trim()),
    };
}

// 한 언어 본문을 정규형으로 — 음역 스크럽 → 꼬리 제거 → 고정 꼬리 재부착
function normalize(body, lang, expect) {
    const scrubbed = scrubDariTranslit(String(body || ''), lang);
    if (!expect.sig) return scrubbed; // base에 서명이 없으면 꼬리를 손대지 않는다
    const head = stripAllTails(scrubbed); // 겹쳐 붙은 꼬리까지 전부 제거(2026-08-29 ja 중복 사고 복구)
    const t = TAIL_BY_LANG[lang] || TAIL_BY_LANG.en;
    return `${head}\n\n${t.sig}${expect.note ? `\n${t.note}` : ''}`;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const only = arg('post', '');
    let posts;
    if (only) {
        const d = await kcultureDb.doc(`posts/${only}`).get();
        posts = [{ id: d.id, ...d.data() }];
    } else {
        const s = await kcultureDb.collection('posts').where('curator', '==', true).get();
        posts = s.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const backup = path.join(logDir, `patch-dari-tails-${ts}.jsonl`);
    const stream = apply ? fs.createWriteStream(backup, { encoding: 'utf8' }) : null;

    console.log(`# 꼬리 정규화 ${apply ? '(APPLY)' : '(dry-run — 반영 안 함)'} — ${posts.length}편\n`);
    let changedDocs = 0, changedPosts = 0, skippedBase = 0;

    for (const p of posts) {
        const snap = await kcultureDb.collection(`posts/${p.id}/translations`).get();
        const doc = {};
        snap.docs.forEach((d) => { doc[d.id] = d.data()?.body || ''; });
        const expect = tailExpectation(doc.en);
        const name = (p.titleName || p.title || '?').slice(0, 32);
        if (!expect.sig) {
            skippedBase++;
            console.log(`SKIP | ${name.padEnd(32)} | ${p.id} | base 영문에 서명 줄 없음 — base 수정 후 reseed 대상`);
            continue;
        }

        const batch = kcultureDb.batch();
        const changed = [];
        for (const L of LANGS) {
            const before = doc[L];
            if (!before) continue;
            const after = normalize(before, L, expect);
            if (after === before) continue;
            // 안전 가드 — 꼬리 교체가 본문을 크게 깎으면 이상 신호다(서명 패턴 오검출 등). 손대지 않는다.
            if (after.length < before.length * 0.85) {
                console.warn(`  ⚠ SKIP ${p.id}/${L} — 길이 ${before.length}→${after.length} (15% 초과 감소)`);
                continue;
            }
            changed.push(L);
            if (apply) {
                stream.write(`${JSON.stringify({ postId: p.id, lang: L, before })}\n`);
                batch.set(kcultureDb.doc(`posts/${p.id}/translations/${L}`), { body: after }, { merge: true });
            }
        }
        // 제목 시드는 음역 스크럽만(꼬리 없음)
        for (const L of LANGS) {
            const key = `${L}__title`;
            const before = doc[key];
            if (!before) continue;
            const after = scrubDariTranslit(before, L);
            if (after === before) continue;
            changed.push(key);
            if (apply) {
                stream.write(`${JSON.stringify({ postId: p.id, lang: key, before })}\n`);
                batch.set(kcultureDb.doc(`posts/${p.id}/translations/${key}`), { body: after }, { merge: true });
            }
        }

        if (!changed.length) { console.log(`OK   | ${name.padEnd(32)} | ${p.id}`); continue; }
        if (apply) await batch.commit();
        changedPosts++; changedDocs += changed.length;
        console.log(`${apply ? 'FIX ' : 'PLAN'} | ${name.padEnd(32)} | ${p.id} | ${changed.length}개 문서: ${changed.join(', ')}`);
    }

    if (stream) stream.end();
    console.log(`\n${apply ? '반영' : '예정'}: ${changedPosts}편 / ${changedDocs}개 문서 · base 결함 skip ${skippedBase}편`);
    if (apply) console.log(`백업: ${backup}`);
    else console.log('반영하려면 --apply 를 붙여 다시 실행할 것.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
