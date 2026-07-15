---
name: changes-0419-session3
description: 2026-04-19 3차 — Push Notifications 래퍼 버그 해결 + UX 완성 + Production 배포 (v1.4.30~v1.4.39, AAB v1.2.7)
type: project
originSessionId: 07851fc1-3875-4c2a-9281-3810da3195ac
---
# 2026-04-19 3차 세션 — Push Notifications 완성 + Production 배포

## 세션 배경
전일 Phase 1+2 도입 완료 ([changes-0419-session2.md](changes-0419-session2.md))했으나 사용자 테스트 중 치명적 버그 발견 — 10회 이상 반복 배포하며 근본 원인 파악 + 완전 해결.

## 🐛 핵심 버그 — "래퍼 vs 인라인" 미스터리

### 증상
`utils/localNotifications.js`의 `requestPermission()` 래퍼 → `plugin.checkPermissions()` → **hang 무한대기 (timeout 안 걸림)**. 동일한 `plugin.checkPermissions()`를 컴포넌트에서 **인라인 호출하면 즉시 응답 정상**.

### 디버깅 여정
1. v1.4.31 — `denied-permanently` 상태 분기 추가, 여전히 hang
2. v1.4.32 — 화면에 보이는 DEBUG LOG 패널 + 🩺 권한 직접 요청 버튼 추가 → 래퍼 경로와 인라인 경로 동시 비교 가능 → **인라인만 작동** 확정
3. v1.4.33 — 600ms 지연 추가 시도, 효과 없음
4. **v1.4.34 — 전면 리팩토링**: `utils/localNotifications.js` 래퍼 제거, 컴포넌트에서 `await import('@capacitor/local-notifications')` 직접 호출 → **완전 해결** ✅
5. v1.4.37 — 동일 문제가 `utils/pushNotifications.js`에서도 재현 → 동일한 인라인 패턴으로 전환

### 추정 원인
- `utils/*.js` 모듈에서 `await import('@capacitor/...')` + plugin 메소드 호출 체인 시 Capacitor WebView 내 스케줄링 이슈
- 컴포넌트에서 직접 호출하면 정상 — Vite 번들링 시 dynamic import 경로 차이로 추정 (근본 원인 미규명)
- **실용적 해결책**: 플러그인 호출은 컴포넌트 내 인라인으로만

**향후 교훈**: Capacitor 플러그인 래퍼 함수를 util 파일에 만들지 말 것. 스토리지/Firestore 헬퍼만 util로.

## 🎨 UX 완성 — SubscriptionEventModal 도입

### 처음 설계 (v1.4.38까지) → 변경 (v1.4.39)

**이전**: 푸시 탭 시 → 설정 탭(구독 섹션)으로 이동
**변경**: 푸시 탭 시 → **type별 구독 이벤트 팝업 표시**

### 4가지 이벤트 팝업

| Type | 아이콘 | 제목 | 버튼 |
|------|-------|------|------|
| `renewal` | ✅ | 구독 갱신 완료 | 확인 |
| `expiration` | ⚠️ | 구독 만료 | 나중에 / **갱신하기** (→ UpgradeModal) |
| `billingIssue` | ❗ | 결제 문제 발생 | 나중에 / **재결제** (→ 설정 탭 + 구독섹션 스크롤) |
| `cancellation` | ℹ️ | 자동 갱신 해제 | 확인 |

### 중복 방지 정책 — "이벤트당 평생 1회"
- eventId = `${type}.${profile.tierUpdatedAt.toMillis()}`
- localStorage `pronunfit.shown.subEvent.${eventId}` 플래그
- push 탭 + tier 변경 감지 이중 트리거 방지
- 새 이벤트(tierUpdatedAt 변경) 발생 시 다시 1회 표시

### 트리거 2경로
1. **Push 탭** (`pushNotificationActionPerformed`) — 정확한 type 추출
2. **Tier 변경 감지** (fallback) — paid→trial 감지 → 'expiration' 팝업 (push 못 받은 유저 보호)

## 🔧 전역 FCM 리스너 단일화 (v1.4.38)

**문제**: NotificationSettings, PushOptInModal, AuthContext 3곳에서 `window.__pushListenersBound` 가드로 리스너 셋업 → 먼저 도달한 쪽만 리스너 등록 → 플로우 의존성 복잡

**해결**: `App.jsx` mount useEffect에서 **전역 1회 등록**:
- `registration` → `saveFcmTokenToFirestore(auth.currentUser.uid, token, platform)`
- `pushNotificationActionPerformed` → `tryShowSubscriptionEvent(type)`
- `registrationError` → console.warn
- 권한 이미 부여된 경우 자동 `register()` 호출

→ 3곳의 리스너 셋업 로직 **완전 제거** (NotificationSettings/PushOptInModal/AuthContext은 `register()`만 호출)

## 📐 UI 정리

### v1.4.36 — 성공 메시지 개선
- 기존: "매일 리마인더가 설정되었습니다." (정적, 다음 action 전까지 유지)
- 변경: **"⏰ 매일 13:55에 알림을 보냅니다."** (시간 포함 + 3초 자동 소거)
- 에러 메시지는 유지 (사용자가 "시스템 설정 열기" 버튼 눌러야 하므로)
- DEBUG LOG 패널 + 🩺 버튼 제거
- `showStatus(msg, { isError })` 헬퍼로 통합
- 10개 언어 `reminderOnAt` 키 추가 (`{time}` 플레이스홀더)

### v1.4.38 — 간격 축소
- 기존: 각 카드 `marginBottom: 8px`
- 변경: flex column + `gap: 4px` 패턴
- 카드 padding `12px 16px` → `10px 14px` 타이트화

## 🍎 로컬 알림 탭 리스너 추가 (v1.4.35)

- `App.jsx` mount에 `localNotificationActionPerformed` 리스너
- id=1001 (매일 리마인더) 탭 시 → `setViewMode('home')`
- 3가지 상태 모두 대응: 완전 종료 / 백그라운드 / 포그라운드

## 📝 문구 수정 (10개 언어 일괄)

- 한국어 리마인더: "스트릭" → "스터디"
- 한국어 renewal: "구독이 갱신되었습니다. 계속 이용해 주세요!" → "~계속 이용해 주셔서 감사합니다."
- 한국어 expiration: "갱신하고 학습을 이어가세요." → "계속 학습하시려면 갱신이 필요합니다."
- 10개 언어 renewal body 톤 통일 (감사 톤)

## 🚢 Production 배포 (2026-04-19 16:00~)

### Option A 전략 (사용자 확정)
"AAB 먼저 → Capgo production 그 다음" — 네이티브 플러그인 누락으로 인한 사용자 혼란 방지.

### 배포 순서
1. **AAB v1.2.7 code26 빌드** (`bash scripts/build-aab.sh`)
   - 새 네이티브 플러그인 포함: `capacitor-local-notifications:8.0.2`, `capacitor-push-notifications:8.0.3`
   - Firestore `config/app.latestNativeVersion = "1.2.7"` 자동 업데이트
   - Play Console 내부테스트 → 프로덕션 승격 (사용자 수동)
2. **Capgo production 채널 포인팅** (`channel set production --bundle 1.4.39 --ignore-metadata-check`)
   - v1.4.39는 이미 staging에 업로드되어 있어 `bundle upload` 중복 오류 → `channel set`으로 포인터 전환
   - `--ignore-metadata-check`: 네이티브 플러그인 추가분 호환성 경고 bypass (AAB 준비 완료했으므로 안전)
3. **채널 포인터 검증**: `channel currentBundle production` → "1.4.39" 확인 ✅

### 배포 영향 범위
- ✅ Android (Play Store v1.2.7 + Capgo v1.4.39) — Push Notifications 완전 작동
- ✅ iOS (App Store v1.2.2) — 무영향 (Capgo iOS 비활성)
- ⏳ Web (Vercel `main`) — 이 세션 말미에 별도 push 예정

## 📋 사이드 이펙트 전수 점검 완료

사용자 요청으로 플랫폼별 상세 점검:
- Android 네이티브: 테스트 기기 검증 완료, OEM별(Samsung OneUI) 정책 차이 주의
- Web: 모든 플러그인 호출 경로 `isNative` 가드 확인
- iOS 네이티브: `ios/**` 미수정, Capgo 비활성, 완전 격리
- Server: `.catch(() => {})` 방어로 webhook 블로킹 0
- Firestore: 모든 신규 필드 additive (fcmTokens, featuresSeen, subscriptionAlertOptOut 등)
- 기존 기능 회귀: 0

## 🌐 웹앱 푸시 미구현 이슈 (신규 등록)

사용자 지적: **Toss/PayPal 웹 구독자는 현재 푸시 알림 못 받음**.

원인: `@capacitor/push-notifications`는 네이티브 전용 — 웹 FCM은 Service Worker 별도 구현 필요.

3-Tier 전략 ([reminder-web-push-notifications.md](reminder-web-push-notifications.md)):
- Tier 1: Option C (앱내 팝업 강화) — 30분, 먼저 착수 권장
- Tier 2: Option B (이메일 알림) — 3~5시간, 결제 실패 복구율 극대화
- Tier 3: Option A (FCM Web + Service Worker) — 8~10시간, 유저 수 증가 후

사용자 결정: **지금 보류**, iOS 심사 통과 시점에 재검토.

## 📦 Firestore 스키마 확정 (v1.4.39 반영)

```
users/{uid}
  fcmTokens: string[]                    // 다중 기기 지원 (arrayUnion)
  fcmTokenUpdatedAt: Timestamp
  fcmPlatform: 'android'|'ios'|'web'
  subscriptionAlertOptOut: boolean       // 서버 sendPush skip 플래그
  featuresSeen: { notifications: boolean } // NEW 뱃지 발견 유도
  (기존 필드 모두 유지)
```

## 🗂️ localStorage 신규 키

```
pronunfit.localReminder.{enabled|hour|minute}    // 로컬 리마인더 설정
pronunfit.pushAlert.subscription                 // 구독 알림 ON/OFF (기본 true)
pronunfit.pushAlert.registeredToken              // 중복 저장 방지
pronunfit.pushOptIn.snoozedAt                    // 7일 스누즈 타임스탬프
pronunfit.featureSeen.notifications              // NEW 뱃지 해제 플래그
pronunfit.shown.subEvent.{type}.{tierUpdatedAt}  // 이벤트당 1회 표시 플래그
```

## 🏷️ 버전 추적

| 버전 | 플랫폼 | 상태 |
|------|-------|------|
| AAB v1.2.7 code26 | Play Store | 내부테스트 업로드 → 프로덕션 승격 (사용자 작업) |
| APK v1.2.7 code26 | 사이드로드 | 사용자 테스트 기기 설치됨 |
| Capgo staging v1.4.39 | staging 채널 | 테스트 완료 |
| Capgo production v1.4.39 | production 채널 | **배포 완료 (2026-04-19)** |
| Vercel web | main 브랜치 | 이 세션 말미에 push 예정 |

## 🧪 검증된 기능 리스트 (Android 테스트 기기)

- ✅ NEW 뱃지 자동 스크롤 + 토글 시 해제
- ✅ 로컬 매일 리마인더 권한 요청 (Android 13+ 다이얼로그)
- ✅ 권한 거부 상태에서 시스템 설정 수동 변경 플로우
- ✅ 시간 피커 변경 시 즉시 재스케줄
- ✅ 1분 뒤 실제 알림 수신 (13:55 확인)
- ✅ 알림 탭 → 홈 탭 자동 이동 (3 상태)
- ✅ 구독 알림 토글 → OS 권한 → FCM 토큰 Firestore 저장
- ✅ Firebase Console 테스트 푸시 수신
- ✅ SubscriptionEventModal 중복 방지 (이벤트당 1회)

## 🔜 남은 작업 (후속 세션)

### 즉시 (이 세션 말미)
- [ ] Git commit + push to main → Vercel 자동 배포

### 단기 (iOS 심사 통과 시)
- [ ] Xcode capability 2개 추가 (Push Notifications, Background Modes)
- [ ] AppDelegate.swift APNs 핸들러 추가
- [ ] ios 빌드 + TestFlight 업로드

### 중장기
- [ ] 웹 푸시 3-tier 전략 (Option C → B → A) 착수 결정
- [ ] 실제 RevenueCat/Toss/PayPal 샌드박스 이벤트 end-to-end 검증
- [ ] OEM별 Android 알림 정책 차이 케이스 수집

## 파일 변경 요약

**신규**: 4개
- `src/components/NotificationSettings.jsx` (Phase 1+2 통합 설정 UI)
- `src/components/PushOptInModal.jsx` (구독 성공 직후 opt-in)
- `src/components/SubscriptionEventModal.jsx` (4가지 이벤트 팝업)
- `src/utils/featureSeen.js` (NEW 뱃지 localStorage+Firestore 하이브리드)
- `server/utils/sendPush.js` (10개 언어 템플릿 + stale token 정리)

**수정**: `src/App.jsx`, `src/context/AuthContext.jsx`, `src/App.css`, `src/locales/*.json` × 10, `src/utils/localNotifications.js`, `src/utils/pushNotifications.js`, `server/routes/webhook.js`, `capacitor.config.json`, `android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`, `package.json`

**최종 웹 번들 버전**: `v1.4.39`
**최종 AAB 버전**: `v1.2.7 (code 26)`
