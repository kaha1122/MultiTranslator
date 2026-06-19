---
name: i18n 키 완전성 — 10개 locale 일괄 추가
description: 새 i18n 키 추가 시 10개 locale 파일 모두에 동시 추가 + npm run check-i18n 검증 의무화
type: feedback
---

**룰**: 새 i18n 키 추가 시 반드시 **10개 locale 파일 모두**(ko/en/ja/zh-CN/vi/fr/de/es/ru/pt-BR)에 일괄 추가. 작업 후 `npm run check-i18n` 으로 누락 검증 필수.

**Why:**
2026-05-04 Sprint 3-3 의 `freeTalk.guide*` 5개 키가 ko/en 에서 누락된 사고 발생.
- Sprint 1+2 시 ko/en 에 freeTalk 블록 만들 때 guide* 빠뜨림
- Sprint 3-3 에서 8개 언어에 guide* 추가하면서 ko/en 보강을 잊음
- 사용자 PC 한국어 환경에서 'freeTalk.guideTitle' 등 키 자체가 화면에 노출 → 첫 인상 망침
- 빌드는 통과(`t()` 결과는 항상 string), 런타임에서만 발견

ChatBubble/FreeTalkingChat 등에서 사용한 `t?.(key) || 'fallback'` 패턴은 키가 없을 때
fallback 적용이 안 됨 — `t()` 가 키 자체 문자열(truthy) 반환하기 때문. 즉 fallback 은
`t()` 가 falsy 반환할 때만 작동하는 안전장치이지, 누락 자체를 막아주지 않는다.

**How to apply:**
- 새 i18n 키 추가 시:
  1. `src/locales/en.json` 에 추가 (reference)
  2. 나머지 9개 locale 에 동일 키를 자국어 번역으로 추가 (10개 모두)
  3. `npm run check-i18n` 실행하여 0 missing 확인
  4. 누락 발견 시 즉시 보강
- 코드에서 `t?.(key) || 'fallback'` 의 fallback 은 보험일 뿐, 누락을 정당화하지 않음
- check-i18n 도구: `scripts/check-i18n.mjs`
  - en.json 을 reference 로 9개 비교
  - 점표기법 키 평탄화 후 set diff
  - 누락 ≥ 1 → exit 1 + 누락 목록 + 해결 안내
  - 추가 키(en 에 없는데 다른 언어에 있는) → warning (오타/leftover 의심)

**참고**: `landing.*` 같이 일부 키는 기존부터 누락된 상태(2026-05-04 기준 222개).
신규 키는 깨끗하게 시작하되, 기존 누락은 별도 정리 사이클로 진행.
