---
name: changes-0318-session2
description: 2026-03-18 후반 작업 — Camera OCR 뷰파인더, Daily Trial 제한, 발음 게이지바, 버그 수정, v1.1.0 릴리스
type: project
---

# 2026-03-18 후반 세션 작업 내역

## 1. Camera OCR — Live Viewfinder 방식으로 전면 교체

### 변경 전
- `<input type="file" capture="environment">`로 네이티브 카메라 앱 호출
- 전체 사진이 그대로 OCR에 전달

### 변경 후
- `getUserMedia`로 라이브 카메라 뷰파인더 구현
- **스캔 박스 오버레이**: 단어(90vw × 80px) / 문장(90vw × 140px) 토글
- 반투명 마스크 + 코너 브라켓 [ ] 가이드
- CSS `scale(1.0)` (줌 1배 — 가장 넓은 화각)
- **Canvas crop**: scan box의 실제 DOM 좌표(getBoundingClientRect)로 정확한 크롭
- 갤러리 선택은 기존 file input 유지
- 카메라 스트림 cleanup (모달 닫기/언마운트 시)
- 카메라 권한 에러 핸들링 + i18n

### 크롭 로직 핵심
```
vidRect = video.getBoundingClientRect()
boxRect = scanBox.getBoundingClientRect()
offset = boxRect 위치 - vidRect 위치 → 네이티브 비디오 좌표로 매핑
```
초기에 "중앙 가정" 버그가 있었으나, 실제 screen 좌표 차이로 수정 완료.

### 줌 히스토리
1.3x → 2.0x (가로 잘림) → 1.0x (최적) → 0.8x (overflow) → **1.0x 확정**

**Why:** 줌이 클수록 화각이 좁아져 책 한 줄이 잘림. 줌 대신 스캔 박스 높이를 줄여서 세로 2줄만 캡처.

### 파일
- `src/components/CameraOCRModal.jsx` — 전면 재작성
- `src/components/CameraOCRModal.css` — 뷰파인더 스타일 ~200줄 추가
- `src/locales/*.json` × 10 — cameraOCR 섹션 (title, close, takePhoto, chooseFromGallery, wordMode, sentenceMode, capture, scanGuide 등)

---

## 2. Free Trial 일간 제한 시스템

### 변경 전
- Trial: 누적 카드 10개, 누적 발음 30회 (영구)

### 변경 후
- Trial: **하루 카드 10개, 하루 발음 20회** (매일 리셋)
- Pro: 월 **1,500회** (기존 1,000 → 1,500)

### 구현
- `useDailyProgress.js`: `pronCount` 필드 추가 (Firestore `users/{uid}/dailyProgress/{date}`)
- `incrementDailyPron()` 함수 추가
- `AuthContext.jsx`: `TRIAL_DAILY_CARD_LIMIT=10`, `TRIAL_DAILY_PRON_LIMIT=20`, `PRO_PRON_LIMIT=1500`
- `dailyTrialCardReached` / `dailyTrialPronReached` 상태 → `todayCount`/`todayPronCount` 기반
- `useAudioRecorder.js`: `onPronSuccess` 콜백 파라미터 추가
- 모든 컴포넌트(TranslationCard, ScenePractice, VocabTab, **Library**)에 `onPronSuccess={incrementDailyPron}` 전달

### 목표 설정 슬라이더
- Trial 사용자: **10으로 고정** (disabled, opacity 0.6, "Free" 라벨)
- 유료 사용자: 1~100 자유 설정

---

## 3. 발음 게이지바 (헤더)

### 구조
```
🎯 ████ 9/10   | Mon Tue Wed ...
🎙️ ████ 15/20  |   (같은 높이 정렬)
```

### Tier별 표시
| Tier | 게이지 | 색상 | 라벨 |
|------|--------|------|------|
| Trial | 일간 | 🟡 amber | `X/20` |
| Pro | 월간 | 🟢 green | `X` (숫자만) |
| Premium/Admin | 숨김 | — | — |

- 좌측 게이지 2개 세로 스택 + 우측 주간 캘린더 → `alignItems: stretch`로 높이 동기화
- 바 높이 6px, 폰트 0.6rem

---

## 4. TrialLimitModal 업데이트
- 타이틀: "Daily Trial Limit Reached!"
- 설명: "and" → "or" (둘 중 하나)
- **"내일 다시 만나요!"** 보라색 메시지 추가
- 행간 축소 (컴팩트)
- 10개 언어 i18n 키 추가: `seeYouTomorrow`

---

## 5. 기타 버그 수정

### Refresh 시 개인정보보호방침 이슈
- **원인**: `useEffect([user, viewMode])`가 매번 privacy viewMode를 홈으로 리다이렉트
- **수정**: `initialRedirectDone` 플래그로 최초 1회만 `window.location.pathname` 체크

### TRIAL_PRON_LIMIT 미정의 에러
- Settings 페이지에서 기존 상수명 참조 잔여 → `TRIAL_DAILY_*` 로 교체

### Library 발음 카운트 누락
- Library.jsx의 TranslationCard에 `onTrialLimitReached`, `onPronSuccess` prop 미전달 → 추가

### Translation textarea 고정 높이
- `rows={2}` 고정 → **자동 높이 확장** (OCR로 긴 문장 입력 시)

### Library 필터 "Starred" → "Flagged"
- 아이콘이 Star→Flag로 바뀌었으나 텍스트 미변경 → en/pt-BR/ru 수정

### 네이티브앱 전용 수정
- **Download 버튼**: LandingPage 헤더 + install popup + App.jsx install banner → 네이티브에서 숨김
- **카카오톡 경고**: Login/Signup에서 `isNativePlatform` 체크 추가 → 네이티브 스킵

---

## 6. 버전 & 릴리스

| 항목 | 값 |
|------|-----|
| package.json | 1.1.0 |
| versionCode | 4 |
| versionName | 1.1.0 |
| Capgo | production 채널 v1.1.0 업로드 완료 |
| AAB | `android/app/build/outputs/bundle/release/app-release.aab` 빌드 완료 |
| Google Play | Alpha 트랙 업로드 대기 (CAMERA 권한 설명 필요) |
| Vercel | main push로 자동 배포 완료 |

---

## 7. Upgrade 팝업 proFeature1
- 10개 locale: "1000" → "1,500" pronunciation assessments/mo
