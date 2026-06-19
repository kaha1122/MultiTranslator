---
name: 2026-04-26 변경 (친구추천 시스템공유 + PWA 설치 UX 전면 개편)
description: 친구추천 깨진 링크/시스템 공유 시트 + PWA install prompt 오안내/iPhone 자동 가이드 슬라이드 — 1.4.71→1.4.80, AAB 무관 OTA
type: project
originSessionId: b46dbdcc-cc8d-4f99-bfac-9c64c89b2aa8
---
# 2026-04-26 변경

큰 두 줄기: **친구추천(1.4.71~1.4.77)** + **PWA 설치 UX(1.4.78~1.4.80)**.
모두 OTA로 처리, AAB 변경 없음.

## 친구추천 — 시스템 공유 시트 + 수신자 단말별 URL + 브랜딩

### 1.4.71 (`287a66a`) — Capacitor Share 분기 재제거
- **문제**: 안드로이드 네이티브에서 친구추천 [공유] → 시스템 공유 시트 안 뜨고 클립보드만 복사됨
- **원인**: `@capacitor/share`는 npm 설치만 됐고 `npx cap sync` 안 돌아 AAB에 native plugin 미등록. Capgo OTA는 웹만 갱신, 네이티브 추가 불가. `await import('@capacitor/share')` async gap으로 user activation 만료 → `navigator.share` 폴백도 NotAllowedError
- **조치**: `Capacitor.isNativePlatform()` 분기 제거, `navigator.share` 직접 호출

### 1.4.72 (`6fe991e`) → 1.4.73 (`5fa6497`) — 진단 + 폴백 강화
- 1.4.72: `[diag] platform=X nav.share=Y` UI alert로 단말 진단 → "Android System WebView가 navigator.share 미노출" 확정 (OTA 범위로 시스템 공유 시트 호출 불가)
- 1.4.73: 진단 코드 제거 + 클립보드 fallback에 4초 안내 hint 노출 (10개 언어 `shareHint`)

### 1.4.74 (`52bce93`) → 폐기
- Android 발신자 → iPhone 수신자 시 Play Store URL이 iPhone에서 죽은 링크 + 웹 광고 미구현으로 친구추천 통째 내릴까 검토 → 사이드바 진입 버튼 비노출 commit
- 사용자 결정: 두 버튼 분리로 살리기 (1.4.75에서 복원)

### 1.4.75 (`524abca`) — **수신자 단말별 2개 버튼 분기**
- 발신자가 받는 친구 단말을 직접 선택 → URL 분기
- `getShareUrl(target)`: `'android'` → Play Store, `'iosweb'` → Web URL
- ReferralModal: 단일 [공유] → 좌(🍎 iPhone/웹) / 우(🤖 Android) 2개 버튼
- 안내 캡션 "💡 받는 친구의 단말에 맞춰 선택해주세요" (10개 언어 `sharePickHint`)
- 사이드바 진입 버튼 복원

### 1.4.76 (`dc17c65`) — 줄바꿈 깨짐 + Apple/Android 브랜드 마크
- "iPhone/웹 친구" 한국어가 "구"만 다음 줄로 떨어지는 UI 깨짐
- Share2 lucide 아이콘 제거 → **인라인 SVG**로 Apple 로고 + Android 로봇 마크
- 버튼 색상: Apple 톤 `#1d1d1f` / Android 그린 `#3DDC84` → 한 번에 OS 식별
- 라벨 단축: "iPhone/웹 친구" → "iPhone / 웹", "Android 친구" → "Android" (10개 언어)
- `whiteSpace: nowrap` 강제 한 줄

### 1.4.77 (`2956ac7`) — `pronunfit.com` 도메인
- `WEB_URL`: `multi-translator-seven.vercel.app` → `pronunfit.com`
- Vercel custom domain alias (ETag 바이트 단위 동일 검증)
- 카톡 미리보기에 "pronunfit.com" 표기 → 브랜드 신뢰감 ↑, 옛 프로젝트명 잔재 제거

## PWA 설치 — handleInstallClick 근본 수정 + iPhone 자동 슬라이드

### 1.4.78 (`2ab0aaf`) — "이미 설치" 오안내 4분기로 분리
- **문제(사용자 보고)**: web에서 [Download] 클릭 시 단말 환경과 무관하게 "이미 설치가 되었습니다" alert. 앱 삭제+쿠키 비워도 동일. 특히 iPhone Safari/Chrome 영구 재현
- **원인**: `handleInstallClick`이 `deferredPrompt === null`을 "이미 설치"로 단정. 실제 null인 경우는 다양:
  - iOS Safari/Chrome: WebKit엔 beforeinstallprompt API 자체가 없어 영구 null
  - Android Chrome: prompt 발생 전(~1초) 일시적 null, Play Store 앱 감지 시 suppress
  - 진짜 standalone PWA: null (이 케이스만 정확)
- **조치**: 4분기로 재작성
  1. `display-mode: standalone` OR `navigator.standalone === true` → 진짜 "이미 설치" alert
  2. `deferredPrompt` 가용 → `prompt()` 호출 (Android Chrome 정상)
  3. iOS UA 감지 → `IOSInstallGuideModal` 모달
  4. 기타 (Android Chrome인데 prompt 부재) → Chrome ⋮ 메뉴 안내 alert
- **신규 컴포넌트**: `IOSInstallGuideModal.jsx` (3 step 텍스트, Share/Plus/Check 아이콘, "다시 보지 않기" + "확인", Chrome 사용자에게 Safari 안내)
- **신규 i18n 9개 × 10 locales**: `iosGuideTitle`, `iosGuideIntro`, `iosStep1~3`, `iosChromeNote`, `iosDontShowAgain`, `iosGotIt`, `androidMenuHint`

### 1.4.79 (`dcc16f7` + `ca6ffb9`) — manifest 영문화 + early listener + LandingPage mount
- **manifest 영문화**: name "PronunFit - 발음 연습 & 다국어 번역" → "PronunFit", description 영문 ("AI Pronunciation Coach & Multilingual Translator"), lang ko → en. 브랜드 일치 + 다국어 사용자 어색함 해소
- **early listener (race condition fix)**:
  - 사용자 보고: PC Chrome에서 engagement 충족(스크롤+클릭4회+30초+)했음에도 "Chrome 메뉴" alert만 반복
  - 원인: Chrome은 engagement 누적 충족 시 페이지 로드 직후 즉시 `beforeinstallprompt` 발생 → React useEffect 마운트 전에 fire되어 영구 missed
  - 조치: `index.html` `<head>`에 `<script>`로 early listener 등록 → `window.__deferredInstallPrompt` 보관 + `__deferredPromptReady` 커스텀 이벤트
  - `App.jsx` useEffect: 마운트 시 `window.__deferredInstallPrompt` 회수 + 새 listener도 병행 등록
  - `handleInstallClick`: state OR window 캡처본 양쪽 체크 (race-safe)
- **iOS 무반응 버그**: `IOSInstallGuideModal`이 "메인 앱 화면" 분기에만 마운트되어 LandingPage 사용자(익명+첫 방문)는 setShowIOSInstallGuide(true) 호출되지만 컴포넌트 미존재 → 무반응. LandingPage 두 분기 모두 Fragment(`<>`)로 감싸 모달 함께 마운트

### 1.4.80 (`95671dd` ~ `69e572c`) — 일괄 묶음 (PWA install 완성)
- **manifest related_applications**: `prefer_related_applications: false` + 자기 자신 webapp 등록 → `navigator.getInstalledRelatedApps()` 사용 가능
- **handleInstallClick 분기 1-b**: standalone 체크 다음에 `getInstalledRelatedApps()` 호출 → 일반 브라우저 탭에서도 PWA 설치 여부 정확 감지 (Windows에 PWA 설치한 사용자가 일반 탭에서 [Download] 클릭 시 "이미 설치" 정확 표시)
- **iPhone/iPad/Mac 웹**: Download 버튼 + 하단 install popup 비노출 (`isAppleWeb` UA 가드)
- **IOSInstallGuideModal 폐기**: import/state/render 모두 제거. 컴포넌트 파일은 보존(참고용), tree-shake로 번들 제외
- **IOSInstallSlideshow 신규**: iPhone(+iPad) 진입 1.5초 후 자동 표시
  - 풀스크린 흰 배경, safe-area 반영
  - 슬라이드 3초 간격 자동 전환, 점(●○) 인디케이터 클릭 수동
  - X 닫기 = 이번에만 닫기 (재방문 시 재표시) / **"다시 열지 않음"** = `localStorage.iosInstallSlideshowSeen` 영구 차단
  - 캡션 상단 노출 (눈에 잘 들어오게), 닫기 X 30px (사용자 요청 절반 축소)
  - `objectFit: contain` (잘림 0, 핵심 화살표 보존)
  - 캡션 i18n `iosStep1`: "Safari" → "browser/브라우저/navegador" 등 10개 언어 일괄 (iOS Chrome 등 비-Safari 사용자 포함)
- **이미지 교체**: `public/install-guide/ios-step1.png` 가로폭 확대본 (275×566 1:2.06 → 276×441 1:1.60), iPhone 화면비 근접
- **fallback 'ko' → 'en'**: `detectBrowserSourceLang` 3곳 모두 → 미지원 OS 사용자(태국·아랍·터키 등)가 한국어 UI 보다가 영어 UI 자동 진입

## 누적 결과

| 영역 | Before | After |
|---|---|---|
| 친구추천 시스템 공유 | 클립보드만, 안내 없음 | navigator.share + 클립보드 fallback + 4초 hint |
| 친구추천 URL 분기 | 발신자 플랫폼 기준 (Android→iPhone 깨짐) | 수신자 단말 발신자 선택 (좌/우 2버튼) |
| 친구추천 메시지 도메인 | vercel.app 서브도메인 | pronunfit.com (브랜드 일치) |
| PWA install "이미 설치" | iOS 100% 오안내 | display-mode + getInstalledRelatedApps 양쪽 체크 |
| Apple 웹 [Download] | 항상 노출 (iOS 무용) | 비노출 |
| iPhone 가이드 | Download 클릭 시 텍스트 모달 | 진입 1.5초 후 자동 풀스크린 슬라이드 |
| beforeinstallprompt 누락 | React 마운트 전 fire 시 영구 미사용 | HTML early listener로 캡처 + race-safe 회수 |
| 미지원 OS 언어 fallback | 한국어 (태국 사용자도 한국어) | 영어 |

## 검증 매트릭스

| 환경 | 기대 동작 |
|---|---|
| iPhone Safari/Chrome (웹) | 1.5초 후 슬라이드 자동 표시, 닫기 X로 이번만 닫기 / 다시 열지 않음으로 영구 차단 |
| Mac Safari/Chrome (웹) | Download 안 보임, 슬라이드 없음 (별도 가이드 추후) |
| Android Chrome (PWA 미설치, engagement 충족) | early listener로 prompt 캡처 → Chrome 네이티브 install prompt 정상 |
| Android Chrome (PWA 이미 설치) | "이미 설치" alert (`getInstalledRelatedApps` 분기) |
| Capacitor Native (Android/iOS) | Capgo OTA 수신, 슬라이드/Download 분기는 isNative 가드로 미발동 |

## 후속 / 미완

- **step2 가로폭 큰 버전 미제공** — 사용자 추후 캡처해서 `public/install-guide/ios-step2.png` 덮어쓰기 시 자동 적용 (코드 수정 불필요)
- **Mac용 별도 가이드 미구현** — Mac Safari "Add to Dock"는 흐름 다르니 별도 컴포넌트 필요
- **영상 자산 미제공** — 정적 이미지 슬라이드로 대체. 추후 8~12초 MP4 제작 시 SVG 자리 video 태그로 교체 가능
- **Capgo OTA 1.4.80** 배포 완료 — `channel currentBundle production = 1.4.80` 검증

## 관련 파일

- [src/components/IOSInstallSlideshow.jsx](src/components/IOSInstallSlideshow.jsx) — 신규 자동 슬라이드 컴포넌트
- [src/components/IOSInstallGuideModal.jsx](src/components/IOSInstallGuideModal.jsx) — 폐기됨, 보존만
- [src/components/ReferralModal.jsx](src/components/ReferralModal.jsx) — 친구추천 2버튼 + 브랜드 마크
- [src/components/LandingPage.jsx](src/components/LandingPage.jsx) — isAppleWeb / isIOSWeb 분기, 슬라이드 트리거
- [src/App.jsx](src/App.jsx) — handleInstallClick 4분기 + getInstalledRelatedApps + early listener 회수
- [public/manifest.json](public/manifest.json) — 영문화 + related_applications
- [index.html](index.html) — beforeinstallprompt early listener
- [public/install-guide/ios-step1.png, ios-step2.png](public/install-guide/) — 슬라이드 이미지
