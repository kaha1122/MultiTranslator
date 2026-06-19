---
name: changes-0331
description: 2026-03-31 작업 — 언어설정 국기아이콘+i18n, 블루투스 마이크 3플랫폼 대응, 가격변경, Toss Webhook 수정, orders 컬렉션 신규
type: project
---

## 2026-03-31 작업 내역

### 언어 설정 UI 개선
- **국기 이모지 아이콘 추가**: 설정 사이드바 언어 선택 버튼에 `lang.flag` 표시 (`.lang-flag` CSS 클래스)
- **왼쪽 정렬**: `.lang-option`을 `justify-content: flex-start` + `padding-left: 16px`로 통일
- **i18n 언어명 표시**: `lang.name`(각 언어 원어) → `getT(sourceLang, 'langNames.{code}')` 변경. 10개 locale에 `langNames` 섹션 추가 (38개 언어 × 10개 소스언어). 예: 한국어 모국어면 "영어", 일본어면 "英語"

### 블루투스 이어폰 마이크 대응 (3개 플랫폼)
- **Webapp**: `enumerateDevices()`로 BT 장치 감지 → `deviceId: { ideal: ... }` 힌트 제공 + fallback (`useAudioRecorder.js`)
  - iOS Safari/Chrome 호환성: `exact` → `ideal` 변경, getUserMedia 실패 시 `{ audio: true }`로 재시도
  - 네이티브 앱에서는 `enumerateDevices` 스킵 (SCO 플러그인이 처리)
- **Android**: `BluetoothAudioPlugin.java` 네이티브 Capacitor 플러그인 신규
  - `AudioManager` BT SCO 시작/종료/헤드셋 감지
  - `BLUETOOTH`, `BLUETOOTH_CONNECT` 권한 추가 (AndroidManifest.xml)
  - `MainActivity.java`에 플러그인 등록
- **iOS**: `BluetoothAudioPlugin.swift` + `.m` 브릿지 신규
  - `AVAudioSession` `.allowBluetooth` + `.allowBluetoothA2DP` + `.defaultToSpeaker`
  - `Info.plist`에 `NSBluetoothAlwaysUsageDescription` 추가
- **공통**: `useAudioRecorder.js`에서 `Capacitor.isNativePlatform()` 시 BT 활성화, 녹음 종료/에러 시 SCO 해제

### 유선 이어폰 분석
- 유선 이어폰은 OS가 자동 라우팅하므로 코드 변경 불필요
- BT만 특별한 이유: 기본 A2DP(출력 전용) → HFP/SCO(입출력)로 프로토콜 전환 필요

### i18n 수정
- **설정 하단 법적 링크**: 하드코딩 한글 → `getT(sourceLang, 'nav.privacy/terms/contact')`
- **구독 플랜 버튼 라벨**: "시작하기"/"Get Started" 등 → "선택"/"Select" 등 (최대 14자→8자, UI 뭉개짐 방지)
- **결제 완료 팝업 확인 버튼**: `common.confirm` 키 10개 언어 추가 (기존 키 미등록으로 키 이름 노출되던 버그)

### 가격 변경
- **KRW**: Pro 3개월 ₩11,990→₩13,990(7%), Premium 1개월 ₩14,990→₩16,990, Premium 3개월 할인 22%→31%
- **USD**: Pro 3개월 $7.99→$8.99(14%), Premium 1개월 $9.99→$10.99, Premium 3개월 할인 17%→24%
- 서버 결제/갱신 금액도 동기화 (subscription.js AMOUNTS 2곳)

### Toss Webhook 수정
- **orderId fallback**: `customerKey`가 없을 때 `tossOrderId`로 유저 검색 (기존: customerKey 없으면 처리 안 됨)
- **BILLING_DELETED**: `customerKey` 없으면 `tossBillingKey`로 유저 검색
- 첫 결제/cron 갱신 시 `tossOrderId`를 Firestore users 문서에 저장

### orders 컬렉션 신규 (Toss 전용)
- **Firestore: `orders/{orderId}`** — Toss 주문 정보 저장
- 필드: orderId, paymentKey, traceId(Toss 고유키), userId, planId, orderName, status, amount, currency, method, cardNumber, cardType, receiptUrl, type(initial/renewal), requestedAt, approvedAt, canceledAt, cancelReason, cancelAmount, createdAt
- **첫 결제**: Toss 응답에서 paymentKey, traceId(헤더), 카드정보 추출하여 저장
- **cron 갱신**: type='renewal'로 갱신 주문도 저장
- **Webhook 취소**: orders 문서의 status → CANCELED/PARTIAL_CANCELED + cancelReason/cancelAmount 업데이트
- RevenueCat은 대시보드가 주문관리 역할하므로 별도 테이블 불필요

### 자동갱신 중지 추적
- users 문서에 `autoRenewPausedAt`(마지막 중지 시각) + `autoRenewPauseCount`(누적 중지 횟수, increment) 추가

### 구독 흐름 확인
- **자동갱신 중지**: Firestore `autoRenew: false`만 변경, Toss에 신호 안 감, 빌링키 유지, 만기일까지 서비스 유지
- **환불**: Toss 대시보드에서 관리자가 수동 취소 시에만 발생, Webhook으로 수신하여 자동 처리
- **만료 다운그레이드**: 클라이언트 AuthContext useEffect에서 `autoRenew===false + 만기경과 → trial` 전환 (접속 시 실행)

### RevenueCat Webhook 수정
- **URL 수정**: 구서버 `pronunfit-server.onrender.com` → 운영서버 `multitranslator.onrender.com`으로 변경
- **인증 수정**: Bearer 접두사 유무 모두 허용 → 최종적으로 양쪽 AUTH 키 삭제 (인증 스킵)
- **subscriptionStartedAt 갱신**: RENEWAL/INITIAL_PURCHASE 시 `purchased_at_ms`로 구독 시작일 업데이트
- **EXPIRATION 이력 보존**: `subscriptionExpiresAt`, `subscriptionMonths`, `subscriptionStartedAt` null로 지우지 않고 유지

### Toss→RevenueCat 프로모션 부여 제거
- **문제**: Toss 결제 시 서버가 RevenueCat에 프로모션 entitlement를 자동 부여 → Toss 취소 후에도 RC 프로모션 남아있음 → 앱 `restorePurchases()`가 감지하여 Firestore를 Pro로 되돌림
- **해결**: subscription.js에서 RC 프로모션 부여 로직(171-193번 줄) 완전 제거
- **근거**: 앱은 Firestore `onSnapshot`으로 tier를 직접 감지하므로 RC 프로모션 불필요

### Toss ↔ RevenueCat 이중 결제 방지 (4곳)
1. **서버 Toss 결제** (subscription.js): RC 활성 구독 있으면 409 + `upgrade.duplicateSubscription` i18n 안내
2. **서버 RC Webhook** (webhook.js): `tierSource==='toss'` + 만기 미경과 시 덮어쓰기 스킵
3. **서버 Toss cron** (subscription.js): `tierSource==='revenuecat'`이면 갱신 스킵
4. **클라이언트 restorePurchases** (App.jsx): Toss 활성 구독이면 RC 동기화 스킵

### tier 업그레이드 시 만기일 즉시 리셋
- **문제**: Pro 3개월 결제 → 다음날 Premium 3개월 → 잔여기간 합산으로 6개월 Premium 사용 가능
- **해결**: 동일 tier 재결제만 기간 합산, 다른 tier 업그레이드 시 `baseDate = 현재시각`

### 설정 화면 만기예정일 표시 보강
- `tier === 'pro'||'premium'` + `subscriptionExpiresAt > 현재시각`일 때만 표시
- 과거 만기일은 숨김 (EXPIRATION 후 이력 보존 시 안전)

### Android 빌드
- v1.1.12 (versionCode 16) APK 빌드 완료 (debug, 37MB)

### 버전
- Webapp: 가격변경+i18n+BT대응+결제로직 등 main 배포 완료
- Android: v1.1.12 APK (BT 대응 + 버튼 라벨 축소)
- iOS: BT 플러그인 추가됨, Xcode에서 Swift/ObjC 파일 Add Files 후 재빌드 필요

### Toss 라이브 전환
- 라이브 탭 비활성화 상태 — 사업자등록 + 심사 승인 필요
- 승인 후: 라이브 Secret Key/Client Key 교체, 라이브 Webhook URL 등록
