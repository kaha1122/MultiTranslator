---
name: reminder-web-push-notifications
description: 웹앱(Vercel) 구독자의 푸시 알림 미지원 이슈 — iOS 심사 알림과 함께 상기 요청됨
type: project
originSessionId: 07851fc1-3875-4c2a-9281-3810da3195ac
---
# 🌐 웹앱 푸시 알림 미구현 — 추후 개발 알림

## 트리거 (반드시 이 메모를 꺼내서 사용자에게 상기시킬 것)

다음 중 하나라도 언급되면 **이 메모 + [reminder-ios-push-post-approval.md](reminder-ios-push-post-approval.md)를 함께 상기**:
- "iOS 심사 통과", "iOS 승인", "App Store 승인"
- "알림 기능 추가 개발", "웹 푸시", "Web Push"
- "웹앱 구독자", "웹 결제 사용자"
- "Toss 결제" 또는 "PayPal 결제"를 추가 개선하려는 맥락
- 푸시 알림 관련 새 요청/개선 논의 시

## 배경 (2026-04-19 확정)

### 현재 푸시 알림 커버리지

| 결제 수단 | 플랫폼 | 푸시 수신 가능? |
|-----------|--------|----------------|
| RevenueCat IAP | Android/iOS 네이티브 | ✅ (iOS는 심사 통과 후) |
| Toss | Android 네이티브 | ✅ |
| Toss | **웹 브라우저** | ❌ **미구현** |
| PayPal | Android 네이티브 | ✅ |
| PayPal | **웹 브라우저** | ❌ **미구현** |

### 왜 미구현?
- `@capacitor/push-notifications`는 **네이티브 플러그인 전용** — 웹에서 작동 안 함
- 웹 FCM은 **Service Worker + Firebase Web SDK** 조합으로 별도 구현 필요
- 현재 코드는 `isNative` 가드로 웹에서 플러그인 호출 skip → **토큰 생성/저장 0**
- 서버 `sendSubscriptionPush()` 호출해도 `fcmTokens` 비어있어 웹 사용자에게 전송 불가

### 부분 대체 — 이미 구현된 것
**앱 내(in-app) `SubscriptionEventModal` 팝업**은 웹에서도 작동:
- 웹 사용자가 앱을 **열어둔 상태**에서 tier 변경 → Firestore onSnapshot → 팝업 표시
- 단, **오프라인 중 발생 이벤트**는 놓침 (첫 로드 시 `prevTierRef` null로 skip)

## 3-Tier 개발 전략 (사용자 확정 순서)

### Tier 1: Option C — 앱 내 팝업 강화 (30분 작업)
**Why**: 웹 사용자가 앱을 열 때라도 반드시 tier 변경 이벤트 인지 보장. 비용 거의 0.

**How to apply**:
- `App.jsx`의 tier 변경 useEffect 보강
- 첫 로드 시 (prevTierRef=null) 현재 profile에 이미 적용된 tier 이벤트 감지
- localStorage `shown.subEvent.${type}.${tierUpdatedAt}`로 중복 방지 (이미 구현됨)
- 예: 오프라인 중 pro→trial 되고 사용자가 웹 열면 "구독 만료" 팝업 표시

**관련 코드**: `src/App.jsx` tier 변경 감지 useEffect (이미 존재, 보강만 필요)

### Tier 2: Option B — 이메일 알림 (3~5시간 작업)
**Why**: 브라우저/OS/플랫폼 무관 **100% 도달**. 결제 실패 복구율 극대화.

**How to apply**:
- SendGrid 계정 (무료 월 100건) 또는 Firebase Functions + Nodemailer
- `server/utils/sendEmail.js` 신규 — `sendSubscriptionEmail(uid, type)` 유틸
- `server/routes/webhook.js`에서 `sendSubscriptionPush()`와 병행 호출
- HTML 이메일 템플릿 4개 (renewal/expiration/billingIssue/cancellation) × 10개 언어
- `users.email` 필드 이미 있으므로 추가 필드 불필요

**주의**: 이메일 발송 빈도/스팸 필터 정책 고려 필요.

### Tier 3: Option A — 웹 Push Notification (FCM Web, 8~10시간 작업)
**Why**: 네이티브와 동일한 실시간 경험. 유저 수가 늘어난 뒤 투자.

**How to apply**:
- Firebase Cloud Messaging for Web: Service Worker 기반
- `public/firebase-messaging-sw.js` 신규 Service Worker 파일
- 클라이언트: `firebase/messaging` 의존, `getToken()` + 리스너 등록
- 서버 `sendSubscriptionPush`가 웹 토큰도 `users.fcmTokens` 배열에 함께 저장 (이미 호환됨 — 배열 구조)
- **Safari iOS 제한**: 2023년부터 PWA 설치 시에만 가능 — 별도 PWA 설치 유도 UX 필요
- 브라우저 푸시 권한 UX (Chrome/Firefox/Edge 정상, Safari 제한적)

**ROI 주의**: Safari(iOS)가 주 타깃이면 Option B가 더 효과적일 수 있음.

## 사용자 결정 사항 (2026-04-19)

- **지금 당장 개발 보류** — 현재 웹 구독자 수 미파악, 우선순위 낮음
- **iOS 심사 통과 시점에 함께 재검토** — 리소스 여유 시 Option C부터 착수
- **Option B(이메일)** — 결제 실패 복구율 중요해지면 우선순위 상승

## 확인 포인트 (개발 착수 전)

- [ ] 실제 웹 구독자 수 (Firestore: `tierSource === 'toss'|'paypal'` AND `fcmTokens` 비어있거나 `platform === 'web'`)
- [ ] 월간 billing issue 발생 빈도 → Option B 우선순위 판정
- [ ] Safari/iOS PWA 사용 비율 → Option A ROI 판정

## 참조
- [changes-0419-session3.md](changes-0419-session3.md) — Push Notifications Phase 1+2 배포 전체 기록
- [reminder-ios-push-post-approval.md](reminder-ios-push-post-approval.md) — iOS 네이티브 푸시 연동 (함께 트리거)
