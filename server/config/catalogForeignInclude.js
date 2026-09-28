// ── 원어가 PRIMARY_CONTENT_LANG가 아닌데 카탈로그에 포함하는 작품 (2026-09-28) ────────────
// 검색·인물 크레딧은 original_language === PRIMARY_CONTENT_LANG 인 tv/movie만 통과시킨다.
// 한일 공동제작처럼 원어가 다른 작품을 사용자가 "포함"으로 결정하면 여기에 TMDB id를 넣는다.
//   - 키: `${media}:${id}` (tv와 movie id 공간이 다르다)
//   - 카탈로그 문서 titles/{id}의 ko·원어 제목은 tmdbBackfill이 원어를 보고 채운다(processTitle ② 참조).
// 추가할 때는 LEDGER(KCulture content/upcoming/LEDGER.md)에 결정 기록을 같이 남긴다.
const FOREIGN_INCLUDE = new Set([
    'tv:305551', // 메리 베리 러브 — Disney+ 한일 공동제작(원어 ja), 2026-10-07 공개. 2026-09-28 사용자 포함 결정
]);

const isForeignIncluded = (media, id) => FOREIGN_INCLUDE.has(`${media}:${Number(id)}`);

module.exports = { FOREIGN_INCLUDE, isForeignIncluded };
