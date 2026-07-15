---
name: changes-0405
description: 2026-04-05 — PayPal USD결제, 국가감지분리, Android Crashlytics크래시해결, RevenueCat서비스계정IAM수정, app-ads.txt, 난이도완화, 듣기탭재생, InfoPlist다국어
type: project
---

## 2026-04-05 변경사항 (v1.4.10 → v1.4.13)

### 1. PayPal 구독 결제 연동 (USD 웹 전용)

#### 결제 경로 3분기 확립
| 환경 | 통화 | 결제 수단 | 자동 갱신 주체 |
|------|------|----------|---------------|
| iOS/Android 네이티브 앱 | 스토어 통화 | RevenueCat (App Store/Google Play) | 스토어 |
| 웹 + 한국 IP (KRW) | ₩ | TossPayments (빌링키) | 서버 Cron |
| 웹 + 해외 IP (USD) | $ | **PayPal Subscriptions** | **PayPal 자동** |

#### PayPal 대시보드 설정
- REST API App: PronunFit (Live)
- Client ID: `VITE_PAYPAL_CLIENT_ID` (Vercel + Render)
- Secret: `PAYPAL_SECRET` (Render only)
- Webhook ID: `0P286889S9487681V`
- Webhook URL: `https://multitranslator.onrender.com/api/paypal-webhook`
- Webhook 이벤트: BILLING.SUBSCRIPTION.ACTIVATED/CANCELLED/EXPIRED/SUSPENDED, PAYMENT.SALE.COMPLETED

#### PayPal Plan ID 매핑
| 내부 planId | PayPal Plan ID |
|---|---|
| pro_1 | P-73490666K6714103SNHIZD3Q |
| pro_3 | P-79J15696J29594025NHIZDCI |
| premium_1 | P-6TL41962S46875337NHIZBWY |
| premium_3 | P-6BV40550N60129258NHIZATQ |

#### 구현 파일
- `@paypal/react-paypal-js` 패키지 추가
- `UpgradeModal.jsx`: USD + 웹 → PayPal 버튼 표시 (createSubscription + custom_id=Firebase UID)
- `server/routes/webhook.js`: PayPal webhook (구독 활성화/갱신/취소/만료 → Firestore 업데이트)
- `server/routes/webhook.js`: `/api/paypal-activate` (onApprove 후 구독 확인)
- `server/routes/subscription.js`: 취소 API Toss/PayPal 통합 (tierSource=paypal → PayPal API 구독 취소)

#### Firestore 필드 (PayPal 사용자)
```
tierSource: "paypal"
paypalSubscriptionId: "I-xxxxx"
paypalPlanId: "P-xxxxx"
subscriptionCurrency: "USD"
```

#### PayPal vs Toss 차이
- PayPal: 자동 갱신을 PayPal이 처리 → Cron 불필요, Webhook으로 알림만 받음
- Toss: 서버 Cron이 billingKey로 직접 청구

---

### 2. 국가 감지 함수 분리

#### 문제
`detectCountry()` 하나로 결제 분기 + 프로필 기록을 공유 → 세션 캐시로 인해 한쪽 실패가 다른 쪽에 영향

#### 분리
| 함수 | 용도 | 호출 방식 | 실패 시 | 캐시 |
|------|------|----------|--------|------|
| `detectCountry()` | 결제 통화 결정 | 클라이언트 직접 (`ipwhois.app`) | US/USD | 세션 메모리 |
| `detectGeoInfo()` | 프로필 geoCountry | 서버 경유 (`/api/detect-country`) | 빈값 (저장 안 함) | 없음 |

- `AuthContext.jsx`: `detectCountry()` → `detectGeoInfo()` 변경
- 결제용은 웹 브라우저에서만 사용 (네이티브는 RevenueCat) → iOS WKWebView 문제 무관

---

### 3. USD 사용자 전화인증 차단 해제

#### 문제
`handleUpgrade()`에서 `!profile?.phoneVerified` 체크가 USD 사용자도 차단

#### 수정
`!profile?.phoneVerified` → `needPhoneVerify` (= `isKR && !profile?.phoneVerified`)
전화인증은 KRW 결제에서만 요구

---

### 4. 듣기 탭 장문 재생/일시정지 + 반복 모드

- 재생 버튼 클릭 → TTS 재생 시작 → Pause 아이콘으로 변경
- 다시 클릭 → 일시정지 → 재개 (2중 재생 방지)
- 재생 ↔ 반복 토글: 반복 모드 ON 시 장문 끝나면 자동 반복
- ListeningTab.jsx에서 자체 Audio 객체 관리 (onSpeak 인터페이스 변경 없음)

---

### 5. 중급 난이도 완화

| 영역 | Basic 변경 | Intermediate 변경 |
|------|-----------|------------------|
| 공통 | Top 500 → **800** | rare idioms 제외, 실용 표현 중심 |
| Vocab | - | 예문 1-2절, 6-12단어 |
| Scene | - | 1-2절, 일상 상황 목표 |
| Listening | - | 1-2절 접속사 연결 |

수정 파일: `server/routes/vocab.js`, `server/config/langGuide.js`, `server/routes/listening.js`

---

### 6. iOS 권한 요청 메시지 10개 언어 로컬라이제이션

- `ios/App/App/{lang}.lproj/InfoPlist.strings` × 10개 언어 생성
- 마이크, 카메라, ATT, 블루투스, 사진 라이브러리 권한 메시지
- `project.pbxproj`에 PBXVariantGroup + knownRegions 등록

---

### 커밋 이력 (주요)
- `788a737` fix: 중급 난이도 완화
- `2fe1399` feat(ios): InfoPlist.strings 10개 언어 로컬라이제이션
- `ebb6531` fix: 국가 감지를 서버 경유 방식으로 전환
- `69e3a0a` feat: PayPal 구독 결제 연동
- `5513092` fix: USD 사용자 전화인증 차단 해제 + PayPal 취소 지원
- `1334b22` refactor: 국가 감지 함수 결제용/프로필용 분리
- `753e287` 1.4.13

---

### 7. Android 프로덕션 크래시 해결 (Crashlytics Gradle 플러그인)

#### 문제
Play Store 프로덕션 앱(v1.2.0, v1.2.1) 시작 즉시 크래시 — 스플래시 직후 종료.

#### 원인 (logcat으로 확인)
`FATAL EXCEPTION: The Crashlytics build ID is missing`
`@capacitor-firebase/crashlytics` npm 패키지는 설치되어 있었으나, Android `build.gradle`에 `firebase-crashlytics-gradle` 플러그인 미등록.

#### 수정
- `android/build.gradle`: `classpath 'com.google.firebase:firebase-crashlytics-gradle:3.0.3'` 추가
- `android/app/build.gradle`: `apply plugin: 'com.google.firebase.crashlytics'` 추가
- v1.2.2 (code 21) AAB 빌드 → 프로덕션 정상 동작 확인

#### PayPal SDK 동적 import (추가 수정)
- `@paypal/react-paypal-js` 정적 import가 네이티브 앱에서도 로드 → 외부 스크립트 삽입 실패 가능
- `lazy()` + `Suspense`로 동적 로드하여 웹 USD 결제 시에만 로드

---

### 8. RevenueCat ↔ Google Play 서비스 계정 연동 수정

#### 문제
실제 프로덕션 결제(₩4,990 Pro Monthly)가 RevenueCat에 기록되지 않음.

#### 원인 (3가지 누락)
1. **IAM 역할 누락**: 서비스 계정 `revenuecat-play-billing`에 Pub/Sub Editor, Monitoring Viewer 역할 미부여
2. **서비스 계정 JSON 키 교체 필요**: GCP 키 유출 사건 이후 새 키 발급 + RevenueCat 업로드
3. **Google Developer Notifications 미연결**: RevenueCat의 Pub/Sub Topic → Google Play Console 실시간 개발자 알림 미등록

#### 해결 순서
1. Google Cloud Console → IAM → `revenuecat-play-billing`에 **Pub/Sub 편집자 + 모니터링 뷰어** 역할 추가
2. 서비스 계정 → 키 탭 → 새 JSON 키 발급 → RevenueCat에 Replace 업로드
3. RevenueCat → Google developer notifications → Topic ID `projects/trnaslatorapp/topics/PronunFit` 선택 → Connect to Google
4. Google Play Console → 수익 창출 설정 → 실시간 개발자 알림 → Topic ID 등록
5. **Track new purchases from server-to-server notifications** 체크
6. Send a test → 수신 확인 → **"Valid credentials"** 표시

#### 핵심 교훈
- Sandbox 테스트 결제는 서비스 계정 검증 없이도 SDK 레벨에서 처리됨 → IAM 역할 누락이 드러나지 않음
- 프로덕션 결제 검증에서만 서비스 계정이 필요 → 프로덕션 출시 전 반드시 확인
- Google 서비스 계정 권한 동기화에 최대 36시간 소요 → 상품 설명 변경 트릭으로 즉시 트리거 가능

---

### 9. AdMob app-ads.txt 인증

- `public/app-ads.txt` 파일 생성 (기존 `ads.txt`는 있었으나 `app-ads.txt` 누락)
- Google Play Console → 스토어 등록정보 → 웹사이트 URL 등록
- AdMob 인증에 최대 24시간 소요

---

### 10. Android 프로덕션 첫 출시

- v1.2.2 (code 21) AAB → Google Play Console 프로덕션 트랙 업로드
- Xcode Cloud: `/ios/*` 파일 변경 시에만 자동 트리거로 설정 (불필요한 iOS 빌드 방지)

---

### 커밋 이력 (추가)
- `18dcbe0` feat: app-ads.txt 추가
- `5c750d2` fix(android): Firebase Crashlytics Gradle 플러그인 추가
- `47bea28` fix(android): PayPal SDK 동적 import

### 배포
- Vercel: 자동 (main push)
- Render: 자동 (서버 코드)
- Capgo production: v1.4.13
- Android Play Store: v1.2.2 (code 21) — 첫 프로덕션 출시
- iOS: Xcode Cloud (`/ios/*` 변경 시에만 트리거)
