// ── 앱 메인 콘텐츠 언어 (K-DramaLingo) ─────────────────────────────────
// 현재는 한국 콘텐츠가 메인이지만, 다른 나라 콘텐츠로 확장할 수 있다.
// 규칙(CLAUDE.md): K-DramaLingo 코드에서 "메인 콘텐츠 언어"를 'ko'로 하드코딩하지 말고
// 반드시 이 상수를 사용한다. 확장 시 PRIMARY_CONTENT_LANG 환경변수만 바꾸면 전체에 반영된다.
// - 콘텐츠 필터(discover with_original_language, 검색/인물 크레딧 필터)
// - 이미지 우선순위(콘텐츠 원어 → 영어 → TMDB 기본값)
// - 사전번역 배치 대상 열거
module.exports = {
    PRIMARY_CONTENT_LANG: process.env.PRIMARY_CONTENT_LANG || 'ko',
};
