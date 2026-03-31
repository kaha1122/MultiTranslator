---
name: bug-patterns
description: 재발 방지용 버그 패턴 — TDZ, 아이콘 padding, Library 스크롤, setTimeout 스크롤, i18n 키 fallback 등
type: feedback
---

## useState 초기값에서 TDZ 에러 (2026-03-13)
**증상**: 프로덕션 번들에서 `Cannot access 'ue' before initialization` 런타임 에러 (앱 로드 불가)
**원인**: `useState` 초기값에서 아래쪽에 선언된 `const` 변수(`sourceLang`)를 참조 → Rollup 번들링 후 TDZ 발생
**해결**: 초기값에 정적 기본값 사용, 실제 값은 이벤트 핸들러에서 세팅

> **핵심 룰**: `useState()` 초기값에서 같은 컴포넌트의 다른 state 변수를 참조하지 말 것! 특히 아래쪽에 선언된 변수는 TDZ 에러 발생. 로컬 dev에선 안 터지고 프로덕션 빌드에서만 터질 수 있음.

## 아이콘 버튼 padding 누락 (2026-03-07)
**증상**: 커스텀 원형 아이콘 버튼이 흰 원만 보이고 아이콘이 보이지 않음
**원인**: `index.css`의 전역 `button { padding: 0.6em 1.2em; }` → 작은 버튼의 콘텐츠 영역이 축소
**해결**: 커스텀 크기 원형 버튼에 반드시 `padding: 0` 추가

> **핵심 룰**: 전역 `button` 스타일 덮어쓰는 커스텀 버튼은 항상 `padding: 0` 명시!

## 숫자 입력 즉시 기본값 리셋 (2026-03-13)
**증상**: 목표점수 입력칸에서 숫자를 지우면 즉시 기본값(80)으로 리셋되어 새 값 입력 불가
**원인**: `parseInt(e.target.value) || defaultValue`가 빈 문자열을 0으로 변환 → 즉시 기본값 적용
**해결**: 표시용 `rawGoal` 상태 분리, 빈 문자열 허용, `onBlur`에서만 기본값 복원

> **핵심 룰**: controlled number input에서 빈 값 허용 필요 시 별도 문자열 상태 + onBlur 검증 패턴 사용!

## setTimeout 기반 스크롤 간헐적 실패 (2026-03-13)
**증상**: Scene 카드 생성 후 스크롤이 될 때도 있고 안 될 때도 있음
**원인**: `setTimeout(150ms)` 사용 시 React 상태 업데이트 → 리렌더 → DOM 페인트가 150ms 안에 완료되지 않으면 `ref.current`가 null
**해결**: `useEffect` + `requestAnimationFrame` 패턴으로 교체 — React가 DOM 업데이트를 완료한 후에만 실행

> **핵심 룰**: 조건부 렌더링 요소에 대한 스크롤은 `setTimeout`이 아닌 상태 기반 `useEffect`로 처리할 것!

## i18n 키 경로가 UI에 그대로 표시 (2026-03-13)
**증상**: 태그에 `tags.action.Initiating`이 그대로 표시됨
**원인**: `t()` 함수가 키를 못 찾으면 키 경로 전체를 반환 → truthy라 `|| fallback` 작동 안 됨
**해결**: `tTag()` 헬퍼 — 반환값이 prefix로 시작하면 locale 미등록으로 판단, 원래 영문 값 fallback

> **핵심 룰**: `t(key) || fallbackValue` 패턴은 키 미등록 시 작동 안 됨. 동적 키에는 반드시 `tTag()` 헬퍼 사용!

## onSnapshot이 삭제된 Firestore 문서를 재생성 (2026-03-15)
**증상**: 회원탈퇴 후 Firestore에서 유저 문서가 여전히 남아있음
**원인**: 서버가 문서 삭제 → 클라이언트 `onSnapshot`이 "문서 없음" 감지 → `setDoc`으로 자동 재생성
**해결**: `accountDeletionInProgress` 모듈 레벨 플래그 추가, 탈퇴 중에는 `setDoc` 스킵. 페이지 리로드 후 자동 리셋.

> **핵심 룰**: `onSnapshot`에서 "문서 없음 → 자동 생성" 패턴이 있을 때, 의도적 삭제(탈퇴 등)와 구분하는 플래그가 필요!

## Firestore doc.delete()는 서브컬렉션을 삭제하지 않음 (2026-03-15)
**증상**: 회원탈퇴 후 메인 문서는 삭제되었으나 dailyProgress, pronunciation_records 등 서브컬렉션이 남아 유령 문서 표시
**원인**: Firestore의 `doc().delete()`는 해당 문서만 삭제, 하위 서브컬렉션은 자동 삭제 안됨
**해결**: `listCollections()` → `listDocuments()` → `batch.delete()` 재귀 삭제 후 메인 문서 삭제

> **핵심 룰**: Firestore 문서 삭제 시 서브컬렉션이 있으면 반드시 `listCollections()`로 재귀 삭제!

## Library 스크롤 + 팝업 충돌 (2026-03-12)
**증상**: 북마크 후 Library로 이동 시 스크롤이 안 됨
**원인**: DailyProgressPopup 오버레이가 동시에 표시되면서 scrollIntoView 무효화
**해결**: `progressPopupOpen` prop을 Library에 전달, 팝업 닫힌 후 스크롤 실행
