---
name: feedback_regression_check
description: 코드 변경 시 기존 기능이 모두 정상 재현되는지 사전 검증 — 변경의 후속 부수효과 차단
type: feedback
originSessionId: 553f58bc-111d-42c0-af23-914db9323c7c
---
# 코드 변경 시 기존 기능 재현 검증 필수

**원칙**: 코드 변경 시, 변경에 따른 추가 버그 발생이 되지 않도록 기존 Code의 모든 기능이 제대로 재현되는 상황에서 신규 코드 변경이 적용될 수 있도록 각별히 코드를 꼼꼼히 점검해야 함.

**Why:**
2026-05-01 Strategy A(백그라운드 익명 사인인) 작업 시, AuthProvider의 loading 차단을 제거하여 자식 컴포넌트의 마운트 타이밍을 바꿨음. 이로 인해 [App.jsx:264](src/App.jsx#L264)의 버전 추적 useEffect가 dep 누락(`!!profile` 미포함) 때문에 신규 유저에서 재실행되지 않는 회귀 버그 발생. 결과: `currentNativeVersion`/`currentNativePlatform` 미기록 → `supportsFeature('notifications')` false → 푸시 알림 모달 미노출 → `fcmTokens` 미등록까지 연쇄 실패. **사이드 이펙트 점검을 1회 수행했음에도 useEffect dep 단계까지 파고들지 않아 놓친 사례** — "변경 영향 표면적 점검"으로는 부족하고, 변경된 흐름에 의존하는 모든 코드가 새 흐름에서도 동일하게 동작하는지까지 확인해야 함.

**How to apply:**
- **타이밍/생명주기/상태 흐름 변경**(loading 게이트 제거, await 제거, mount 순서 변경, Provider value 변경 등)이 일어날 때, 해당 흐름에 의존하는 모든 useEffect/이벤트 핸들러/조건부 렌더의 dep 배열과 가드 조건을 전수 검토.
- **dep 배열 검토 체크리스트**:
  - 새 흐름에서 dep 값이 어떤 순서로 변하는지 추적
  - 모든 가드(`if (!user) return`, `if (!profile) return` 등)가 새 흐름에서도 통과 가능한지 확인
  - dep 값이 undefined→undefined로 유지되어 React가 재실행 트리거 못 잡는 경우 보강(`!!user`, `!!profile` 등)
- **검증 방법 우선순위**:
  1. 변경 흐름이 이전과 다르면 dev 빌드로 실제 동작 확인 (콘솔 로그 + Firestore 문서 비교)
  2. 신규 유저 첫 부팅 흐름은 *직접 데이터 삭제* 후 재현 — 재방문 케이스만 보면 회귀 못 잡음
  3. AuthProvider/Provider/State 흐름 변경은 모든 useEffect dep와 가드를 grep해서 영향받는 곳 목록화
- 빌드 통과 + 한 번 정상 동작 ≠ 검증 완료. 기존 모든 기능이 새 흐름에서도 발화하는지 확인이 핵심.
- 관련 메모리: [feedback_side_effect_check.md](feedback_side_effect_check.md) (사이드 이펙트 일반 원칙) — 이 파일은 그 중에서도 "기존 동작 재현"에 특화.
