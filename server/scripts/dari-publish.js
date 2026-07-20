// ── Dari AI 큐레이터 — 회차 토론 스레드 수동 게시 CLI ─────────────────────────
// 로컬 실행 (server/.env 의 TMDB_API_KEY, GEMINI_API_KEY, KCULTURE_SERVICE_ACCOUNT_BASE64 필요):
//   cd server && node scripts/dari-publish.js --title 12345 --episodes 5,6 [--season 1] [--dry] [--reseed]
// 옵션:
//   --title 12345       TMDB tv id (필수)
//   --episodes 5,6      대상 회차(쉼표 구분, 필수)
//   --season 1          시즌 (기본 1)
//   --dry               Firestore 쓰기 없이 생성 결과만 출력 (Gemini 발제 1회는 호출됨)
//   --reseed            기존 스레드의 번역 시드 재생성(번역 프롬프트 개선 반영용)
// 멱등: 같은 스레드(doc id dari_s{season}e{maxEp})가 이미 있으면 skip하고 기존 문서를 출력.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { ensureDariAccount, createEpisodeThread } = require('../lib/dari');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

const tmdbId = parseInt(arg('title', ''), 10);
const episodes = (arg('episodes', '') || '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
const season = parseInt(arg('season', '1'), 10);
const dryRun = process.argv.includes('--dry');
const reseed = process.argv.includes('--reseed');
const backdate = arg('backdate', null); // 'auto' | 'YYYY-MM-DD' — 과거분 백필 시 createdAt 소급

if (!Number.isInteger(tmdbId) || !episodes.length) {
    console.error('사용법: node scripts/dari-publish.js --title <tmdbId> --episodes 5,6 [--season 1] [--dry] [--reseed]');
    process.exit(1);
}

console.log('[dari-publish] start', { tmdbId, season, episodes, dryRun, reseed });
const t0 = Date.now();
(async () => {
    const uid = await ensureDariAccount();
    console.log(`[dari-publish] Dari uid=${uid}`);
    const r = await createEpisodeThread({ tmdbId, season, episodes, dryRun, reseed, backdate });
    console.log('─'.repeat(60));
    console.log(`문서 경로 : ${r.path}${r.skipped ? '  (이미 존재 — skip)' : r.dryRun ? '  (dry-run — 미기록)' : ''}`);
    console.log(`제목      : ${r.title || '(기존 문서)'}`);
    console.log('본문      :');
    console.log(r.body || '(기존 문서 — 본문은 Firestore 참조)');
    if (r.info) { console.log('정보 블록 :'); console.log(JSON.stringify(r.info, null, 2)); }
    if (r.seededLangs) console.log(`번역 시드 : ${r.seededLangs.join(', ')}`);
    console.log('─'.repeat(60));
    console.log(`[dari-publish] DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(0);
})().catch((e) => { console.error('[dari-publish] FAIL', e); process.exit(1); });
