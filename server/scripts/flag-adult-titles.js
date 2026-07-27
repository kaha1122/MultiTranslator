// ── 성인 에로물 플래그 배치 (titles/{id}.hidden) ────────────────────────────
// 앱 표면(검색·탐색·인물·컬렉션)과 sitemap에서 제외할 작품에 hidden=true를 찍는다.
// 실제 필터링은 lib/hiddenTitles.js(서버)와 KCulture scripts/gen-sitemap.mjs가 읽어서 수행한다.
// 문서를 지우지 않는 이유는 ① 되돌릴 수 있어야 하고 ② 이미 저장한 12개 언어 번역을 버릴 이유가
// 없기 때문이다(플래그만 내리면 즉시 복구).
//
// ⚠ 왜 TMDB의 include_adult로 안 되는가 (2026-07-27 실측)
//   한국 소프트코어물 13편을 확인한 결과 **전부 `adult:false`**였고 장르는 Romance/Drama/(없음)였다.
//   TMDB의 adult는 사실상 하드코어 포르노 전용이라 우리 카탈로그에는 무력하다.
//
// ── 판정 규칙 (표본 실측으로 결정) ──────────────────────────────────────────
//   R1  키워드에 softcore/nudity/erotic 계열  → hidden            (성인물 8/13, 정상작 0/6)
//   R2  한국 등급이 18·19·19+·청소년관람불가 **그리고** vote_count < 10  → hidden
//                                                                   (성인물 10/13, 정상작 0/6)
//   ⚠ 등급 단독은 절대 쓰지 않는다 — 「씨받이」(KR 19, vote 267)처럼 **정상 성인영화가 같은 등급**이다.
//     표본이 없다(vote<10)는 조건이 결합돼야 상업 개봉작과 갈린다. 실측에서 성인물은 vote 0~2,
//     정상작은 최소 267이었다 — 이 축이 가장 깨끗하게 갈린다.
//   ⚠ popularity는 쓰지 않는다 — 「반딧불이의 묘」가 0.01이라 정상 명작이 걸린다.
//   R3  등급·키워드 정보가 아예 없고 표본도 없음 → **숨기지 않고** 후보로만 리포트(정밀도 우선).
//
// ── 속도 (2026-07-27 실측 기준) ─────────────────────────────────────────────
//   전수 2.4만편에 TMDB를 다 치면 오래 걸린다. 그럴 필요가 없다 —
//   `titles/{id}.meta`에 이미 keywords·vote_count가 들어 있어 **상당수는 로컬에서 판정**된다:
//     · meta 있고 키워드 적중        → 조회 0 (즉시 숨김)   ≈ 1,193편
//     · meta 있고 vote>=10 + 키워드無 → 조회 0 (즉시 유지)   ≈ 2,489편  (R2가 vote<10 조건이므로)
//     · 그 외(meta 없음 / vote<10)    → 등급 확인용 TMDB 1회 ≈ 20,678편
//   여기에 동시 처리 기본값을 20으로 올려 전수 실행이 5~8분 수준이 되게 했다.
//
// 수동 보정: scripts/adult-manual.json  { "hide": ["123"], "allow": ["456"] }
//   hide = 규칙에 안 걸려도 숨김 / allow = 규칙에 걸려도 노출(오탐 구제, 규칙보다 우선)
//
// 사용법 (server/.env 필요: TMDB_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64):
//   node scripts/flag-adult-titles.js --dry      # 판정만(쓰기 없음) + HTML 리포트 — 먼저 이걸 권장
//   node scripts/flag-adult-titles.js            # 실행(+ HTML 리포트)
//   node scripts/flag-adult-titles.js --unflag 123 456   # 특정 id 숨김 해제
// 옵션: --concurrency 20 · --limit N · --media tv|movie|both · --no-html
//
// 산출물: scripts/logs/flag-adult-*.log (실행 로그)
//         scripts/logs/adult-review-*.html (**사람이 직접 검수하는 목록** — 제목·줄거리·근거·TMDB 링크)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { kcultureDb } = require('../config/firebaseKculture');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_KEY = process.env.TMDB_API_KEY || '';

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const opts = {
    concurrency: parseInt(arg('concurrency', '20'), 10),
    limit: arg('limit') ? parseInt(arg('limit'), 10) : 0,
    media: arg('media', 'both'),
    dry: process.argv.includes('--dry'),
    html: !process.argv.includes('--no-html'),
};

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1'), dim = paint('2'), green = paint('32'), yellow = paint('33'), red = paint('31'), cyan = paint('36');

const LOG_DIR = path.join(__dirname, 'logs');
const MANUAL_FILE = path.join(__dirname, 'adult-manual.json');
let logFile = null;
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
function log(line = '') {
    console.log(line);
    if (logFile) { try { fs.appendFileSync(logFile, stripAnsi(line) + '\n'); } catch { /* 무시 */ } }
}

function loadManual() {
    try {
        const j = JSON.parse(fs.readFileSync(MANUAL_FILE, 'utf8'));
        return { hide: new Set((j.hide || []).map(String)), allow: new Set((j.allow || []).map(String)) };
    } catch { return { hide: new Set(), allow: new Set() }; }
}

// ── 판정 기준 ───────────────────────────────────────────────────────────────
// ⚠ 키워드는 강·약으로 나눈다 (2026-07-27 전수 dry-run에서 오탐 발견)
//   초안은 erotic 계열을 전부 무조건 숨김으로 잡았는데, 그 결과 「아가씨」(vote 4401, 칸 초청작)
//   「하녀」(384) 「섬」(371) 「나쁜 남자」(306) 「사마리아」(267) 「뫼비우스」(265)가 전부 숨겨졌다.
//   `eroticism`은 **한국 예술영화에 흔히 붙는 주제 태그**라 성인물 판별에 쓸 수 없다.
//   반면 `softcore`는 실측상 정확도가 높다(vote 70·59·45짜리도 전부 실제 에로물).
//   → STRONG은 하한을 높게(100) 둬서 어지간한 평점수에도 숨기고,
//     WEAK은 일반 하한(10)을 적용해 상업 개봉작을 살린다.
const KW_STRONG = /^(softcore|sexploitation|pornograph)/i;   // 성인물 전용 태그 — 정확도 높음
const KW_WEAK = /^(erotic|erotica|erotic movie|nudity|sex film)/i; // 예술영화에도 붙음 — 표본 조건 필수
const STRONG_FLOOR = 100;  // softcore인데 평점수 100 이상이면 사람 눈으로 확인(검수 목록에 남김)
const ADULT_CERTS = new Set(['18', '19', '19+', '청소년관람불가', 'R18', 'X']);
const VOTE_FLOOR = 10;   // 이 미만 = 상업 개봉작으로 보기 어려움(실측: 정상 개봉작 최소 267)

const matchKw = (kws, re) => (kws || []).find((k) => re.test(String(k || '')));
// 성인 등급이 실제로 무엇이었는지 반환 — 사유 표기용(certs[0]을 쓰면 ['15','19'] 같은 경우
// "cert:15"로 잘못 찍혀 검수 때 혼란을 준다).
const adultCert = (certs) => (certs || []).map((c) => String(c).trim()).find((c) => ADULT_CERTS.has(c));

// 공통 판정 — 로컬(meta)·원격(TMDB) 양쪽이 같은 규칙을 쓰도록 한 곳에 모은다.
// certs를 못 구한 경로(로컬 선판정)는 null을 넘기면 등급 규칙은 건너뛴다.
function decideBy(kws, certs, votes) {
    const strong = matchKw(kws, KW_STRONG);
    if (strong && votes < STRONG_FLOOR) return { verdict: 'hide', reason: `kw:${strong}+vote${votes}` };
    const weak = matchKw(kws, KW_WEAK);
    if (weak && votes < VOTE_FLOOR) return { verdict: 'hide', reason: `kw:${weak}+vote${votes}` };
    if (certs) {
        const c = adultCert(certs);
        if (c && votes < VOTE_FLOOR) return { verdict: 'hide', reason: `cert:${c}+vote${votes}` };
        if (!certs.length && votes < 3) return { verdict: 'suspect', reason: `no-cert+vote${votes}` };
    }
    return null;
}

async function tmdb(p, params = {}) {
    const u = new URLSearchParams({ api_key: TMDB_KEY, ...params });
    const r = await fetch(`${TMDB_BASE}${p}?${u}`);
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    return r.json();
}

// TMDB 조회 판정 — 등급(movie=release_dates KR / tv=content_ratings KR)까지 확인해야 할 때만 호출.
async function classifyRemote(media, id) {
    const append = media === 'movie' ? 'keywords,release_dates' : 'keywords,content_ratings';
    const d = await tmdb(`/${media}/${id}`, { language: 'en-US', append_to_response: append });

    const kws = (d.keywords?.keywords || d.keywords?.results || []).map((k) => String(k.name || ''));
    let certs = [];
    if (media === 'movie') {
        const kr = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'KR');
        certs = (kr?.release_dates || []).map((x) => x.certification).filter(Boolean);
    } else {
        const cr = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'KR');
        if (cr?.rating) certs = [cr.rating];
    }
    const votes = Number(d.vote_count || 0);
    const info = {
        title: d.title || d.name || '',
        year: String(d.release_date || d.first_air_date || '').slice(0, 4),
        overview: d.overview || '',
        votes, certs: [...new Set(certs)], kws,
    };

    const d2 = decideBy(kws, [...new Set(certs)], votes);
    return d2 ? { ...d2, info } : { verdict: 'keep', reason: '', info };
}

// ── 대상 수집 + 로컬 선판정 ─────────────────────────────────────────────────
// meta(keywords·vote_count)로 결론이 나는 건 TMDB를 치지 않는다. 마스크로 필요한 필드만 받는다 —
// meta 통째로 받으면 문서당 평균 5.7KB라 2.4만 건에 140MB가 된다.
async function collect() {
    const snap = await kcultureDb.collection('titles')
        .select('media', 'hidden', 'searchTitle',
            'meta.keywords', 'meta.vote_count', 'meta.title', 'meta.overview',
            'meta.release_date', 'meta.first_air_date', 'metaCachedAt')
        .get();

    const rows = [];
    snap.forEach((d) => {
        const x = d.data() || {};
        if (x.media !== 'tv' && x.media !== 'movie') return;
        if (opts.media !== 'both' && x.media !== opts.media) return;

        const m = x.meta || {};
        const kws = (m.keywords || []).map((k) => k?.name).filter(Boolean);
        const votes = Number(m.vote_count || 0);
        const info = {
            title: m.title || x.searchTitle?.en || Object.values(x.searchTitle || {})[0] || '',
            year: String(m.release_date || m.first_air_date || '').slice(0, 4),
            overview: m.overview || '',
            votes, certs: [], kws,
        };

        let local = null; // null이면 TMDB 조회 필요(등급 확인)
        if (x.metaCachedAt && m.vote_count !== undefined) {
            const d2 = decideBy(kws, null, votes); // certs=null → 등급 규칙은 건너뜀
            if (d2) local = { ...d2, info };
            // 등급 규칙(R2)과 약한 키워드(R1-weak)는 둘 다 vote<VOTE_FLOOR가 전제다.
            // 표본이 충분하고 강한 키워드도 없으면 더 볼 것이 없다 → 조회 없이 유지 확정.
            else if (votes >= VOTE_FLOOR) local = { verdict: 'keep', reason: '', info };
        }
        rows.push({ id: d.id, media: x.media, hidden: x.hidden === true, local, info });
    });
    return rows;
}

// ── 검수용 HTML 리포트 ──────────────────────────────────────────────────────
// 규칙을 믿고 넘기지 말고 **사람이 제목·줄거리를 직접 보라고** 만드는 산출물.
// 포스터는 싣지 않는다(성인물 이미지가 그대로 떠서 검수 화면이 불편해진다) — 대신 TMDB 링크를 건다.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 후보(R3)는 전수의 절반 가까이 나온다 — 등급 정보가 없는 무명작이 원래 많기 때문이다.
// 그대로 나열하면 사람이 못 훑으므로 **의심 점수 순으로 정렬**해 위쪽만 보면 되게 한다.
// ⚠ 이 점수는 **정렬 전용**이다. 숨김 판정에는 절대 쓰지 않는다 — 제목 단어 매칭은 오탐이 많아
//   ("Secret Garden", "아내가 결혼했다" 같은 정상작이 걸린다) 자동 차단 근거로는 못 쓴다.
const SUSPECT_HINTS = /(sex|erotic|nude|naked|lust|seduc|affair|adultery|mistress|sister-in-law|stepmom|stepmother|massage|motel|temptation|desire|forbidden|intimate|body|wife'?s|정사|유혹|은밀|욕망|불륜|형수|처제|아내의|색|애무|밤의)/i;
function suspicionScore(info) {
    const t = String(info.title || '');
    const o = String(info.overview || '').slice(0, 300);
    let s = 0;
    if (SUSPECT_HINTS.test(t)) s += 3;
    if (SUSPECT_HINTS.test(o)) s += 1;
    if (!info.overview) s -= 1;          // 줄거리조차 없으면 판단 근거가 없어 뒤로
    return s;
}

const SUSPECT_SHOW = 400;   // 후보 표시 상한 — 의심 점수 상위만. 전체는 실행 로그에 남는다.

function writeHtml(file, hidden, suspectsAll) {
    const suspects = suspectsAll.slice(0, SUSPECT_SHOW);
    const suspectMore = suspectsAll.length - suspects.length;
    const row = (r, i) => `<tr>
  <td class="n">${i + 1}</td>
  <td class="id"><label><input type="checkbox" class="pick" value="${esc(r.id)}"> ${esc(r.id)}</label></td>
  <td><b>${esc(r.info.title || '(제목 없음)')}</b>${r.info.year ? ` <span class="y">(${esc(r.info.year)})</span>` : ''}
      <div class="ov">${esc((r.info.overview || '(줄거리 없음)').slice(0, 400))}</div></td>
  <td class="m">${esc(r.media)}</td>
  <td class="v">${r.info.votes}</td>
  <td><span class="rz">${esc(r.reason)}</span>${r.info.certs?.length ? `<div class="c">등급 ${esc(r.info.certs.join('/'))}</div>` : ''}${r.info.kws?.length ? `<div class="k">${esc(r.info.kws.slice(0, 4).join(', '))}</div>` : ''}</td>
  <td><a href="https://www.themoviedb.org/${esc(r.media)}/${esc(r.id)}" target="_blank" rel="noreferrer">TMDB ↗</a></td>
</tr>`;

    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>성인물 판정 검수 — ${hidden.length}편 숨김 / ${suspects.length}편 후보</title>
<style>
 :root{color-scheme:light dark}
 body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px;max-width:1200px}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:16px;margin:32px 0 8px}
 .sub{color:#888;margin-bottom:20px}
 .box{background:#8881;border:1px solid #8883;border-radius:8px;padding:12px 16px;margin:16px 0}
 table{border-collapse:collapse;width:100%;margin-top:8px}
 th,td{border-bottom:1px solid #8883;padding:8px 10px;text-align:left;vertical-align:top}
 th{position:sticky;top:0;background:Canvas;font-size:12px;color:#888}
 .n{color:#aaa;width:40px} .id{white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px}
 .m,.v{white-space:nowrap;color:#888} .y{color:#888;font-weight:400}
 .ov{color:#888;font-size:12.5px;margin-top:3px;max-width:620px}
 .rz{display:inline-block;background:#f43f5e22;border:1px solid #f43f5e55;border-radius:4px;padding:1px 6px;font-size:11.5px;white-space:nowrap}
 .c,.k{color:#888;font-size:11.5px;margin-top:3px} a{color:#3b82f6}
 #out{width:100%;height:90px;font-family:ui-monospace,monospace;font-size:12px;margin-top:8px}
 button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #8886;background:#8881;cursor:pointer}
</style></head><body>
<h1>성인물 판정 검수</h1>
<div class="sub">숨김 판정 <b>${hidden.length}</b>편 · 수동 검토 후보 <b>${suspects.length}</b>편 · 생성 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>

<div class="box">
 <b>쓰는 법</b> — 목록을 훑다가 <b>잘못 숨겨진 것</b>(정상 작품인데 숨김 판정)이나
 <b>놓친 것</b>(후보인데 성인물)에 체크한 뒤 아래 버튼을 누르세요. id 배열이 만들어집니다.<br>
 그 배열을 <code>server/scripts/adult-manual.json</code>의 <code>allow</code>(노출 강제) 또는
 <code>hide</code>(숨김 강제)에 붙여넣고 스크립트를 다시 실행하면 반영됩니다.
 <div><button onclick="collect()">체크한 id 모으기</button></div>
 <textarea id="out" placeholder='["123","456"]'></textarea>
</div>

<h2>🚫 숨김 판정 ${hidden.length}편</h2>
<div class="sub">아래는 앱 검색·탐색·색인에서 제외됩니다. 정상 작품이 섞여 있으면 체크 → <code>allow</code>로.</div>
<table><thead><tr><th></th><th>id</th><th>제목 / 줄거리</th><th>종류</th><th>평점수</th><th>판정 근거</th><th></th></tr></thead>
<tbody>${hidden.map(row).join('\n')}</tbody></table>

<h2>❓ 수동 검토 후보 ${suspectsAll.length}편${suspectMore > 0 ? ` <span class="y">(의심 높은 순 ${suspects.length}편만 표시)</span>` : ''}</h2>
<div class="sub">등급 정보도 표본도 없어 <b>자동 판정을 보류</b>한 것들입니다(대부분 무명 독립영화·다큐라
 그냥 두어도 됩니다). 제목·줄거리에 성인물 신호가 있는 순으로 정렬했으니 <b>위쪽만 훑어도</b> 충분합니다.
 성인물이 보이면 체크 → <code>hide</code>로.${suspectMore > 0 ? ` 나머지 ${suspectMore}편은 실행 로그에 있습니다.` : ''}</div>
<table><thead><tr><th></th><th>id</th><th>제목 / 줄거리</th><th>종류</th><th>평점수</th><th>판정 근거</th><th></th></tr></thead>
<tbody>${suspects.map(row).join('\n')}</tbody></table>

<script>
function collect(){
  const ids=[...document.querySelectorAll('.pick:checked')].map(e=>e.value);
  document.getElementById('out').value=JSON.stringify(ids);
  document.getElementById('out').select();
}
</script></body></html>`;
    fs.writeFileSync(file, html, 'utf8');
}

// ── --unflag ────────────────────────────────────────────────────────────────
async function unflag(idList) {
    for (const id of idList) {
        await kcultureDb.doc(`titles/${id}`).set({ hidden: false, hiddenReason: null }, { merge: true });
        log(green(`  ✔ ${id} 숨김 해제`));
    }
}

async function main() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* 무시 */ }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    logFile = path.join(LOG_DIR, `flag-adult-${stamp}.log`);
    if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
    if (!TMDB_KEY) throw new Error('TMDB_API_KEY 없음');

    const ui = process.argv.indexOf('--unflag');
    if (ui >= 0) return unflag(process.argv.slice(ui + 1).filter((s) => /^\d+$/.test(s)));

    const manual = loadManual();
    log('');
    log(bold('▶ 성인물 플래그 배치'));
    log(`  동시 ${opts.concurrency}${opts.limit ? ` · limit ${opts.limit}` : ''} · 미디어 ${opts.media}`
        + (opts.dry ? yellow(' · DRY(쓰기 없음)') : ''));
    log(dim(`  수동 보정: hide ${manual.hide.size}건 · allow ${manual.allow.size}건 (${MANUAL_FILE})`));

    log(dim('\n  Firestore titles 스캔 + 로컬 선판정 중…'));
    let rows = await collect();
    if (opts.limit) rows = rows.slice(0, opts.limit);

    // 수동 보정이 규칙보다 우선 — TMDB 조회도 생략된다.
    for (const r of rows) {
        if (manual.allow.has(r.id)) r.local = { verdict: 'keep', reason: 'manual:allow', info: r.info };
        else if (manual.hide.has(r.id)) r.local = { verdict: 'hide', reason: 'manual:hide', info: r.info };
    }

    const needProbe = rows.filter((r) => !r.local);
    log(`  대상 ${bold(rows.length)}편 (현재 hidden ${rows.filter((r) => r.hidden).length}편)`);
    log(`  ${green('로컬 판정')} ${rows.length - needProbe.length}편 ${dim('(meta의 키워드·평점수로 결론 — TMDB 호출 0)')}`);
    log(`  ${cyan('TMDB 조회')} ${needProbe.length}편 ${dim(`(등급 확인 필요) · 예상 ${Math.ceil(needProbe.length / opts.concurrency / 4 / 60)}~${Math.ceil(needProbe.length / opts.concurrency / 2 / 60)}분`)}`);
    log(dim(`  로그 파일: ${logFile}`));
    log('');

    const t0 = Date.now();
    const stat = { hide: 0, keep: 0, suspect: 0, changed: 0, errors: 0 };
    const hiddenList = [], suspectList = [];
    let idx = 0, counted = 0;

    async function decide(r) {
        if (r.local) return r.local;
        return classifyRemote(r.media, r.id);
    }

    async function worker() {
        while (idx < rows.length) {
            const r = rows[idx++];
            try {
                const { verdict, reason, info } = await decide(r);
                counted++;
                const rec = { id: r.id, media: r.media, reason, info: info || r.info };
                if (verdict === 'suspect') { stat.suspect++; suspectList.push(rec); }
                else if (verdict === 'hide') { stat.hide++; hiddenList.push(rec); }
                else stat.keep++;

                const shouldHide = verdict === 'hide';
                if (shouldHide !== r.hidden) {
                    stat.changed++;
                    if (!opts.dry) {
                        await kcultureDb.doc(`titles/${r.id}`).set(
                            { hidden: shouldHide, hiddenReason: shouldHide ? reason : null },
                            { merge: true },
                        );
                    }
                    const mark = shouldHide ? yellow('🚫 숨김') : green('👁 해제');
                    log(`  ${mark} ${r.id} 「${rec.info.title}」 ${dim(`${reason} · vote ${rec.info.votes}`)}`);
                }
            } catch (e) {
                counted++; stat.errors++;
                log(`  ${red('✖')} ${r.id} ${red(e.message)}`);
            }
            if (counted % 2000 === 0 && counted < rows.length) {
                const el = (Date.now() - t0) / 1000;
                log(cyan(`  ── 진행 ${counted}/${rows.length} · 숨김 ${stat.hide} · 남은 예상 ${Math.round((rows.length - counted) / (counted / el) / 60)}분`));
            }
        }
    }
    await Promise.all(Array.from({ length: opts.concurrency }, worker));

    log('');
    log(bold('══════════════ 요약 ══════════════'));
    log(`  판정 — 숨김 ${bold(stat.hide)} · 유지 ${stat.keep} · 후보(수동검토) ${stat.suspect} · 오류 ${stat.errors}`);
    log(`  ${opts.dry ? yellow('DRY — 실제 변경 없음. 바뀔 문서') : '변경된 문서'} ${bold(stat.changed)}건 · ${Math.round((Date.now() - t0) / 1000)}초`);

    if (opts.html) {
        const htmlFile = path.join(LOG_DIR, `adult-review-${stamp}.html`);
        // 숨김 목록은 제목순 — 같은 시리즈물이 붙어 있어야 훑기 쉽다(오탐 확인이 목적).
        const byTitle = (a, b) => String(a.info.title).localeCompare(String(b.info.title));
        // 후보는 의심 점수 내림차순 — 위쪽만 봐도 되게(놓친 성인물 찾기가 목적).
        const byScore = (a, b) => suspicionScore(b.info) - suspicionScore(a.info)
            || String(a.info.title).localeCompare(String(b.info.title));
        writeHtml(htmlFile, hiddenList.sort(byTitle), suspectList.sort(byScore));
        log('');
        log(bold(`  📄 검수용 목록: ${htmlFile}`));
        log(dim('     브라우저로 열어 제목·줄거리를 직접 확인하고, 오탐은 체크 → adult-manual.json 에 반영하세요.'));
    }
    log(dim(`  실행 로그: ${logFile}`));
    log('');
}

main().then(() => process.exit(0)).catch((e) => {
    log(red(`\n✖ 실패: ${e.message}`));
    process.exit(1);
});
