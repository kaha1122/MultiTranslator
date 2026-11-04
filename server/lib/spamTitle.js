// ── TMDB 제목 훼손(스팸) 가드 (2026-11-05) ──────────────────────────────────
// TMDB는 공개 편집 DB라 제목이 광고 문구로 바뀌는 일이 있다. 실사례: 「학교 2013」(tv:46596) 원제가
// `淫片网 448832𝟵.com 黄漫片网 448856𝟵.com`으로 훼손돼 ko·zh-CN 상세·인물 필모에 그대로 노출됐고,
// 공식 제목 갱신(refreshOfficialTitles)이 zh-CN searchTitle에 저장까지 했다.
// 판정은 보수적으로 — 정상 제목을 스팸으로 오판하면 그게 더 큰 사고다.
//   ① 수학 영숫자 기호(U+1D400–1D7FF, 𝟵 등): 필터 회피용. 정상 제목에 쓰일 일이 없다.
//   ② 도메인 + (한자·가나·한글 또는 5자리 이상 숫자): 광고 문구 형태.
//      도메인만 있는 라틴 제목은 통과 — 「빤스 벗고 덤벼라」(movie:569137)의 영문 제목 `www.whitelover.com`이 실제 제목일 수 있다.
//   ※ '网' 같은 글자 기준은 금지 — 「거미집」(蜘蛛网)·「그물」(网) 등 정상 중국어 제목 13건이 걸린다(2026-11-05 전수 검사).
const MATH_ALNUM = /[\u{1D400}-\u{1D7FF}]/u;
const DOMAIN = /(?:https?:\/\/|www\.)|[a-z0-9-]{2,}\.(?:com|net|cn|top|xyz|vip|cc|io|me|info|org|tv|app|site|club|live|bet)\b/i;
const CJK_OR_DIGITS = /[぀-ヿ㐀-鿿가-힣]|\d{5,}/;

function isSpamTitle(s) {
    const t = String(s || '');
    if (!t) return false;
    if (MATH_ALNUM.test(t)) return true;
    return DOMAIN.test(t) && CJK_OR_DIGITS.test(t);
}

module.exports = { isSpamTitle };
