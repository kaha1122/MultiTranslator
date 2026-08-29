// ── L2 의미 검수 결과 요약 (logs/qa-semantic.jsonl → 사람이 읽는 리포트) ─────────────
// 사용: cd server && node scripts/qa-dari-semantic-report.js [--severity high] [--lang ar]
//                    [--type OMISSION] [--md logs/qa-semantic.md] [--full]
const path = require('path');
const fs = require('fs');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

const SRC = path.join(__dirname, '..', 'logs', 'qa-semantic.jsonl');
const rows = fs.readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const fSev = arg('severity', ''); const fLang = arg('lang', ''); const fType = arg('type', '');
const full = process.argv.includes('--full');

const flat = [];
for (const r of rows) {
    for (const it of r.issues || []) {
        if (fSev && it.severity !== fSev) continue;
        if (fLang && r.lang !== fLang) continue;
        if (fType && it.type !== fType) continue;
        flat.push({ post: r.name, postId: r.postId, lang: r.lang, ...it });
    }
}

const count = (key) => flat.reduce((a, x) => { a[x[key]] = (a[x[key]] || 0) + 1; return a; }, {});
const show = (title, obj) => {
    console.log(`\n## ${title}`);
    Object.entries(obj).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(k).padEnd(16)} ${v}`));
};

console.log(`# L2 의미 검수 요약 — 판정 ${rows.length}건 / 지적 ${flat.length}건`);
show('심각도', count('severity'));
show('유형', count('type'));
show('언어', count('lang'));
show('작품(상위 12)', Object.fromEntries(Object.entries(count('post')).sort((a, b) => b[1] - a[1]).slice(0, 12)));

const high = flat.filter((x) => x.severity === 'high');
console.log(`\n## high 지적 ${high.length}건${full ? '' : ' (상위 40건 — 전체는 --full)'}`);
for (const x of (full ? high : high.slice(0, 40))) {
    console.log(`\n[${x.lang}] ${x.post} · ${x.type}`);
    console.log(`  EN : ${String(x.source || '').replace(/\s+/g, ' ').slice(0, 150)}`);
    console.log(`  TGT: ${String(x.target || '').replace(/\s+/g, ' ').slice(0, 150)}`);
    console.log(`  WHY: ${String(x.why || '').replace(/\s+/g, ' ').slice(0, 180)}`);
}

const md = arg('md', '');
if (md) {
    const abs = path.isAbsolute(md) ? md : path.join(__dirname, '..', md);
    const lines = ['# Dari 리뷰 L2 의미 검수', '', `- 판정 ${rows.length}건 / 지적 ${flat.length}건 (high ${high.length})`, ''];
    const byPost = {};
    flat.forEach((x) => { (byPost[`${x.post} (${x.postId})`] = byPost[`${x.post} (${x.postId})`] || []).push(x); });
    for (const [k, v] of Object.entries(byPost)) {
        lines.push(`## ${k}`, '', '| 언어 | 심각도 | 유형 | EN | 번역 | 사유 |', '|---|---|---|---|---|---|');
        v.forEach((x) => lines.push(`| ${x.lang} | ${x.severity} | ${x.type} | ${String(x.source || '').replace(/[|\n]/g, ' ').slice(0, 90)} | ${String(x.target || '').replace(/[|\n]/g, ' ').slice(0, 90)} | ${String(x.why || '').replace(/[|\n]/g, ' ').slice(0, 130)} |`));
        lines.push('');
    }
    fs.writeFileSync(abs, lines.join('\n'), 'utf8');
    console.log(`\n리포트 저장: ${abs}`);
}
