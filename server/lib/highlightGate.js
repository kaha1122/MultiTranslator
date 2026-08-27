// ── 회차 하이라이트 저장 게이트 (2026-08-28) ─────────────────────────────────
// 에이전트/스크립트가 무엇을 가져오든, titles/{id}/media/clips.hls 에 실리기 전에
// 여기서 기계 검증한다(사람·LLM 실수 차단 — 앱 사용자에게 노출되는 데이터).
//   ① oEmbed 200 = 영상 존재 + 외부 임베드 가능(401=임베드 차단, 404=삭제/비공개)
//   ② 채널 allowlist = 방송사/플랫폼 공식 채널만(팬 편집·리뷰 채널 차단)
//   ③ 저장 시 hlsMeta(제목·채널·시각)를 함께 남겨 사후 검증(verify)·감사에 쓴다.
// 사용처: scripts/set-title-highlight.js(단건), scripts/find-title-highlights.js(수집),
//         scripts/verify-title-highlights.js(사후 검증).

// 공식 채널 allowlist — oEmbed author_name 과 "정규화 후 완전 일치"로 비교.
// (부분 일치는 "tvN DRAMA 명장면"류 팬 채널 오인 위험 → 완전 일치만.)
// 새 공식 채널을 발견하면 여기 한 줄 추가한다(에이전트 절차: 공식 여부 확인 후 추가).
const OFFICIAL_CHANNELS = [
  // SBS
  'SBS 스브스 Drama', 'SBS Catch', 'SBS', 'SBS NOW 스브스나우', 'SBS Drama',
  // tvN / CJ ENM
  'tvN DRAMA', 'tvN', 'tvN D ENT', '디글 :Diggle', '디글 클래식 :Diggle Classic', 'TVING', '티빙',
  // MBC
  'MBCdrama', 'MBC 드라마 파밍', '드라마 파밍', 'MBCentertainment',
  // KBS
  'KBS Drama', 'KBS 드라마 클래식 : KBS Drama Classic', 'KBS WORLD TV', 'KBS한국방송',
  // JTBC
  'JTBC Drama', 'JTBC', 'JTBC Voyage',
  // 기타 채널·플랫폼
  'ENA', '지니 TV', 'Genie TV 지니 TV', '채널A', '채널A 드라마', 'Channel A',
  'MBN', 'MBN 드라마', '쿠팡플레이', 'Coupang Play 쿠팡플레이',
  'Netflix Korea 넷플릭스 코리아', 'Netflix K-Content', 'Wavve', '웨이브',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[\s:·,._-]+/g, '');
const NORM_SET = new Set(OFFICIAL_CHANNELS.map(norm));

function isOfficialChannel(name) {
  return NORM_SET.has(norm(name));
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

module.exports = { OFFICIAL_CHANNELS, isOfficialChannel, fetchOembed, gateHighlight, saveHighlight };
