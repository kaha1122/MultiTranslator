---
name: capacitor-android
description: Capacitor + Capgo 안드로이드 앱 확장 — 초기 설정, 네이티브 Google Sign-In, TTS 호환, safe-area, AAB 빌드, 트러블슈팅
type: project
---

## Capacitor 안드로이드 앱 확장 (2026-03-17)

### 프로젝트 경로
- **메인 작업 경로**: `C:\Projects\multi-translator` (영문 경로)
- **기존 경로**: `C:\AntiGravity용\번역\multi-translator` (한글 경로 — Android 빌드 시 문제 발생하여 이전)
- **Android 프로젝트**: `C:\Projects\multi-translator\android`
- 두 경로 간 소스 동기화 필요 (git은 기존 경로에서 관리)

### Capacitor 초기 설정
- **appId**: `com.arigems.pronunfit`
- **appName**: PronunFit
- **webDir**: `dist` (Vite 빌드 출력)
- **Capacitor 버전**: 8.2.0
- **플러그인**:
  - `@capgo/capacitor-updater@8.43.11` — OTA 라이브 업데이트
  - `@capacitor-firebase/authentication@8.1.0` — 네이티브 Google Sign-In

### Capgo 설정
- **계정**: 가입 완료 (SOLO $12/월, 14일 무료 체험)
- **API Key (ALL)**: `0a03a6f5-7ddc-4862-aba3-f62ebf89eec3`
- **앱 등록**: `com.arigems.pronunfit` 등록 완료
- **첫 번들 업로드**: v0.0.0 production 채널 업로드 완료
- **capacitor.config.json**: `CapacitorUpdater.autoUpdate: true`
- **main.jsx**: `CapacitorUpdater.notifyAppReady()` 추가

### 배포 플로우
```
코드 수정 → git push main
  ├── [웹] Vercel 자동 배포
  ├── [서버] Render 자동 배포
  ├── [앱 OTA] npx @capgo/cli bundle upload (JS/CSS 변경 시)
  └── [앱 네이티브] Android Studio AAB 빌드 → Play Console (네이티브 변경 시)
```

### Release Keystore
- **파일**: `C:\Projects\multi-translator\android\release-keystore.jks`
- **Alias**: `pronunfit`
- **Store/Key Password**: `PronunFit2026!`
- **Debug SHA-1**: `7A:C0:BD:42:C3:31:6E:A6:67:33:68:28:93:BD:30:50:E2:76:70:CF`
- **Release SHA-1**: `EA:26:A1:FC:ED:2F:11:7B:34:B1:BF:30:B0:1D:63:14:5B:67:56:6D`
- 두 SHA-1 모두 Firebase Console에 등록 완료
- `.gitignore`에 `*.jks`, `*.keystore` 추가 (보안)

### AAB 빌드
- **출력**: `android/app/build/outputs/bundle/release/app-release.aab` (약 12MB)
- **빌드 명령**: JAVA_HOME 설정 필요
```bash
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
cd android && ./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file="release-keystore.jks 경로" \
  -Pandroid.injected.signing.store.password="PronunFit2026!" \
  -Pandroid.injected.signing.key.alias="pronunfit" \
  -Pandroid.injected.signing.key.password="PronunFit2026!"
```

### npm 스크립트
- `npm run cap:sync` — 웹 빌드 + Android sync
- `npm run cap:android` — 웹 빌드 + sync + Android Studio 열기

---

## 트러블슈팅 기록

### 1. 한글 경로 문제
**증상**: Android Studio에서 `android` 폴더 열 때 "non-ASCII characters" 경고
**원인**: `C:\AntiGravity용\번역\` 경로에 한글 포함
**해결**: `C:\Projects\multi-translator`로 프로젝트 복사. `android/gradle.properties`에 `android.overridePathCheck=true` 추가 (임시)

### 2. VITE_API_URL 누락
**증상**: 앱에서 문장 생성 시 "문장을 생성할 수 없습니다" 에러
**원인**: `.env`에 `VITE_API_URL`이 없어서 `localhost:5000`으로 fallback. Vercel은 환경변수로 주입하므로 웹에서는 문제 없었음
**해결**: `.env`에 `VITE_API_URL=https://multitranslator.onrender.com` 추가

### 3. TTS 재생 안됨
**증상**: 로그인 전 랜딩페이지에서 TTS 버튼 눌러도 소리 안 남
**원인**: `/api/azure-tts`가 `requireAuth` → 비로그인 시 401. 웹에서는 Web Speech API fallback이 동작했지만, Android WebView에서는 Web Speech API도 제한적
**해결**: 서버 `tts.js`에서 `requireAuth` → `optionalAuth`로 변경. 랜딩페이지 데모에서도 Azure TTS 품질 제공

### 4. Google 로그인 안됨 — signInWithPopup
**증상**: Google 로그인 버튼 눌러도 반응 없음
**원인**: Capacitor WebView에서 `signInWithPopup()`이 차단됨
**시도**: `signInWithRedirect()`로 변경 → localhost 리다이렉트 에러 발생
**최종 해결**: `@capacitor-firebase/authentication` 플러그인으로 네이티브 Google Sign-In
- `FirebaseAuthentication.signInWithGoogle()` → idToken 획득
- `signInWithCredential(auth, GoogleAuthProvider.credential(idToken))` → Firebase 인증
- App.jsx, Login.jsx, Signup.jsx 3개 파일에서 `isNativePlatform` 분기

### 5. Google 로그인 안됨 — 네이티브 플러그인
**증상**: `@capacitor-firebase/authentication` 설치 후에도 Google Sign-In 팝업 안 뜸
**원인 1**: `google-services.json`에 Android OAuth client (client_type: 1) 없음 → SHA-1 미등록
**해결**: Firebase Console → Android 앱 추가 → SHA-1 등록 → `google-services.json` 재다운로드
**원인 2**: `capacitor.config.json`에 `FirebaseAuthentication` 플러그인 설정 누락
**해결**: `"FirebaseAuthentication": { "skipNativeAuth": false, "providers": ["google.com"] }` 추가

### 6. 하단 내비게이션 바 / 상단 상태바 겹침
**증상**: 사이드바 상하단이 Android 시스템 바와 겹쳐서 잘림
**해결**: CSS에 `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)` padding 추가
- `.app-header`: 상단 safe-area
- `.sidebar-header`: 상단 safe-area
- `.sidebar-footer`: 하단 safe-area
- `.lp-nav`: 랜딩페이지 상단 safe-area

### 7. @codetrix-studio/capacitor-google-auth 호환 문제
**증상**: `npm install` 시 peer dependency 에러
**원인**: Capacitor 8과 호환 안됨 (peer `@capacitor/core@^6.0.0` 요구)
**해결**: `@capacitor-firebase/authentication` 사용 (Capacitor 8 지원)

---

## 네이티브 vs 웹 분기 패턴

```javascript
const isNativePlatform = window.Capacitor?.isNativePlatform?.();

// Google Sign-In
if (isNativePlatform) {
  // @capacitor-firebase/authentication → signInWithCredential
} else {
  // signInWithPopup (기존 웹 방식)
}

// Service Worker
if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js');
}
```

---

## Android 앱 아이콘/스플래시
- `public/logo_circle.png` → 5개 해상도 ic_launcher + ic_launcher_round + ic_launcher_foreground 생성
- 스플래시: 흰 배경 + PronunFit 로고 중앙 (11개 해상도)
- sharp 라이브러리로 자동 생성

## AndroidManifest 권한
- `INTERNET` (기본)
- `RECORD_AUDIO` (발음 녹음)
- `MODIFY_AUDIO_SETTINGS` (오디오 설정)

## Google Play 제출 준비 현황
| 항목 | 상태 |
|---|---|
| 앱 아이콘 | ✅ PronunFit 로고 |
| 스플래시 화면 | ✅ PronunFit 로고 |
| versionCode/Name | ✅ 1 / "1.0" |
| release keystore | ✅ 생성 + SHA-1 등록 |
| AAB 빌드 | ✅ app-release.aab (12MB) |
| Play Console 계정 | ✅ 등록됨 |
| 스크린샷 | ❌ 폰에서 캡처 필요 |
| 스토어 등록정보 | ❌ 미작성 |
| 개인정보처리방침 | ✅ https://pronunfit.com/privacy |
| 계정 삭제 URL | ✅ https://pronunfit.com/#delete-info |
