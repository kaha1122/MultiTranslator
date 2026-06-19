---
name: changes-0323-session2
description: 2026-03-23 2차 — 네이티브 전화인증 구현, Play Store 업데이트 팝업 자동화, 구독 모달 복귀, 계정 업그레이드 스피너 분리, Scene/Vocab 프롬프트 개선
type: project
---

# 2026-03-23 Session 2 변경 이력

## 1. 네이티브 전화(SMS) 인증 — 전면 구현
### 문제
웹앱에서는 Firebase `RecaptchaVerifier`로 전화인증이 정상 동작하지만, Capacitor 네이티브 앱에서는 WebView 환경에서 reCAPTCHA가 동작하지 않아 SMS 발송 자체 불가.

### 해결 과정 (여러 차례 시행착오)
1. **`capacitor.config.json`에 `"phone"` provider 추가** — 핵심 원인. `providers: ["google.com", "facebook.com"]`에 `"phone"`이 빠져있어 네이티브 Phone Auth 프로바이더가 초기화되지 않음
2. **`linkWithPhoneNumber` → `signInWithPhoneNumber`으로 변경** — `linkWithPhoneNumber`은 네이티브 레이어에 사용자가 인증되어야 동작. 익명 사용자는 웹 SDK로만 로그인하므로 네이티브 레이어 미인증 상태. `signInWithPhoneNumber`은 네이티브 인증 상태 불필요
3. **이벤트 기반 플로우** — 플러그인의 `signInWithPhoneNumber`은 `void` 반환. `phoneCodeSent`/`phoneVerificationCompleted`/`phoneVerificationFailed` 리스너로 verificationId 수신
4. **코드 확인은 웹 SDK 통일** — 네이티브에서 받은 verificationId를 웹 SDK의 `PhoneAuthProvider.credential()` + `updatePhoneNumber()`로 처리. 네이티브/웹 공통 로직
5. **Google Play 앱 서명 키 SHA-256 등록** — Play Store 내부 테스트로 설치 시 Google Play 앱 서명 키로 재서명됨. 이 키의 SHA-256이 Firebase Console에 미등록이면 Play Integrity 검증 실패 → SMS 발송 차단
6. **Play Integrity API 활성화** — Google Cloud Console에서 활성화 필요

### 최종 아키텍처
- **SMS 발송**: 네이티브 → `FirebaseAuthentication.signInWithPhoneNumber()` (reCAPTCHA 우회), 웹 → `RecaptchaVerifier` + `PhoneAuthProvider.verifyPhoneNumber()`
- **코드 확인**: 네이티브/웹 공통 → `PhoneAuthProvider.credential()` + `updatePhoneNumber()`
- **Firestore 저장**: `users/{uid}.phoneVerified = true` + `verifiedPhones/{phoneNumber}` 문서 생성

### 관련 파일
- `src/App.jsx` — `handleSendPhoneVerification()`, `handleVerifyPhoneCode()`
- `capacitor.config.json` — providers에 "phone" 추가
- Firebase Console — SHA-256 등록 (업로드키 + Play 앱 서명키 둘 다)
- Google Cloud Console — Play Integrity API 활성화

### 핵심 교훈
- `@capacitor-firebase/authentication`의 phone auth 메서드는 이벤트 기반 (void 반환)
- `linkWithPhoneNumber`은 네이티브 레이어 인증 필수 → 익명 사용자 불가
- Play Store 배포 시 **앱 서명 키**와 **업로드 키**의 SHA-1/SHA-256 모두 Firebase 등록 필요

---

## 2. Play Store 업데이트 팝업 자동화
### 문제
기존: `MIN_NATIVE_VERSION` 하드코딩 → AAB 출시마다 코드 수정 + Capgo 배포 필요

### 해결
- **Firestore `config/app.latestNativeVersion`** 기반으로 변경
- 앱 실행 시 Firestore에서 최신 버전 조회 → 설치 버전 < 최신 버전이면 팝업
- **서버 API `POST /api/config/app`** 추가 (BUILD_SECRET 인증) → 빌드 스크립트에서 자동 호출
- **`scripts/build-aab.sh`** 스크립트 생성: 웹빌드 → cap sync → AAB 빌드 → Firestore 자동 업데이트

### Firestore 보안 규칙
```
match /config/{docId} {
  allow read: if request.auth != null;
}
```
쓰기는 Admin SDK(서버)만 가능.

### 환경변수
- Render: `BUILD_SECRET=pronunfit-build-2026-secret`

### 관련 파일
- `src/App.jsx` — useEffect에서 `getDoc(doc(db, 'config', 'app'))` 조회
- `server/routes/account.js` — `POST /api/config/app` 엔드포인트
- `scripts/build-aab.sh` — AAB 빌드 자동화 스크립트 (서버 URL: `https://multitranslator.onrender.com`)

---

## 3. 구독 모달 복귀 (인증 후)
### 문제
구독 모달 → 인증 요청 → 프로필 모달 열림 → 인증 완료 → 프로필 모달 닫힘 → 구독 모달 사라짐

### 해결
- `pendingUpgradeTier` state 추가 — 구독 모달에서 인증 요청 시 현재 tier 저장
- `closeProfileModal()` 헬퍼 — 프로필 모달 닫힐 때 `pendingUpgradeTier`가 있으면 구독 모달 자동 재오픈
- 프로필 모달의 모든 닫기 지점(저장, X버튼, 배경 클릭)에서 `closeProfileModal()` 사용

### 이메일 인증 후 자동 갱신
- `UpgradeModal.jsx`에 `visibilitychange` 리스너 추가
- 이메일 앱에서 인증 완료 후 앱 복귀 시 `auth.currentUser.reload()` → `emailVerified` 자동 갱신

---

## 4. 계정 업그레이드 모달 스피너 분리
### 문제
Google/Facebook/Email 버튼이 하나의 `loading` state를 공유 → Google 클릭 시 Facebook도 스피너 표시

### 해결
- `loading` → `loadingType` (`'google'`/`'facebook'`/`'email'`/`null`)로 변경
- 각 버튼은 `loadingType === 'google'` 등으로 자기 스피너만 표시
- `const loading = !!loadingType;`로 하위 호환 (disabled 체크용)

### 관련 파일
- `src/components/AccountUpgradeModal.jsx`

---

## 5. Scene/Vocab 프롬프트 개선
### 5-1. Scene Reply 후리가나 삽입 방지 강화
- **문제**: Reply 프롬프트에서 일본어 문장에 脚（あし）, 筋肉（きんにく）같은 후리가나가 삽입됨
- **원인**: Rule 7이 약해서 temperature 1.3에서 Gemini가 교육적 도움 경향으로 위반
- **해결**: Rule 7을 "CRITICAL" + "NEVER" + 실제 위반 사례 명시 + "네이티브가 문자메시지에 쓰듯이" 기준 명시
- Initiate/Reply 모두 동일하게 강화

### 5-2. 러시아어 강세(´) 표기 추가
- **Scene Initiate/Reply**: pronunciation 필드에 `For ru: the full sentence rewritten with accent marks (´) on stressed vowels` 추가
- **Vocab**: Rule 6, pronunciation, examplePronunciation 필드에 러시아어 강세 가이드 추가
- 예시: `Извини́те, где нахо́дится метро́?`

### 관련 파일
- `server/routes/scene.js` — Initiate 프롬프트(line 190), Reply 프롬프트(line 299), pronunciation 필드
- `server/routes/vocab.js` — Rule 6(line 136), pronunciation(line 147), examplePronunciation(line 150)

---

## 버전 이력
| 버전 | 내용 |
|------|------|
| v1.3.50 | 네이티브 전화인증 1차 시도 (linkWithPhoneNumber — 실패) |
| v1.3.51 | 이벤트 기반 플로우 (linkWithPhoneNumber — 여전히 실패) |
| v1.3.52 | capacitor.config.json에 phone provider 추가 + AAB v1.1.9 빌드 |
| v1.3.53 | Play Store 업데이트 팝업 Firestore 기반 + 서버 API + 빌드 스크립트 |
| v1.3.54 | signInWithPhoneNumber으로 변경 (네이티브 인증 상태 불필요) |
| v1.3.55 | 구독 모달 복귀 (pendingUpgradeTier) |
| v1.3.56 | UpgradeModal 이메일 인증 후 visibilitychange 자동 갱신 |
| v1.3.57 | AccountUpgradeModal 스피너 분리 (loadingType) |
| AAB v1.1.9 (code 13) | phone provider + Facebook SDK 네이티브 설정 |
| 서버 | Scene/Vocab 프롬프트 개선 (후리가나 방지 강화 + 러시아어 강세) |
