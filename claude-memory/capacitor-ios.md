---
name: capacitor-ios
description: Capacitor iOS 앱 확장 — 초기 설정, Firebase/AdMob/Facebook/Apple Sign-In 구성, 플랫폼 분기, 빌드 스크립트
type: project
---

## Capacitor iOS 앱 확장 (2026-03-29)

### 프로젝트 경로
- **iOS 프로젝트**: `c:\Projects\multi-translator\ios`
- **Xcode 프로젝트**: `ios/App/App.xcodeproj`
- **Capacitor 버전**: 8.2.0 (Android와 동일)
- **`@capacitor/ios`**: ^8.2.0

### 감지된 Capacitor 플러그인 (6개)
- `@capacitor-community/admob@8.0.0`
- `@capacitor-firebase/authentication@8.1.0`
- `@capacitor/app@8.0.1`
- `@capgo/capacitor-updater@8.43.11`
- `@revenuecat/purchases-capacitor@12.2.4`
- `capacitor-voice-recorder@7.0.6` (SPM 미지원 경고 → CocoaPods fallback)

### Firebase iOS 설정
- Firebase Console에 iOS 앱 추가 완료 (Bundle ID: `com.arigems.pronunfit`)
- `GoogleService-Info.plist` → `ios/App/App/` 배치 완료
- **iOS CLIENT_ID**: `879220793558-cnm0sip9uset46r4hm8095fiq88cjdvt.apps.googleusercontent.com`
- **REVERSED_CLIENT_ID**: `com.googleusercontent.apps.879220793558-cnm0sip9uset46r4hm8095fiq88cjdvt`
- **iOS GOOGLE_APP_ID**: `1:879220793558:ios:be47f439696fc18653e977`

### Info.plist 설정 완료
- **URL Schemes**: Google Sign-In (REVERSED_CLIENT_ID), Facebook (`fb2187242868692310`)
- **Facebook SDK**: AppID, ClientToken, DisplayName, LSApplicationQueriesSchemes
- **AdMob**: `GADApplicationIdentifier` + SKAdNetworkItems 24개
- **권한**: NSMicrophoneUsageDescription, NSCameraUsageDescription, NSUserTrackingUsageDescription

### AdMob iOS
- **앱 ID**: `ca-app-pub-8626604652301297~8593058116`
- **Ad Unit IDs**:
  - Banner01 (bannerBottom): `ca-app-pub-8626604652301297/4522890515`
  - Bonus01 (RewardC): `ca-app-pub-8626604652301297/6602055685`
  - Bonus02 (RewardP): `ca-app-pub-8626604652301297/3209808845`
  - Interstitial01: `ca-app-pub-8626604652301297/2858455055`
- bannerTop은 미사용 → Banner01과 동일 ID로 설정

### Apple Sign-In 구현 완료 (코드)
- **capacitor.config.json**: providers에 `"apple.com"` 추가
- **firebase/config.js**: `OAuthProvider('apple.com')` + `appleProvider` export
- **Login.jsx**: `handleAppleLogin()` — 네이티브: `FirebaseAuthentication.signInWithApple()` → `OAuthProvider.credential({idToken, rawNonce})` → `signInWithCredential()`, 웹: `signInWithPopup(auth, appleProvider)`
- **Signup.jsx**: 동일 패턴
- **AccountUpgradeModal.jsx**: `handleAppleUpgrade()` — 익명→실계정 연결 + credential-already-in-use 마이그레이션
- **UI**: 검정 배경 + 흰 Apple 로고 SVG 버튼
- **i18n**: 10개 언어에 `appleLogin`, `appleSignup`, `appleFailed`, `appleBtn` 키 추가
- **주의**: Apple Developer 계정 등록 후 Firebase Console에서 Apple 프로바이더 활성화 + Xcode에서 Sign in with Apple capability 추가 필요

### 플랫폼 분기 (iOS/Android)

#### 분기 패턴: `Capacitor.getPlatform()` 사용
```javascript
const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
```

#### 분기 적용 위치
1. **App.jsx — RevenueCat configure()**
   - `Capacitor.getPlatform() === 'ios' ? VITE_REVENUECAT_IOS_KEY : VITE_REVENUECAT_ANDROID_KEY`
2. **App.jsx — 업데이트 팝업 스토어 URL**
   - iOS: `apps.apple.com/app/pronunfit/idXXXXXXXXXX` (TODO: App Store ID 등록 후 교체)
   - Android: `play.google.com/store/apps/details?id=com.arigems.pronunfit`
3. **UpgradeModal.jsx — 구독 관리 fallback URL**
   - iOS: `apps.apple.com/account/subscriptions`
   - Android: `play.google.com/store/account/subscriptions`
4. **useAdMob.js — Ad Unit IDs**
   - `AD_UNITS_IOS` / `AD_UNITS_ANDROID` / `AD_UNITS_TEST` 3분리
   - `isIOS()` 헬퍼 함수 추가

### 환경변수
- `.env`에 `VITE_REVENUECAT_IOS_KEY=appl_PLACEHOLDER` 추가 (TODO: 실제 키 교체)

### npm 스크립트
- `npm run cap:ios` — 웹 빌드 + sync + Xcode 열기
- `npm run cap:sync:ios` — 웹 빌드 + sync

### iOS 빌드 스크립트
- `scripts/build-ios.sh` — Android의 `build-aab.sh`와 유사
- 웹 빌드 → cap sync → CocoaPods → Xcode Archive → IPA Export → Firestore 업데이트
- `ios/ExportOptions.plist` — App Store 업로드용 (teamID 교체 필요)

### 완료
- [x] Apple Developer 계정 등록 ($99/년) — 2026-03-30 완료
- [x] App Store Connect 앱 생성 + 구독 상품 4개 (pro_1, pro_3, premium_1, premium_3) — 2026-03-30 완료
- [x] Firebase Console → Apple Sign-In 프로바이더 활성화 — 2026-03-30 완료
- [x] RevenueCat iOS 앱 등록 + SDK Key (`appl_axXSSHqmingtaFOVvuelvrRXQyK`) → `.env` 반영 — 2026-03-30 완료
- [x] RevenueCat Products + Entitlements(Pro/Premium) + Offerings 연결 — 2026-03-30 완료
- [x] App Store Server Notification URL → RevenueCat webhook 설정 — 2026-03-30 완료
- [x] 공유 암호(Shared Secret) 생성 + RevenueCat 등록 — 2026-03-30 완료
- [x] In-app purchase key (P8) + App Store Connect API key 등록 — 2026-03-30 완료
- [x] APNs Key 생성 (Key ID: 3UG6XQ5H7W) → Firebase Cloud Messaging 업로드 — 2026-03-30 완료
- [x] ExportOptions.plist teamID → M9ZMZ99KS2 — 2026-03-30 완료
- [x] App Store 업데이트 팝업 URL → id6761342764 — 2026-03-30 완료

### 미완료
- [ ] Xcode → Sign in with Apple capability 추가
- [ ] Mac에서 Xcode 빌드 테스트
- [ ] App Store 심사 제출 (스크린샷, 개인정보 라벨 등)
