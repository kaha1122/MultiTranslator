---
name: 단일 유저 진단 스크립트 (check-user-tier.js)
description: 특정 UID의 tier/구독/플랫폼/AI consent + streak/geo/reengagement 상태를 한 번에 조회하는 운영 도구. "진단 스크립트로 UID 확인해줘" 키워드로 호출됨.
type: reference
originSessionId: 2c4f1767-d455-4e57-a50b-05e2c2d8c72e
---
# 단일 유저 진단 스크립트

## 위치
`server/check-user-tier.js`

## 사용법
```bash
cd server && node check-user-tier.js <UID>
```

## 출력 필드 (JSON)
- **Tier 핵심**: `tier`, `tierSource` (revenuecat/tosspayments/paypal), `tierUpdatedAt`, `planId`, `autoRenew`, `subscriptionExpiresAt`
- **Auth**: `isAnonymous`, `email`, `displayName`
- **Platform**: `currentNativePlatform/Version`, `firstNativePlatform`
- **AI Consent**: `aiConsentAt` (useAdMob 게이트)
- **Activity**: `lastActiveAt`, `lastActiveDay`, `createdAt`
- **Geo / Push reach** (2026-05-15 추가): `geoCountry`, `deviceLang`, `fcmTokensCount`, `lifecycleStage`, `reengagementOptOut`
- **Streak + Streak Risk Push** (2026-05-15 추가): `streakCurrent`, `streakLongest`, `streakUpdatedAt`, `earnedMilestones`, `streakIntroDismissed`, `streakRiskOptOut`, `lastStreakRiskPushDate`, `lastStreakRiskPushAt`

## 진단 패턴
- **Pro인데 광고 나오는 경우**: `tier=pro`, `subscriptionExpiresAt`이 미래인지 확인
- **Race condition 의심**: `createdAt`과 `tierUpdatedAt` 차이가 1~5초이면 가입 직후 IAP 구매 시나리오 (useAdMob race)
- **RC 다운그레이드 오탐**: `tierSource=revenuecat`인데 RC entitlement 사라진 경우
- **`tier=trial` + `lifecycleStage='subscriber'` 모순** (정상): 정기 구독 후 자동갱신 실패로 tier만 다운그레이드, lifecycleStage는 과거 구독자 이력으로 의도적 보존. cleanup 불필요.
- **Streak risk push 미발송 진단**:
  - `streakCurrent < 3` → 조건 미충족 (정상)
  - `lastActiveAt`이 country local 자정 이후 → "오늘 활동함"으로 탈락 (수정 후 정상)
  - `lifecycleStage` 무관 (admin tier만 제외) — admin은 `shouldSkipUser`에서 차단
  - `currentNativePlatform=ios` + `REENGAGEMENT_IOS_ENABLED !== 'true'` → 통째 skip
  - `fcmTokensCount=0` → no-tokens skip
  - `streakRiskOptOut=true` 또는 `reengagementOptOut=true` → 사용자 opt-out

## 운영 메모
2026-05-09 작성 — UID `55ZGaKpdaPhDN2vpvon6X8yNMAk2` (Pro 광고 표시 race condition) 진단 시 신설.
사용자 호출 트리거: **"진단 스크립트로 UID 확인해줘"** / **"check-user-tier로 ~ 확인해줘"**.

## 의존성
`server/.env`의 `FIREBASE_SERVICE_ACCOUNT_BASE64` 필요 (server/export-*.js와 동일 패턴).

## 확장 시
필드 추가가 필요하면 `server/routes/reengagement.js`의 `/api/cron/user-info` 엔드포인트와 동기화 유지.
