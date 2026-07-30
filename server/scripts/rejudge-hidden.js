// ── 숨김 작품 AI 재판정 (문맥 판정으로 교정) ────────────────────────────────
// 규칙만으로 숨겨진 작품을 Gemini 문맥 판정(lib/adultJudge.js)에 다시 걸어, 잘못 숨긴 것을 푼다.
//
// 왜 만들었나 (2026-07-30)
//   direct-to-video(`video:true`)를 전량 숨김으로 처리했더니 678편이 숨겨졌는데, 그중 성인 신호가
//   있는 건 33편뿐이었고 나머지 645편은 **BTS·SMTOWN·ITZY·임영웅 공연 실황과 팬 다큐**였다.
//   K-Contents 앱에서 그건 핵심 자산이라 정책을 철회했고, 이미 숨긴 것들을 되돌릴 경로가 필요했다.
//
// 동작
//   대상: titles 중 hidden=true 이고 hiddenBy가 auto:* 인 것(사람 판정 'manual'은 건드리지 않는다).
//   판정: TMDB 상세 1회 + Gemini 1회 → adult/unsure면 숨김 유지, clean이면 **노출로 되돌림**.
//   기록: adultAI(판정·근거)를 문서에 남겨 재실행 시 재호출하지 않는다(--force로 무시).
//
// ⚠ 사람이 이미 판정한 것은 절대 건드리지 않는다:
//   · hiddenBy='manual'  (apply-adult-verdicts.js가 찍은 것)
//   · adult-manual.json의 hide/allow에 있는 id
//
// 사용법:
//   node scripts/rejudge-hidden.js --dry              # 판정만(쓰기 없음) — 먼저 이걸 권장
//   node scripts/rejudge-hidden.js                    # 실제 반영 + 인덱스 재생성 + 서버 알림
//   node scripts/rejudge-hidden.js --limit 50         # 표본만
// 옵션: --concurrency 6 · --force(기존 adultAI 무시하고 재판정) · --no-refresh
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');
const { judgeAdultAI } = require('../lib/adultJudge');
const adultRules = require('../lib/adultRules');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const opts = {
    concurrency: parseInt(arg('concurrency', '6'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    dry: process.argv.includes('--dry'),
    force: process.argv.includes('--force'),
    refresh: !process.argv.includes('--no-refresh'),
};

const tty = process.stdout.isTTY;
const paint = (c) => (s) => (tty ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36');

async function tmdb(p, params = {}) {
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${p}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    return r.json();
}

async function main() {
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    if (!TMDB_KEY) throw new Error('TMDB_API_KEY 없음');
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 없음 — 문맥 판정 불가');

    const manual = adultRules.loadManual();
    const snap = await kcultureDb.collection('titles').where('hidden', '==', true)
        .select('media', 'hiddenBy', 'hiddenReason', 'searchTitle', 'adultAI').get();

    let rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => String(r.hiddenBy || '').startsWith('auto:'))          // 사람 판정 보호
        .filter((r) => !manual.hide.has(r.id) && !manual.allow.has(r.id))     // 수동 목록 보호
        .filter((r) => opts.force || !r.adultAI);                             // 이미 판정된 건 skip
    if (opts.limit) rows = rows.slice(0, opts.limit);

    console.log(`\n${bold('▶ 숨김 작품 AI 재판정')}${opts.dry ? yellow(' · DRY(쓰기 없음)') : ''}`);
    console.log(dim(`  전체 숨김 ${snap.size}편 중 대상 ${rows.length}편 (사람 판정·수동목록·판정완료 제외)`));
    console.log(dim(`  동시 ${opts.concurrency} · 작품당 TMDB 1회 + Gemini 1회\n`));

    const stat = { adult: 0, clean: 0, failed: 0, unhidden: 0 };
    let i = 0, done = 0;
    const t0 = Date.now();

    async function worker() {
        while (i < rows.length) {
            const r = rows[i++];
            const media = r.media === 'movie' ? 'movie' : 'tv';
            const ko = r.searchTitle?.ko || r.searchTitle?.en || '';
            try {
                const append = media === 'movie' ? 'keywords,release_dates' : 'keywords,content_ratings';
                const det = await tmdb(`/${media}/${r.id}`, { language: 'ko-KR', append_to_response: append });
                const ai = await judgeAdultAI(media, det, { koTitle: ko });
                done++;
                if (!ai) {
                    // 판정 실패 → **숨김 유지**. AI를 못 불렀다는 사실이 노출 근거가 될 수 없다.
                    stat.failed++;
                    console.log(`  ${red('?')} ${r.id.padEnd(9)} ${ko.slice(0, 26).padEnd(28)} ${dim('판정 실패 — 숨김 유지')}`);
                    continue;
                }
                stat[ai.verdict]++;
                // 명백한 성인물만 숨김 유지. 그 외는 전부 노출로 되돌린다(중간 등급 없음).
                const keepHidden = ai.verdict === 'adult';
                const mark = keepHidden ? red('🚫 성인물') : green('👁 해제');
                console.log(`  ${mark} ${r.id.padEnd(9)} ${ko.slice(0, 26).padEnd(28)} ${dim(`${ai.confidence.toFixed(2)} · ${ai.reason.slice(0, 60)}`)}`);
                if (!opts.dry) {
                    const patch = { adultAI: { ...ai, model: 'gemini', at: new Date() } };
                    if (keepHidden) {
                        patch.hiddenBy = 'auto:ai';
                        patch.hiddenReason = `ai:adult(${ai.confidence.toFixed(2)})`;
                    } else {
                        // 해제 — hidden 관련 필드를 모두 정리한다. metaTranslated=false로 남아 있으므로
                        // 다음 cron runRetry가 11개 언어 번역을 자동으로 채운다.
                        patch.hidden = false; patch.hiddenReason = null; patch.hiddenBy = null;
                        stat.unhidden++;
                    }
                    await kcultureDb.doc(`titles/${r.id}`).set(patch, { merge: true });
                }
            } catch (e) {
                done++; stat.failed++;
                console.log(`  ${red('✖')} ${r.id.padEnd(9)} ${red(e.message)} ${dim('— 숨김 유지')}`);
            }
            if (done % 50 === 0 && done < rows.length) {
                const el = (Date.now() - t0) / 1000;
                console.log(cyan(`  ── ${done}/${rows.length} · 남은 예상 ${Math.round((rows.length - done) / (done / el) / 60)}분`));
            }
        }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    console.log(`\n${bold('══════ 요약 ══════')}`);
    console.log(`  성인물 ${red(stat.adult)} · 정상(해제) ${green(stat.clean)} · 판정실패 ${stat.failed}`);
    console.log(`  ${opts.dry ? yellow('DRY — 실제 변경 없음') : `실제 해제 ${bold(stat.unhidden)}편`} · ${Math.round((Date.now() - t0) / 1000)}초`);

    if (!opts.dry && opts.refresh) {
        console.log(`\n${bold('▶ 숨김 필터 반영')}`);
        const { refreshHiddenFilter } = require('./refresh-hidden-filter');
        await refreshHiddenFilter();
    } else if (!opts.dry) {
        console.log(yellow('\n  ⚠ --no-refresh — 인덱스 미반영. node scripts/refresh-hidden-filter.js 를 따로 실행하세요.'));
    }
    console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error('\n✖', e.message); process.exit(1); });
