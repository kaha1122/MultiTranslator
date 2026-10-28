#!/usr/bin/env node
// ── channels.json 검증 (2026-10-28) ─────────────────────────────────────────────
// 무엇을: server/config/channels.json 의 스키마·중복·oEmbed 실측 일치를 기계 검사한다 — 채널을 추가·수정한 뒤 커밋 전에 돌린다.
//   ① 스키마: name/kind/market/langs/episodic/channelId 형식   ② 게이트 키(이름+별칭) 정규화 중복 0, excluded 와 충돌 0
//   ③ (네트워크) evidence[0] 영상의 oEmbed author_name 이 name 또는 alias 와 정규화 일치 — 채널 개명·오기를 잡는다
//      (실사고 4건: DRAMA Voyage / KBS Drama Classic / wavve 웨이브 / 플레이그램→MDS스피어 개명)
// 실행: node scripts/channels-verify.js [--quick(네트워크 생략)] [--only <name 부분일치>]   exit 1 = 실패 있음
const path = require('path');
const DATA = require(path.join(__dirname, '..', 'config', 'channels.json'));
const { fetchOembed } = require('../lib/highlightGate');
const norm = (s) => String(s || '').toLowerCase().replace(/[\s:·,._-]+/g, '');
const KINDS = new Set(['broadcaster', 'ott-kr', 'ott-regional', 'production', 'distributor', 'title-official']);
const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const fails = [];
const fail = (m) => { fails.push(m); console.log('  ❌ ' + m); };

(async () => {
  const chans = DATA.channels || [];
  console.log(`channels.json — ${chans.length}개 · updatedAt ${DATA.updatedAt}`);
  // ① 스키마
  for (const c of chans) {
    if (!c.name || typeof c.name !== 'string') fail(`name 누락: ${JSON.stringify(c).slice(0, 80)}`);
    if (!KINDS.has(c.kind)) fail(`${c.name}: kind 값 이상 「${c.kind}」`);
    if (!c.market) fail(`${c.name}: market 누락`);
    if (!Array.isArray(c.langs) || !c.langs.length) fail(`${c.name}: langs 누락`);
    if (typeof c.episodic !== 'boolean') fail(`${c.name}: episodic 은 boolean`);
    if (c.channelId && !/^UC[\w-]{20,}$/.test(c.channelId)) fail(`${c.name}: channelId 형식 「${c.channelId}」`);
    if (c.kind === 'title-official' && !c.titleId) fail(`${c.name}: title-official 인데 titleId 없음`);
    if (c.watch && !c.channelId) fail(`${c.name}: watch 가 있는데 channelId 없음(순회 불가)`);
  }
  // ② 중복·충돌
  const keys = chans.flatMap((c) => [c.name, ...(c.aliases || [])].map((k) => [norm(k), k, c.name]));
  const seen = new Map();
  for (const [n, k, owner] of keys) { if (seen.has(n)) fail(`게이트 키 중복: 「${k}」(${owner}) ↔ ${seen.get(n)}`); else seen.set(n, owner); }
  for (const e of DATA.excluded || []) if (seen.has(norm(e.name))) fail(`excluded 「${e.name}」가 channels 에도 있음(${seen.get(norm(e.name))})`);
  // ③ oEmbed 실측
  if (!quick) {
    let n = 0;
    for (const c of chans) {
      if (only && !c.name.includes(only)) continue;
      const v = (c.evidence || [])[0];
      if (!v) { console.log(`  · ${c.name}: evidence 없음 — 미검증(legacy)`); continue; }
      const oe = await fetchOembed(v);
      n++;
      if (!oe.ok) { console.log(`  ⚠ ${c.name}: oEmbed ${oe.status} (${v}) — 영상 삭제/임베드 차단, evidence 교체 권장`); continue; }
      const match = [c.name, ...(c.aliases || [])].some((k) => norm(k) === norm(oe.author));
      if (!match) fail(`${c.name}: author_name 실측 「${oe.author}」 ≠ 등재명 — 개명 또는 오기(evidence ${v})`);
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`  oEmbed 검사 ${n}건`);
  }
  console.log(fails.length ? `\n실패 ${fails.length}건` : '\n✅ 통과');
  process.exit(fails.length ? 1 : 0);
})();
