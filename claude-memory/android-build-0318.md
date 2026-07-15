---
name: android-build-0318
description: 2026-03-18 안드로이드 Back키 수정, 헤더 버튼 i18n, 버전표시, Capgo 채널 동적 주입, Staging/Production 빌드 플로우 확립
type: project
---

## 2026-03-18 주요 작업

### 1. 안드로이드 Back 키 수정 (App.jsx)

**문제 1**: `window.history.back()` 호출 → SPA에서 브라우저 히스토리 없어 검은 화면만 뜨고 동작 안 함
**문제 2**: `showExitToast` stale closure → deps 배열에 없어 항상 false로 읽혀 두 번 눌러도 종료 안 됨

**해결**:
- `viewModeHistoryRef` 스택 추가 — viewMode 변경 시 자동 push
- `isNavigatingBackRef` 플래그 — 뒤로가기로 인한 viewMode 변경은 히스토리에 다시 push 안 함
- `showExitToastRef` 추가 — stale closure 방지
- Back 키 → 히스토리 pop → `setViewMode(이전화면)`, 루트에서는 2초 내 재누르면 `exitApp()`
- useEffect deps를 `[sidebarOpen]`으로 단순화 (viewMode 제거)

### 2. 헤더 dict 버튼 라벨 i18n 분리

**문제**: Scene/Vocab 탭 우측 상단 버튼이 `nav.translation` 사용 → "Từ điển giọng nói"(베트남어) 등 긴 이름이 헤더 UI 깨뜨림

**해결**: `nav.dictBtn` 키 신규 추가

| 언어 | 값 |
|------|----|
| ko | `사전` |
| ja | `辞書` |
| zh-CN/zh-TW | `词典` |
| en (+ 나머지 폴백) | `Dictionary` |

- 사이드바/홈 메뉴의 `nav.translation` ("보이스 사전" 등)은 그대로 유지
- App.jsx 헤더 버튼만 `getT(sourceLang, 'nav.dictBtn')` 사용

### 3. 설정 화면 버전 표시

**문제**: `bundleVersion` 초기값 `'builtin'` → 항상 "PronunFit vbuiltin" 표시

**해결**:
- `appVersion` state 추가 → `CapacitorApp.getInfo().version`으로 네이티브 versionName 표시
- `bundleVersion` — Capgo `current().bundle.version`이 'builtin'이 아닐 때만 표시
- 표시 형식: `PronunFit v1.0.0` (기본) / `PronunFit v1.0.0 (OTA 1.0.9)` (OTA 적용 후)

### 4. Capgo 채널 동적 주입 (핵심 버그 수정)

**문제**: `CapacitorUpdater.setChannel({ channel: 'production' })` 하드코딩
→ APK를 staging 채널로 빌드해도 런타임에 production으로 강제 전환 → OTA 못 받음

**해결**:
- `vite.config.js`에 `define: { __CAPGO_CHANNEL__: JSON.stringify(process.env.CAPGO_CHANNEL || 'production') }` 추가
- App.jsx: `CapacitorUpdater.setChannel({ channel: __CAPGO_CHANNEL__ })`

**Staging 빌드 명령**:
```bash
CAPGO_CHANNEL=staging npm run build
```
**Production 빌드 명령** (기본값):
```bash
npm run build
```

### 5. Staging/Production 빌드 플로우 확립

**Staging 테스트 APK 전체 순서**:
```bash
# 1. staging 채널로 빌드
CAPGO_CHANNEL=staging npm run build
# 2. capacitor.config.json → channel: staging 변경
# 3. cap sync
npx cap sync android
# 4. APK 빌드 (release 서명)
cd android && ./gradlew assembleRelease
# 5. Capgo staging 채널에 bundle push (버전 먼저 bump 필요)
cd .. && npx @capgo/cli bundle upload --channel staging
# 6. capacitor.config.json → channel: production 원복
# 7. 폰에 APK 설치 → 앱 실행 → 종료 후 재실행 → OTA 적용 확인
```

**Production AAB 빌드**:
```bash
npm run build                          # production 채널 (기본값)
npx cap sync android
cd android && ./gradlew bundleRelease  # AAB 생성
```
- AAB 위치: `android/app/build/outputs/bundle/release/app-release.aab`
- APK 위치: `android/app/build/outputs/apk/release/app-release.apk`

**Production Capgo OTA 배포**:
```bash
npm run build
npx @capgo/cli bundle upload --channel production
```

### 6. Vercel Staging Preview 브랜치 설정

- `staging` 브랜치 생성 및 push → Vercel Preview URL 자동 생성
- `main` → Production, `staging` → Preview
- 현재 staging = main (동일 상태에서 분기 시작)

### 7. 현재 버전 상태 (2026-03-18)

| 항목 | 값 |
|------|-----|
| package.json version | 1.0.9 (staging OTA 최신) |
| build.gradle versionCode | 2 |
| build.gradle versionName | 1.0.0 |
| Play Store 제출 여부 | 미제출 (AAB 생성 완료) |
| Capgo staging 최신 bundle | 1.0.9 |
| Capgo production bundle | 미push (OTA 미배포) |
