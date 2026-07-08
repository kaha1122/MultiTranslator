---
name: changes-0531
description: 2026-05-31 발열 전면 재검토 + 무거운 5개 탭 lazy-mount 적용 + v1.5.86 production 배포
metadata: 
  node_type: memory
  type: project
  originSessionId: 70f54104-7050-44c5-8fb1-025c09ebbf9c
---

# 2026-05-31: 발열 전면 재검토 + 탭 lazy-mount (v1.5.86)

heat-issue-analyzer 에이전트로 발열/배터리 종합 재검토 → 잔존 원인 10건 List up. 그 중 **발견 2번(조건부 lazy-mount)** 우선 적용 후 production 배포.

## 발열 재검토 결과 (우선순위)
근본 원인 2가지는 v1.5.66~85 fix가 증상 완화에 그쳤음을 시사:
1. 🔴 **App.jsx 5,728줄 단일 컴포넌트** — state 1개 변경 시 전체 재렌더. 탭 컴포넌트 React.memo 전무 (= 발견 1, 미적용).
2. 🔴 **탭 display:none 항시 마운트** — Library만 v1.5.77 조건부 마운트, 나머지 7개 탭 effect/iframe/리스너 지속 (= 발견 2, 이번 적용).

기타 잔존(미적용): HomePage Framer Motion 아코디언/이모지 잔존, 광고 dismiss 후 thermal 회복 장치 없음(v1.5.85 triggerForcedIdle 제거), CapacitorUpdater.addListener 4개 remove 불가, 자동저장 useEffect 동기 JSON.stringify 9개, RevenueCat getCustomerInfo 재호출, useEffect deps에 JSON.stringify 직접, console.log 249개 production 포함, iOS speechSynthesis.getVoices() 불필요.

## 적용: 발견 2번 — 탭 lazy-mount
- [App.jsx](src/App.jsx) `visitedTabsRef = useRef(new Set(['home']))` + render마다 `visitedTabsRef.current.add(viewMode)` (idempotent lazy-init 패턴).
- vocab/listening/video/scene/stats 5개 탭을 `{visitedTabsRef.current.has('X') && (<Comp/>)}`로 gating.
- **핵심**: 한번 방문하면 계속 마운트 → 생성 콘텐츠(VocabTab.words / ListeningTab.passage / ScenePractice.generated) 손실 없음. 단순 `viewMode===X &&` 였다면 탭 전환 시 콘텐츠 날아가는 회귀였을 것.
- Home/Translation만 쓰는 유저는 5개 탭 effect/YouTube iframe/오디오/리스너를 아예 미실행.
- videoReaderRef 접근부(1073, 3955) 모두 옵셔널 체이닝(`?.`)이라 미마운트 null 안전 검증.
- Trade-off: 미방문 탭 첫 진입 시 마운트 비용 1회(부하가 앱 시작→첫 클릭 시점으로 이동).

## 배포
- 커밋 `c186290` (App.jsx + package.json 1.5.85→1.5.86만 stage, 무관한 promo_images 변경 제외).
- **Capgo production + staging 둘 다 1.5.86** — staging upload 후 production은 `channel set production com.arigems.pronunfit --bundle 1.5.86`로 포인터만 변경(재업로드 시 "Version already exists" 에러 → channel set이 정답). `currentBundle` 양쪽 검증 완료.
- main push (Vercel 웹 production 자동 배포). author email no-reply 확인(Vercel block 방지).
- Xcode Cloud 미트리거 정상(ios/** 미변경) — iOS 반영은 Capgo OTA로 충분.
- 사용자 검증: "많이 좋아진 것 같아" → production 승인.

## 학습
- **Capgo 동일 번들 채널 승격**: 이미 업로드된 버전을 다른 채널로 올릴 땐 재업로드 불가(`Version X already exists`). `channel set <channel> <appId> --bundle <version>`로 포인터만 이동이 정답.
- React 탭 컴포넌트 발열 최적화: 단순 조건부 마운트는 state 손실 회귀 → 생성 콘텐츠 가진 탭은 "방문 후 유지(keepMounted)" 패턴 필수.

## 잔여
- 발견 1번(React.memo + props useMemo 안정화) 미적용 — 다음 단계 후보.
- 나머지 🟡/🟢 발열 항목 10건 중 미적용분.
