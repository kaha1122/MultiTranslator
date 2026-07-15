---
name: changes-0402
description: 2026-04-02 iOS 크래시 수정 (GoogleService-Info.plist 미등록), Crashlytics 추가, 프로모 이미지 리사이즈
type: project
---

## 2026-04-02 변경사항

### iOS TestFlight 크래시 수정 (핵심)

**증상**: 앱 아이콘 클릭 즉시 크래시 (빌드 1.0(2)에서 6건 크래시)

**근본 원인**: `GoogleService-Info.plist`가 디스크에는 존재했지만 **Xcode 프로젝트(project.pbxproj)에 등록되지 않아** 빌드 시 앱 번들에 포함되지 않음. `@capacitor-firebase/authentication` 플러그인 초기화 시 `FirebaseApp.configure()`가 plist를 찾지 못해 즉시 크래시.

**Xcode Organizer 크래시 스택트레이스 확인**:
- `FirebaseAuthentication.__allocating_init(plugin:config:)` → `+[FIRApp configure]` 에서 크래시
- Capacitor 브릿지 → 플러그인 로드 → Firebase 초기화 실패 순서

**수정 파일**:
1. **`ios/App/App.xcodeproj/project.pbxproj`**
   - `GoogleService-Info.plist`를 PBXFileReference, PBXGroup(App), PBXBuildFile, PBXResourcesBuildPhase에 추가
   - 파일 ID: `F1D2E3A42DB1234500AABB01` (FileRef), `F1D2E3A52DB1234500AABB02` (BuildFile)

2. **`ios/App/App/AppDelegate.swift`**
   - `FirebaseApp.configure()` → `if FirebaseApp.app() == nil { FirebaseApp.configure() }` (중복 초기화 방지)

**커밋**: `bc8bed9` (이전 세션 `05f1d7b`에서 Crashlytics 추가 + FirebaseApp.configure() 최초 추가)

### Firebase Crashlytics 추가 (이전 세션)
- `@capacitor-firebase/crashlytics` v8.2.0 설치
- `Package.swift`에 SPM 의존성 추가
- `AppDelegate.swift`에서 `Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)`
- Firebase Console → Crashlytics에서 웹으로 크래시 로그 확인 가능 (Mac 없이)

### App Store 프로모 이미지 리사이즈
- 30개 이미지 (5장 x 6언어) 1242x2208 → 1242x2688로 리사이즈 (6.5" iPhone용)
- PIL 패딩 방식 (상단 160px, 하단 320px 배경색 확장)
- 출력: `promo_images/Promo_XX/output/{en,es,jp,ko,ru,vn}/`

### 참고: iOS 크래시 디버깅 방법
- **Xcode Organizer** (Mac 필요): Window → Organizer → Crashes → 스택 트레이스
- **Firebase Crashlytics** (웹): Firebase Console → Release & Monitor → Crashlytics (크래시 후 앱 재실행 필요)
- **App Store Connect**: TestFlight → 빌드 → 충돌 피드백 (테스터 수동 보고만)

### 앱 미리보기 (App Preview)
- App Store Connect의 "앱 미리보기"는 15~30초 프로모 동영상 (최대 3개)
- 선택사항이며, 스크린샷만으로 제출 가능
