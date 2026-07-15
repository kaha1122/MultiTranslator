// ── TMDB K-Content 메타 사전번역 — 연도별 백필 러너 ──────────────────────────
// 전체 ~25k 작품을 한 번에 돌리기 부담스러울 때, 연도 단위로 틈틈이 나눠 실행하는 스크립트.
// 멱등: 이미 번역된 작품(metaTranslated=true)은 skip → 같은 연도를 다시 돌려도 안전.
//
// 사용법 (server/.env 필요: TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64):
//   cd server
//   node scripts/backfill-by-year.js --year 2026              # 한 해만
//   node scripts/backfill-by-year.js --year 2020-2024         # 범위(최신 연도부터 역순 처리)
//   node scripts/backfill-by-year.js --year 2024 --media tv   # tv|movie|both (기본 both)
//   node scripts/backfill-by-year.js --status                 # 연도별 완료 현황 표
// 옵션:
//   --concurrency 4   동시 처리 수 (기본 4)
//   --limit 50        연도당 처리 상한 (시범용)
//   --force           이미 번역된 작품도 재번역
//
// 로그: 터미널 + scripts/logs/backfill-*.log 에 동일 내용 기록(검수용).
// 현황: scripts/.backfill-years.json 에 연도/미디어별 결과 저장 → --status 로 확인.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { processTitle, enumerateIds } = require('../lib/tmdbBackfill');

// ── 인자 파싱 ────────────────────────────────────────────────────────────────
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const opts = {
    media: arg('media', 'both'),
    concurrency: parseInt(arg('concurrency', '4'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    force: process.argv.includes('--force'),
};
const MEDIAS = opts.media === 'both' ? ['tv', 'movie'] : [opts.media];

// ── 색상 (터미널만, 로그 파일엔 ANSI 제거 후 기록) ───────────────────────────
const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36');

// ── 상태 파일(연도별 완료 현황) + 로그 파일 ──────────────────────────────────
const STATE_FILE = path.join(__dirname, '.backfill-years.json');
const LOG_DIR = path.join(__dirname, 'logs');
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

let logFile = null;
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
function log(line = '') {
    console.log(line);
    if (logFile) { try { fs.appendFileSync(logFile, stripAnsi(line) + '\n'); } catch { /* 로그파일 실패는 무시 */ } }
}

function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}시간 ${m}분`;
    if (m) return `${m}분 ${s}초`;
    return `${s}초`;
}

// ── --status: 연도별 완료 현황 표 ────────────────────────────────────────────
function printStatus() {
    const state = loadState();
    const keys = Object.keys(state);
    if (!keys.length) { console.log('아직 실행 기록이 없습니다. 예: node scripts/backfill-by-year.js --year 2026'); return; }
    const years = [...new Set(keys.map((k) => k.split('/')[0]))].sort((a, b) => b - a);
    console.log(bold('\n연도별 사전번역 현황 (.backfill-years.json)'));
    console.log(dim('연도    미디어  대상    신규   skip   부분  오류  Gemini언어  실행시각'));
    for (const y of years) {
        for (const m of ['tv', 'movie']) {
            const r = state[`${y}/${m}`];
            if (!r) continue;
            const at = (r.at || '').slice(0, 16).replace('T', ' ');
            const lim = r.limited ? yellow(' (limit)') : '';
            console.log(
                `${y}   ${m.padEnd(6)} ${String(r.total).padStart(5)}  ${green(String(r.done).padStart(5))}  ${String(r.skipped).padStart(5)}  ` +
                `${(r.partial ? yellow(String(r.partial).padStart(4)) : String(r.partial).padStart(4))}  ${(r.errors ? red(String(r.errors).padStart(4)) : String(r.errors).padStart(4))}  ` +
                `${String(r.gemini).padStart(6)}  ${dim(at)}${lim}`
            );
        }
    }
    console.log(dim('\n※ 부분/오류가 남은 연도는 같은 명령 재실행으로 이어서 처리됩니다(멱등).'));
}

// ── 연도 하나 × 미디어 하나 처리 ─────────────────────────────────────────────
async function runYear(year, media, state) {
    log('');
    log(bold(`━━━━━━━━━━ ${year} · ${media.toUpperCase()} ━━━━━━━━━━`));
    const t0 = Date.now();
    log(dim(`  TMDB discover로 ${year}년 작품 목록 수집 중…`));

    const seen = new Set(); const items = [];
    for await (const it of enumerateIds(media, year, year)) {
        if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    }
    const capped = opts.limit ? items.slice(0, opts.limit) : items;
    log(`  대상 ${bold(items.length)}편${capped.length !== items.length ? yellow(` → limit ${capped.length}편만 처리`) : ''}`);
    if (!capped.length) { log(dim('  처리할 작품 없음 — 다음으로.')); return { total: 0, done: 0, skipped: 0, partial: 0, gemini: 0, errors: 0 }; }

    const stat = { total: capped.length, done: 0, skipped: 0, partial: 0, gemini: 0, errors: 0 };
    let idx = 0, counted = 0;

    async function worker() {
        while (idx < capped.length) {
            const it = capped[idx++];
            const ts = Date.now();
            try {
                const r = await processTitle(media, it.id, { force: opts.force });
                counted++;
                if (r.skipped) {
                    stat.skipped++;
                    if (stat.skipped % 100 === 0) log(dim(`  · 기번역 skip 누적 ${stat.skipped}편`));
                } else {
                    stat.done++; stat.gemini += r.geminiUsed;
                    if (!r.complete) stat.partial++;
                    const secs = ((Date.now() - ts) / 1000).toFixed(1);
                    const mark = r.complete ? green('✔') : yellow('⚠');
                    const partialNote = r.complete ? '' : yellow(' (부분 — 재실행 시 자동 재시도)');
                    log(`  ${mark} [${counted}/${capped.length}] ${it.id} 「${it.name}」 langs=${r.langs} gemini=${r.geminiUsed} ${dim(secs + 's')}${partialNote}`);
                }
            } catch (e) {
                counted++; stat.errors++;
                log(`  ${red('✖')} [${counted}/${capped.length}] ${it.id} 「${it.name}」 ${red(e.message)}`);
            }
            if (counted % 50 === 0 && counted < capped.length) {
                const elapsed = (Date.now() - t0) / 1000;
                const eta = (capped.length - counted) / (counted / elapsed);
                log(cyan(`  ── 진행 ${counted}/${capped.length} (${Math.round((counted / capped.length) * 100)}%) · 경과 ${fmtDur(elapsed)} · 남은 예상 ${fmtDur(eta)} · 신규 ${stat.done} / skip ${stat.skipped} / 오류 ${stat.errors}`));
            }
        }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    const el = fmtDur((Date.now() - t0) / 1000);
    const summary = `✅ ${year} ${media} 완료 — 대상 ${stat.total} · 신규번역 ${stat.done}` +
        (stat.partial ? ` (부분 ${stat.partial})` : '') + ` · skip ${stat.skipped} · 오류 ${stat.errors} · Gemini번역 ${stat.gemini}언어 · ${el}`;
    log(bold(stat.errors || stat.partial ? yellow(summary) : green(summary)));

    state[`${year}/${media}`] = { ...stat, at: new Date().toISOString(), ...(opts.limit ? { limited: true } : {}) };
    saveState(state);
    return stat;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
    if (process.argv.includes('--status')) { printStatus(); return; }

    const yearArg = arg('year');
    if (!yearArg) {
        console.log('사용법: node scripts/backfill-by-year.js --year 2026 [--year 2020-2024] [--media tv|movie|both] [--concurrency 4] [--limit 50] [--force]');
        console.log('        node scripts/backfill-by-year.js --status   (연도별 완료 현황)');
        printStatus();
        process.exitCode = 1;
        return;
    }
    const mm = String(yearArg).match(/^(\d{4})(?:-(\d{4}))?$/);
    if (!mm) { console.error(`--year 형식 오류: "${yearArg}" (예: 2026 또는 2020-2024)`); process.exit(1); }
    const [a, b] = [parseInt(mm[1], 10), mm[2] ? parseInt(mm[2], 10) : parseInt(mm[1], 10)];
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    const years = []; for (let y = to; y >= from; y--) years.push(y); // 최신 연도부터

    fs.mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logFile = path.join(LOG_DIR, `backfill-${from === to ? from : `${from}-${to}`}-${stamp}.log`);

    log(bold(`\n▶ 연도별 사전번역 시작`));
    log(`  연도: ${years.join(', ')} · 미디어: ${MEDIAS.join('+')} · 동시 ${opts.concurrency}` +
        (opts.limit ? ` · limit ${opts.limit}/연도` : '') + (opts.force ? red(' · FORCE(재번역)') : ''));
    log(dim(`  로그 파일: ${logFile}`));

    process.on('SIGINT', () => {
        log(red('\n⏹ 사용자 중단(Ctrl+C) — 멱등이므로 같은 명령을 재실행하면 남은 작품만 이어서 처리됩니다.'));
        process.exit(130);
    });

    const state = loadState();
    const grand = { total: 0, done: 0, skipped: 0, partial: 0, gemini: 0, errors: 0 };
    const t0 = Date.now();
    for (const y of years) {
        for (const m of MEDIAS) {
            const s = await runYear(y, m, state);
            for (const k of Object.keys(grand)) grand[k] += s[k];
        }
    }

    log('');
    log(bold('══════════════ 전체 요약 ══════════════'));
    log(`  연도 ${years.length}개 × ${MEDIAS.join('+')} · 대상 ${grand.total}편`);
    log(`  신규번역 ${green(grand.done)}${grand.partial ? ` (부분 ${yellow(grand.partial)})` : ''} · skip ${grand.skipped} · 오류 ${grand.errors ? red(grand.errors) : 0} · Gemini번역 ${grand.gemini}언어`);
    log(`  소요 ${fmtDur((Date.now() - t0) / 1000)} · 검수용 로그: ${logFile}`);
    if (grand.partial || grand.errors) log(yellow('  ⚠ 부분/오류 잔여분은 같은 명령 재실행(멱등) 또는 runRetry cron으로 자동 재시도됩니다.'));
    log(dim('  현황 확인: node scripts/backfill-by-year.js --status'));
}

main().catch((e) => { log(red(`[backfill-by-year] FAIL ${e.stack || e.message}`)); process.exit(1); });
