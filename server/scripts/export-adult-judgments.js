// ── 성인물 AI 판정 결과 → 검수용 Markdown ───────────────────────────────────
// rejudge-hidden.js / cron 게이트가 문서에 남긴 adultAI 판정을 표로 뽑는다.
// HTML 리포트(flag-adult-titles.js)와 달리 **판정 근거를 그대로 읽는 용도**다 —
// 사람이 훑으면서 오탐을 골라 adult-manual.json의 allow/hide에 넣는 것이 목적.
//
// 사용법:
//   node scripts/export-adult-judgments.js                 # 전체(adultAI 있는 문서 전부)
//   node scripts/export-adult-judgments.js --only adult    # 성인물 판정만
//   node scripts/export-adult-judgments.js --out logs/x.md
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    only: arg('only', ''),                    // '' | 'adult' | 'clean'
    out: arg('out', ''),
};

// 표 셀 안에서 깨지는 문자 정리 — 파이프는 이스케이프, 개행은 공백으로.
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');

    // adultAI는 판정을 받은 문서에만 있다. 컬렉션 전체를 마스크로 읽어 필터링한다
    // (adultAI에 부등호 인덱스를 만들 이유가 없다 — 1회성 리포트라 스캔이 더 싸다).
    const snap = await kcultureDb.collection('titles')
        .select('media', 'hidden', 'hiddenBy', 'hiddenReason', 'isVideo', 'searchTitle', 'adultAI')
        .get();

    const rows = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        if (!x.adultAI?.verdict) return;
        if (opts.only && x.adultAI.verdict !== opts.only) return;
        rows.push({
            id: d.id,
            media: x.media === 'movie' ? 'movie' : 'tv',
            ko: x.searchTitle?.ko || x.searchTitle?.en || Object.values(x.searchTitle || {})[0] || '',
            verdict: x.adultAI.verdict,
            conf: Number(x.adultAI.confidence || 0),
            reason: x.adultAI.reason || '',
            signals: Array.isArray(x.adultAI.signals) ? x.adultAI.signals.join(', ') : '',
            hidden: x.hidden === true,
            hiddenBy: x.hiddenBy || '',
            isVideo: x.isVideo === true,
            at: x.adultAI.at?.toDate?.().toISOString().slice(0, 16).replace('T', ' ') || '',
        });
    });

    // 성인물 먼저(확신도 높은 순) → 정상(확신도 낮은 순 = 애매했던 것부터 보게)
    rows.sort((a, b) => {
        if (a.verdict !== b.verdict) return a.verdict === 'adult' ? -1 : 1;
        return a.verdict === 'adult' ? b.conf - a.conf : a.conf - b.conf;
    });

    const adult = rows.filter((r) => r.verdict === 'adult');
    const clean = rows.filter((r) => r.verdict === 'clean');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const table = (list) => [
        '| # | 판정 | 확신 | id | 제목 | 종류 | video | 현재 | 판정 근거 |',
        '|---|---|---|---|---|---|---|---|---|',
        ...list.map((r, i) => `| ${i + 1} | ${r.verdict === 'adult' ? '🚫 성인물' : '👁 정상'} | ${r.conf.toFixed(2)} `
            + `| [${r.id}](https://www.themoviedb.org/${r.media}/${r.id}) | ${cell(r.ko) || '_(제목 없음)_'} | ${r.media} `
            + `| ${r.isVideo ? 'Y' : ''} | ${r.hidden ? '숨김' : '노출'} | ${cell(r.reason)} |`),
    ].join('\n');

    const md = [
        `# 성인물 AI 판정 결과 — ${rows.length}편`,
        '',
        `생성 ${stamp} · 판정기 Gemini(lib/adultJudge.js) · 2단 판정(명백한 성인물만 adult, 나머지 clean)`,
        '',
        `| 판정 | 건수 | 앱 노출 |`,
        `|---|---|---|`,
        `| 🚫 성인물 | ${adult.length} | 숨김 |`,
        `| 👁 정상 | ${clean.length} | 노출 |`,
        '',
        '**오탐을 찾으면** `server/scripts/adult-manual.json` 의 `allow`(노출 강제) 또는 `hide`(숨김 강제)에',
        'id를 넣으세요. 수동 목록은 규칙·AI 판정보다 **항상 우선**하며, 이후 실행에서 재판정되지 않습니다.',
        '',
        `## 🚫 성인물 판정 ${adult.length}편`,
        '',
        adult.length ? table(adult) : '_없음_',
        '',
        `## 👁 정상 판정 ${clean.length}편`,
        '',
        '확신도가 낮은 순으로 정렬했다 — **위쪽이 판정이 애매했던 것들**이라 놓친 성인물이 있다면 거기 있다.',
        '',
        clean.length ? table(clean) : '_없음_',
        '',
    ].join('\n');

    const dir = path.join(__dirname, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = opts.out
        ? path.resolve(opts.out)
        : path.join(dir, `adult-judgments-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`);
    fs.writeFileSync(file, md, 'utf8');

    console.log(`\n  판정 ${rows.length}편 (성인물 ${adult.length} · 정상 ${clean.length})`);
    console.log(`  📄 ${file}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
