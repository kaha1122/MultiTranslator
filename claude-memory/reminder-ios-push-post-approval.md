---
name: reminder-ios-push-post-approval
description: iOS 심사 승인 후 Push Notifications 최종 통합 작업 알림 (사용자 요청으로 등록)
type: project
originSessionId: 07851fc1-3875-4c2a-9281-3810da3195ac
---
# 🔔 iOS 심사 승인 / App Store 출시 후 최종 작업 알림

## 트리거
사용자가 다음 중 하나를 언급하면 **반드시** 이 메모를 꺼내서 상기시킬 것:
- "iOS 심사 통과", "iOS 승인", "App Store 승인", "심사 완료"
- "iOS 빌드", "iOS 배포", "iOS 새 버전"
- "TestFlight 업로드", "App Store 출시"
- iOS 관련 다음 릴리스 논의 시작

## ⚠️ 함께 상기할 것
이 알림을 꺼낼 때 **반드시 [reminder-web-push-notifications.md](reminder-web-push-notifications.md)도 함께 상기**시킬 것 — 사용자가 2026-04-19에 명시 요청함. iOS 심사 통과 시점은 웹 푸시 개발 재검토 타이밍이기도 함.

---

## 📋 iOS 심사/출시 후 해야 할 작업 목록 (2가지)

### ① Push Notifications Xcode 통합 (아래 상세)
### ② Meta 대시보드에 iPhone Store ID 등록 (2026-04-23 추가)

---

## 배경 상태 (2026-04-19 기준)
- Push Notifications Phase 1+2 개발 **완료** (main 브랜치 커밋됨)
- Web/Android 동작 가능 — Android APK 사이드로드로 검증
- **iOS만 남음** — 현재 심사 중인 빌드에는 push 미포함 (의도적)

## Firebase 쪽 완료 상태
- ✅ Firebase Cloud Messaging API (V1) 활성화
- ✅ 프로덕션 APNs 인증 키 이미 업로드됨 (Key ID `3UG6XQ5H7W`, Team ID `M9ZMZ99KS2`)
- ✅ Android google-services.json 연동됨

## 사용자가 심사 승인 후 해야 할 일 (Xcode 작업만)

### 1. Xcode Capability 추가 (5분)
`ios/App/App.xcodeproj` 열기 → App target → Signing & Capabilities:
- `+ Capability` → **Push Notifications** 체크
- `+ Capability` → **Background Modes** → "Remote notifications" 체크

### 2. AppDelegate.swift 수정 (10분)
파일 경로: `ios/App/App/AppDelegate.swift`

추가할 코드 (기존 메소드와 공존하도록 삽입):
```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}

func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}
```

import 확인: `import Capacitor` 이미 있어야 함.

### 3. 빌드 & 제출
- `npm run cap:ios` → Xcode → Archive → TestFlight 업로드
- 버전 번호 올리기 (현재 이후 버전)
- **실기기에서 푸시 수신 테스트 필수** (시뮬레이터는 푸시 불가)

## 확인 포인트 (제출 전 체크리스트)
- [ ] `ios/App/App/App.entitlements`에 `aps-environment = production` 항목 있는지
- [ ] Settings → 알림 섹션에서 토글 ON 동작
- [ ] Firebase Console → Cloud Messaging → "Send test message"로 토큰 복사해 실제 수신 검증
- [ ] RevenueCat 샌드박스 구독으로 RENEWAL 웹훅 → push 수신 검증
- [ ] App Store 심사용 App Privacy: "Notifications" 항목 사용 표시 (필수)

## 심사 통과 이력 방지 포인트
- 권한 요청 **앱 실행 즉시 팝업 금지** — 이미 Settings 토글 기반으로 opt-in 설계되어 있음
- Pre-prompt 모달 문구에 "왜 필요한지" 명시 — 이미 `pushOptIn.body` i18n 키로 10개 언어 준비됨
- 마케팅 푸시 절대 금지 — 구독 이벤트만 전송 (이미 설계에 반영)

## 참조 파일
- [changes-0419-session2.md](changes-0419-session2.md) — Push 전체 구현 상세
- [src/utils/pushNotifications.js] — FCM 토큰 등록
- [server/utils/sendPush.js] — 서버 발송 + 10개 언어 템플릿
- [capacitor-push-notifications 공식 가이드](https://capacitorjs.com/docs/apis/push-notifications)

---

# ② Meta 대시보드에 iPhone Store ID 등록 (2026-04-23 추가)

## 배경
APronunFit Facebook App(`822618547094999`)의 **Meta 광고 관리자 > 계정 및 플랫폼 설정 > 2단계 iOS 섹션**에 iPhone Store ID를 등록하려 했으나, **iOS 앱이 아직 App Store에 공식 출시 안 됨(심사 중/TestFlight 단계)**이라 Meta가 Store ID 검증 실패 → 저장 오류 발생.

따라서 현재는 iOS 섹션에 **번들 ID(`com.arigems.pronunfit`)만 등록**된 상태. Store ID 필드는 비워둠.

## 해야 할 일 (App Store 정식 출시 확인 직후)

### 1. App Store URL 확인 (먼저)
브라우저에서 다음 URL 접속해 PronunFit 앱 페이지가 정상 표시되는지 확인:
```
https://apps.apple.com/app/id6761342764
```

- 정상 표시됨 → 2단계 진행
- 404 또는 "앱을 찾을 수 없음" → Apple App Store 공개 상태 재확인 필요

### 2. Meta 대시보드에 Store ID 입력 (5분 작업)

**경로**: https://developers.facebook.com/apps/822618547094999/ → 이용 사례 → **"Meta 광고 관리자로 앱 광고 만들기 및 관리하기"** → 맞춤 설정 → **계정 및 플랫폼 설정** → **2단계: 플랫폼 및 앱 스토어 추가** → iOS 섹션

입력값:
- **iPhone Store ID**: `6761342764`
- **iPad Store ID**: `6761342764` (Universal 앱 가정. iPad 미지원이면 비움)
- **URL 스키마 접미사**: 비움
- **공유 비밀**: 비움
- **앱 내 이벤트 자동 로깅**: ON 유지 (이미 활성)

**저장(변경 사항 저장)** 클릭 → 빨간 경고 사라지면 성공.

## 의미
Meta 광고에서 **iOS App Install 캠페인 최적화**를 위해 필요. Store ID 등록 시:
- Meta가 광고 클릭 → App Store 직접 연결 (딥링크)
- iOS 어트리뷰션 정확도 향상
- iOS 사용자 타겟팅 기반 광고 가능

## 기록
- 2026-04-23 시도 시 App Store 미공개 상태라 저장 실패 → 나중으로 미룸
- Apple App Store ID `6761342764`는 확정값 (메모리 [changes-0407.md](changes-0407.md)에 등록)
- 번들 ID `com.arigems.pronunfit`는 이미 Meta 대시보드에 등록 완료
