// ── 회차 하이라이트 자동 수집 (2026-08-28) — 스크립트 1번 ─────────────────────
// 대상: **Dari 스레드(토론방)가 개설된 작품**(curation_threads) × **이미 방영이 지난 회차** 중
//       하이라이트(hls)가 아직 없는 회차. 전 카탈로그가 아니다.
// 목적: 에이전트(LLM) 비용 없이 기계적으로 수집 — 유튜브 검색(yt-dlp) → 후보 필터
//       (공식 채널·회차 귀속·길이·업로드일) → 명확한 것만 하드 게이트(lib/highlightGate) 통과 후
//       자동 저장. 애매한 후보는 logs/highlight-candidates-*.md 로 내보내 에이전트가 판단한다.
//
// 사용법 (server/.env 에 KCULTURE_SERVICE_ACCOUNT_BASE64 + TMDB_API_KEY 필요, yt-dlp 설치):
//   node scripts/find-title-highlights.js                  # 스레드 전 작품(방영분 결측 회차만)
//   node scripts/find-title-highlights.js --title 296206   # 한 작품만(에이전트 운영 기본 — 회차당 검색 1~2회)
//   node scripts/find-title-highlights.js --dry            # 판정만, 저장·리포트 안 함
// 자동 저장 조건(전부 충족 — 하나라도 애매하면 후보 리포트로):
//   공식 채널(allowlist) + 회차 번호 단일 귀속(제목, 없으면 설명문) + 길이 4~30분
//   + 제외어 없음(선공개·예고·묶음 등) + 업로드일 ≥ 방영일-2일 + oEmbed 200
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { kcultureDb } = require('../config/firebaseKculture');
const { isOfficialChannel, gateHighlight, saveHighlight } = require('../lib/highlightGate');

const TMDB_KEY = process.env.TMDB_API_KEY;
const DRY = process.argv.includes('--dry');
const onlyTitle = (() => { const i = process.argv.indexOf('--title'); return i > -1 ? String(process.argv[i + 1]).replace(/\D/g, '') : null; })();

const SEARCH_N = 6;              // 검색당 후보 수(전량 메타 추출이라 크게 잡으면 느려짐)
const DUR_MIN = 240, DUR_MAX = 1800; // 회차 요약본 길이대(4~30분) — 장면 클립·풀버전 배제
const EXCLUDE_RE = /선공개|예고|티저|메이킹|비하인드|인터뷰|몰아보기|전편|풀버전|스페셜|OST|쇼츠|shorts/i;
const BUNDLE_RE = /\d+\s*[-~〜]\s*\d+\s*(?:화|회)/; // "1-2회" 묶음 — 단일 회차 귀속 불가

// ── yt-dlp ──────────────────────────────────────────────────────────────────
const YTDLP_FALLBACK = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe');
let YTDLP = 'yt-dlp';
// ⚠ 출력 인코딩 강제 필수 — 한국어 Windows에서 yt-dlp 파이프 출력이 cp949로 나와 한글 제목이
// 깨지고(mojibake) 회차 귀속 정규식("N화")이 조용히 실패한다(2026-08-28 실측 —
// PYTHONIOENCODING만으론 standalone exe가 무시). --encoding utf-8 + env 이중 지정.
const YT_ENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const YT_BASE_ARGS = ['--encoding', 'utf-8'];
function ytdlp(args) {
  const full = [...YT_BASE_ARGS, ...args];
  let r = spawnSync(YTDLP, full, { encoding: 'utf8', windowsHide: true, timeout: 180000, env: YT_ENV });
  if (r.error && r.error.code === 'ENOENT' && YTDLP !== YTDLP_FALLBACK) {
    YTDLP = YTDLP_FALLBACK;
    r = spawnSync(YTDLP, full, { encoding: 'utf8', windowsHide: true, timeout: 180000, env: YT_ENV });
  }
  if (r.error) throw new Error(`yt-dlp 실행 실패: ${r.error.message}`);
  return r.stdout || '';
}

// 검색 — id/제목/채널/길이/업로드일을 탭 구분으로. (전량 추출이라 검색 1회 ≈ 수십 초)
function searchVideos(query) {
  const out = ytdlp([`ytsearch${SEARCH_N}:${query}`, '--skip-download', '--no-warnings',
    '--print', '%(id)s\t%(title)s\t%(channel)s\t%(duration)s\t%(upload_date)s']);
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, title, channel, duration, upload] = l.split('\t');
    return { id, title: title || '', channel: channel || '', duration: Number(duration) || 0, upload: upload || '' };
  }).filter((v) => v.id && /^[A-Za-z0-9_-]{6,20}$/.test(v.id));
}
function fetchDescription(videoId) {
  try { return ytdlp([`https://www.youtube.com/watch?v=${videoId}`, '--skip-download', '--no-warnings', '--print', '%(description)s']); }
  catch { return ''; }
}

// 작품명 대조 — 제목·설명문(해시태그 포함)에 작품명이 있어야 자동 저장 자격.
// ⚠ 2026-08-28 실측: "우리만의 리허설 2화" 검색 최상위가 **타 작품(최애의 사원) 2화 하이라이트**
// (같은 채널 tvN DRAMA·같은 회차 번호) — 채널+회차만으론 교차 오귀속이 난다. 작품명 필수.
const normText = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, '');

// 회차 귀속 — "N화"/"N회"/"EP N" 단일 표기(다른 숫자 회차 표기 동반 시 실패)
function epMatch(text, ep) {
  if (!text) return false;
  if (BUNDLE_RE.test(text)) return false;
  const re = new RegExp(`(?:^|[^0-9])${ep}\\s*(?:화|회)(?![0-9])|EP\\.?\\s*0?${ep}(?![0-9])`, 'i');
  if (!re.test(text)) return false;
  // 다른 회차 번호가 함께 표기되면(하이라이트 모음 등) 귀속 불가
  const others = [...text.matchAll(/(\d{1,3})\s*(?:화|회)/g)].map((m) => Number(m[1])).filter((n) => n !== ep && n <= 200);
  return others.length === 0;
}

async function tmdb(pathname) {
  const r = await fetch(`https://api.themoviedb.org/3${pathname}${pathname.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}`);
  if (!r.ok) throw new Error(`TMDB ${r.status} ${pathname}`);
  return r.json();
}

(async () => {
  if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
  if (!TMDB_KEY) throw new Error('TMDB_API_KEY 없음');
  const today = new Date().toISOString().slice(0, 10);

  // ① 대상 열거 — Dari 스레드가 개설된 (작품, 시즌)만
  const snap = await kcultureDb.collection('curation_threads').get();
  const targets = new Map(); // `${titleId}|${season}` → true
  for (const d of snap.docs) {
    const m = d.id.match(/_s(\d+)e(\d+)$/);
    if (!m) continue; // 영화 등
    const id = String(d.data().titleId || '').replace(/\D/g, '');
    if (!id || (onlyTitle && id !== onlyTitle)) continue;
    targets.set(`${id}|${m[1]}`, true);
  }
  console.log(`대상: 스레드 개설 작품·시즌 ${targets.size}건${onlyTitle ? ` (--title ${onlyTitle})` : ''} · ${DRY ? 'dry-run' : '자동 저장 모드'}`);

  const saved = [], ambiguous = [], notfound = [];
  for (const key of targets.keys()) {
    const [id, season] = key.split('|');
    // ② 한국어 제목 + 방영 지난 회차
    let koName, airedEps;
    try {
      const detail = await tmdb(`/tv/${id}?language=ko-KR`);
      koName = detail.name || detail.original_name;
      const s = await tmdb(`/tv/${id}/season/${season}?language=ko-KR`);
      airedEps = (s.episodes || []).filter((e) => e.air_date && e.air_date <= today)
        .map((e) => ({ ep: e.episode_number, air: e.air_date }));
    } catch (e) { console.warn(`  ✗ ${id} TMDB 실패: ${e.message}`); continue; }

    // ③ 기존 hls 스킵(멱등)
    let have = {};
    try {
      const doc = await kcultureDb.doc(`titles/${id}/media/clips`).get();
      have = (doc.exists && doc.data().hls) || {};
    } catch { /* 없으면 전부 결측 */ }
    const missing = airedEps.filter(({ ep }) => !have[`s${season}e${ep}`]);
    console.log(`\n■ ${koName} (${id} S${season}) — 방영 ${airedEps.length}회 / 결측 ${missing.length}회`);
    if (!missing.length) continue;

    for (const { ep, air } of missing) {
      // ④ 검색(1차: 하이라이트, 공식 후보 없으면 2차: N회)
      let cands = [];
      try {
        cands = searchVideos(`${koName} ${ep}화 하이라이트`);
        if (!cands.some((v) => isOfficialChannel(v.channel))) {
          cands = cands.concat(searchVideos(`${koName} ${ep}회`));
        }
      } catch (e) { console.warn(`  E${ep}: 검색 실패 — ${e.message}`); continue; }

      // ⑤ 기본 필터(길이·제외어·업로드일) — 채널 무관 공통
      const airMin = air ? Number(air.replace(/-/g, '')) - 2 : 0; // YYYYMMDD 근사 비교(월경계 오차는 -2일 여유로 흡수)
      const viable = cands.filter((v) => v.duration >= DUR_MIN && v.duration <= DUR_MAX
        && !EXCLUDE_RE.test(v.title) && !BUNDLE_RE.test(v.title)
        && (!v.upload || !airMin || Number(v.upload) >= airMin));

      // ⑥ 공식 채널 + 작품명 대조 + 회차 귀속(제목 → 설명문) → 자동 저장 후보
      const normShow = normText(koName);
      const official = viable.filter((v) => isOfficialChannel(v.channel));
      const attributed = [];
      for (const v of official) {
        if (epMatch(v.title, ep) && normText(v.title).includes(normShow)) { attributed.push(v); continue; }
        // 제목에 회차·작품명 없는 시리즈(습드첵류: 설명문에 "N회", 해시태그에 작품명) — 설명문 보강
        const desc = fetchDescription(v.id);
        const full = `${v.title}\n${desc}`;
        if ((epMatch(v.title, ep) || epMatch(desc, ep)) && normText(full).includes(normShow)) attributed.push(v);
      }

      if (attributed.length) {
        attributed.sort((a, b) => b.duration - a.duration); // 회차 전체 요약(긴 것) 우선
        const pick = attributed[0];
        if (DRY) { console.log(`  E${ep}: [dry] 자동 후보 ${pick.id} "${pick.title.slice(0, 40)}" (${pick.channel})`); saved.push(`${id} E${ep}`); continue; }
        const gate = await gateHighlight(pick.id); // oEmbed 200 + 채널 재검증(하드 게이트)
        if (gate.ok) {
          await saveHighlight(kcultureDb, { titleId: id, season, ep, videoId: pick.id, meta: gate });
          console.log(`  E${ep}: ✅ 저장 ${pick.id} "${pick.title.slice(0, 44)}" (${pick.channel}, ${Math.round(pick.duration / 60)}분)`);
          saved.push(`${koName} E${ep} ${pick.id}`);
        } else {
          console.log(`  E${ep}: ⚠ 게이트 거부(${gate.reason}) ${pick.id} — 후보 리포트로`);
          ambiguous.push({ id, koName, season, ep, cands: attributed, note: `게이트 거부: ${gate.reason}` });
        }
      } else if (viable.length) {
        console.log(`  E${ep}: 후보 ${viable.length}건 — 자동 판정 불가(후보 리포트로)`);
        ambiguous.push({ id, koName, season, ep, cands: viable.slice(0, 5), note: official.length ? '공식 채널이나 회차 귀속 불명' : '공식 채널 후보 없음' });
      } else {
        console.log(`  E${ep}: 후보 없음`);
        notfound.push(`${koName} E${ep}`);
      }
    }
  }

  // ⑦ 애매 후보 리포트 — 에이전트(방송후 모드) 판단용
  if (ambiguous.length && !DRY) {
    const logDir = path.join(__dirname, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, `highlight-candidates-${new Date().toISOString().slice(0, 10)}.md`);
    const lines = [`# 하이라이트 후보 검토 (${new Date().toISOString().slice(0, 16)}Z)`, '',
      '자동 판정 불가분 — 공식 여부·회차 귀속을 판단해 맞는 것만 저장:',
      '`node scripts/set-title-highlight.js --title {id} --season {s} --ep {n} --video {videoId}`',
      '새 공식 채널이면 lib/highlightGate.js OFFICIAL_CHANNELS 에 추가 후 저장(--force-channel 지양).', ''];
    for (const a of ambiguous) {
      lines.push(`## ${a.koName} (${a.id}) S${a.season} E${a.ep} — ${a.note}`);
      for (const c of a.cands) lines.push(`- \`${c.id}\` | ${c.title} | ${c.channel} | ${Math.round(c.duration / 60)}분 | up:${c.upload}`);
      lines.push('');
    }
    fs.writeFileSync(file, lines.join('\n'));
    console.log(`\n후보 리포트: ${file}`);
  }
  console.log(`\n완료 — 저장 ${saved.length} / 검토 필요 ${ambiguous.length} / 후보 없음 ${notfound.length}`);
  process.exit(0);
})().catch((e) => { console.error('[find-title-highlights] FAIL', e); process.exit(1); });
