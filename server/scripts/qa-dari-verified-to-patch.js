// ── 2차 검증 확정분(logs/qa-verified.jsonl) → patch-dari-tx.js 입력 JSON 생성 ─────────
// 사용: cd server && node scripts/qa-dari-verified-to-patch.js [--min-confidence 0.9] [--out <path>]
//
// ⚠ 확정(CONFIRMED)이면서 ① fix 문구가 있고 ② claim.target이 실제 본문에 **정확히 1회** 나오는
//   항목만 패치 대상으로 만든다. 여러 번 나오거나 안 나오면 사람이 볼 목록(logs/qa-manual.md)으로 뺀다
//   — 잘못된 위치를 조용히 고치는 것이 오역보다 나쁘다.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

async function main() {
    const minConf = Number(arg('min-confidence', 0.9));
    const out = arg('out', path.join(__dirname, '..', 'logs', 'qa-patch-auto.json'));
    const manualPath = path.join(__dirname, '..', 'logs', 'qa-manual.md');

    const rows = fs.readFileSync(path.join(__dirname, '..', 'logs', 'qa-verified.jsonl'), 'utf8')
        .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
        .filter((r) => r.verdict === 'CONFIRMED' && Number(r.confidence) >= minConf);

    const cache = new Map();
    const bodyOf = async (postId, lang) => {
        const k = `${postId}|${lang}`;
        if (!cache.has(k)) cache.set(k, (await kcultureDb.doc(`posts/${postId}/translations/${lang}`).get()).data()?.body || '');
        return cache.get(k);
    };

    const patch = [];
    const manual = [];
    for (const r of rows) {
        const tgtQuote = String(r.claim?.target || '').trim();
        const fix = String(r.fix || '').trim();
        const body = await bodyOf(r.postId, r.lang);
        const occurrences = tgtQuote ? body.split(tgtQuote).length - 1 : 0;
        // ⚠ 고유명사 치환은 자동화하지 않는다 — 모델의 fix가 **또 다른 틀린 이름**일 수 있다.
        //   2026-08-29 실측: 「아저씨」 ko가 `Agent Kim Reactivated`를 '대행사'로 옮긴 것은 오역이 맞지만
        //   모델이 제안한 '검은 태양'도 틀렸다(정답은 「김부장」). 지적은 맞고 처방은 틀린 전형이다.
        //   → 짧은 치환(제목·인명일 확률이 높다)과 원문과 겹치는 글자가 거의 없는 치환은 사람에게 보낸다.
        const overlap = (a, b) => {
            const A = new Set(a.replace(/\s/g, '')); let hit = 0;
            for (const ch of new Set(b.replace(/\s/g, ''))) if (A.has(ch)) hit++;
            return A.size ? hit / A.size : 0;
        };
        const reason = !fix ? 'fix 문구 없음'
            : !tgtQuote ? 'target 인용 없음'
                : occurrences === 0 ? '본문에서 인용을 못 찾음(모델이 축약·변형해 인용)'
                    : occurrences > 1 ? `본문에 ${occurrences}회 등장 — 위치 불확정`
                        : fix === tgtQuote ? 'fix가 원문과 동일'
                            : r.claim.type === 'PROPER_NOUN' ? '고유명사 — 모델 처방 신뢰 불가'
                                : tgtQuote.replace(/\s/g, '').length < 12 ? '치환 대상이 짧음(제목·인명 가능성) — 사람 확인'
                                    : overlap(tgtQuote, fix) < 0.35 ? '원문과 거의 겹치지 않는 치환 — 사람 확인' : '';
        if (reason) { manual.push({ ...r, reason }); continue; }
        patch.push({ postId: r.postId, lang: r.lang, _name: r.name, _why: r.note, replace: tgtQuote, with: fix });
    }

    fs.writeFileSync(out, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
    const md = ['# 사람 확인이 필요한 확정 지적', '', `자동 패치 ${patch.length}건 / 수동 ${manual.length}건`, ''];
    manual.forEach((m) => md.push(
        `## ${m.name} [${m.lang}] — ${m.reason}`, '',
        `- EN : ${String(m.claim.source || '').replace(/\n/g, ' ')}`,
        `- TGT: ${String(m.claim.target || '').replace(/\n/g, ' ')}`,
        `- 사유: ${m.note}`,
        `- 제안: ${m.fix || '(없음)'}`, '',
    ));
    fs.writeFileSync(manualPath, md.join('\n'), 'utf8');
    console.log(`자동 패치 ${patch.length}건 → ${out}`);
    console.log(`수동 확인 ${manual.length}건 → ${manualPath}`);
    const byReason = manual.reduce((a, m) => { a[m.reason] = (a[m.reason] || 0) + 1; return a; }, {});
    Object.entries(byReason).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
