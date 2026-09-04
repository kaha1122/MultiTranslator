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
// ⚠ 공식이어도 **회차별 편성이 아닌 채널은 넣지 않는다**(2026-08-28 검토) — 단일 회차 귀속이
//   불가해 오귀속만 만든다. 제외 확정분:
//   · 'DRAMA Voyage'(@DRAMAVoyage, JTBC 공식 "드라마봐야지") — 설명문이 "아파트 - 1,2,3,4회"처럼
//     여러 회차 묶음. 제목엔 회차가 없고 설명문 "1,2,3,4회"는 epMatch가 4회 단독으로 오인한다.
//   · '스튜디오지니'(@Studio_Genie, KT 제작사 공식) — "EP.N-1/N-2" 부분 클립 + "EP.09~10" 범위
//     묶음(BUNDLE_RE가 화/회 없는 'EP.09~10' 형태를 못 잡음)이라 최장 정렬 시 묶음이 1순위가 된다.
//     같은 작품은 'ENA DRAMA'가 회차별 풀 하이라이트를 올리므로 손실도 없다.
const OFFICIAL_CHANNELS = [
  // SBS
  'SBS 스브스 Drama', 'SBS Catch', 'SBS', 'SBS NOW 스브스나우', 'SBS Drama',
  // tvN / CJ ENM
  'tvN DRAMA', 'tvN', 'tvN D ENT', '디글 :Diggle', '디글 클래식 :Diggle Classic', 'TVING', '티빙',
  // MBC
  'MBCdrama', 'MBC 드라마 파밍', '드라마 파밍', '드파밍', 'MBCentertainment',
  // KBS
  // ⚠ 'KBS Drama Classic' — oEmbed author_name 실측값은 한글 접두어가 **없다**(2026-08-28 파일럿).
  //    'KBS 드라마 클래식 : KBS Drama Classic'만 있던 탓에 정규화 완전 일치에 걸려 구작 회차 클립이
  //    전부 비공식으로 떨어졌다(풀하우스 E5~E16 실측). 표기 변형은 둘 다 남긴다.
  'KBS Drama', 'KBS Drama Classic', 'KBS 드라마 클래식 : KBS Drama Classic', 'KBS WORLD TV', 'KBS한국방송',
  // JTBC
  'JTBC Drama', 'JTBC', 'JTBC Voyage',
  // 기타 채널·플랫폼
  'ENA', 'ENA DRAMA', 'ENA 이엔에이', '지니 TV', 'Genie TV 지니 TV', '채널A', '채널A 드라마', 'Channel A',
  'MBN', 'MBN 드라마', '쿠팡플레이', 'Coupang Play 쿠팡플레이', '쿠팡플레이 Coupang Play',
  // ⚠ 'wavve 웨이브' — oEmbed author_name 실측값은 **영문+한글이 한 덩어리**다(2026-08-28).
  //    'Wavve'와 '웨이브'를 따로 넣어 두면 정규화 완전 일치에 걸려 전부 비공식으로 떨어진다
  //    (약한영웅 Class 1 실측: 1~4화 하이라이트가 존재하는데 8회 전량 "공식 채널 후보 없음").
  //    → 채널을 추가할 땐 반드시 oEmbed author_name 을 그대로 넣을 것. 세 번째 같은 사고다
  //    (DRAMA Voyage / KBS Drama Classic / wavve 웨이브).
  'Netflix Korea 넷플릭스 코리아', 'Netflix K-Content', 'wavve 웨이브', 'Wavve', '웨이브',
  // 공개 전 티저(upcoming-research) 실측 author_name — 2026-08-30 첫 실행(재혼 황후 CDhtpYWNEuk / 인턴 dtpyrKDJPRg)
  'Disney Plus Korea 디즈니 플러스 코리아', 'Warner Bros. Korea',
  // 제작사 공식 채널 — 방송사 채널이 회차 클립을 올리지 않아 제작사가 직접 올리는 경우(2026-09-01 추가).
  // '캔버스엔'(Canvas N) = 「그래, 이혼하자」(276470) 제작사. 회차 예고를 이 채널만 올리며
  // (KBS Drama 채널엔 없다), 제목이 "[N화 예고] … ＜그래, 이혼하자＞ 9월 2일 밤 11시 방송" 형태라
  // 회차 단일 귀속이 명확하다(§13의 제외 사유인 묶음 편성이 아니다). oEmbed author_name 실측값 그대로.
  // ⚠ 이 채널이 올리는 것은 30~40초 예고라 하이라이트 길이 게이트(4~30분)에 애초에 걸리지 않는다 —
  //   find-title-highlights가 예고를 하이라이트로 오인할 위험은 없다.
  '캔버스엔',
  // 영화 배급사·제작사 공식 채널 — 2026-09-01 추가(upcoming-scout 첫 정기 실행에서 구조적 공백 발견:
  // 추석 개봉작 4편이 화제성이 아니라 allowlist 부재로 전량 탈락했다). 전부 oEmbed author_name 실측 일치 확인.
  // 영화는 회차 개념이 없어 하이라이트 회차 오귀속 위험이 없다.
  '롯데엔터테인먼트', 'CJ ENM Movie', '플레이그램', 'hivemedia_corp',
  // '스튜디오지니'(KT Studio Genie, 지니 TV 오리지널 제작사, UCXmRJfZ3atLVLDiO5Ufycvw) — 2026-09-02 추가.
  // 「연애박사」 무드티저 2편을 Disney Plus Korea·ENA DRAMA보다 하루 먼저(08-31) 올려 teaser-watch가 하루 늦게 잡았다.
  // oEmbed author_name 실측값 '스튜디오지니' 그대로. 제작사 채널이라 회차 클립도 올릴 수 있다 — 하이라이트 오귀속이 보이면 재검토.
  '스튜디오지니',
  // ⚠ '너에게 다이브'(작품 전용 공식 채널)는 **보류**한다 — 작품 단위 채널이라 회차 귀속 규칙이 다르고,
  //   현재 올라온 것도 티저가 아니라 대본리딩 영상이다. 실제 티저가 올라오면 그때 판단한다.
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
