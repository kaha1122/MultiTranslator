---
name: feedback_platform_specific_versions
description: 네이티브 버전 비교 로직은 반드시 플랫폼(iOS/Android) 구분 필수 — iOS/Android 스토어 버전이 독립 관리됨
type: feedback
originSessionId: 07851fc1-3875-4c2a-9281-3810da3195ac
---
**규칙**: `firstNativeVersion` / `currentNativeVersion` 을 feature launch 판정에 사용할 때 **반드시 플랫폼(iOS/Android) 구분 후 비교**할 것.

**Why:** iOS App Store와 Android Play Store는 버전 번호가 **독립적으로 관리**됨. 같은 시점에도 iOS v1.2.3, Android v1.2.7 같이 다름. 기능 launch 시점도 플랫폼별로 다를 수 있음 (예: Android 먼저 출시, iOS는 심사 통과 후).

플랫폼 구분 없이 단일 버전 비교 (`firstNativeVersion >= '1.2.7'`) 시:
- Android 신규 v1.2.7 유저: 정확히 스킵
- iOS 신규 v1.2.4 유저: '1.2.4' < '1.2.7'으로 판정되어 **NEW 뱃지 잘못 표시**
- iOS 구버전 v1.2.3 유저: '1.2.3' < '1.2.7' 스킵 안 됨 (우연히 맞음)

**How to apply:**
- Firestore `users` 문서에 `firstNativePlatform`, `currentNativePlatform` 함께 저장 (이미 구현됨 v1.4.42)
- Feature launch 판정 시 플랫폼별 맵 사용:
  ```js
  const FEATURE_LAUNCH_VERSIONS = {
      notifications: { android: '1.2.7', ios: '1.2.4' },
  };
  const platform = profile.firstNativePlatform;
  const launchVer = FEATURE_LAUNCH_VERSIONS.notifications[platform];
  if (compareVersions(profile.firstNativeVersion, launchVer) >= 0) skipBadge();
  ```
- 버전 비교는 **semver 스타일** (`1.2.10 > 1.2.9`)로, 단순 문자열 비교 금지
- 신규 feature 추가 시 `FEATURE_LAUNCH_VERSIONS`에 플랫폼별 런치 버전 함께 기록
- App Store 실제 출시 완료된 후에만 iOS 런치 버전 반영 (심사 중인 빌드 번호 사용 금지)

## 관련 Firestore 필드 (2026-04-19 확정)

```
users.firstNativeVersion: string      // e.g., "1.2.7"
users.firstNativePlatform: "android" | "ios"
users.firstNativeVersionSetAt: Timestamp
users.currentNativeVersion: string    // 앱 실행 시마다 갱신
users.currentNativePlatform: "android" | "ios"
users.currentNativeVersionUpdatedAt: Timestamp
```

## ⚠️ 플랫폼 정보 단일 소스 — `currentNativePlatform`만 사용

**레거시 필드 `users.fcmPlatform` 더 이상 쓰지 말 것** (v1.4.43부터 기록 중단):
- 과거 `saveFcmTokenToFirestore(uid, token, platform)`에서 `fcmPlatform` 함께 저장했으나,
- `currentNativePlatform`과 기능 중복 — 현재는 `currentNativePlatform`이 **단일 진실 원본**
- `saveFcmTokenToFirestore(uid, token)` 시그니처로 platform 인자 제거됨
- 기존 `fcmPlatform` 필드가 있는 사용자 문서는 그대로 남겨둠 (호환성, 삭제 불필요)
- 플랫폼 판정이 필요한 모든 로직은 `profile.currentNativePlatform` 참조
