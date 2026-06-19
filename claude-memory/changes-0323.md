---
name: changes-0323
description: 2026-03-23 작업 — 웹앱 익명채번 2중 방지, 온보딩 즉시 표시, i18n 버튼, AdMob dot 가림, AdSense 봇 우회
type: project
---

## 2026-03-23 작업 내역

### 1. 웹앱 온보딩 팝업 즉시 표시 (bc0e1ce)
- **문제**: "무료로 시작하기" 클릭 후 온보딩(모국어/학습언어 선택) 팝업이 안 뜨고, 다음 로그인 시에 뜸
- **원인**: useEffect 의존성 `[user?.uid]`만 있어서 profile 로드 완료를 감지 못함. anonymous 유저는 `hasCompletedOnboarding` 필드가 없어 `profile?.hasCompletedOnboarding`이 로드 전/후 모두 `undefined` → 변화 감지 불가
- **수정**: 의존성을 `[user?.uid, !!profile]`로 변경 — `null→object` 변화 감지

### 2. 웹앱 2중 익명채번 방지 (bc0e1ce)
- **문제**: `handleStartFreeFromLanding`에서 `webAppEntered='1'`을 `signInAnonymously` **이전**에 설정 → AuthContext의 `needsLanding` 가드가 해제된 상태에서 `onAuthStateChanged(null)` 재호출 시 AuthContext도 `signInAnonymously` 호출 → 2중 채번
- **수정**: `webAppEntered`를 `signInAnonymously` **성공 후**에 설정하여 가드 유지
- **구조**: `signInAnonymously` 호출 위치 2곳 (App.jsx `handleStartFreeFromLanding` + AuthContext 자동) — 뮤텍스 미공유 상태이므로 순서 보장이 핵심

### 3. 익명유저 가입유도 팝업 "다음에" 버튼 i18n (c1afd1e)
- **문제**: 재방문 시 뜨는 가입유도 팝업의 두 번째 버튼이 `upgrade.later` 키 사용 → 해당 키가 upgrade 섹션에 존재하지 않아 키 문자열 그대로 노출
- **수정**: `upgrade.nextTime` 키 신설, 10개 언어 번역 추가 (ko: "다음에", en: "Next time", ja: "次回" 등)
- fallback도 `'나중에'` → `'다음에'`로 변경

### 4. 탭 dot 인디케이터 AdMob 배너 가림 수정 (8938dfa)
- **문제**: 네이티브앱에서 하단 AdMob 배너가 탭 dot 인디케이터를 가림
- **수정**:
  - `.tab-dots`: `bottom: 0` → `bottom: var(--admob-bottom, 0px)`
  - `.app-container`: padding-bottom에 `var(--admob-bottom, 0px)` 추가
- 웹에서는 `--admob-bottom=0px`이므로 영향 없음

### 5. AdSense 봇 랜딩 페이지 우회 (6ce65a0)
- **문제**: Google AdSense가 "가치없는 콘텐츠"로 광고 거절 — 봇이 랜딩 페이지 "무료로 시작하기" 버튼을 클릭하지 못해 앱 내부 콘텐츠를 크롤링할 수 없음
- **수정**:
  - `src/utils/isBot.js` 신설: Googlebot/AdsBot/검색엔진 봇 UA 감지
  - AuthContext: `needsLanding`에 `!isBot()` 조건 추가 → 봇은 자동 anonymous 로그인
  - App.jsx: `showLanding` 초기값에 `!isBot()` 조건 추가 → 봇은 랜딩 건너뜀
- 일반 사용자 동작은 변경 없음

### 버전 이력
- v1.3.47 ~ v1.3.49 (Capgo staging/production)
- AAB v1.1.7 (versionCode 11) 빌드 완료
