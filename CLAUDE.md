# PronunFit — Claude Code 작업 가이드

이 파일은 **모든 Claude Code 표면(CLI / VS Code / 웹 dispatch / GitHub Action)에서 자동 로드**되는 핵심 컨텍스트입니다. PC 로컬 auto-memory와 별개로, 외부 환경에서도 동일한 규칙으로 작업하기 위한 portable 룰북입니다.

## 앱 개요

- **앱명**: PronunFit (`com.arigems.pronunfit`)
- **목적**: 발음 평가 + 다국어 번역 + 학습 콘텐츠 (UI 10언어 / 학습 38언어)
- **배포 채널**: 웹 ([Vercel](https://multi-translator-seven.vercel.app)) · Android (Play Store) · iOS (App Store) · Capgo OTA (Android + iOS)
- **상태**: **Production 실서비스 중** — 잘못된 변경은 즉시 실유저 피해

## 기술 스택

- **프론트**: React 19 + Vite 7, Capacitor 8, Framer Motion, Lucide React
- **백엔드**: Node/Express ([server/](server/)) — Render 배포, **별도 `server/package.json`** (루트 X)
- **AI**: Gemini 2.5 Flash-Lite (서버 경유 only) + Azure Speech S0 (발음/TTS)
- **인증/DB**: Firebase Auth/Firestore + RevenueCat (IAP) + TossPayments (KR) + PayPal (USD)
- **i18n**: 10 locale (`ko/en/ja/zh-CN/vi/fr/de/es/ru/pt-BR`)

## 명령어

```bash
npm run dev              # Vite dev
npm run build            # production build
npm run lint
npm run check-i18n       # 10 locale 키 완전성 — i18n 키 추가 후 필수
npm run check-secrets    # dist/ API 키 leak 검증 — 배포 전 필수
npm run cap:sync         # 웹 빌드 → Capacitor 동기화
npm run cap:android      # Android Studio 열기
npm run cap:ios          # Xcode 열기
```

서버 패키지 추가는 **`cd server && npm install <pkg>`** (루트 npm install 금지 — Render는 server/package.json 사용).

## 🚨 절대 규칙 (위반 시 사고)

### 1. 비밀 키 노출 금지 (4차 사고 누적, 최악: GCP 프로젝트 통째 정지)
- **Git commit / 클라이언트 빌드(`VITE_*`) / chat·스크린샷 / 하드코딩** 어디에도 비밀 노출 금지
- `VITE_*` 접두사는 **클라이언트에 평문 inline됨** → 비밀은 절대 `VITE_` 금지
- 비밀의 유일한 거처: **Render 환경변수**. 클라는 서버 경유 호출
- **배포 전 `npm run check-secrets` 필수** — `dist/`에서 ALLOWLIST 외 키 발견 시 즉시 폐기 + 재발급
- 안전한 `VITE_*`: `VITE_FIREBASE_*` (Web config + VAPID public key), `VITE_TOSS_CLIENT_KEY`, `VITE_REVENUECAT_*_KEY`, `VITE_PAYPAL_CLIENT_ID`, `VITE_API_URL`만
- **금지**: `VITE_GEMINI_*`, `VITE_AZURE_*_KEY`, `VITE_OPENAI_*`, `VITE_*_SECRET`, `VITE_YOUTUBE_API_KEY`

### 2. `.env.local` 파일명 사용 금지
- Vite 우선순위에서 `.env.local`은 **production 빌드도 inline됨** (2026-05-04 Capgo OTA 사고 사례)
- dev override는 **`.env.development.local`** 사용 (mode 명시 파일만)
- Capgo upload 전 `grep -oE "https://[a-z]+\.onrender\.com|http://localhost" dist/assets/index-*.js` 확인

### 3. 배포 — staging 우선 / main은 명시 요청 시에만
- main push = Vercel production 자동 배포 (1~2분)
- 기본 흐름: 작업은 main 작업트리, 배포는 `git checkout staging && git merge main && git push origin staging`
- **main push 전**: `npm run build && npm run check-secrets` 검증
- Capgo: `npx @capgo/cli bundle upload --channel staging` → `channel currentBundle staging`로 포인터 일치 검증

### 4. 사이드 이펙트 점검 섹션 필수
- 모든 코드 변경 제안 시 **"사이드 이펙트 점검"** 섹션 포함 의무
- 빌드 통과 ≠ 안전. 변경된 함수/값/상태의 모든 호출처를 Grep으로 확인
- 분류: 🚨 Critical / 🟡 Minor / 🟢 영향 없음 (이유 명시)
- **크로스 플랫폼**: Web / Android (Capacitor WebView) / iOS (WKWebView) 각 동작 차이 짚기
- **역사적 데이터**: Firestore 스키마 변경 시 기존 유저 문서 호환 확인

### 5. i18n 키 완전성 — 10 locale 일괄
- 새 i18n 키 추가 시 `src/locales/*.json` **10개 모두 동시 추가**
- `t?.(key) || 'fallback'`의 fallback은 보험일 뿐 — 키가 없으면 t()가 키 자체 문자열을 반환해서 fallback 발화 안 함
- 작업 후 **`npm run check-i18n` 필수** (en.json reference, exit 1 on missing)

## 플랫폼별 트리거 규칙

### Xcode Cloud (iOS)
- **`ios/**` 경로 변경이 포함된 push만 자동 빌드 트리거**
- 웹/`src/**`/`server/**`/`package.json`만 수정한 push는 안 돎
- iOS에 변경 반영 필요 시 `ios/**` 편집 또는 App Store Connect에서 수동 "Start Build"
- 사전 점검: `git diff <prev>..HEAD -- ios/`

### Capgo OTA
- **Android + iOS** (iOS는 2026-05-07 재활성화 — `autoUpdate=true`, ci_post_clone 정리됨; 과거 무한 reload 이슈는 해결된 것으로 판단)
- 채널: `production` / `staging`
- 네이티브 변경(Java/Swift/Gradle/Plugin 추가)은 OTA 불가 → AAB / IPA 재빌드 필수

### 네이티브 버전 자동 업데이트 금지
- Firestore `config/app.latestNativeVersion`은 AAB 빌드 시 자동 업데이트하지 않음
- Play Store **공개 후 수동** 업데이트 (빌드 vs 공개 시점 괴리로 "없는 버전" 업데이트 팝업 방지)
- 플랫폼 분기 필수 (`firstNativePlatform` / `currentNativePlatform`, `FEATURE_LAUNCH_VERSIONS = {android, ios}`)

## 클라이언트/서버 정합성

- tier·구독 로직 수정 시 클라이언트 + `server/routes/*` **양쪽 병행 패치 필수**
- `server/routes/subscription.js`의 `/api/check-subscription`은 웹 로그인 시 **능동적으로 Firestore 수정**함

## 이메일 캠페인

- 이메일 이미지는 **inline cid attachment** 필수 (Gmail 신규 발신자 외부 이미지 차단)
- Resend `attachments` + `contentId` + HTML `<img src="cid:...">`

## 활성 자격증명 / 금지 ID

- **활성 FB App**: APronunFit (`822618547094999`)
- **🚫 사용 금지 FB App ID**: `1549474396756439` (구 PronunFit, Meta 영구 비활성)
- **🚫 사용 금지 광고계정 ID**: `2187242868692310` (옛값, 무효)
- **iOS App Store ID**: `6761342764`

## 주요 디렉터리

- [src/App.jsx](src/App.jsx) — 메인 컨테이너 (탭/모달/auth 통합)
- [src/components/](src/components/) — 50+ 컴포넌트
- [src/context/AuthContext.jsx](src/context/AuthContext.jsx) — 인증 + tier 동기화 (5초 sync 폴백 포함)
- [src/config/languages.js](src/config/languages.js) — 38개 학습 언어 중앙 관리
- [src/locales/](src/locales/) — 10 locale JSON
- [src/firebase/config.js](src/firebase/config.js) — iOS만 `browserLocalPersistence` (Android는 Phase 1-C 대기)
- [server/routes/](server/routes/) — analyze · translate · scene · vocab · listening · converse · tts · ocr · video · subscription · account · webhook · referral · reengagement · reviewBonus
- [server/utils/sendPush.js](server/utils/sendPush.js), [server/utils/sendEmail.js](server/utils/sendEmail.js)
- [ios/App/ci_scripts/ci_post_clone.sh](ios/App/ci_scripts/ci_post_clone.sh) — Xcode Cloud 빌드 스크립트
- [scripts/build-aab.sh](scripts/build-aab.sh), [scripts/build-ios.sh](scripts/build-ios.sh)

## 대기 작업 (코드 변경 트리거 시 상기)

- **다음 AAB 빌드 시**: Direct Boot 가드 / FB SDK 17.0.2 고정 / `@capacitor/share` cap sync + ReferralModal native 분기 / Android Firebase Auth `browserLocalPersistence` 강제 (Phase 1-C, 우선순위 높음)
  - 트리거: AAB 빌드 / `versionCode` bump / `MainApplication.java` / `android/app/build.gradle` / `src/firebase/config.js` 편집
- **iOS 심사 통과 후**: Push Notifications Xcode 통합 (Capability 추가 + AppDelegate.swift 핸들러) + Meta 대시보드 iPhone Store ID(`6761342764`) 등록

## 사용자 정보

- **언어**: 한국어 (응답 한국어로)
- **개발 환경**: VS Code + Claude Code, dispatch 워크플로 도입 중
- **사용자 이메일**: sw.haka@gmail.com

## 추가 참고

PC 로컬 auto-memory(`~/.claude/projects/.../memory/`)에는 50+ 세션 로그(changes-MMDD.md)와 추가 feedback 파일이 있습니다. 이 CLAUDE.md는 그 중 **load-bearing한 stable 룰만 추출**한 것입니다. 외부 dispatch 환경에서 더 깊은 컨텍스트가 필요하면 사용자에게 요청하세요.
