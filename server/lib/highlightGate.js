// ── 회차 하이라이트 저장 게이트 (2026-08-28) ─────────────────────────────────
// 에이전트/스크립트가 무엇을 가져오든, titles/{id}/media/clips.hls 에 실리기 전에
// 여기서 기계 검증한다(사람·LLM 실수 차단 — 앱 사용자에게 노출되는 데이터).
//   ① oEmbed 200 = 영상 존재 + 외부 임베드 가능(401=임베드 차단, 404=삭제/비공개)
//   ② 채널 allowlist = 방송사/플랫폼 공식 채널만(팬 편집·리뷰 채널 차단)
//   ③ 저장 시 hlsMeta(제목·채널·시각)를 함께 남겨 사후 검증(verify)·감사에 쓴다.
// 사용처: scripts/set-title-highlight.js(단건), scripts/find-title-highlights.js(수집),
//         scripts/verify-title-highlights.js(사후 검증).

// 공식 채널 SSOT = ../config/channels.json (2026-10-28 통합 — 종전 이 파일의 OFFICIAL_CHANNELS 배열 +
//   KCulture scripts/thread-eligibility.mjs OTT_CHANNEL_REGION + scripts/teaser-watch.mjs CHANNELS 세 목록을 하나로).
//   게이트 키 = name + aliases, oEmbed author_name 과 "정규화 후 완전 일치"(부분 일치는 "tvN DRAMA 명장면"류 팬 채널 오인 위험).
//   채널 추가 절차: KCulture `node scripts/lib/channels.mjs --resolve <@handle|UC…>` 로 author_name·channelId를 실측해 레코드를
//   받아 channels.json 에 붙이고 `node scripts/channels-verify.js` 통과 후 커밋(main push = 배포). 이름을 손으로 적지 말 것 —
//   표기가 다르면 전부 비공식으로 떨어진다(3연속 실사고: DRAMA Voyage / KBS Drama Classic / wavve 웨이브, 2026-10-28 통합 검증에서
//   추가 발견: play 채널A·MBN Entertainment·플레이그램→MDS스피어 개명).
//   ⚠ 회차별 편성이 아닌 채널의 묶음 영상은 단일 회차 귀속이 불가하다 → 레코드의 episodic:false 로 표시하고, 제외가 필요한 채널은
//   excluded 절에 사유와 함께 둔다(DRAMA Voyage). Disney+ 지역 채널처럼 플랫폼 구조상 회차별 영상이 없는 경우는 작품 단위 영상이
//   스레드 클립 역할을 대신한다(2026-10-20 예외) — 길이 게이트(collectHighlights DUR_MIN 240초)가 hls 저장을 구조적으로 막는다.
//   Viu 지역 채널은 회차별 영상을 올리므로 그 안전 속성에 기대지 말 것(2026-10-28, channels.json 각 레코드 note 참조).
const crypto = require('crypto');
const CHANNEL_DATA = require('../config/channels.json');
const CHANNELS = CHANNEL_DATA.channels;
const EXCLUDED = CHANNEL_DATA.excluded || [];
const CHANNELS_VERSION = crypto.createHash('sha1').update(JSON.stringify(CHANNEL_DATA)).digest('hex').slice(0, 10);
const OFFICIAL_CHANNELS = CHANNELS.flatMap((c) => [c.name, ...(c.aliases || [])]);

const norm = (s) => String(s || '').toLowerCase().replace(/[\s:·,._-]+/g, '');
const NORM_SET = new Set(OFFICIAL_CHANNELS.map(norm));
const BY_NORM = new Map();
for (const c of CHANNELS) for (const k of [c.name, ...(c.aliases || [])]) BY_NORM.set(norm(k), c);

function isOfficialChannel(name) {
  return NORM_SET.has(norm(name));
}
// 채널 레코드 조회(name 또는 alias) — kind·platform·market·episodic·titleId 를 쓰는 소비자용
function channelByName(name) {
  return BY_NORM.get(norm(name)) || null;
}

// oEmbed 조회 — status 200이면 존재+임베드 가능. title/author_name은 게이트·메타 저장에 사용.
async function fetchOembed(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json();
    return { ok: true, status: 200, title: j.title || '', author: j.author_name || '' };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

// 게이트 판정 — 저장 전 필수 통과. forceChannel: 채널 검사만 우회(oEmbed는 우회 불가).
async function gateHighlight(videoId, { forceChannel = false } = {}) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(String(videoId))) return { ok: false, reason: 'bad_video_id' };
  const oe = await fetchOembed(videoId);
  if (!oe.ok) return { ok: false, reason: `oembed_${oe.status || 'error'}`, ...oe };
  if (!forceChannel && !isOfficialChannel(oe.author)) {
    return { ok: false, reason: 'channel_not_allowlisted', title: oe.title, author: oe.author };
  }
  return { ok: true, title: oe.title, author: oe.author };
}

// 게이트 통과분 저장 — hls(videoId) + hlsMeta(제목·채널·시각) set-merge(멱등).
// gate 결과를 재사용해 oEmbed 이중 호출을 피한다(meta 인자).
async function saveHighlight(db, { titleId, season, ep, videoId, meta }) {
  const key = `s${season}e${ep}`;
  await db.doc(`titles/${titleId}/media/clips`).set({
    hls: { [key]: videoId },
    hlsMeta: { [key]: { v: videoId, t: String(meta?.title || '').slice(0, 140), ch: meta?.author || null, at: new Date().toISOString() } },
    updatedAt: new Date(),
  }, { merge: true });
  return key;
}

module.exports = { OFFICIAL_CHANNELS, CHANNELS, EXCLUDED, CHANNELS_VERSION, isOfficialChannel, channelByName, fetchOembed, gateHighlight, saveHighlight };
