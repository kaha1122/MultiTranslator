// ── 사전번역 마무리 러너 — Firestore를 직접 훑어 미완 작품만 채운다 ──────────
// backfill-by-year.js와 목적은 같지만 **대상 열거 방식이 반대**다.
//   · backfill-by-year : TMDB discover(연도 윈도우)로 열거 → 연도를 훑는다
//   · 이 스크립트      : Firestore `titles`를 직접 훑는다 → **우리가 실제로 가진 것**을 훑는다
//
// 왜 필요한가 (2026-07-27 실측)
//   연도 열거는 100%를 닫지 못한다. discover의 연도 필터가 쓰는 날짜와 우리가 저장한 날짜가
//   어긋나는 작품(방영일 갱신·지역 개봉일 차이 등)은 **어느 연도 실행으로도 방문되지 않는다**.
//   1950~2026 전 연도를 다 돌린 뒤에도 228편이 미완으로 남았던 이유이며, 날짜가 아예 없는
//   문서는 원리적으로 영원히 안 걸린다. 이 스크립트는 그 구멍을 정확히 메운다.
//
// 무엇을 대상으로 하나
//   `metaLangs`가 TARGETS(12개 UI 언어) 전부를 갖지 못한 문서. 단 아래는 제외한다:
//     · metaNoSource=true → TMDB에 번역 원본(영어·원어·네이티브) 자체가 없어 **영구 불가**.
//       재시도해도 못 채우고 TMDB·Gemini 호출만 낭비한다(2026-07-27 기준 228편).
//     · media 없음 → /{media}/{id} 조회가 불가능.
//
// 비용: 열거는 필드 마스크(select) 덕에 문서당 수십 바이트다. 2.4만 문서 스캔 ≈ Firestore 읽기
//       2.4만 건 ≈ $0.015. 처리 대상만 TMDB 1회 + (부족분이 있으면) Gemini 1회.
//
// 사용법 (server/.env 필요: TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64):
//   cd server
//   node scripts/fill-missing-langs.js --dry            # 대상만 집계(쓰기 없음) — 먼저 이걸 권장
//   node scripts/fill-missing-langs.js                  # 실행
//   node scripts/fill-missing-langs.js --concurrency 8
// 옵션:
//   --dry               대상 집계·목록만 출력하고 종료(TMDB·Gemini·쓰기 전부 없음)
//   --concurrency 4     동시 처리 수 (기본 4)
//   --limit N           처리 상한 (시범용)
//   --include-nosource  metaNoSource 문서도 재시도(TMDB에 원문이 새로 생겼을 때만 의미)
//
// 멱등 — 중단·재실행 안전. 로그: 터미널 + scripts/logs/fill-missing-*.log
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { processTitle, TARGETS } = require('../lib/tmdbBackfill');
const { kcultureDb } = require('../config/firebaseKculture');

// ── 인자 파싱 ────────────────────────────────────────────────────────────────
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const opts = {
    concurrency: parseInt(arg('concurrency', '4'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    dry: process.argv.includes('--dry'),
    includeNoSource: process.argv.includes('--include-nosource'),
};

// ── 색상 (터미널만, 로그 파일엔 ANSI 제거 후 기록) ───────────────────────────
const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36');

const LOG_DIR = path.join(__dirname, 'logs');
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

// ── 대상 열거 ────────────────────────────────────────────────────────────────
// select()로 필요한 5개 필드만 받는다 — meta(출연·이미지…)까지 끌어오면 문서당 평균 5.7KB라
// 2.4만 건이면 약 140MB를 받게 된다(2026-07-27 실측). 마스크는 선택이 아니라 필수다.
async function collectTargets() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 환경변수 필요');
    log(dim('  Firestore titles 스캔 중… (필드 마스크 — 문서당 수십 바이트)'));
    const snap = await kcultureDb.collection('titles')
        .select('metaLangs', 'media', 'metaNoSource', 'metaTranslated', 'searchTitle')
        .get();

    const targets = [];
    const stat = { total: 0, complete: 0, noSource: 0, noMedia: 0 };
    snap.forEach((d) => {
        stat.total++;
        const x = d.data() || {};
        const langs = x.metaLangs || [];
        if (TARGETS.every((t) => langs.includes(t.code))) { stat.complete++; return; }
        if (x.metaNoSource && !opts.includeNoSource) { stat.noSource++; return; }
        if (x.media !== 'tv' && x.media !== 'movie') { stat.noMedia++; return; }
        targets.push({
            id: d.id,
            media: x.media,
            have: langs.length,
            missing: TARGETS.filter((t) => !langs.includes(t.code)).map((t) => t.code),
            // 표시용 이름 — searchTitle은 {lang: 제목} 맵. 영어 우선, 없으면 아무 언어나.
            name: x.searchTitle?.en || Object.values(x.searchTitle || {})[0] || '(제목 미상)',
        });
    });
    return { targets, stat };
}

// ── 본체 ────────────────────────────────────────────────────────────────────
async function main() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* 무시 */ }
    logFile = path.join(LOG_DIR, `fill-missing-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

    log('');
    log(bold('▶ 사전번역 마무리 — Firestore 직접 스캔'));
    log(`  동시 ${opts.concurrency}${opts.limit ? ` · limit ${opts.limit}` : ''}`
        + (opts.dry ? yellow(' · DRY(집계만)') : '')
        + (opts.includeNoSource ? yellow(' · noSource 포함') : ''));
    log(dim(`  로그 파일: ${logFile}`));
    log('');

    const t0 = Date.now();
    const { targets, stat } = await collectTargets();

    log('');
    log(bold('━━━━━━━━━━ 스캔 결과 ━━━━━━━━━━'));
    log(`  전체 ${stat.total}편`);
    log(`  ${green('완비')} ${stat.complete}편 (12개 언어 전부)`);
    log(`  ${dim('제외')} 번역불가(metaNoSource) ${stat.noSource}편` + dim(' — TMDB에 원본 자체가 없어 영구 불가'));
    if (stat.noMedia) log(`  ${dim('제외')} media 없음 ${stat.noMedia}편`);
    log(`  ${yellow('대상')} ${bold(targets.length)}편`);

    if (targets.length) {
        // 어떤 언어가 얼마나 비었는지 — 파이프라인 어디가 새는지 보는 지표
        const byLang = {};
        for (const t of targets) for (const c of t.missing) byLang[c] = (byLang[c] || 0) + 1;
        log(dim(`  누락 언어: ${Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')}`));
    }

    if (!targets.length) { log(''); log(green('  채울 것이 없습니다 — 이미 전부 완비.')); return; }

    if (opts.dry) {
        log('');
        log(bold('  DRY — 상위 30편 미리보기'));
        for (const t of targets.slice(0, 30)) {
            log(`    ${t.id} 「${t.name}」 ${t.media} · 보유 ${t.have} · 누락 ${t.missing.join(',')}`);
        }
        if (targets.length > 30) log(dim(`    … 외 ${targets.length - 30}편`));
        log('');
        log(dim('  실제 실행: 위 명령에서 --dry 를 빼세요.'));
        return;
    }

    const capped = opts.limit ? targets.slice(0, opts.limit) : targets;
    log('');
    log(bold(`━━━━━━━━━━ 처리 시작 (${capped.length}편) ━━━━━━━━━━`));

    const s = { done: 0, skipped: 0, partial: 0, gemini: 0, errors: 0 };
    const stillPartial = [];
    let idx = 0, counted = 0;
    const t1 = Date.now();

    async function worker() {
        while (idx < capped.length) {
            const it = capped[idx++];
            const ts = Date.now();
            try {
                const r = await processTitle(it.media, it.id);
                counted++;
                if (r.skipped) {
                    // 스캔~처리 사이에 다른 실행이 채운 경우(경합) — 정상.
                    s.skipped++;
                } else {
                    s.done++; s.gemini += r.geminiUsed;
                    if (!r.complete) { s.partial++; stillPartial.push(it.id); }
                    const secs = ((Date.now() - ts) / 1000).toFixed(1);
                    const mark = r.complete ? green('✔') : yellow('⚠');
                    const note = r.complete ? '' : yellow(' (부분 — 원본 부족 가능성, 재실행 시 자동 재시도)');
                    log(`  ${mark} [${counted}/${capped.length}] ${it.id} 「${it.name}」 ${dim(`누락 ${it.missing.join(',')} →`)} langs=${r.langs} gemini=${r.geminiUsed} ${dim(secs + 's')}${note}`);
                }
            } catch (e) {
                counted++; s.errors++;
                log(`  ${red('✖')} [${counted}/${capped.length}] ${it.id} 「${it.name}」 ${red(e.message)}`);
            }
            if (counted % 50 === 0 && counted < capped.length) {
                const el = (Date.now() - t1) / 1000;
                log(cyan(`  ── 진행 ${counted}/${capped.length} (${Math.round((counted / capped.length) * 100)}%) · 경과 ${fmtDur(el)} · 남은 예상 ${fmtDur((capped.length - counted) / (counted / el))}`));
            }
        }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    log('');
    log(bold('══════════════ 요약 ══════════════'));
    const summary = `  처리 ${capped.length}편 — 완료 ${s.done - s.partial} · 부분 ${s.partial} · skip ${s.skipped} · 오류 ${s.errors} · Gemini ${s.gemini}언어 · ${fmtDur((Date.now() - t0) / 1000)}`;
    log(s.errors || s.partial ? yellow(summary) : green(summary));

    // 부분 실패는 조용히 넘기지 않는다 — 남은 게 있으면 무엇이 남았는지 id로 남긴다.
    if (stillPartial.length) {
        log('');
        log(yellow(`  ⚠ 여전히 부분인 작품 ${stillPartial.length}편: ${stillPartial.slice(0, 20).join(', ')}${stillPartial.length > 20 ? ' …' : ''}`));
        log(dim('    대개 TMDB에 번역 원본이 빈약한 마이너 작품입니다. 한 번 더 돌려도 안 채워지면'));
        log(dim('    metaNoSource로 굳는 것이 정상이며, sitemap·색인 품질에는 영향이 없습니다.'));
    }
    log(dim(`  검수용 로그: ${logFile}`));
    log('');
}

main().then(() => process.exit(0)).catch((e) => {
    log(red(`\n✖ 실패: ${e.message}`));
    process.exit(1);
});
