---
name: Client-server 동일 로직 병행 패치
description: tier/구독/권한 로직 수정 시 클라이언트뿐 아니라 서버 동일 경로까지 병행 확인·수정 필수
type: feedback
originSessionId: d951046a-563d-4f92-bb08-ab0f03fbcf97
---
tier/구독/권한처럼 **같은 비즈니스 결정을 클라이언트와 서버 양쪽에서 독립적으로 내리는 로직**은 한쪽만 수정하면 반드시 버그가 남는다. 수정 시 반드시 양쪽 경로를 같이 점검·패치한다.

**Why:**
2026-04-21 사건 — RevenueCat entitlement miss 시 만기일 전 강제 다운그레이드 버그를 클라이언트 3곳 ([AuthContext.jsx:374](src/context/AuthContext.jsx#L374), [App.jsx:514](src/App.jsx#L514), [App.jsx:277](src/App.jsx#L277))에 가드 추가하고 Capgo v1.4.51까지 배포했는데, 같은 사용자(`vTXu7Zl...`)가 몇 시간 후 다시 tier=trial로 다운그레이드됨. 원인은 **서버 `/api/check-subscription` ([subscription.js:270-280](server/routes/subscription.js#L270-L280))에 동일 로직이 있었고 거기엔 가드가 없었음**. 웹 로그인 시 이 엔드포인트가 발동되어 Firestore를 직접 trial로 덮어씀. 사이드 이펙트 점검 단계에서 서버 파일도 grep 했지만 "RC EXPIRATION webhook은 이벤트 기반이라 안전"이라고 판단하고 `/api/check-subscription`의 능동적 다운그레이드 경로를 놓쳤다.

**How to apply:**
- tier/구독/권한/카운터 관련 코드 수정 시, 다음 3개 디렉토리 전부 grep 필수:
  - `src/` (클라이언트 — AuthContext, App.jsx, UpgradeModal 등)
  - `server/routes/` (REST 엔드포인트 — subscription.js, webhook.js, account.js)
  - `server/` cron/background 작업 (subscription.js의 `/api/cron/*`)
- 특히 주의할 endpoint: **`/api/check-subscription`** — 웹 세션에서 능동적으로 Firestore를 수정함. 클라이언트 RC sync와 동일 로직.
- 사이드 이펙트 점검 표에 "서버 경로"를 별도 행으로 명시하고, 이벤트-기반(webhook)과 능동-호출(endpoint) 경로를 구분해서 각각 영향 분석.
- 패치 후 검증: 네이티브 앱 뿐 아니라 **웹 로그인 시나리오까지** 반드시 테스트 (서버 경로 트리거됨).
