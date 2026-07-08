---
name: changes-0415
description: 2026-04-15 Firebase Analytics Android SDK 의존성 누락 수정 — GA 사용자 측정항목 0 문제 해결
type: project
originSessionId: e74ed0af-f033-4ea5-9b54-20e13084b951
---
# 2026-04-15: Firebase Analytics SDK 누락 수정

## 문제
Firebase Console의 Google Analytics "사용자 측정항목" 카드가 모두 0으로 표시됨.
Firebase 공식 가이드의 "사용자 측정항목 문제 해결" 조건(앱 Firebase 연결, SDK 올바른 구현)을 점검한 결과, Android 측 SDK 의존성 누락이 원인으로 확인됨.

## 플랫폼별 진단 결과

### 🌐 Web — OK
- [src/firebase/config.js:45](src/firebase/config.js#L45)에서 `getAnalytics(app)` 호출됨
- `VITE_FIREBASE_MEASUREMENT_ID` (G-XXXXXXXXXX) 환경변수 설정 필요 (전제조건)

### 🤖 Android — ❌ 주원인
- [android/app/build.gradle](android/app/build.gradle)에 `com.google.gms.google-services` 플러그인은 적용돼 있었음 (line 66)
- 그러나 **`firebase-analytics` SDK 의존성이 dependencies 블록에 누락**
- `@capacitor-firebase/crashlytics`는 Crashlytics만 포함하고 Analytics를 transitive로 끌고 오지 않음
- 결과: `first_open`, `session_start`, `screen_view` 등 이벤트가 네이티브에서 전혀 로깅되지 않음 → GA 0건

### 🍎 iOS — 보통 OK (검증 필요)
- [ios/App/App/AppDelegate.swift:14-16](ios/App/App/AppDelegate.swift#L14-L16)에서 `FirebaseApp.configure()` 호출됨
- Package.resolved에 `GoogleAppMeasurement`가 포함됨 (CapacitorFirebaseCrashlytics → FirebaseCrashlytics 경유 transitive)
- 기본 자동수집은 작동할 가능성이 높으나, 확실히 하려면 `CapApp-SPM/Package.swift`에 `FirebaseAnalytics` product 명시적 추가 권장 (이번에는 미적용)

## 수정 내용

### [android/app/build.gradle](android/app/build.gradle#L52-L54)
dependencies 블록에 Firebase BOM 33.7.0 + firebase-analytics 추가:

```gradle
implementation project(':capacitor-android')
// Firebase BOM + Analytics (GA 사용자 측정항목 수집)
implementation platform('com.google.firebase:firebase-bom:33.7.0')
implementation 'com.google.firebase:firebase-analytics'
// Facebook SDK for native Facebook Login
implementation 'com.facebook.android:facebook-login:latest.release'
```

BOM 방식을 선택한 이유: 향후 다른 Firebase SDK 추가 시 버전 자동 정렬, 호환성 보장.

## 배포
- 커밋: `efde748` (main 브랜치 직접 push — 사용자가 production 배포 명시적 요청)
- 메시지: "fix: Firebase Analytics SDK 의존성 추가 — GA 사용자 측정항목 0 해결"

## 다음 단계 (사용자 액션)
1. AAB 재빌드 (`build-aab.sh`)
2. Play Store 트랙 업로드
3. 설치 후 수 분~24시간 내 Firebase Console GA 대시보드에서 `first_open`, `session_start` 이벤트 수집 확인
4. 만약 iOS에서도 측정항목이 0이면 `CapApp-SPM/Package.swift`에 `FirebaseAnalytics` product 명시적 추가 필요

## 교훈 (재발 방지)
**Why:** Firebase 플러그인을 Capacitor 서브패키지 단위로 추가하다 보면 Analytics가 누락되기 쉬움. Capacitor에는 `@capacitor-firebase/analytics`가 별도 존재하지만, 웹에서 `firebase/analytics`로 충분한 경우 네이티브용 SDK 추가를 잊기 쉬움.
**How to apply:** Firebase Analytics를 쓴다면 Android는 `firebase-analytics` 의존성, iOS는 `FirebaseAnalytics` SPM product를 반드시 확인할 것. Crashlytics 설치돼 있다고 Analytics가 함께 오는 것 아님.
