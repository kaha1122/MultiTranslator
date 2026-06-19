---
name: changes-0322
description: 2026-03-22 세션: AdMob배너 ADAPTIVE, 빈발음Drop(hasDetectedVoice), 익명팝업UTC→로컬, PWA아이콘, Vercel staging 구글로그인, Capgo디바이스채널
type: project
---

## 2026-03-22 변경사항 (v1.3.33~v1.3.35)

### AdMob 배너
- `BannerAdSize.BANNER` → `ADAPTIVE_BANNER` 변경 (전체 너비)
- 플러그인 제약: 배너 2개 동시 불가 (`@capacitor-community/admob`은 배너 1개만 지원)
- `alert()` 디버그 코드 3개 제거 (lines 72, 86, 90)

### 빈 발음 녹음 Drop (useAudioRecorder.js)
- `hasDetectedVoiceRef`: RMS 볼륨 분석 중 음성 감지 시 true 설정
- `onstop`에서 3가지 조건 체크 → 미충족 시 서버 전송 차단:
  - `hasDetectedVoiceRef.current === false` (음성 미감지)
  - `recordDuration < 2000` (2초 미만)
  - `audioBlob.size < 2000` (2KB 미만)
- `errors.retryPronunciation` i18n 10개 언어 등록

### 익명 유저 가입유도 팝업
- `new Date().toISOString().slice(0,10)` (UTC) → 로컬 시간 기준으로 변경
- UTC+9 한국에서 날짜가 바뀌어도 팝업 안 뜨던 문제 수정

### PWA 아이콘
- manifest `"purpose": "any maskable"` → `"any"` 변경 (maskable이 아이콘 80% 잘라먹음)
- `pronunfit.com`에서 PWA 설치 정상 작동 확인
- Windows PC에서 국기 이모지 미렌더링은 OS 제한 — 현재 유지

### Vercel Staging 구글 로그인
- staging branch URL: `multi-translator-git-staging-seungwoo-has-projects-65170b8b.vercel.app`
- Firebase 승인된 도메인에 위 URL 추가 필요 (`auth/unauthorized-domain` 에러)
- 개별 커밋 URL (`multi-translator-3i0wc4fhf-...`)은 매번 변경되므로 등록 불필요

### Capgo 디바이스 채널 관리
- 테스트 기기: Capgo 콘솔 → Devices에서 채널을 `staging` (ID: 19564)으로 수동 지정
- production 전환 시 콘솔에서 채널만 변경 — 앱 데이터 초기화 불필요
- `setChannel()` 코드 호출과 관계없이 콘솔 수동 지정이 우선

### 배포 규칙 변경
- 웹앱: staging branch만 push (main push는 production 요청 시에만)
- Capgo: `CAPGO_CHANNEL=staging` 빌드 후 staging 채널 업로드
