// ── Dari 리뷰의 특정 언어만 재번역 ────────────────────────────────────────────────────
// 사용: cd server && node scripts/reseed-dari-lang.js --post <id> --lang vi[,ar] [--title] [--apply]
//
// reseedReviewPost는 12개 언어를 전부 다시 만든다 — 한 언어만 잘렸거나 오역이 확인됐을 때
// 나머지 11개의 기존 QA 결과까지 날리게 되므로, 그 경우엔 이 스크립트로 해당 언어만 교체한다.
// (2026-08-29 전량 검수: CLOY ar 0.30 · The Man from Nowhere ar 0.29 · Kingdom vi 0.45 —
//  본문이 문장 중간에서 끊긴 채 게시돼 있었다.)
// 꼬리 2줄은 lib/dari의 TAIL_BY_LANG가 결정적으로 붙인다(번역 대상 아님).
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

async function main() {
    const postId = arg('post', '');
    const langs = (arg('lang', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const withTitle = process.argv.includes('--title');
    const model = arg('model', '') || null; // 미지정 시 lib/dari 기본(DARI_TX_MODEL_ID 또는 전역 PRIMARY)
    const apply = process.argv.includes('--apply');
    if (!postId || !langs.length) {
        console.error('사용법: node scripts/reseed-dari-lang.js --post <id> --lang vi[,ar] [--title] [--apply]');
        process.exit(1);
    }

    // lib/dari의 내부 헬퍼를 그대로 쓴다 — 게시 경로와 동일한 규칙(고정 꼬리·glossary·showTitles)을 보장.
    const dari = require('../lib/dari');
    const { translateBodyMulti, translateTitleMulti, showTitlesOf } = dari._reseed || {};
    if (!translateBodyMulti) throw new Error('lib/dari가 _reseed를 노출하지 않는다 — export를 확인할 것');

    const snap = await kcultureDb.doc(`posts/${postId}`).get();
    if (!snap.exists) throw new Error(`posts/${postId} 없음`);
    const data = snap.data();
    const enBody = (await kcultureDb.doc(`posts/${postId}/translations/en`).get()).data()?.body || data.body;
    if (!enBody) throw new Error('base 영문 본문을 찾을 수 없다');

    const st = data.titleId ? await showTitlesOf(data.titleId, data.media || 'tv') : null;
    const showTitles = st ? { en: data.titleName || st.en, original: st.original, originalLang: st.originalLang } : null;

    console.log(`[reseed] posts/${postId} (${data.titleName}) → [${langs.join(', ')}]${model ? ` model=${model}` : ''}${apply ? '' : ' (dry-run)'}`);
    const body = await translateBodyMulti(enBody, langs, showTitles, data.glossary || null, model);
    const titles = withTitle && data.title ? await translateTitleMulti(data.title, langs, showTitles, data.glossary || null, model) : {};

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(__dirname, '..', 'logs', `reseed-dari-lang-${postId}-${ts}.jsonl`);
    const lines = [];
    const batch = kcultureDb.batch();
    for (const L of langs) {
        const text = body[L];
        if (!text) { console.warn(`  ⚠ ${L}: 번역 미수확 — 건너뜀`); continue; }
        const before = (await kcultureDb.doc(`posts/${postId}/translations/${L}`).get()).data()?.body || '';
        console.log(`  ${L}: ${before.length}자 → ${text.length}자 (en ${enBody.length}자, 비 ${(text.length / enBody.length).toFixed(2)})`);
        lines.push(JSON.stringify({ postId, lang: L, before }));
        if (apply) batch.set(kcultureDb.doc(`posts/${postId}/translations/${L}`), { body: text, translatedAt: new Date() }, { merge: true });
        if (titles[L]) {
            const tb = (await kcultureDb.doc(`posts/${postId}/translations/${L}__title`).get()).data()?.body || '';
            lines.push(JSON.stringify({ postId, lang: `${L}__title`, before: tb }));
            if (apply) batch.set(kcultureDb.doc(`posts/${postId}/translations/${L}__title`), { body: titles[L], translatedAt: new Date() }, { merge: true });
        }
    }
    if (apply) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, `${lines.join('\n')}\n`, 'utf8');
        await batch.commit();
        console.log(`반영 완료 · 백업 ${backup}`);
    } else {
        console.log('반영하려면 --apply 를 붙일 것.');
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
