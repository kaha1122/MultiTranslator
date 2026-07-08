---
name: changes-0403-session2
description: 2026-04-03~04 iOS App Store 심사 대비 전면 구현, Safe Area/AdMob 통합, 마이크 권한, 앱 라이프사이클
type: project
---

## 2026-04-03~04 변경사항 (v1.4.3 → v1.4.7)

### 1. App Store 심사 필수 항목 구현

#### 1-1. PrivacyInfo.xcprivacy 생성
- `ios/App/App/PrivacyInfo.xcprivacy` 신규 생성 + `project.pbxproj` 등록
- NSPrivacyTracking: true (AdMob 개인화 광고)
- NSPrivacyTrackingDomains: googleads, pagead2, app-measurement, crashlytics, facebook
- NSPrivacyCollectedDataTypes: DeviceID, UserID, ProductInteraction, CrashData, PerformanceData, AudioData
- NSPrivacyAccessedAPITypes: UserDefaults(CA92.1), FileTimestamp(C617.1), DiskSpace(E174.1)

#### 1-2. ATT 프롬프트 (iOS only, AdMob 초기화 전)
- `useAdMob.js`: AdMob.initialize() 직전에 `FirebaseAuthentication.requestAppTrackingTransparencyPermission()` 호출
- `isIOS()` 조건으로 Android/Web 무영향

#### 1-3. 구매 복원 버튼
- `UpgradeModal.jsx`: `RestorePurchasesButton` 컴포넌트 추가 (네이티브에서만 표시)
- `Purchases.restorePurchases()` → 성공 시 reload, 실패 시 "복원할 내역 없음" 표시
- i18n 10개 언어: `upgrade.restorePurchases/restoreSuccess/restoreNone/loadingProducts`

#### 1-4. ITSAppUsesNonExemptEncryption
- `Info.plist`에 `false` 추가 (HTTPS만 사용, 수출규정 자동 통과)

#### 1-5. AI 데이터 처리 동의 모달
- `App.jsx`: `showAiConsent` 상태 + 온보딩 완료 후 표시
- Firestore `users/{uid}.aiConsentAt` 타임스탬프 저장 (기기 간 동기화)
- localStorage 캐시 + Firestore 정본 이중 저장
- i18n 10개 언어: `aiConsent.title/body/privacyLink/accept`
- **버그 수정**: `t()` → `getT(sourceLang, ...)` (App.jsx에 t 함수 없음 → ReferenceError 해결)

#### 1-6. NSPhotoLibraryUsageDescription
- `Info.plist`에 추가 (CameraOCRModal 갤러리 선택 기능)

#### 1-7. 푸시 알림 Capability 사전 준비
- `App.entitlements`: `aps-environment: development` (Archive 시 production 자동 전환)
- `Info.plist`: `UIBackgroundModes: remote-notification`

---

### 2. 마이크 권한 처리 (iOS)

#### 2-1. PronunFitViewController → 실패 → 제거
- **시도 1**: `CAPBridgeViewController` 서브클래스, `viewDidLoad`에서 `webView.uiDelegate = self` → **검은 화면** (Capacitor 내부 delegate 체인 파손)
- **시도 2**: `CAPPlugin` 기반 `MediaCapturePlugin`, `forwardingTarget` 패턴 → **흰 화면** (플러그인 메시지 디스패칭 방해)
- **결론**: 두 방식 모두 제거. Main.storyboard는 `CAPBridgeViewController` 유지
- 마이크 반복 팝업(WKWebView 특성)은 출시 후 안전한 방식으로 재구현 예정

**Why:** Capacitor 8의 내부 WKUIDelegate 관리가 매우 엄격하여, uiDelegate를 어떤 방식으로든 교체하면 WebView 로딩이 깨짐.

#### 2-2. VoiceRecorder 플러그인 fallback
- `useAudioRecorder.js`: VoiceRecorder 권한 체크를 try-catch로 감싸고, 실패 시 getUserMedia로 직접 시도
- 네이티브에서 getUserMedia 실패 시 "설정에서 마이크를 허용" + "설정 열기" 버튼 표시
- i18n 10개 언어: `errors.micDeniedNative/openSettings`
- **결과**: iPhone 설정 → 마이크 → PronunFit 정상 등록 확인

#### 2-3. 설정 열기 기능
- `useAudioRecorder.js`: `openAppSettings()` 함수 → `App.openUrl({ url: 'app-settings:' })`
- TranslationCard, ScenePractice, VocabTab 3개 컴포넌트에 "설정 열기" 버튼 추가
- 네이티브에서만 표시 (`Capacitor.isNativePlatform()` 가드)

---

### 3. Safe Area + AdMob 하단 레이아웃 통합

#### 3-1. JS probe 방식의 실패 (교훈)
- **시도**: `useAdMob.js` 모듈 스코프에서 `document.body.appendChild(probe)` → iOS WKWebView에서 `document.body`가 null → TypeError → 모듈 전체 실패 → **흰 화면**
- **교훈**: useAdMob.js 모듈 스코프에서 DOM body에 절대 접근하지 말 것. `document.documentElement`만 안전.

#### 3-2. 최종 구현: CSS env() + .admob-active 클래스
- **전략**: JS probe 완전 제거, CSS `env(safe-area-inset-bottom)` 직접 사용
- `useAdMob.js setOffset()`: 광고 유무에 따라 `<html>`에 `.admob-active` 클래스 토글
- CSS 분기:
  - 기본(광고 없음): `env(safe-area-inset-bottom, 0px)` — iOS ~34px, Android/Web 0px
  - `.admob-active` (광고 있음): `var(--admob-bottom)` — 배너가 safe-area 포함

#### 3-3. 6가지 케이스 동작

| | 광고 있음 (Trial) | 광고 없음 (Pro/Premium) |
|---|---|---|
| **iOS** | `.admob-active` → admob-bottom ~60px | env(safe-area-inset-bottom) ~34px |
| **Android** | `.admob-active` → admob-bottom ~60px | env() = 0px |
| **Web** | 광고 없음 → 0px | 0px |

#### 3-4. 수정된 요소 목록
- `App.css`: app-container, app-nav, tab-dots, sidebar, sidebar-footer
- 모달 CSS 5개: UpgradeModal, OnboardingModal, BookmarkPrompt, RenewalReminder, DailyProgress
- 모달 JSX 3개: ConfirmModal, TrialLimitModal, AccountUpgradeModal
- 컴포넌트 CSS 6개: AppGuide, CameraOCR, Library, ListeningTab, TabTutorial, LegalPages
- `App.jsx` 인라인 스타일 3곳

#### 3-5. 플랫폼 CSS 클래스 부여
- **문제**: `useAdMob.js` 모듈 스코프에서 `isNativePlatform()` 호출 → iOS WKWebView에서 Capacitor 브릿지 미준비 → `window.Capacitor` = undefined → 클래스 안 붙음
- **해결**: `App.jsx` useEffect로 이동 (React 렌더 시점 = 브릿지 확실히 준비)
- `document.documentElement` + `document.body` 양쪽에 `platform-ios/android`, `platform-native` 클래스 부여

#### 3-6. 네이티브 앱 광고 아래 틈 배경색
- `App.css`: `.platform-native body` + `body.platform-native` → `background-color: var(--bg-primary)`, `background-image: none`
- Web: 기존 `#e2e8f0` 유지 (480px 바깥 영역)

---

### 4. 앱 라이프사이클

#### 4-1. 백그라운드 진입 시 녹음 자동 중단
- `App.jsx`: `appStateChange` 리스너 → `isActive: false` 시 `app-background` 이벤트 발행
- `useAudioRecorder.js`: `app-background` 이벤트 수신 → 녹음 중이면 자동 stop
- iOS 홈 버튼/스와이프, Android 홈 버튼 모두 대응
- Web: `isNativePlatform()` 가드로 무영향

---

### 5. 업데이트 팝업 iOS/Android 분리

#### 5-1. 문제
- Firestore `latestNativeVersion: "1.1.14"` (Android용)
- iOS 앱 `info.version: "1.0"` → `1.0 < 1.1.14` → 매번 "Play Store 업데이트" 팝업

#### 5-2. 수정
- iOS: `configData.latestIOSVersion` 전용 필드만 사용 (없으면 팝업 안 뜸)
- Android: `configData.latestAndroidVersion || configData.latestNativeVersion` (기존 유지)
- App Store URL: `idXXXXXXXXXX` 플레이스홀더 → `id6761342764` 실제 ID 적용
- Firestore `config/app`에 `latestIOSVersion: "1.0"` 필드 추가 완료

---

### 6. 기타

#### 6-1. Azure Speech SDK 업데이트
- `server/package.json`: `microsoft-cognitiveservices-speech-sdk` 1.33.0 → 1.49.0
- 2026-07-01 이전 필수 (CRL 캐싱 문제로 Linux/Android 연결 실패 방지)

#### 6-2. Xcode Cloud CI 스크립트 최적화
- `ci_post_clone.sh`: `brew install node` 스킵 로직, `npm ci --prefer-offline`, `NODE_OPTIONS --max-old-space-size=4096`
- exit code 130 (메모리 부족/프로세스 중단) 방지

---

### iOS 앱 시작 시퀀스 (교훈 정리)

**모듈 스코프에서 안전한 것:**
- `document.documentElement` 접근 (항상 존재)
- `window.Capacitor` 체크 (존재 여부만, 없으면 undefined)
- CSS 변수 설정 (`r.style.setProperty`)

**모듈 스코프에서 위험한 것 (iOS WKWebView):**
- `document.body` 접근 → null일 수 있음 → TypeError → 모듈 전체 실패 → 흰 화면
- `window.Capacitor.isNativePlatform()` 호출 → 브릿지 미주입 시 undefined → 클래스 안 붙음
- `webView.uiDelegate = self` → Capacitor 내부 delegate 파손 → 검은 화면

**안전한 대안:**
- body 접근 → `DOMContentLoaded` 대기 또는 React useEffect에서
- Capacitor API 호출 → React useEffect에서 (렌더 시점에 브릿지 보장)
- uiDelegate → 현재 안전한 방법 없음 (Capacitor 8 제한), 출시 후 재도전

---

### 커밋 이력 (주요)
- `e7aefd2` feat(ios): App Store 심사 대비 — Privacy Manifest, ATT, 구매복원, 마이크 권한 개선
- `587c6fd` fix: AI 동의 모달 t() → getT() 수정
- `9ceb1a9` fix: AI 동의를 Firestore aiConsentAt에 저장
- `1e8a94d` fix(ios/android): 백그라운드 진입 시 녹음 자동 중단
- `e3351bb` fix(ios): NSPhotoLibraryUsageDescription 추가
- `b068f57` feat(ios): 푸시 알림 Capability 추가
- `ca6f47b` fix: Safe Area + AdMob 하단 레이아웃 전면 재구현 — CSS env() 직접 사용
- `55ee184` fix(ios): 마이크 권한 요청 실패 방어
- `cc9f0d8` fix(ios): 업데이트 팝업 iOS/Android 완전 분리
- `92ffa7a` fix(ios): 플랫폼 CSS 클래스를 App.jsx useEffect로 이동
- `5bf69f1` chore: bump version to v1.4.7

### 배포
- Vercel: 자동 (main push)
- Capgo production: v1.4.7
- iOS TestFlight: 1.0 (빌드 48~), Xcode Cloud 또는 Mac 수동 빌드
- Render 서버: 자동 (Azure Speech SDK 1.49.0 배포됨)
