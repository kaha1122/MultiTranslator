---
name: changes-0321
description: 2026-03-21~22 작업 — 배너가림UI, 익명계정중복차단, 웹첫방문anonymous지연, 인터스티셜trial전용, Google Sign-In 프로덕션 수정(SHA-1+CredentialManager), Capgo채널정상화, User정보확장, Play Store업데이트팝업, RevenueCat초기화, pronunciation_records필드추가
type: project
---

## 2026-03-21~22 주요 작업

### 1. 배너 광고 가림 UI 수정
- UpgradeModal: `--admob-bottom` 반영 + "광고 없음" 인라인 배치
- CameraOCRModal: `margin-bottom: var(--admob-bottom)` 추가
- AppGuide: 섹션 간격 축소 + `--admob-bottom` 반영

### 2. 익명계정 중복생성 근본 차단
- **발견**: Firebase Auth에 같은 밀리초(639ms)에 2개 anonymous UID 생성됨 (REST API로 확인)
- **원인**: `onAuthStateChanged` 동시 2번 실행 시, 둘 다 `await authStateReady()` 통과 후 뮤텍스 도달 → 타이밍에 따라 둘 다 `signInAnonymously` 호출
- **수정**: 뮤텍스를 `authStateReady()` 이전으로 이동
- setDoc에 try-catch 추가 (실패해도 onSnapshot fallback 작동)
- 5초 타임아웃 폴백에도 뮤텍스 추가

### 3. 웹 첫 방문 시 anonymous 자동 생성 차단
- **문제**: 웹 첫 방문(또는 쿠키 삭제 후) 시 랜딩페이지 표시 전에 anonymous 자동 생성 → 로그인 선택하면 고아 계정
- **수정**: `webAppEntered !== '1'`이면 anonymous 생성 건너뜀 → "무료로 시작하기" 클릭 시에만 생성

### 4. 인터스티셜 광고 trial 전용
- `tier === 'pro' || tier === 'premium'` → `tier !== 'trial'`로 변경 (admin 등 비trial 티어에서도 광고 차단)

### 5. 홈 폴더 active 테두리
- `.home-folder-unit`에 `border: 1.5px solid #f1f5f9`, active 시 `border-color: var(--folder-color)` 추가

### 6. 랜딩페이지 footer 크롤러 접근성
- `<button onClick>` → `<a href="/privacy">` 등으로 변경 (Google OAuth 브랜딩 인증 대응)
- Google Search Console 도메인 인증용 TXT 레코드 Vercel DNS에 추가

### 7. Google Sign-In 프로덕션 수정 (핵심 버그)
- **증상 1**: "Google 로그인 실패: undefined" → 에러 메시지 개선 (`err.code || err.message || JSON.stringify(err)`)
- **증상 2**: "No credentials available" → Credential Manager 비활성화
- **증상 3**: "에러 10 (DEVELOPER_ERROR)" → SHA-1 불일치
- **근본 원인**: Play Console 앱 서명 키 SHA-1이 Firebase/Google Cloud에 미등록
  - 로컬 keystore SHA-1 (`7A:C0:BD...`, `EA:26:A1...`)만 등록했었음 → 이것은 업로드 키
  - Play Store는 AAB를 **자체 키로 재서명** → 실제 SHA-1은 `90:99:49:8D:E0:F3:19:79:F9:87:BD:B6:6E:43:A7:D5:29:C0:65:66`
  - Play Console → 테스트 및 출시 → 앱 무결성 → 앱 서명에서만 확인 가능
- **수정 내역**:
  - Firebase Console + Google Cloud Console에 실제 앱 서명 키 SHA-1 등록
  - `useCredentialManager: false` — Login.jsx, Signup.jsx, App.jsx 3곳 (레거시 Google Sign-In 사용)
  - `googleProviderWebClientId` capacitor.config.json에 추가
  - google-services.json 갱신 (Firebase에서 재다운로드)
- **교훈**: 로컬 keytool SHA-1 ≠ Play Store 앱 서명 SHA-1. capacitor-android.md 메모리 수정 완료

### 8. Capgo 채널 정상화
- **문제**: Capgo 대시보드에서 기본 다운로드 채널이 staging으로 되어 있어 production 업데이트 수신 불가
- production으로 변경 + `--disable-auto-update none`으로 변경
- Capgo 업데이트는 첫 실행에서 다운로드 → 두 번째 실행에서 적용 (2회 재시작 필요)

### 9. Google 로그인 에러 메시지 개선
- Login.jsx: `err.code` → `err.code || err.message || JSON.stringify(err)` 로 변경
- 네이티브 플러그인 에러 시 `undefined` 대신 실제 에러 내용 표시

### 10. User 정보 확장 (platform + deviceLang)
- 모든 유저 문서 생성/업데이트 시 `platform`("app"/"web")과 `deviceLang`(navigator.language) 추가
- AuthContext(anonymous/실계정), App.jsx(Google 네이티브/웹), Login.jsx, Signup.jsx 총 6곳 적용
- `merge: true`로 저장하므로 기존 유저도 다음 로그인 시 자동 추가

### 11. pronunciation_records 필드 추가
- `useAudioRecorder.js`에서 발음 평가 기록 저장 시 `targetLang`, `sourceLang`, `platform` 추가
- 언어 오생성 버그 분석용 (Gemini 환각 vs 코드 버그 구분)

### 12. Play Store 업데이트 유도 팝업
- 앱 시작 시 네이티브 버전이 `MIN_NATIVE_VERSION`(1.1.5) 미만이면 팝업 표시
- "Play Store에서 업데이트" → Play Store 앱 페이지로 이동
- "나중에" → 팝업 닫고 계속 사용 (다음 실행 시 다시 표시)
- 한국어/영어 i18n 지원 (`update.title`, `update.desc`, `update.btn`, `update.later`)
- Capgo OTA로 배포 가능 (네이티브 코드 변경 불필요)

### 13. RevenueCat 앱 시작 시 초기화
- App.jsx에서 `user.uid` 변경 시 `Purchases.configure()` 호출
- `.env`에 `VITE_REVENUECAT_ANDROID_KEY=goog_jAaOuKaGoHKDRiapaBjWMlrVFvV` 추가
- UpgradeModal의 기존 configure는 fallback으로 유지 (중복 호출 안전)

### 14. RevenueCat 대시보드 설정 완료 (콘솔 작업)
- Google Cloud → 서비스 계정 `revenuecat-play-billing` 생성 + JSON 키 발급
- Google Play Console → API 액세스 → 서비스 계정 권한 부여 (진행 중)
- RevenueCat 대시보드 → Service Account JSON 업로드 완료
- Entitlements: Pro (pro_1, Pro_3), Premium (Premium_1, Premium_3) 매핑 완료
- SDK API Key: `goog_jAaOuKaGoHKDRiapaBjWMlrVFvV` (PronunFit 앱)

### 15. Google OAuth 브랜딩 인증
- Google Cloud Console → OAuth 동의 화면 → 브랜딩 인증 완료 (프로덕션 상태)
- 앱 이름: PronunFit, 홈페이지: pronunfit.com, 개인정보처리방침: pronunfit.com/privacy
- Google Search Console 도메인 소유권 인증 (DNS TXT 레코드 via Vercel)

### 16. PronunFit 배너 이미지 생성
- `public/pronunfit-banner-4096x2304.png` (4096x2304, 1.3MB) — Play Console 등록용

### 버전 이력
- v1.3.22 ~ v1.3.32 (Capgo OTA)
- v1.1.2 ~ v1.1.5 (Play Store AAB, versionCode 6~9)

### RevenueCat 향후 진행 필요사항
1. ~~Google Cloud 서비스 계정 생성~~ ✅
2. ~~RevenueCat 대시보드 JSON 업로드~~ ✅
3. ~~.env에 API 키 추가 + 앱 초기화~~ ✅
4. Google Play Console → API 액세스 → 서비스 계정 권한 부여 (UI 변경으로 메뉴 찾기 어려움)
5. RevenueCat Webhook 엔드포인트 구현 (서버: 구독 갱신/만료/취소 시 Firestore tier 자동 업데이트)
6. Google Play 테스트 결제 검증
7. Credential Manager 방식 전환 (Digital Asset Links 설정 후, 현재는 레거시 방식 사용 중)
