// ── 회차 하이라이트 수집 코어 (2026-08-28 분리) ────────────────────────────────
// scripts/find-title-highlights.js 의 "작품 1건 수집" 로직을 라이브러리로 뺀 것.
// 호출처 3곳이 **같은 규칙·같은 게이트**를 쓰게 하는 것이 목적이다:
//   · scripts/find-title-highlights.js  — 일괄/단건 CLI(운영자 실행)
//   · scripts/dari-review.js            — Dari 리뷰 게시 직후 자동 수집
//   · scripts/sogam-queue-load.js       — 자동 소감 큐 적재 직후 자동 수집
// 저장은 lib/highlightGate.js 의 하드 게이트(oEmbed 200 + 공식 채널 allowlist)를 통과해야 한다.
//
// 실측 근거(2026-08-28 파일럿 — 눈물의여왕/도깨비/풀하우스/폭싹 각 16회):
//   눈물의여왕 16/16 · 도깨비 16/16 · 풀하우스 16/16 · 폭싹(Netflix) 자동 제외
// 규칙을 손대면 이 4작으로 회귀 검증할 것.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { isOfficialChannel, gateHighlight, saveHighlight } = require('./highlightGate');

// ── 제외 규칙 ────────────────────────────────────────────────────────────────
// 편성 플랫폼 기반 자동 제외 — ID 하드코딩보다 우선한다. 이 플랫폼들의 공식 채널은
// **회차 번호 없는 장면 클립·프로모**만 올려 회차 귀속이 원리적으로 불가하다.
//   실측: 폭싹 속았수다(Netflix 최대 흥행작) 16회 전부 187~274초 씬 클립·회차 표기 없음.
//         동궁(Netflix) 동일 영상 2개가 E1~E7 전 회차 후보. 킬러들의 쇼핑몰2(Disney+) 74~166초 프로모만.
//   ⚠ 쿠팡플레이는 넣지 않는다 — 회차 하이라이트를 실제로 올린다(지금 불륜 6회 저장 실적).
const SKIP_NETWORKS = [
  'Netflix', 'Disney+', 'Disney Plus', 'iQIYI', 'iQIYI International',
  'GagaOOLala', 'Apple TV+', 'Prime Video', 'Amazon Prime Video',
];
const normNet = (s) => String(s || '').toLowerCase().replace(/[\s+.-]+/g, '');
const SKIP_NET_SET = new Set(SKIP_NETWORKS.map(normNet));
const blockedNetwork = (networks) => (networks || []).map((n) => n.name).find((n) => SKIP_NET_SET.has(normNet(n)));

// 작품 단위 제외 — 플랫폼으로 못 거르는 개별 사유. 해제하려면 force 옵션으로 1회 재확인 후 항목 제거.
const SKIP_TITLES = {
  // 공식 채널은 있으나 그 채널이 allowlist 제외 확정 → 공급원이 없다.
  // (JTBC 'DRAMA Voyage'는 회차 묶음이라 lib/highlightGate.js 주석에서 제외 확정)
  300727: 'JTBC — 유일 공급 채널 DRAMA Voyage가 묶음 편성이라 allowlist 제외 확정',
  96162: 'JTBC — 상동(이태원 클라쓰 실측 0/16)',
  // 포맷 미지원(구조적 불가가 아님 — 파이프라인 보강 시 해제 대상).
  // KBS Drama는 회차 요약본이 아니라 3~4분(200~230초) 장면 클립을 "KBS 260809 방송"
  // 형식으로 올린다 → 길이 하한(240초) 미달 + 제목에 회차 없음(방송일로만 귀속 가능).
  300954: 'KBS Drama 포맷(3~4분 장면 클립·방송일 표기) — 현 길이·귀속 규칙 미지원',
  276470: 'KBS Drama 포맷(3~4분 장면 클립·방송일 표기) — 현 길이·귀속 규칙 미지원',
  // 회차 요약본을 아예 안 만드는 편성(실측 0건) — 테마 모음집·짧은 씬 클립만 존재.
  64010: 'tvN이지만 회차 요약본 없음 — 테마 모음집("덕선♥택 모먼트")·2분 씬 클립만(실측 0/20)',
  197067: 'ENA — 공식 클립에 회차 번호를 안 붙임("[하이라이트] 신입 변호사 우영우 첫출근")(실측 0/16)',
};

// ── 후보 판정 파라미터 ───────────────────────────────────────────────────────
const SEARCH_N = 6;              // 검색당 후보 수(전량 메타 추출이라 크게 잡으면 느려짐)
const DUR_MIN = 240, DUR_MAX = 1800; // 회차 요약본 길이대(4~30분) — 장면 클립·풀버전 배제
// ⚠ '몰아보기'를 제외어로 두지 말 것 (2026-08-28 파일럿 실측) — tvN 구작은 **회차별 요약본**을
//   "[#도깨비] 5화 12분 만에 몰아보기"라고 부른다. 제외어로 두면 도깨비 16회가 전부 탈락하고
//   잡음(웃긴 장면 모음 N탄)만 후보로 남는다. 진짜 묶음("4~6화 35분만에 몰아보기")은 아래
//   BUNDLE_RE(회차 범위)와 길이 상한(30분)이 이미 걸러낸다.
const EXCLUDE_RE = /선공개|예고|티저|메이킹|비하인드|인터뷰|전편|풀버전|스페셜|OST|쇼츠|shorts/i;
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

// 텍스트가 "명시적으로 주장하는" 회차 번호들 — "N화/N회"와 "EPnn" 두 표기를 모두 본다.
// ⚠ EP 표기를 빼면 안 된다(2026-08-28 실사고): 풀하우스 `[EP16-02]` 영상의 **설명문에
//   `[EP15-02]`가 섞여 있어** 설명문 기반 귀속이 E15로 뒤집혔다 — 시청자에게 다음 회차
//   스포일러를 노출하는 오귀속이다.
function claimedEps(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(\d{1,3})\s*(?:화|회)/g)) out.add(Number(m[1]));
  for (const m of String(text || '').matchAll(/EP\.?\s*(\d{1,3})/gi)) out.add(Number(m[1]));
  return [...out].filter((n) => n > 0 && n <= 200);
}

// 회차 귀속 — "N화"/"N회"/"EP N" 단일 표기(다른 숫자 회차 표기 동반 시 실패)
function epMatch(text, ep) {
  if (!text) return false;
  if (BUNDLE_RE.test(text)) return false;
  const re = new RegExp(`(?:^|[^0-9])${ep}\\s*(?:화|회)(?![0-9])|EP\\.?\\s*0?${ep}(?![0-9])`, 'i');
  if (!re.test(text)) return false;
  const others = claimedEps(text).filter((n) => n !== ep);
  return others.length === 0;
}

async function tmdb(pathname) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY 없음');
  const r = await fetch(`https://api.themoviedb.org/3${pathname}${pathname.includes('?') ? '&' : '?'}api_key=${key}`);
  if (!r.ok) throw new Error(`TMDB ${r.status} ${pathname}`);
  return r.json();
}

/**
 * 작품 1건(시즌 1개)의 결측 회차 하이라이트를 수집한다.
 * @param db Firestore(admin) — kcultureDb
 * @param titleId TMDB tv id
 * @param season  시즌 번호(기본 1). ⚠ 다시즌 작품은 반드시 지정 — 안 하면 S1으로 저장된다.
 * @param dry     true면 판정만(쓰기 없음)
 * @param force   true면 제외 목록(플랫폼·작품)을 무시하고 진행
 * @param log     로그 함수(기본 console.log). null 이면 무음.
 * @returns {saved, ambiguous, notfound, skipped, koName, aired, missing}
 *          skipped 가 문자열이면 그 사유로 수집하지 않은 것(정상 종료).
 */
async function collectForTitle(db, { titleId, season = 1, dry = false, force = false, log = console.log } = {}) {
  const say = typeof log === 'function' ? log : () => {};
  const id = String(titleId).replace(/\D/g, '');
  const out = { saved: [], ambiguous: [], notfound: [], skipped: null, koName: null, aired: 0, missing: 0 };
  if (!id) { out.skipped = 'titleId 없음'; return out; }
  if (!db) { out.skipped = 'db 없음'; return out; }

  if (!force && SKIP_TITLES[Number(id)]) {
    out.skipped = SKIP_TITLES[Number(id)];
    say(`⏭ ${id} 제외 — ${out.skipped}`);
    return out;
  }

  let koName, airedEps;
  try {
    const detail = await tmdb(`/tv/${id}?language=ko-KR`);
    koName = detail.name || detail.original_name;
    out.koName = koName;
    // 플랫폼 제외 — 회차 검색(작품당 수십 회)에 들어가기 전에 끊어 낭비를 없앤다.
    const bad = force ? null : blockedNetwork(detail.networks);
    if (bad) {
      out.skipped = `${bad} 오리지널(회차 미표기 클립만 공급)`;
      say(`⏭ ${koName} (${id}) 제외 — ${out.skipped}`);
      return out;
    }
    const s = await tmdb(`/tv/${id}/season/${season}?language=ko-KR`);
    const today = new Date().toISOString().slice(0, 10);
    airedEps = (s.episodes || []).filter((e) => e.air_date && e.air_date <= today)
      .map((e) => ({ ep: e.episode_number, air: e.air_date }));
  } catch (e) { out.skipped = `TMDB 실패: ${e.message}`; say(`  ✗ ${id} ${out.skipped}`); return out; }

  // 기존 hls 스킵(멱등)
  let have = {};
  try {
    const doc = await db.doc(`titles/${id}/media/clips`).get();
    have = (doc.exists && doc.data().hls) || {};
  } catch { /* 없으면 전부 결측 */ }
  const missing = airedEps.filter(({ ep }) => !have[`s${season}e${ep}`]);
  out.aired = airedEps.length; out.missing = missing.length;
  say(`\n■ ${koName} (${id} S${season}) — 방영 ${airedEps.length}회 / 결측 ${missing.length}회`);
  if (!missing.length) return out;

  for (const { ep, air } of missing) {
    // 질의를 단계적으로 늘리되 **귀속이 성립하면 즉시 멈춘다**(자동화율 ↑ / 검색 낭비 ↓).
    // 3차 "N화 몰아보기"는 tvN 구작의 회차 요약 명칭이다(도깨비 8→16 개선분).
    const QUERIES = [`${koName} ${ep}화 하이라이트`, `${koName} ${ep}회`, `${koName} ${ep}화 몰아보기`];
    const airMin = air ? Number(air.replace(/-/g, '')) - 2 : 0; // YYYYMMDD 근사 비교(월경계 오차는 -2일 여유로 흡수)
    const normShow = normText(koName);
    const seen = new Set();      // videoId 중복 제거 — 설명문 재조회 낭비 방지
    const descCache = new Map();
    let cands = [], viable = [], official = [], attributed = [], searchFailed = false;

    for (let qi = 0; qi < QUERIES.length; qi++) {
      let batch;
      try { batch = searchVideos(QUERIES[qi]); } catch (e) {
        if (!qi) { say(`  E${ep}: 검색 실패 — ${e.message}`); searchFailed = true; }
        break;
      }
      for (const v of batch) { if (!seen.has(v.id)) { seen.add(v.id); cands.push(v); } }

      // 기본 필터(길이·제외어·업로드일) — 채널 무관 공통
      viable = cands.filter((v) => v.duration >= DUR_MIN && v.duration <= DUR_MAX
        && !EXCLUDE_RE.test(v.title) && !BUNDLE_RE.test(v.title)
        && (!v.upload || !airMin || Number(v.upload) >= airMin));

      // 공식 채널 + 작품명 대조 + 회차 귀속(제목 → 설명문) → 자동 저장 후보
      official = viable.filter((v) => isOfficialChannel(v.channel));
      attributed = [];
      for (const v of official) {
        if (epMatch(v.title, ep) && normText(v.title).includes(normShow)) { attributed.push(v); continue; }
        // 🚨 제목이 **다른 회차를 명시**하면 설명문으로 뒤집지 않는다(풀하우스 EP16 영상의 설명문에
        //    EP15가 섞여 E15로 오귀속된 실사고 — 다음 회차 스포일러가 된다).
        const claimed = claimedEps(v.title);
        if (claimed.length && !claimed.includes(ep)) continue;
        // 제목에 회차·작품명 없는 시리즈(설명문에 "N회", 해시태그에 작품명) — 설명문 보강
        if (!descCache.has(v.id)) descCache.set(v.id, fetchDescription(v.id));
        const desc = descCache.get(v.id);
        const full = `${v.title}\n${desc}`;
        if ((epMatch(v.title, ep) || epMatch(desc, ep)) && normText(full).includes(normShow)) attributed.push(v);
      }
      if (attributed.length) break; // 귀속 성립 — 추가 질의 불필요
    }
    if (searchFailed) continue;

    if (attributed.length) {
      attributed.sort((a, b) => b.duration - a.duration); // 회차 전체 요약(긴 것) 우선
      const pick = attributed[0];
      if (dry) { say(`  E${ep}: [dry] 자동 후보 ${pick.id} "${pick.title.slice(0, 40)}" (${pick.channel})`); out.saved.push(`${id} E${ep}`); continue; }
      const gate = await gateHighlight(pick.id); // oEmbed 200 + 채널 재검증(하드 게이트)
      if (gate.ok) {
        await saveHighlight(db, { titleId: id, season, ep, videoId: pick.id, meta: gate });
        say(`  E${ep}: ✅ 저장 ${pick.id} "${pick.title.slice(0, 44)}" (${pick.channel}, ${Math.round(pick.duration / 60)}분)`);
        out.saved.push(`${koName} E${ep} ${pick.id}`);
      } else {
        say(`  E${ep}: ⚠ 게이트 거부(${gate.reason}) ${pick.id} — 후보 리포트로`);
        out.ambiguous.push({ id, koName, season, ep, cands: attributed, note: `게이트 거부: ${gate.reason}` });
      }
    } else if (viable.length) {
      say(`  E${ep}: 후보 ${viable.length}건 — 자동 판정 불가(후보 리포트로)`);
      out.ambiguous.push({ id, koName, season, ep, cands: viable.slice(0, 5), note: official.length ? '공식 채널이나 회차 귀속 불명' : '공식 채널 후보 없음' });
    } else {
      say(`  E${ep}: 후보 없음`);
      out.notfound.push(`${koName} E${ep}`);
    }
  }
  return out;
}

/**
 * 애매 후보 리포트 — 에이전트(방송후 모드) 판단용.
 * ⚠ tag 를 반드시 줄 것: 예전엔 날짜만 썼는데 --title 을 루프로 돌리면 **작품마다 같은 파일을
 *   덮어써서** 마지막 작품 것만 남았다(2026-08-28 실측 — 6작 78건 유실).
 */
function writeCandidateReport(ambiguous, { tag = '', dir = path.join(__dirname, '..', 'scripts', 'logs') } = {}) {
  if (!ambiguous || !ambiguous.length) return null;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const safeTag = String(tag).replace(/[^A-Za-z0-9_-]+/g, '');
  const file = path.join(dir, `highlight-candidates-${stamp}${safeTag ? `-${safeTag}` : ''}.md`);
  const lines = [`# 하이라이트 후보 검토 (${new Date().toISOString().slice(0, 16)}Z)`, '',
    '자동 판정 불가분 — 공식 여부·회차 귀속을 판단해 맞는 것만 저장:',
    '`node scripts/set-title-highlight.js --title {id} --season {s} --ep {n} --video {videoId}`',
    '새 공식 채널이면 lib/highlightGate.js OFFICIAL_CHANNELS 에 추가 후 저장(--force-channel 지양).',
    '⚠ 채널명은 **oEmbed author_name 실측값**을 넣을 것 — yt-dlp channel 값과 다를 수 있다.', ''];
  for (const a of ambiguous) {
    lines.push(`## ${a.koName} (${a.id}) S${a.season} E${a.ep} — ${a.note}`);
    for (const c of a.cands) lines.push(`- \`${c.id}\` | ${c.title} | ${c.channel} | ${Math.round(c.duration / 60)}분 | up:${c.upload}`);
    lines.push('');
  }
  // 같은 파일이 이미 있으면 이어쓴다(루프 실행에서 유실 방지)
  if (fs.existsSync(file)) fs.appendFileSync(file, `\n${lines.slice(1).join('\n')}`);
  else fs.writeFileSync(file, lines.join('\n'));
  return file;
}

/**
 * 게시 파이프라인용 얇은 래퍼 — 실패해도 절대 throw 하지 않는다.
 * 하이라이트 수집이 리뷰 게시·큐 적재를 막으면 안 된다(부가 기능이지 전제조건이 아니다).
 */
async function collectQuietly(db, { titleId, season = 1, media = 'tv', tag = '' } = {}) {
  if (media && media !== 'tv') return { skipped: `media=${media}(회차 없음)` };
  try {
    const r = await collectForTitle(db, { titleId, season });
    if (r.ambiguous.length) {
      const f = writeCandidateReport(r.ambiguous, { tag: tag || String(titleId) });
      if (f) console.log(`[highlights] 후보 리포트: ${f}`);
    }
    return r;
  } catch (e) {
    console.warn(`[highlights] 수집 실패(무시하고 진행) titleId=${titleId}: ${e.message}`);
    return { skipped: `실패: ${e.message}` };
  }
}

module.exports = {
  collectForTitle, collectQuietly, writeCandidateReport,
  SKIP_TITLES, SKIP_NETWORKS, blockedNetwork,
  // 테스트·재사용용 내부 헬퍼
  epMatch, claimedEps, normText,
};
