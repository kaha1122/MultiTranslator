// ── 카탈로그 전량 재구축 러너 — 한국어 피벗 V2 (2026-07-28 재정비) ──────────────
// Firestore `titles`(재정비 후 18,325편 — 전부 한국어 원제 보유)를 훑어, V2 마커(metaV=2)가
// 없거나 미완(metaTranslated=false)인 작품을 lib/tmdbBackfill.js `processTitle`(한국어 피벗)로
// 재번역한다. 무엇을 어떻게 채우는지는 전부 코어가 결정한다 — 이 러너는 열거·진행 표시만.
//
// V1 대비 무엇이 다시 만들어지나:
//   · 제목: ko=원제 / 그 외 11개 언어 = 검증 통과한 TMDB 공식 제목 우선, 아니면 원제→Gemini
//   · 줄거리: ko 피벗(없으면 en에서 전 언어 일괄) — 제목란 줄거리·원어 오염·빈 제목 전부 청소
//   · translations 문서는 전체 교체(과거 쓰레기 필드 제거)
//
// 사용법 (server/.env 필요: TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64):
//   node scripts/rebuild-ko-pivot.js --dry              # 대상 집계만(쓰기·호출 없음)
//   node scripts/rebuild-ko-pivot.js --limit 30         # 시범 실행(검수용)
//   node scripts/rebuild-ko-pivot.js --concurrency 8    # 전량 실행
// 옵션: --dry · --limit N · --concurrency N(기본 4) · --force(V2 완료 문서도 재처리 — 통상 불필요)
//
// 멱등 — 중단·재실행 안전(완료 문서는 코어의 스킵 게이트가 걸러줌). 로그: scripts/logs/rebuild-*.log
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { processTitle } = require('../lib/tmdbBackfill');
const { kcultureDb } = require('../config/firebaseKculture');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    concurrency: parseInt(arg('concurrency', '4'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    dry: process.argv.includes('--dry'),
    force: process.argv.includes('--force'),
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36');

const LOG_DIR = path.join(__dirname, 'logs');
let logFile = null;
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
function log(line = '') {
    console.log(line);
    if (logFile) { try { fs.appendFileSync(logFile, stripAnsi(line) + '\n'); } catch { /* 무시 */ } }
}
function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), mn = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}시간 ${mn}분`;
    if (mn) return `${mn}분 ${s}초`;
    return `${s}초`;
}

// 대상 열거 — 필드 마스크(select)로 문서당 수십 바이트만. meta를 끌어오면 문서당 5.7KB다.
async function collectTargets() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    log(dim('  Firestore titles 스캔 중… (필드 마스크)'));
    const snap = await kcultureDb.collection('titles')
        .select('metaV', 'metaTranslated', 'media', 'searchTitle')
        .get();
    const targets = [];
    const stat = { total: 0, doneV2: 0, noMedia: 0 };
    snap.forEach((d) => {
        stat.total++;
        const x = d.data() || {};
        if (!opts.force && x.metaV === 2 && x.metaTranslated) { stat.doneV2++; return; }
        if (x.media !== 'tv' && x.media !== 'movie') { stat.noMedia++; return; }
        targets.push({
            id: d.id, media: x.media,
            name: x.searchTitle?.ko || x.searchTitle?.en || Object.values(x.searchTitle || {})[0] || '(제목 미상)',
        });
    });
    return { targets, stat };
}

async function main() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* 무시 */ }
    logFile = path.join(LOG_DIR, `rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

    log('');
    log(bold('▶ 카탈로그 재구축 — 한국어 피벗 V2'));
    log(`  동시 ${opts.concurrency}${opts.limit ? ` · limit ${opts.limit}` : ''}`
        + (opts.dry ? yellow(' · DRY(집계만)') : '') + (opts.force ? yellow(' · FORCE') : ''));
    log(dim(`  로그 파일: ${logFile}`));
    log('');

    const t0 = Date.now();
    const { targets, stat } = await collectTargets();

    log(bold('━━━━━━━━━━ 스캔 결과 ━━━━━━━━━━'));
    log(`  전체 ${stat.total.toLocaleString()}편`);
    log(`  ${green('V2 완료')} ${stat.doneV2.toLocaleString()}편 (재실행 시 자동 skip)`);
    if (stat.noMedia) log(`  ${dim('제외')} media 없음 ${stat.noMedia}편`);
    log(`  ${yellow('대상')} ${bold(targets.length.toLocaleString())}편`);

    if (!targets.length) { log(''); log(green('  처리할 것이 없습니다 — 전부 V2 완료.')); return; }
    if (opts.dry) { log(''); log(dim('  실제 실행: --dry 를 빼세요. 시범은 --limit 30 권장.')); return; }

    const capped = opts.limit ? targets.slice(0, opts.limit) : targets;
    log('');
    log(bold(`━━━━━━━━━━ 처리 시작 (${capped.length.toLocaleString()}편) ━━━━━━━━━━`));

    const s = { done: 0, skipped: 0, partial: 0, gemini: 0, errors: 0 };
    const stillPartial = [], failed = [];
    let idx = 0, counted = 0;
    const t1 = Date.now();

    async function worker() {
        while (idx < capped.length) {
            const it = capped[idx++];
            const ts = Date.now();
            try {
                const r = await processTitle(it.media, it.id, { force: opts.force });
                counted++;
                if (r.skipped) s.skipped++; // 스캔~처리 사이 다른 실행이 완료(경합) 또는 excluded — 정상
                else {
                    s.done++; s.gemini += r.geminiUsed;
                    if (!r.complete) { s.partial++; stillPartial.push(it.id); }
                    const secs = ((Date.now() - ts) / 1000).toFixed(1);
                    const mark = r.complete ? green('✔') : yellow('⚠');
                    log(`  ${mark} [${counted}/${capped.length}] ${it.id} 「${it.name}」 gemini=${r.geminiUsed} ${dim(secs + 's')}${r.complete ? '' : yellow(' (부분 — 재실행 시 자동 재시도)')}`);
                }
            } catch (e) {
                counted++; s.errors++; failed.push(it.id);
                log(`  ${red('✖')} [${counted}/${capped.length}] ${it.id} 「${it.name}」 ${red(e.message)}`);
            }
            if (counted % 100 === 0 && counted < capped.length) {
                const el = (Date.now() - t1) / 1000;
                log(cyan(`  ── 진행 ${counted}/${capped.length} (${Math.round((counted / capped.length) * 100)}%) · 경과 ${fmtDur(el)} · 남은 예상 ${fmtDur((capped.length - counted) / (counted / el))} · Gemini ${s.gemini}`));
            }
        }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    log('');
    log(bold('══════════════ 요약 ══════════════'));
    const summary = `  처리 ${capped.length.toLocaleString()}편 — 완료 ${s.done - s.partial} · 부분 ${s.partial} · skip ${s.skipped} · 오류 ${s.errors} · Gemini ${s.gemini}건 · ${fmtDur((Date.now() - t0) / 1000)}`;
    log(s.errors || s.partial ? yellow(summary) : green(summary));
    if (stillPartial.length) log(yellow(`  ⚠ 부분: ${stillPartial.slice(0, 20).join(', ')}${stillPartial.length > 20 ? ' …' : ''} — 재실행 또는 cron runRetry가 마저 채움`));
    if (failed.length) log(red(`  ✖ 오류: ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? ' …' : ''}`));
    log(dim(`  검수용 로그: ${logFile}`));
    log(dim('  ※ 완료 후: KCulture에서 npm run sitemap:refresh(lastmod 갱신) + 커밋'));
    log('');
}

main().then(() => process.exit(0)).catch((e) => {
    log(red(`\n✖ 실패: ${e.message}`));
    process.exit(1);
});
