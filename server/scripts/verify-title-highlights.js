// ── 회차 하이라이트 사후 검증 (2026-08-28) — 스크립트 2번 ─────────────────────
// 저장된 전체 hls 엔트리(titles/*/media/clips)를 순회하며 링크 부패를 감시한다:
//   · oEmbed 200 여부 — 404(삭제·비공개)·401(임베드 차단)·기타 오류 감지
//   · 채널 allowlist 여부 — allowlist 개정 후 소급 점검(hlsMeta 없던 초기 저장분 포함)
//   · 제목 변경 감지(참고용) — hlsMeta.t 와 현재 제목 대조
// 기본은 리포트만. --prune 은 죽은 엔트리(oEmbed 비-200)를 백업(JSONL) 후 제거 —
// 앱은 해당 회차가 TMDB 스틸로 자연 폴백되고, 다음 find 실행이 재수집을 시도한다.
// 운영 주기: 월 1회 또는 find 대량 실행 직후.
//
// 사용법: node scripts/verify-title-highlights.js [--prune]
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { kcultureDb } = require('../config/firebaseKculture');
const { fetchOembed, isOfficialChannel } = require('../lib/highlightGate');
const { FieldValue } = require('firebase-admin/firestore');

const PRUNE = process.argv.includes('--prune');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!kcultureDb) throw new Error('kcultureDb 없음 — KCULTURE_SERVICE_ACCOUNT_BASE64 필요');
  const snap = await kcultureDb.collectionGroup('media').get();
  const rows = []; // { ref, titleId, key, videoId, meta }
  for (const d of snap.docs) {
    if (d.id !== 'clips') continue;
    const hls = (d.data() || {}).hls || {};
    const hlsMeta = (d.data() || {}).hlsMeta || {};
    const titleId = d.ref.parent.parent.id;
    for (const [key, videoId] of Object.entries(hls)) rows.push({ ref: d.ref, titleId, key, videoId, meta: hlsMeta[key] || null });
  }
  console.log(`검사 대상: 작품 ${new Set(rows.map((r) => r.titleId)).size}개 / 하이라이트 ${rows.length}건 · ${PRUNE ? '⚠ --prune(죽은 엔트리 제거)' : '리포트만'}`);

  const dead = [], blocked = [], offlist = [], renamed = [];
  let ok = 0;
  for (const r of rows) {
    const oe = await fetchOembed(r.videoId);
    if (!oe.ok) {
      (oe.status === 401 ? blocked : dead).push({ ...r, status: oe.status });
      console.log(`✗ ${r.titleId} ${r.key} ${r.videoId} — oEmbed ${oe.status}${oe.status === 401 ? '(임베드 차단)' : '(삭제/비공개)'}`);
    } else {
      ok++;
      if (!isOfficialChannel(oe.author)) {
        offlist.push({ ...r, author: oe.author });
        console.log(`⚠ ${r.titleId} ${r.key} ${r.videoId} — 채널 allowlist 밖: "${oe.author}"`);
      }
      if (r.meta?.t && oe.title && r.meta.t !== oe.title.slice(0, 140)) renamed.push({ ...r, now: oe.title });
    }
    await sleep(150); // 유튜브 oEmbed 예의상 간격
  }

  console.log(`\n결과 — 정상 ${ok} / 삭제·비공개 ${dead.length} / 임베드 차단 ${blocked.length} / 비-allowlist ${offlist.length} / 제목 변경 ${renamed.length}`);
  if (renamed.length) renamed.forEach((r) => console.log(`  (참고) 제목 변경 ${r.titleId} ${r.key}: "${r.meta.t.slice(0, 40)}" → "${r.now.slice(0, 40)}"`));
  if (offlist.length) console.log('  → 비-allowlist 건은 공식 채널이면 lib/highlightGate.js OFFICIAL_CHANNELS 에 추가, 아니면 --prune 대상 검토');

  const bad = [...dead, ...blocked];
  if (!PRUNE || !bad.length) process.exit(0);

  const logDir = path.join(__dirname, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const backup = path.join(logDir, `prune-highlights-${Date.now()}.jsonl`);
  for (const r of bad) {
    fs.appendFileSync(backup, JSON.stringify({ path: r.ref.path, key: r.key, videoId: r.videoId, status: r.status, meta: r.meta }) + '\n');
    await r.ref.update({ [`hls.${r.key}`]: FieldValue.delete(), [`hlsMeta.${r.key}`]: FieldValue.delete(), updatedAt: new Date() });
    console.log(`제거: ${r.ref.path} ${r.key} (${r.videoId}, oEmbed ${r.status})`);
  }
  console.log(`백업: ${backup}`);
  process.exit(0);
})().catch((e) => { console.error('[verify-title-highlights] FAIL', e); process.exit(1); });
