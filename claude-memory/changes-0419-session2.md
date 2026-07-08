---
name: changes-0419-session2
description: 2026-04-19 2차 — Push Notifications Phase 1+2 도입 (iOS 심사와 무관 main 개발)
type: project
originSessionId: 07851fc1-3875-4c2a-9281-3810da3195ac
---
# 2026-04-19 2차 세션 — Push Notifications Phase 1+2 도입

## 배경
iOS 심사 중이지만 push 기능 자체는 심사본 미포함 → `main` 브랜치에서 병행 개발 착수. 심사 승인 후 다음 iOS 빌드에 합류시킬 계획.

## Phase 1: FCM 구독 이벤트 푸시 (서버 이벤트 기반)

**Why**: 구독 라이프사이클(RENEWAL/EXPIRATION/BILLING_ISSUE/CANCELLATION) 알림. 기존 webhook 인프라 재활용 → 인프라 증설 0.

**How to apply**: 신규 구독 이벤트 추가 시 `server/utils/sendPush.js`의 `PUSH_MESSAGES`에 10개 언어 번역 추가 후 `sendSubscriptionPush(uid, 'type')` 호출.

### 파일 변경
- `src/utils/pushNotifications.js` (신규) — FCM 토큰 등록, Firestore `users.fcmTokens` 배열 저장
- `src/context/AuthContext.jsx` — 실계정 로그인 시 조용한 재등록 (권한 이미 부여된 경우만)
- `server/utils/sendPush.js` (신규) — `sendSubscriptionPush(uid, type)` 유틸, 10개 언어 템플릿, stale token 자동 정리
- `server/routes/webhook.js` — RevenueCat/Toss/PayPal 3 provider에 푸시 훅 연결
  - RevenueCat: RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE
  - Toss: 전액 환불(expiration)
  - PayPal: RENEWAL, CANCELLATION, EXPIRED, SUSPENDED

### Firestore 스키마 추가
- `users.fcmTokens: string[]` — 다중 기기 지원 (arrayUnion)
- `users.fcmTokenUpdatedAt: Timestamp`
- `users.fcmPlatform: 'ios'|'android'|'web'`
- `users.subscriptionAlertOptOut: boolean` — 사용자 거부 시 서버가 skip

## Phase 2: 로컬 매일 연습 리마인더 (서버 불필요)

**Why**: 메모리 [changes-0418-session2.md]의 "신규유저이탈방지" 대응. Trial 일일 한도(10카드/20발음)가 자정 로컬타임존 리셋되는 패턴과 정합.

**How to apply**: 사용자가 Settings에서 시간 선택 → 로컬타임존 기준 매일 반복. 서버/백엔드 비용 0.

### 파일 변경
- `src/utils/localNotifications.js` (신규) — `@capacitor/local-notifications` 래퍼, 고정 ID=1001로 중복 방지
- `src/components/NotificationSettings.jsx` (신규) — 토글 + 시간 선택 + pre-prompt 모달 UI
- `src/App.jsx` — Settings 화면 구독섹션 위에 `<NotificationSettings>` 삽입

## 공통 인프라
- `capacitor.config.json` — PushNotifications/LocalNotifications 플러그인 옵션 추가
- `android/app/src/main/AndroidManifest.xml` — `POST_NOTIFICATIONS` 권한 추가 (Android 13+/API 33)
- `package.json` — `@capacitor/push-notifications@^8.0.0` + `@capacitor/local-notifications@^8.0.0`
- i18n: 10개 언어 전부에 `notifications.*` + `common.cancel`/`common.continue` 키 추가

## 권한 UX 설계 (Apple 심사 안전 패턴)
- **앱 실행 시 자동 권한 팝업 금지** — `AuthContext`는 이미 권한 부여된 경우에만 조용히 토큰 재등록
- **사용자 최초 권한 요청**은 Settings 화면 토글 ON → 커스텀 pre-prompt 모달("왜 필요한지" 설명) → 사용자 수락 시에만 OS 권한 팝업
- 구독 알림 기본 **로컬 저장 true** (실제 발송은 토큰 등록 + OS 권한 모두 충족 시에만)
- 연습 리마인더 기본 **false** (사용자 능동 설정 필요)

## 사용자 측 필수 작업 (배포 전)
1. **Apple Developer Console**: Keys → APNs Auth Key (.p8) 생성
2. **Firebase Console**: Project Settings → Cloud Messaging → Apple app configuration에 .p8 업로드
3. **Xcode**: App target → Signing & Capabilities → `+ Capability` → **Push Notifications** + **Background Modes (Remote notifications)** 체크
4. **ios/App/App/AppDelegate.swift**: APNs 토큰 처리 코드 추가 (capacitor-push-notifications README)
5. **실기기 테스트**: iOS 시뮬레이터는 푸시 수신 불가 — 실기기 필수
6. **Android**: `google-services.json` 이미 있으므로 추가 설정 불필요

## 사이드 이펙트 점검
- **웹**: `Capacitor.isNativePlatform()` 가드 — 플러그인 dynamic import도 네이티브에서만 → no-op, 번들 영향 없음
- **iOS/Android 플랫폼 분기**: 3분기 ([changes-0403.md]) 유지됨. 웹은 UI 토글 disabled + "mobile app only" 안내
- **기존 유저 호환**: `fcmTokens`/`subscriptionAlertOptOut` 필드 없어도 작동 — 서버는 `filter(Boolean)` + default true
- **Tier 무관**: 모든 tier(trial/pro/premium) 동일 적용, 다만 Phase 1은 tier 변경 webhook 이벤트 발생 시에만 트리거되므로 trial 유저에게는 과금 관련 노이즈 없음
- **익명 유저**: AuthContext에서 `!authenticatedUser.isAnonymous` 가드 → 익명은 FCM 등록 안 함
- **토큰 정리**: 미등록/유효X 토큰은 전송 시 자동 제거 (`messaging/registration-token-not-registered` 등)

## 빌드 검증
- `npm run build` → ✅ 통과 (5.06s)
- 10개 locale 파일 JSON.parse 전부 OK + `notifications.sectionTitle` key 검증 완료
- Vite warning: pushNotifications.js static+dynamic import 혼재 — 기능상 무해 (AuthContext는 lazy, NotificationSettings는 static)

## A+D: 기존 사용자 발견 유도 (2차 추가)

### A. NEW 뱃지 시스템 (2단 발견)
**Why**: 기존 사용자는 앱 업데이트만으로는 ②Pre-prompt / ③OS 권한 팝업 어느 것도 자동으로 안 뜸 → 설정 화면을 능동적으로 열고 토글 해야 활성화 → 발견율 낮음.

**How to apply**:
- Layer 1: 사이드바 "설정" 버튼 아이콘 우상단 빨간 점(pulse) — `!featuresSeen.notifications` 시
- Layer 2: 설정 진입 시 알림 섹션으로 auto-scroll (1회) + 섹션 헤더에 "NEW" pulse 뱃지
- 해제 조건: 알림 토글을 한 번이라도 건드리는 순간 (ON/OFF 무관) → localStorage + Firestore `users.featuresSeen.notifications = true` 양쪽 저장
- 크로스기기 동기화: Firestore로 다른 기기/재설치 후에도 확인 상태 유지

### D. 구독 성공 직후 push opt-in 모달
**Why**: Pro/Premium 전환 직후가 "결제 알림 받기"의 가치가 가장 명확한 순간 → 허용률 높음. 구독자에게 결제 실패/만료 알림은 서비스 품질 자체.

**How to apply**:
- `App.jsx` useEffect로 `profile.tier` 변경 감지: trial → pro/premium 전환 시 1.5초 딜레이 후 `PushOptInModal` 표시
- 중복 방지: 이미 `fcmTokens.length > 0` 이거나 7일내 "나중에" 스누즈(localStorage `pushOptIn.snoozedAt`) 시 skip
- "허용" 클릭 → pre-prompt 생략하고 바로 OS 권한 팝업 (구독자에게는 맥락 충분) → 토큰 등록 + `subscriptionAlertOptOut=false`

### 파일 변경 (2차)
- `src/utils/featureSeen.js` (신규) — localStorage + Firestore 하이브리드 훅
- `src/components/PushOptInModal.jsx` (신규) — 구독 성공 직후 모달
- `src/components/NotificationSettings.jsx` — `active`/`profile` props 추가, `useFeatureSeen` 훅, `sectionRef` auto-scroll, 토글 시 `markSeen()`, 헤더 NEW 뱃지
- `src/App.jsx` — `notificationsSeen` 상태, tier 전환 감지 `useEffect` + `prevTierRef`, 사이드바 설정 빨간 점, PushOptInModal 렌더, NotificationSettings props 확장
- `src/App.css` — `.nav-new-dot` 빨간 점 + pulse, `.feature-new-badge` NEW 뱃지 + pulse 애니메이션
- i18n 10개 전 언어: `common.newBadge`, `pushOptIn.{title,body,allow,later}` 추가

### Firestore 스키마 추가 (2차)
- `users.featuresSeen.notifications: boolean` — 발견 뱃지 해제 여부 (필요 시 다른 기능용으로 `.xxx` 확장 가능)

## 아직 안 한 것 (후속 과제)
- **iOS 빌드 검증** (심사 통과 후)
- **AppDelegate.swift APNs 토큰 처리** — iOS 재빌드 시 필요
- **웹 FCM** (Service Worker + Web Push) — Phase 3
- **스케줄형 재참여 푸시** (inactivity cron) — Phase 3, Cloud Scheduler 필요
- **포그라운드 수신 커스텀 UI** — 현재 console.log만
