---
name: subscription
description: TossPayments 구독/결제 시스템 — 빌링키 흐름, 자동갱신 cron, 취소/만료 로직, 리마인더 팝업
type: project
---

## TossPayments 결제 흐름 (2026-03-12 구현, 2026-03-15 테스트 완료)

### 첫 결제 (카드 등록 + 즉시 결제)
1. 프론트 `UpgradeModal.jsx`: `loadTossPayments(clientKey)` → `payment({customerKey}).requestBillingAuth({ method: 'CARD', successUrl, failUrl })` (SDK v2 — `billing()` 아님!)
2. 토스 카드 입력 페이지 → 성공 시 `successUrl?authKey=xxx`로 리다이렉트
3. `App.jsx`: URL 파라미터 파싱 → `POST /api/toss-confirm-billing` 호출
4. 서버: `authKey` → 빌링키 발급(`POST /v1/billing/authorizations/{authKey}`) → 빌링키로 결제(`POST /v1/billing/{billingKey}`) → Firestore 업데이트

### Firestore 저장 필드 (`users/{uid}`)
- `tier`: 'trial' | 'pro' | 'premium' | 'admin'
- `planId`: 'pro_1' | 'pro_3' | 'premium_1' | 'premium_3'
- `subscriptionMonths`: 1 | 3
- `tossBillingKey`: 토스 빌링키
- `tossCustomerKey`: user.uid
- `autoRenew`: true | false
- `subscriptionExpiresAt`: Firestore Timestamp
- `subscriptionStartedAt`: Firestore Timestamp
- `lastRenewedAt`: cron 갱신 시 기록

### 자동 갱신 (서버 cron)
- 엔드포인트: `POST /api/cron/renew-subscriptions`
- Render cron 또는 외부 스케줄러에서 매일 1회 호출
- 조건: `autoRenew === true` AND `subscriptionExpiresAt <= now`
- 처리: 빌링키로 재결제 → 만료일 연장 (months 단위)
- 결제 실패: 빌링키 폐기(`/v1/billing/authorizations/revoke`) → trial 전환

### 구독 취소
- `POST /api/cancel-subscription`: `autoRenew: false`만 설정
- 즉시 다운그레이드 아님! 만료일까지 서비스 유지
- 만료 후 클라이언트(AuthContext)에서 trial로 전환

### 만료일 스태킹
- 기존 구독이 남아있으면 기존 만료일부터 연장 (오늘이 아님)
- `toss-confirm-billing`에서 `max(currentExpiry, today) + months`

### 만료 예정 리마인더 팝업
- `RenewalReminderPopup.jsx` — 만료 10일/7일/2일 전 3단계 알림
- `autoRenew === false`일 때만 표시 (취소한 사용자만)
- 긴급도별 색상: 10일(파란), 7일(노란), 2일(빨간)
- "구독 갱신하기" 버튼 → UpgradeModal 연결
- localStorage로 같은 구간에서 닫으면 재표시 안 함

### 결제 전 인증 요건 (2026-03-15 추가)
1. **이메일 인증** (Firebase Auth `emailVerified`) — 결제 정보 통보용
   - UpgradeModal: `user.reload()`로 최신 상태 갱신 후 체크
   - 서버: `admin.auth().getUser(customerKey).emailVerified` 이중 체크
2. **전화번호 인증** (`profile.phoneVerified`) — 사용자 중복 확인
   - 서버: Firestore `phoneVerified` 이중 체크
- 두 인증 모두 미완료 시 한 화면에 동시 표시 (이메일=파란, 폰=노란)
- 이메일 인증 후 구독 버튼 재클릭 시 `user.reload()`로 자동 반영

### USD 결제 지원 (2026-03-15 추가)
- IP 기반 국가 감지 (`src/utils/detectCountry.js`): `ipapi.co` API → 한국 IP → KRW, 그 외 → USD
- USD 플랜: Pro 1mo $9.99, Pro 3mo $16.99, Premium 1mo $18.99, Premium 3mo $49.99
- `PLAN_CONFIGS_KRW` / `PLAN_CONFIGS_USD` 분리 (UpgradeModal.jsx)
- 서버: `currency` 파라미터로 KRW/USD 구분, TossPayments에 `currency: 'USD'` 전달
- Firestore: `subscriptionCurrency` 필드 저장
- 인증 정책: KRW → 이메일+전화 / USD → 이메일만 (서버+클라이언트 모두 적용)

### RevenueCat 연동 (2026-03-15 추가)
- **역할**: 결제 처리가 아닌 **구독 권한(entitlement) 관리** 계층
- **흐름**: TossPayments 결제 성공 → 서버에서 RevenueCat REST API로 entitlement 부여
- **API 호출** (`server/index.js` 4단계):
  1. `GET /v1/subscribers/{userId}` — subscriber 생성/조회
  2. `POST /v1/subscribers/{userId}/entitlements/{Pro|Premium}/promotional` — entitlement 부여
- **duration**: 1개월 → `monthly`, 3개월 → `three_month`
- **실패 처리**: RevenueCat 실패해도 결제 자체는 성공으로 처리 (non-blocking)
- **Entitlements**: `Pro`, `Premium` (RevenueCat Dashboard에 생성 완료)
- **향후**: Android 앱 → RevenueCat SDK + Google Play, 웹과 동일한 entitlement 공유

### 글로벌 결제 전략
- 한국 (KRW): TossPayments → RevenueCat entitlement
- 해외 (USD): 현재 TossPayments 해외결제 / 향후 Paddle 검토
- Android (미래): Google Play → RevenueCat SDK
- Stripe: 한국 사업자등록증 미지원으로 제외

### 환경변수
- 프론트: `VITE_TOSS_CLIENT_KEY` (clientKey) — Vercel 환경변수
- 서버: `TOSS_SECRET_KEY` (secretKey) — Render 환경변수
- 서버: `REVENUECAT_SECRET_KEY` — Render 환경변수 (sk_CnoEqYGnbzOQLihHhmMwpgbUiDHfG)
- 인증 헤더: `Basic base64(secretKey:)` (TossPayments), `Bearer sk_*` (RevenueCat)
- 테스트 키: `test_ck_*` / `test_sk_*` (2026-03-15 설정 및 테스트 완료)
- RevenueCat SDK API Key (Android용, 미래): `test_aEzDbfPCurBEVYBwuUegRIytKxP`

### AuthContext 만료 처리
- `autoRenew === true`: 클라이언트에서 다운그레이드 안 함 (cron이 처리)
- `autoRenew !== true` AND 만료: trial로 전환 + Firestore 정리

### UpgradeModal 취소 UI
- `autoRenew === true`: "자동 갱신 중지" 버튼 표시
- `autoRenew === false`: 만료일이 포함된 안내 메시지 표시
