---
name: changes-0402-session2
description: 2026-04-02 2차 — iOS TestFlight 무한 로딩 해결 (Auth persistence, Firestore Long Polling, Capgo OTA, 업데이트팝업 분기)
type: project
---

## 2026-04-02 2차 세션: iOS 무한 로딩 해결

### 증상
TestFlight에서 앱 실행 시:
1. Loading 스피너가 영원히 계속됨 (AuthContext의 `loading === true`가 해제 안 됨)
2. "Update on Play Store" 팝업이 iOS에서 노출
3. 팝업 닫고 홈 진입 후 Capgo OTA가 앱을 reload → 다시 무한 로딩

### 근본 원인 분석

**iOS Capacitor의 WKWebView는 `capacitor://localhost` 커스텀 스킴을 사용** — 이것이 Android(`http://localhost`) 및 Web(`https://...`)과 다른 핵심 차이:

| 문제 | 원인 | 영향 범위 |
|------|------|----------|
| Firebase Auth IndexedDB hang | `getAuth()`의 기본 persistence가 `capacitor://` 스킴에서 hang | iOS만 |
| Firestore WebChannel 미작동 | gRPC-web 전송이 WKWebView에서 작동 안 함 | iOS만 |
| Capgo OTA reload 루프 | production 채널에 Android 번들이 있어 iOS에서도 다운로드→reload | iOS만 |
| 업데이트 팝업 플랫폼 미분리 | `latestNativeVersion` 하나로 iOS/Android 공용 비교 | iOS만 |

**Why:** 다른 PC에서 `experimentalForceLongPolling`만 적용했지만 해결 안 됨 — Long Polling은 Firestore 문제만 해결하고, **Auth의 IndexedDB hang은 별개 문제**였음.

### 수정 내용

#### 1. `src/firebase/config.js` — iOS 전용 Firebase 초기화 분기
```js
const isIOS = Capacitor.getPlatform() === 'ios';

// Auth: iOS만 browserLocalPersistence (IndexedDB 대신 localStorage)
export const auth = isIOS
    ? initializeAuth(app, { persistence: browserLocalPersistence })
    : getAuth(app);

// Firestore: iOS만 Long Polling
export const db = isIOS
    ? initializeFirestore(app, { experimentalForceLongPolling: true })
    : getFirestore(app);
```
- **Android/Web**: `getAuth()` + `getFirestore()` — 기존과 완전 동일, 사이드이펙트 없음

#### 2. `src/context/AuthContext.jsx` — 안전장치 추가
- `auth.authStateReady()`에 5초 타임아웃 (iOS WKWebView hang 방지)
- 타임아웃 시 `signInAnonymously` 재시도
- 10초 최종 안전장치: 어떤 경로든 loading 강제 해제 (중복 호출 방지 로직 포함)

#### 3. `src/App.jsx` — Landing/업데이트 팝업/Capgo 수정
- `showLanding`: 네이티브 앱에서는 항상 `false` (웹 전용)
- 업데이트 체크: iOS는 `latestIOSVersion`, Android는 `latestAndroidVersion` 필드 분리 (없으면 `latestNativeVersion` fallback)
- Capgo OTA 이벤트 리스너/채널 등록: iOS에서 건너뜀

#### 4. `src/main.jsx` — Capgo iOS builtin 고정
```js
if (Capacitor.getPlatform() === 'ios') {
  CapacitorUpdater.reset({ toLastSuccessful: false }).catch(() => {});
}
```
- iOS 시작 시 항상 Xcode 빌드 원본(builtin) 번들 사용 — Capgo 다운로드 번들 적용 방지

#### 5. `ios/App/CapApp-SPM/Package.swift` — 백슬래시 수정
- Windows 백슬래시(`\`) → 포워드슬래시(`/`) (Xcode Cloud 빌드 에러 방지)

### Firestore `config/app` 필드 추가 필요
- `latestIOSVersion`: App Store 출시 후 추가 (현재는 필드 없으면 팝업 미노출)
- `latestAndroidVersion`: 기존 `latestNativeVersion`과 별도 관리 가능

### 후속 발견 (2026-04-03)
- 이 세션의 수정만으로는 iOS 무한 로딩이 해결되지 않았음
- **근본 원인**: `ios/App/App/capacitor.config.json`이 gitignore 대상이라 `cap sync ios` 시 루트 원본(`autoUpdate: true`)으로 매번 덮어씌워짐 → 네이티브 Capgo가 계속 활성 상태로 빌드됨
- **최종 해결**: 빌드 스크립트(`ci_post_clone.sh`, `build-ios.sh`)에서 sync 후 `autoUpdate: false` 패치 추가 → changes-0403.md 참조

### Capgo iOS 향후 계획
- 현재: iOS에서 Capgo OTA 완전 비활성화 (네이티브 + JS 양쪽)
- 향후: iOS 전용 Capgo 채널 생성 → iOS 빌드용 번들 별도 업로드 → 패치 로직 제거 가능

### 커밋 이력
- `9466b1b` fix(ios): iOS WKWebView 무한 로딩 해결 — Auth persistence + Firestore Long Polling iOS 전용 분기
- `48ba6a4` fix(ios): Landing 노출 방지, 업데이트 팝업 플랫폼 분기, Capgo iOS 비활성화
- `503f3a0` fix(ios): Capgo OTA reload 루프 방지 — iOS에서 builtin 번들로 리셋
