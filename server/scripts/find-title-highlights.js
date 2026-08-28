// ── 회차 하이라이트 자동 수집 CLI (2026-08-28) ────────────────────────────────
// 판정·저장 로직은 전부 lib/collectHighlights.js 에 있다(Dari 리뷰 게시·소감 큐 적재와 공유).
// 이 파일은 **대상 열거 + 루프 + 리포트**만 담당한다.
//
// 대상: 기본은 **Dari 스레드(curation_threads)가 개설된 (작품, 시즌)** 중 방영이 지난 결측 회차.
//       --title 을 주면 스레드 미개설 작품도 진행한다(운영자 지정).
//
// 사용법 (server/.env 에 KCULTURE_SERVICE_ACCOUNT_BASE64 + TMDB_API_KEY 필요, yt-dlp 설치):
//   node scripts/find-title-highlights.js                  # 스레드 전 작품(결측 회차만)
//   node scripts/find-title-highlights.js --title 296206   # 한 작품만. --season N(기본 1)
//   node scripts/find-title-highlights.js --dry            # 판정만, 저장·리포트 안 함
//   node scripts/find-title-highlights.js --no-skip        # 제외 목록 무시하고 재확인
// 자동 저장 조건: 공식 채널(allowlist) + 회차 단일 귀속 + 길이 4~30분 + 제외어 없음
//                + 업로드일 ≥ 방영일-2일 + oEmbed 200. 애매하면 후보 리포트로.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { kcultureDb } = require('../config/firebaseKculture');
const { collectForTitle, writeCandidateReport, SKIP_TITLES } = require('../lib/collectHighlights');

const DRY = process.argv.includes('--dry');
const NO_SKIP = process.argv.includes('--no-skip');
const onlyTitle = (() => { const i = process.argv.indexOf('--title'); return i > -1 ? String(process.argv[i + 1]).replace(/\D/g, '') : null; })();
const argSeason = (() => { const i = process.argv.indexOf('--season'); return i > -1 ? parseInt(process.argv[i + 1], 10) : null; })();

(async () => {
  if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
  if (!process.env.TMDB_API_KEY) throw new Error('TMDB_API_KEY 없음');

  // 대상 열거 — 스레드 docId 접미사 `_s{시즌}e{회차}` 에서 시즌을 읽는다.
  // ⚠ 스레드 문서에는 season 필드가 **없다**. docId 파싱이 유일한 근거다.
  const snap = await kcultureDb.collection('curation_threads').get();
  const targets = new Map(); // `${titleId}|${season}` → true
  for (const d of snap.docs) {
    const m = d.id.match(/_s(\d+)e(\d+)$/);
    if (!m) continue; // 영화 등
    const id = String(d.data().titleId || '').replace(/\D/g, '');
    if (!id || (onlyTitle && id !== onlyTitle)) continue;
    targets.set(`${id}|${m[1]}`, true);
  }
  // --title 명시 = 운영자 지정 — 스레드 미개설 작품도 진행(기본 실행의 스코프는 스레드 작품만)
  if (onlyTitle && !targets.size) {
    const season = Number.isInteger(argSeason) && argSeason > 0 ? argSeason : 1;
    console.log(`⚠ ${onlyTitle}: Dari 스레드 미개설 작품 — --title 명시라 진행(S${season})`);
    targets.set(`${onlyTitle}|${season}`, true);
  }
  // 작품 단위 제외는 일괄 실행에서만 적용(--title 은 운영자가 콕 집은 것이라 통과시킨다).
  if (!onlyTitle && !NO_SKIP) {
    for (const key of [...targets.keys()]) {
      const id = Number(key.split('|')[0]);
      if (SKIP_TITLES[id]) { targets.delete(key); console.log(`⏭ ${id} 제외 — ${SKIP_TITLES[id]}`); }
    }
  }
  console.log(`대상: 작품·시즌 ${targets.size}건${onlyTitle ? ` (--title ${onlyTitle})` : ' (Dari 스레드 개설분)'} · ${DRY ? 'dry-run' : '자동 저장 모드'}`);

  const saved = [], ambiguous = [], notfound = [];
  for (const key of targets.keys()) {
    const [id, season] = key.split('|');
    const r = await collectForTitle(kcultureDb, {
      titleId: id, season: Number(season), dry: DRY,
      force: NO_SKIP || !!onlyTitle, // --title 은 플랫폼 제외도 경고 없이 통과(운영자 강제 확인용)
    });
    if (r.skipped) console.log(`  (건너뜀: ${r.skipped})`);
    saved.push(...r.saved); ambiguous.push(...r.ambiguous); notfound.push(...r.notfound);
  }

  if (!DRY) {
    const file = writeCandidateReport(ambiguous, { tag: onlyTitle || 'batch' });
    if (file) console.log(`\n후보 리포트: ${file}`);
  }
  console.log(`\n완료 — 저장 ${saved.length} / 검토 필요 ${ambiguous.length} / 후보 없음 ${notfound.length}`);
  process.exit(0);
})().catch((e) => { console.error('[find-title-highlights] FAIL', e); process.exit(1); });
