---
name: changes-0409
description: 2026-04-09 — Apple 심사 리젝 5개 이슈 대응, RevenueCat iOS 키 오타수정, Apple Sign-In capability 추가, email null 처리, 구독정보 표시, iOS 프로모이미지 변환, 유료앱계약 활성화
type: project
---

## 2026-04-09 변경 사항

### Apple 심사 리젝 대응 (빌드 81 → 리젝, 빌드 83/84로 재제출 준비)

#### 이슈 1: Apple Sign-In 실패 (ASAuthorizationError 1000)
- **증상**: Apple 심사관 + 실제 iPhone 테스트 모두 "The operation couldn't completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)" 에러
- **근본 원인**: Xcode 프로젝트의 **Signing & Capabilities 탭에 Sign in with Apple capability 미등록**
  - `ios/App/App/App.entitlements` 파일에는 `com.apple.developer.applesignin` 키가 있었음
  - Apple Developer Portal → Identifiers → com.arigems.pronunfit에도 Sign In with Apple 체크됨
  - **하지만** Xcode 프로젝트 자체에 Capability가 추가되지 않으면, 빌드 시 프로비저닝 프로파일에 해당 권한이 포함되지 않음
  - entitlement 파일 = 선언만, Xcode Capability = 실제 프로비저닝 프로파일에 권한 포함
- **해결**: Mac Xcode → Target → Signing & Capabilities → **+ Capability → Sign in with Apple** 추가
- **교훈**: entitlement 파일, Developer Portal, Xcode Capability 3곳 모두 일치해야 동작
- **검증**: 빌드 83 TestFlight에서 Apple Sign-In 성공. Apple의 "나의 이메일 가리기" 기능으로 `xxx@privaterelay.appleid.com` relay 이메일 정상 수신. 이 relay 주소로 발송한 메일은 Apple이 실제 이메일로 자동 전달함.

#### 이슈 2: IAP "Invalid API Key" (RevenueCat)
- **증상**: Apple 심사관이 구독 구매 시도 시 "There was a credentials issue. Invalid API Key." 에러
- **진단 과정**:
  1. Render 서버 환경변수 확인 → `VITE_` 프론트엔드 변수는 Render에 불필요 (서버가 아닌 클라이언트 빌드에 포함)
  2. PC `.env` 확인 → 키 존재
  3. Xcode Cloud 환경변수 확인 → 키 존재
  4. Mac `.env` 확인 → 키 존재 (빌드 81은 수동빌드라 Mac .env 사용)
  5. RevenueCat 대시보드 → iOS 앱 설정, In-app purchase key, App Store Connect API 모두 정상 (Valid credentials)
  6. **RevenueCat 대시보드의 Public API Key와 .env 값을 한 글자씩 비교 → 오타 발견!**
- **근본 원인**: `.env`의 RevenueCat iOS 키에 **1글자 오타**
  - 대시보드 정본: `appl_axXSSHqm`**j**`ngtaFOVvuelvrRXQyK`
  - Mac/PC `.env`: `appl_axXSSHqm`**i**`ngtaFOVvuelvrRXQyK` (`i`가 `j`여야 함)
  - Xcode Cloud 환경변수에는 `j`로 정상 → Xcode Cloud 빌드였으면 문제 없었을 것
  - 빌드 81은 수동빌드(Mac .env 사용)라 오타가 그대로 번들에 포함됨
- **해결**: PC `.env` + Mac `.env` 모두 `i` → `j`로 수정
- **교훈**: API 키는 반드시 원본과 byte-level 대조. 수동빌드 시 Mac .env 관리 주의.
- **검증**: 빌드 83에서 "Invalid API Key" 에러 사라짐, RevenueCat 정상 초기화 확인

#### 이슈 3: 구독 정보 누락 (기간/EULA) — Guideline 3.1.2(c)
- **Apple 요구사항**: 자동갱신 구독 앱은 앱 내에 (1) 구독 기간 (2) Privacy Policy 링크 (3) Terms of Use(EULA) 링크를 포함해야 함. App Store 메타데이터에도 EULA 링크 필요.
- **기존 상태**: UpgradeModal에 "1개월 ₩16,990" 가격만 표시, 자동갱신 명시 없음, Privacy/Terms 링크 없음
- **수정 내용 (UpgradeModal.jsx + UpgradeModal.css)**:
  1. **플랜 기간에 "(자동 갱신)" 표시 추가**: 기존 `"1개월"` → `"1개월 (자동 갱신)"` — 3곳 수정 (네이티브 플랜, 웹 플랜, PayPal 플랜)
     - 코드: `<span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>({t('upgrade.autoRenew')})</span>`
  2. **footer 문구 변경**: 기존 `"언제든지 취소 가능 · 카드 정보는 안전하게 처리됩니다"` 위에 자동갱신 안내 추가
     - `"구독은 해지하기 전까지 자동으로 갱신됩니다. 언제든지 해지 가능합니다."`
  3. **개인정보처리방침 | 이용약관 링크** 추가: footer 아래에 두 링크 표시
     - 클릭 시 모달 닫고 `/privacy` 또는 `/terms` 페이지로 이동
     - CSS: `.upgrade-legal-links` 스타일 (보라색 밑줄 링크, 가운데 정렬)
  4. **i18n 10개 언어**: `autoRenew`, `autoRenewNote`, `privacyPolicy`, `termsOfUse` 키 추가
- **App Store Connect 수동 작업**:
  - 앱 설명(Description) 하단에 `Privacy Policy: https://pronunfit.com/privacy` + `Terms of Use: https://pronunfit.com/terms` 추가
  - EULA 필드 위치: 앱 정보 → 사용권 계약 → 편집 → Apple 표준 EULA 적용 확인
- 커밋: `298988e`

#### 이슈 4: IAP 상품 심사 미제출 — Guideline 2.1(b)
- **Apple 요구사항**: IAP 상품을 앱 바이너리와 함께 심사에 제출해야 함. 첫 번째 구독은 반드시 새 앱 버전과 함께 제출.
- **기존 상태**: 4개 상품 모두 "메타데이터 누락됨" 상태 → 심사에 제출 불가
- **해결 (App Store Connect 수동 작업)**:
  1. **심사용 스크린샷**: 각 상품에 UpgradeModal 캡처 1290x2796 PNG 업로드 (72 DPI, RGB, flattened, no rounded corners)
     - 원본 캡처(431x533 등)를 1290x2796 캔버스에 중앙 배치 + 흰 배경 패딩으로 리사이즈
     - 스크립트: `promo_images/` 폴더에서 Python PIL로 변환
  2. **영어 현지화**: 각 상품에 Display Name + Description 입력
     - premium_3: "Premium 3 Months" / "Unlimited pronunciation, all tabs, ad-free, premium support. Auto-renews every 3 months."
     - premium_1: "Premium Monthly" / 동일 (monthly)
     - pro_3: "Pro 3 Months" / "1,500 pronunciations/month, all tabs, ad-free. Auto-renews every 3 months."
     - pro_1: "Pro Monthly" / 동일 (monthly)
  3. **구독 그룹 현지화**: "PronunFit Subscriptions" / "PronunFit"
  4. 결과: 4개 모두 **"제출 준비 완료"** 상태
- **재제출 시**: 앱 버전 페이지 → "App 내 구입 및 구독" 섹션 → + 버튼 → 4개 선택 → 함께 제출

#### 이슈 5: Android 스크린샷 사용 — Guideline 2.3.10
- **Apple 요구사항**: 스크린샷에 비-iOS 상태바 이미지 제거
- **기존 상태**: 프로모 이미지에 Android 상태바(SKT 4:15) + Android 네비게이션 바(◁ ○ ▫) 포함
- **해결**: Gemini AI 이미지 편집으로 일괄 변환
  - **모델**: `gemini-3.1-flash-image-preview` (Nano Banana 2) — `gemini-2.5-flash-image`보다 편집 품질 우수
  - **프롬프트 핵심**: 폰 목업 영역만 수정, 상단 Android 상태바 → iOS 상태바(9:41), 하단 Android 버튼 → iOS 홈 인디케이터(가로 pill bar)
  - **SDK**: `google.genai` Python SDK, `types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"])`
  - **리사이즈**: AI 출력 이미지를 원본 크기로 `Image.LANCZOS` 리사이즈 (해상도 보존)
  - **결과**: 120개 이미지 변환 (5 promo × 6 언어 × 4 사이즈), 2개 1차 실패 → 재시도 성공
  - **출력 구조**: `promo_images/ios_output/{lang}/promo_XX_{lang}_{size}.png` (언어별 폴더)
  - **스크립트**: `promo_images/edit_to_ios.py` (단건), `promo_images/edit_all_to_ios.py` (일괄)
  - Rate limit 대응: 이미지당 `time.sleep(2)` 적용

---

### email null 처리 개선

#### 문제 발견 및 분석
- **발견 계기**: Facebook 유저 (UID `EnPt16erbCVd0eZqMDbzOl62Qq03`, 베트남 Bạc Liêu) 로그인 성공했으나 email이 null
- **Firebase Auth 조회 결과**: email=undefined, provider=facebook.com, displayName="Tuyet Anh"
- **Firestore 조회 결과**: email=null, displayName="User" (Facebook의 displayName도 못 가져옴)
- **원인 분석**:
  1. **Facebook**: `facebookProvider.addScope('email')` 설정 있지만, 사용자가 전화번호로만 Facebook 가입 시 email 미제공 (동남아시아에서 흔함)
  2. **Google**: `googleProvider`에 email scope 미설정 (`addScope('email')` 누락) — 기본적으로 email 반환하지만 보장 안 됨
  3. **Apple**: email scope 있지만, "나의 이메일 가리기" 선택 시 relay 이메일 제공 (null은 아님)
  4. **공통**: 모든 로그인 핸들러에서 `user.email`이 null이어도 검증 없이 Firestore에 그대로 저장
  5. **결과**: email null → UpgradeModal에서 `sendEmailVerification()` 불가 → 영원히 구독 불가

#### 수정 로직 상세

**1. Google Provider email scope 추가** — `src/firebase/config.js`
```js
// 변경 전
export const googleProvider = new GoogleAuthProvider();
// 변경 후
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
```
- Facebook(`facebookProvider.addScope('email')`)과 Apple(`appleProvider.addScope('email')`)은 이미 있었음

**2. Login/Signup — email fallback + 정상 로그인 허용** — `Login.jsx`, `Signup.jsx`
- **변경 전**: `user.email`을 직접 사용 → null이면 null로 저장
- **변경 후 (2단계 진화)**:
  - 1차 수정: email null → `auth.signOut()` → 에러 메시지 → **로그인 차단** (사이드이펙트 발견: orphan Auth 레코드, 마이그레이션 문제)
  - 최종 수정: email null이어도 **정상 로그인 허용** → App.jsx 레벨에서 email 등록 모달 표시
- **코드 패턴** (Google/Facebook/Apple 각 네이티브+웹 = 6곳씩, Login+Signup = 12곳):
```js
const additionalInfo = getAdditionalUserInfo(userCredential);
const resolvedEmail = user.email || additionalInfo?.profile?.email || null;
// email null이어도 signOut 안 함, 정상 진행
const profileData = { uid: user.uid, email: resolvedEmail, ... };
await setDoc(doc(db, 'users', user.uid), profileData, { merge: true });
```
- `additionalInfo?.profile?.email`: Facebook/Apple이 `user.email`에는 안 넣지만 profile 객체에는 넣을 수 있는 케이스 대응

**3. AccountUpgradeModal — signOut 제거** — `AccountUpgradeModal.jsx`
- `migrateAndSignIn()` 함수에서 email null 시 `auth.signOut()` + `throw { code: 'auth/no-email' }` 제거
- 각 핸들러(Google/Facebook/Apple)의 `linkWithCredential` 후 email 체크 제거
- catch에서 `auth/no-email` 에러 핸들링 제거

**4. App.jsx — email 미등록 모달 (로그인 직후 즉시 표시)**
- **감지 로직**: `useEffect`에서 `user && !user.isAnonymous && !user.email` 조건 감시
  - dependency: `[user?.uid, user?.email]` — email이 채워지면 자동으로 모달 닫힘
- **모달 UI**: zIndex 3100 (AI 동의 모달 3000보다 위), 닫기 버튼 없음 (email 입력 필수)
  - 빨간 Mail 아이콘 + 제목/설명 + email input + "등록" 버튼
  - Enter 키로 제출 가능 (`onKeyDown`)
- **저장 로직**: `updateEmail(auth.currentUser, emailInput)` → **인증 메일 없이 즉시 저장**
  - `verifyBeforeUpdateEmail()`이 아닌 `updateEmail()` 사용 → 가입 직후 UX 마찰 최소화
  - 방금 로그인한 세션이라 재인증 없이 `updateEmail()` 동작
  - Firestore에도 `{ email: emailInput }` merge 저장
  - 성공 시 `setShowEmailRegister(false)` → 모달 닫힘
- **에러 핸들링**: too-many-requests, email-already-in-use, 일반 실패
- **2단계 인증 (구독 시)**: 기존 UpgradeModal의 `needEmailVerify` 로직이 이메일 인증을 요구 → `sendEmailVerification()` → 인증 완료 후 구매 가능

**5. UpgradeModal — email 없는 유저 이메일 등록 UI** — `UpgradeModal.jsx`
- `hasNoEmail = !user?.email` 상태 추가
- `showVerifyWarnings` 활성 시, `hasNoEmail`이면 기존 이메일 인증 UI 대신 **이메일 입력 UI** 표시
  - 빨간 border 박스 (기존 이메일 인증 = 파란 border)
  - `verifyBeforeUpdateEmail()` 사용 (구독은 인증까지 필요하므로)
  - 기존 이메일 인증 UI는 `needEmailVerify && !hasNoEmail` 조건으로 분리
- import에 `verifyBeforeUpdateEmail` 추가

**6. i18n 10개 언어 번역 키 추가**
- `auth` 섹션: `noEmailError` — "이메일이 없는 계정입니다. Google 또는 이메일 로그인을 이용해 주세요."
- `upgrade` 섹션: `noEmailTitle`, `noEmailDesc`, `addEmail`, `emailUpdateSent`, `invalidEmail`

#### email null 처리 흐름 정리
```
소셜 로그인 (email 없는 Facebook 등)
  → 정상 로그인 (signOut 안 함)
  → Firestore에 email: null 저장
  → App.jsx 감지 → 즉시 email 입력 모달
  → updateEmail() 즉시 저장 (인증 없음) → 앱 사용 가능
  → 나중에 구독 시도
  → UpgradeModal에서 emailVerified 체크
  → sendEmailVerification() → 인증 메일 → 인증 완료 → 구매 가능
```

- 커밋: `3c8dd42`

---

### 유료 앱 계약 (Paid Apps Agreement) 활성화
- **문제**: IAP 상품이 Sandbox에서 "None of the products registered in the RevenueCat dashboard could be fetched from App Store Connect" 에러
- **원인**: App Store Connect → 비즈니스 → 유료 앱 계약이 **"사용자 정보 대기 중"** 상태 → IAP 상품을 StoreKit에서 가져올 수 없음
- **해결**: 은행 계좌(KakaoBank) + 세금 양식(W-8BEN) 작성
  - W-8BEN: 한국 개인 → Name, Country(South Korea), Foreign TIN(주민번호/사업자번호), 한국주소, Tax treaty(Korea) 선택
  - Part III Certification 2개 체크박스 체크 + 제출
- **결과**:
  - 유료 앱 계약: **활성화됨** ✅
  - 은행 계좌: **활성화됨** ✅
  - U.S. Certificate + W-8BEN: **활성화됨** ✅
  - 대한민국 세금 양식: **대기 중** (Apple 검토 중, 1~2일 소요)
- 유료 앱 계약 활성화 → IAP 상품 Sandbox 동작 가능 (시간 소요될 수 있음)

---

### 재제출 체크리스트
- [x] Apple Sign-In capability 추가 (Xcode)
- [x] RevenueCat iOS 키 오타 수정 (Mac .env)
- [x] 구독 정보 표시 (자동갱신 + Privacy/Terms 링크)
- [x] IAP 4개 상품 메타데이터 완성 (스크린샷 + 현지화)
- [x] iOS 프로모 이미지 120개 변환
- [x] 유료 앱 계약 활성화
- [ ] App Store Connect 앱 설명에 Privacy/Terms URL 추가
- [ ] App Store Connect 스크린샷 교체 (ios_output 폴더)
- [ ] 앱 버전에 IAP 4개 연결
- [ ] Mac에서 최종 빌드 (빌드 84) — git pull 후 구독정보 표시 코드 포함
- [ ] 대한민국 세금 양식 승인 확인
- [ ] IAP Sandbox 테스트 확인
- [ ] 심사 재제출

### 커밋 이력
- `3c8dd42` fix: email null 처리 개선 + Google Provider scope + RevenueCat iOS 키 수정
- `298988e` feat: 구독 정보 표시 개선 — 자동갱신 명시 + Privacy/Terms 링크 (Apple 이슈 3)

### 빌드
- iOS TestFlight: 빌드 83 (Sign in with Apple + RevenueCat 키 수정, 구독정보 표시 미포함)
- 빌드 84 예정 (구독정보 표시 포함, 최종 심사용)
- Capgo staging: v1.4.15
- Vercel: 자동 배포 완료
