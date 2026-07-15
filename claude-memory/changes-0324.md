---
name: changes-0324
description: 2026-03-24 작업 — linkWithPopup 통일, Auth 삭제 fatal, 익명 구독 가드, iOS 효과음 하이브리드, 팝업 AdMob 가림 방지
type: project
---

# 2026-03-24 변경 사항

## 1. 웹 계정 업그레이드: signInWithPopup → linkWithPopup 통일
- **파일**: `src/components/AccountUpgradeModal.jsx`
- **문제**: 웹에서 Google/Facebook 가입 시 `signInWithPopup` 사용 → 새 UID 생성되어 익명 학습 데이터 소실
- **수정**: `linkWithPopup(auth.currentUser, provider)` 사용으로 통일
  - 네이티브(Capacitor)는 기존 `upgradeAnonymous(credential)` → `linkWithCredential` 유지
  - 웹도 동일하게 익명 UID 보존 + provider credential 연결
- **import 변경**: `signInWithPopup` → `linkWithPopup`

## 2. 서버 회원탈퇴: Firebase Auth 삭제 실패 시 fatal 처리
- **파일**: `server/routes/account.js`
- **문제**: Auth 삭제 실패해도 `success: true` 반환 → 클라이언트는 삭제 성공으로 처리 → 재가입 시 "이미 가입된 이메일" 에러
- **수정**:
  - Auth 삭제 실패 → `res.status(500).json({ success: false, error: '...', partialErrors })` 반환
  - `admin.apps.length` 미초기화 시에도 `success: false` 반환
  - 1~5단계(Toss/RevenueCat/verifiedPhones/Firestore)는 기존처럼 부분 실패 허용

## 3. 익명 유저 구독 시도 시 무료계정 생성 먼저 유도
- **파일**: `src/App.jsx`, `src/components/AccountUpgradeModal.jsx`
- **문제**: 익명 유저가 바로 구독(Pro/Premium) 시도 → 인증(전화/이메일)이 익명 계정에 연결 → 실제 계정과 불일치
- **수정**:
  - `requestUpgrade(tier)` 헬퍼 함수 추가: 익명이면 `AccountUpgradeModal` 선표시
  - 사이드바 Pro/Premium, 설정 탭 업그레이드, TrialLimitModal, RenewalReminderPopup 총 5곳 적용
  - `AccountUpgradeModal`에 `onSuccess`, `fromSubscription` prop 추가
  - `fromSubscription=true` 시 파란색 안내 배너: "구독하려면 먼저 무료 계정을 만들어야 합니다"
  - 계정 생성 성공 → `pendingUpgradeTier` 활용하여 `UpgradeModal` 자동 복귀
  - X 버튼/취소 시 `pendingUpgradeTier` 초기화
- **i18n**: 10개 언어 `upgrade.accountRequiredForSubscription` 키 추가

## 4. iOS 효과음: AudioContext + HTML5 Audio WAV 폴백 하이브리드
- **파일**: `src/utils/soundEffects.js` (전면 재작성)
- **문제**: iOS Safari/Chrome에서 AudioContext가 비동기 콜백(발음 평가 결과)에서 suspended → 효과음 미재생. Silent Mode에서도 AudioContext 차단됨
- **최종 해결 (하이브리드 방식)**:
  - **Android/데스크톱**: AudioContext `state === 'running'` → 기존 프로그래매틱 Oscillator 톤 즉시 재생
  - **iOS (AudioContext 불가 시)**: 코드에서 WAV PCM 데이터 직접 생성(`generateWav`, `generateToneSamples`) → `new Audio(blobUrl).play()` 폴백
  - WAV Blob URL은 `_wavCache`에 캐싱하여 반복 재생 시 재생성 방지
  - 매 `touchend`/`click`마다 `getAudioCtx()` → `resume()` 호출 (AudioContext를 running 유지 시도)
  - 톤 정의를 `TONES` 객체로 중앙 관리 (alert, success, star, swipe)
- **시행착오**: 단순 AudioContext unlock(무음 버퍼 1회) → 매 제스처 resume → 최종적으로 HTML5 Audio 폴백이 iOS에서 유일하게 안정적으로 동작

## 5. 모든 팝업 AdMob 배너 가림 방지
- **수정 파일 10개**: OnboardingModal.css, DailyProgressPopup.css, TabTutorial.css, BookmarkPromptModal.css, RenewalReminderPopup.css, UpgradeModal.css(기존 적용), TrialLimitModal.jsx, ConfirmModal.jsx, AccountUpgradeModal.jsx, App.jsx(AnonSignupPrompt, LoginModal)
- **문제**: 네이티브 AdMob 배너가 웹뷰 위 하단에 겹쳐 팝업 하단이 가려짐
- **수정**: 모든 팝업 overlay의 `padding`에 `var(--admob-bottom, 0px)` 통합
  - CSS 파일: `padding: 20px 20px calc(20px + var(--admob-bottom, 0px))`
  - 인라인 스타일: `padding: '20px 20px calc(20px + var(--admob-bottom, 0px))'`
  - `paddingBottom` 별도 추가 대신 `padding` shorthand에 통합 (웹은 `0px` 유지)
  - TabTutorial: `bottom: calc(44px + safe-area + var(--admob-bottom, 0px))`
  - DailyProgressPopup: `padding-bottom: calc(90px + var(--admob-bottom, 0px))`

## 버전 이력
| 버전 | 커밋 | 내용 |
|------|------|------|
| v1.3.58 (Capgo) | `58d7a64` | linkWithPopup 통일 + Auth 삭제 fatal |
| v1.3.59 (Capgo) | `3535876` | 익명 구독 가드 + AccountUpgradeModal 개선 |
| v1.3.60 (Capgo) | `ea9fc00` | iOS AudioContext unlock (1차 시도) |
| v1.3.61 (Capgo) | `1397a92` | 팝업 10개 AdMob 가림 방지 |
| v1.3.62 (Capgo) | `34d8771` | soundEffects 안전 래핑 |
| v1.3.63 (Capgo) | `ccea5ac` | iOS 매 제스처 resume (2차 시도) |
| v1.3.64 (Capgo) | `1884734` | **iOS 효과음 최종 해결 — 하이브리드 AudioContext+HTML5 Audio** |
| AAB v1.1.10 (code 14) | — | v1.3.58~60 포함, Firestore latestNativeVersion 업데이트 완료 |
