---
name: changes-0322-session3
description: 2026-03-22 3차 — Facebook 로그인 인증 전면 구현, 도메인 인증, 네이티브 SDK 설정, 사이드바 익명UID 표시
type: project
---

## 2026-03-22 3차 세션 작업 내역

### Facebook 로그인 인증 추가 (웹 + 네이티브)

#### 외부 설정 (Facebook Developer Console + Firebase Console)
- Facebook Developer Console 앱 생성 (App ID: `1549474396756439`)
- Firebase Console → Authentication → Facebook 제공업체 활성화 (App ID + App Secret 등록)
- OAuth 리디렉션 URI 양쪽 등록 완료
- Facebook 도메인 인증: `index.html`에 `<meta name="facebook-domain-verification">` 메타태그 추가
- Android 키 해시 3개 등록 (Debug + Release 업로드키 + Play Store 앱 서명 키)
  - Debug: `esC9QsMxbqZnM2gok70wUOJ2cM8=`
  - Release: `6iah/O0vEXs0sb8wsB1jFFtnVm0=`
  - Play Store 서명: `kJlJjeDzGXn5h722bkOn1SnAZWY=`
- Android 패키지명 `com.arigems.pronunfit` + 클래스 `com.arigems.pronunfit.MainActivity` 등록
- 투명 배경 로고 생성: `icon-512-transparent.png`, `icon-1024-transparent.png`

#### 코드 구현 — 웹 (signInWithPopup)
- **`src/firebase/config.js`**: `FacebookAuthProvider` + `facebookProvider` export 추가, `email`/`public_profile` scope 명시
- **`src/components/Auth/Login.jsx`**: `handleFacebookLogin` — 웹(`signInWithPopup`) / 네이티브(`FirebaseAuthentication.signInWithFacebook()`) 분기, Facebook 파란색 버튼 Google 아래 배치
- **`src/components/Auth/Signup.jsx`**: 동일 패턴 Facebook 가입 버튼 + 핸들러 추가
- **`src/App.jsx`**: `handleNativeFacebookLogin` + `handleFacebookLoginFromLanding`, LandingPage에 `onFacebookLogin` prop 전달
- **`src/components/AccountUpgradeModal.jsx`**: `handleFacebookUpgrade` — 익명→Facebook 계정 업그레이드, Google과 Email 사이에 버튼 배치
- **`src/components/LandingPage.jsx`**: `onFacebookLogin` prop 수신

#### 코드 구현 — 네이티브 (Android Facebook SDK)
- **`capacitor.config.json`**: providers에 `"facebook.com"` 추가
- **`android/app/src/main/res/values/strings.xml`**: `facebook_app_id`, `facebook_client_token`, `fb_login_protocol_scheme` 추가
- **`android/app/src/main/AndroidManifest.xml`**: Facebook SDK meta-data + `FacebookActivity` + `CustomTabActivity` 등록
- **`android/app/build.gradle`**: `com.facebook.android:facebook-login` dependency 추가, versionCode 10 / versionName 1.1.6

#### 에러 대응 — `auth/account-exists-with-different-credential`
- 같은 이메일로 Google과 Facebook 모두 로그인 시도 시 발생하는 에러 핸들링
- i18n 키 `accountExistsDifferent` 추가 (10개 언어)

#### i18n (10개 언어 파일 모두)
- `auth.facebookLogin` — Facebook으로 로그인
- `auth.facebookSignup` — Facebook으로 가입하기
- `auth.facebookFailed` — Facebook 로그인 실패
- `auth.accountExistsDifferent` — 다른 로그인 방식으로 가입된 이메일
- `upgrade.facebookBtn` — Facebook으로 계속하기

#### Facebook OAuth scope 이슈
- 초기 구현 시 email을 가져오지 못함 (Firebase Auth에 식별자 `-` 표시)
- 원인: `facebookProvider.addScope('email')` 미호출
- 해결: `config.js`에 `facebookProvider.addScope('email')` + `facebookProvider.addScope('public_profile')` 추가
- Facebook Developer Console에서 `email` 권한 **고급 액세스** 전환 필요 (표준 액세스에서는 이메일 미제공)

### 기타 변경

#### 사이드바 익명 유저 UID 표시
- 사이드바 이메일 자리에 익명 유저일 경우 `user.uid` 표시
- `App.jsx` 1940행: `{user.email || (user.isAnonymous ? user.uid : '')}`

#### UpgradeModal 개선 (이전 세션 미커밋 건 포함)
- RevenueCat 구독 동기화 시 `productId`, `subscriptionMonths` 함께 저장
- `currentPlan` 매칭 로직 개선 (planId prefix 매칭)
- 네이티브 구독관리 버튼 조건: `autoRenew === true` 또는 `tierSource === 'revenuecat'`
- 가격 블록 레이아웃/뱃지 색상 변경
- i18n `manageSubscription` 키 추가

### 버전 이력
- v1.3.43: Facebook 도메인 인증 + UpgradeModal + RevenueCat 동기화
- v1.3.44: Facebook 로그인 코드 구현
- v1.3.45: Facebook OAuth scope 수정
- v1.3.46: 사이드바 익명 UID 표시
- AAB v1.1.6 (versionCode 10): Facebook SDK 네이티브 설정 포함 APK 빌드

### 트러블슈팅
1. **네이티브 Facebook 로그인 에러** (`io.capawesome.capacitorjs.plugins.firebase.auth...`): Android 프로젝트에 Facebook SDK 미설정 → `strings.xml` + `AndroidManifest.xml` + `build.gradle` 설정으로 해결
2. **Invalid Scopes: email**: Facebook 앱에서 `email` 권한 미활성화 → 고급 액세스 전환으로 해결
3. **이메일 미수신**: `facebookProvider.addScope('email')` 미호출 → scope 명시 추가로 해결
