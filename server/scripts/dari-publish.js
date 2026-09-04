// ── Dari AI 큐레이터 — 회차 토론 스레드 수동 게시 CLI ─────────────────────────
// 로컬 실행 (server/.env 의 TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/dari-publish.js --title 12345 --episodes 5,6 [--season 1] [--dry] [--reseed]
// 옵션:
//   --title 12345       TMDB tv id (필수)
//   --episodes 5,6      대상 회차(쉼표 구분, 필수)
//   --season 1          시즌 (기본 1)
//   --dry               Firestore 쓰기 없이 생성 결과만 출력 (Gemini 발제 1회는 호출됨)
//   --reseed            기존 스레드의 번역 시드 재생성(번역 프롬프트 개선 반영용)
//   --hook "<요약>"      회차 훅(2026-08-15): 공식 선공개/예고 클립 요약 2~3문장(영어 권장) — 발제가 회차 밀착이 됨.
//   --hook-file <경로>   훅을 파일에서 읽음(긴 요약·따옴표 이슈 회피)
//   --body-file <경로>   발제 본문을 파일(영어 마크다운)에서 그대로 사용 — Gemini 발제 생성 생략, 번역 시드는 수행(2026-09-04 선공개 정보 브리핑용).
//                       서명 줄이 없으면 자동으로 붙인다. 제목은 "{작품명} [EP a-b]" 규칙 그대로.
//   --rebody            기존 스레드의 발제 본문을 --body-file 내용으로 교체 + 번역 재시드(제목·댓글·공감 유지) — 10일·20일 브리핑 업데이트용.
//   --pre               선공개 스레드(2026-09-04): --episodes 불필요. tid dari_s{S}pre · episode 0 · 제목 "{작품} [Pre-release]" · --body-file 필수 · --clip 필수(공식 티저).
//                       첫 방송일에는 이 옵션 없이 --episodes 1,2 로 정규 회차 스레드를 따로 연다.
//   --rehook            기존 스레드의 발제 본문을 --hook 반영으로 재생성 + 번역 재시드(제목·댓글·공감 유지)
//   --clip <videoId>    선공개 클립 유튜브 영상 id(11자) — 스레드 화면 썸네일+온디맨드 재생(2026-08-19, DECISIONS.md §11).
//                       신규 게시 시 저장, **기존 스레드에 주면 클립만 소급 주입**(발제·번역 무변경 — Gemini 미호출).
//   --clip-ep <N>       클립 대상 회차(라벨 "EP N" 표시용, 선택)
// 멱등: 같은 스레드(doc id dari_s{season}e{maxEp})가 이미 있으면 skip하고 기존 문서를 출력.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ensureDariAccount, createEpisodeThread, createMovieThread } = require('../lib/dari');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const tmdbId = parseInt(arg('title', ''), 10);
const episodes = (arg('episodes', '') || '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
const season = parseInt(arg('season', '1'), 10);
const dryRun = process.argv.includes('--dry');
const reseed = process.argv.includes('--reseed');
const backdate = arg('backdate', null); // 'auto' | 'YYYY-MM-DD' — 과거분 백필 시 createdAt 소급
const rehook = process.argv.includes('--rehook');
let hook = arg('hook', null);
const hookFile = arg('hook-file', null);
if (!hook && hookFile) hook = fs.readFileSync(hookFile, 'utf8').trim();
if (rehook && !hook) { console.error('--rehook 은 --hook 또는 --hook-file 이 필요합니다'); process.exit(1); }
const bodyFile = arg('body-file', null);
const bodyOverride = bodyFile ? fs.readFileSync(bodyFile, 'utf8').trim() : null;
const rebody = process.argv.includes('--rebody');
if (rebody && !bodyOverride) { console.error('--rebody 는 --body-file 이 필요합니다'); process.exit(1); }
if (bodyOverride && bodyOverride.length > 6000) { console.error('--body-file 본문이 6,000자를 넘습니다(브리핑은 2,000~4,000자 권장)'); process.exit(1); }
const clipId = arg('clip', null); // 선공개 클립 videoId — 형식 검증은 dari.js normClip
const clipEp = parseInt(arg('clip-ep', ''), 10);
const clip = clipId ? { videoId: clipId, ...(Number.isInteger(clipEp) && clipEp > 0 ? { ep: clipEp } : {}) } : null;

const isMovie = arg('media', 'tv') === 'movie' || process.argv.includes('--movie'); // 영화 전편형 스레드(2026-08-04)
const pre = process.argv.includes('--pre'); // 선공개 스레드(2026-09-04)
if (pre && !bodyOverride) { console.error('--pre 는 --body-file 이 필요합니다'); process.exit(1); }

if (!Number.isInteger(tmdbId) || (!isMovie && !pre && !episodes.length)) {
    console.error('사용법: node scripts/dari-publish.js --title <tmdbId> --episodes 5,6 [--season 1] [--dry] [--reseed]');
    console.error('  영화: node scripts/dari-publish.js --title <tmdbId> --movie [--dry] [--backdate YYYY-MM-DD]');
    process.exit(1);
}

console.log('[dari-publish] start', { tmdbId, media: isMovie ? 'movie' : 'tv', season, episodes, pre, dryRun, reseed, rehook, rebody, clip, hook: hook ? `${hook.slice(0, 60)}…` : null, bodyOverride: bodyOverride ? `${bodyOverride.length} chars` : null });
const t0 = Date.now();
(async () => {
    const uid = await ensureDariAccount();
    console.log(`[dari-publish] Dari uid=${uid}`);
    const r = isMovie
        ? await createMovieThread({ tmdbId, dryRun, backdate })
        : await createEpisodeThread({ tmdbId, season, episodes, dryRun, reseed, backdate, hook, rehook, clip, bodyOverride, rebody, pre });
    console.log('─'.repeat(60));
    console.log(`문서 경로 : ${r.path}${r.skipped ? '  (이미 존재 — skip)' : r.dryRun ? '  (dry-run — 미기록)' : r.rehooked ? '  (rehook — 발제 교체·재시드 완료)' : r.clipped ? '  (기존 스레드 — 클립만 주입)' : ''}`);
    if (r.clip) console.log(`클립      : ${r.clip.videoId}${r.clip.ep ? ` (EP ${r.clip.ep})` : ''}`);
    console.log(`제목      : ${r.title || '(기존 문서)'}`);
    console.log('본문      :');
    console.log(r.body || '(기존 문서 — 본문은 Firestore 참조)');
    if (r.info) { console.log('정보 블록 :'); console.log(JSON.stringify(r.info, null, 2)); }
    if (r.seededLangs) console.log(`번역 시드 : ${r.seededLangs.join(', ')}`);
    console.log('─'.repeat(60));
    console.log(`[dari-publish] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(0);
})().catch((e) => { console.error('[dari-publish] FAIL', e); process.exit(1); });
