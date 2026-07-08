---
name: changes-0328
description: 2026-03-28 작업 — 단어장 예문 발음, Translation 탭 예문 생성, Listening 문장재생, 홈 게이지, 플레이스토어 홍보 이미지 생성기
type: project
---

# 2026-03-28 작업 내역

## 앱 기능 변경 (v1.3.90 → v1.3.91)

### 1. 단어장(Library) 예문 발음 연습 토글
- **TranslationCard.jsx**: `practiceMode` 상태 추가 (`'word'` / `'example'`)
- `useAudioRecorder`에 `practiceText` (모드에 따라 word/example 전환) 전달
- `resetAssessment` 호출로 모드 전환 시 이전 결과 초기화
- `example`이 있는 카드만 "단어 연습 ↔ 예문 연습" 슬라이드 토글 표시
- **TranslationCard.css**: `.practice-section` 스코프 아래에 토글 + 타겟 텍스트 스타일 추가
- i18n: `vocab.practiceWord` / `vocab.practiceExample` — 10개 언어 모두 키 존재 확인

### 2. Translation 탭 단어 예문 생성
- **App.jsx Gemini 프롬프트**: Task 6 추가 — `type: "word"`일 때 `example`, `exampleTranslation` 필드 생성
- **`translationExamples` 상태** 추가 — `{ langCode: { example, exampleTranslation } }`
- **`saveToFirebase`**: example/exampleTranslation Firestore 저장
- **Translation 탭 UI**: TranslationCard에 example/exampleTranslation prop 전달
- **EXAMPLE 섹션 위치**: 발음 연습 아래 → 발음 토글 위로 이동 (VocabTab과 동일)
- **예문 TTS**: `onSpeakText` prop 추가 (App.jsx, Library.jsx 모두 handleSpeak 전달)
- **아이콘 통일**: 예문 TTS 아이콘을 `Volume2`로 통일 (Vocab/Listening/Translation/단어장 모두)

### 3. Listening 탭 문장 단위 터치 재생
- **`splitIntoSentences` 함수**: 대화형은 줄바꿈 기준, 에세이는 문장 종결 부호 기준 분리
- **`playingSentenceIdx` 상태**: 현재 재생 중인 문장 인덱스 추적
- 지문 표시를 문장 단위 `<span>`으로 변경 — 터치 시 해당 문장만 TTS 재생 + 파란 하이라이트
- **전체 듣기 버튼(🔊)** 기존대로 유지
- **ListeningTab.css**: `.listening-sentence` hover/active/playing 스타일

### 4. Listening 탭 별표 효과음
- `playStarSound` import + `handleSave` 후 호출 추가
- 4개 탭 모두 동일한 `playStarSound()` 확인 (Translation, Vocab, Scene, Listening)

### 5. Listening 조회수 Firebase 저장 + 홈 3개 게이지바
- **useDailyProgress.js**: `todayListenCount` + `incrementDailyListen()` 추가
- Firestore `users/{uid}/dailyProgress/{YYYY-MM-DD}.listenCount` 저장
- ListeningTab `onGenerate` 콜백에 `incrementDailyListen()` 연결
- **HomePage.jsx**: 오늘의 진도 3개 게이지바 (카드달성 🎯, 발음 🎙, 듣기 🎧)
- 카드/발음 한도에 광고 보너스(`rewardBonus`) 반영
- **달 아이콘 30% 축소**: `font-size: 1rem → 0.7rem`

### 6. Capgo Production 배포
- v1.3.91 → Capgo production 채널 업로드 완료

---

## 플레이스토어 홍보 이미지 생성기

### 생성기 도구
- **`promo_images/generate.mjs`** — 범용 HTML+Puppeteer 홍보 이미지 생성기
  - `--screenshot`: 폰 안에 넣을 스크린샷
  - `--title`, `--highlight`, `--subtitle`: 카피
  - `--theme`: 배경색 테마 (`green`, `blue`, `purple`, `peach`, `gold`)
  - `--recommend-title`, `--recommend-items`: 추천 문구 (파이프 구분)
  - `--glow-pos`: 돋보기 확대경 Y비율
  - `--stars`: 별표 오버레이 Y비율 (쉼표 구분)
  - `--side-checklist`: 사이드 체크리스트 (아이콘:텍스트 형식)
  - 출력: 1080x1920 PNG
- **`promo_images/capture.mjs`** — HTML → PNG 캡처 (Puppeteer)
- **`promo_images/resize_all.py`** — 6개 언어 × 3사이즈 리사이즈 (Pillow)
- **`promo_images/generate_feature_graphic2.py`** — Feature Graphic 배경 생성 (Gemini API)

### 테마 컬러
| 테마 | 배경색 | 사용처 |
|---|---|---|
| `green` | 민트 그린 (#f0fdf4~#dcfce7) | Promo_01 |
| `blue` | 하늘색 (#eff6ff~#dbeafe) | Promo_02 |
| `purple` | 연보라 (#faf5ff~#f3e8ff) | Promo_03 |
| `peach` | 피치 (#fff7ed~#ffedd5) | Promo_04 |
| `gold` | 골드/웜옐로 (#fffbeb~#fef3c7) | Promo_05 |

### 생성된 홍보 이미지 (5장 × 6언어 × 3사이즈 = 90개)

| Promo | 주제 | 카피 | 테마 | 특수효과 |
|---|---|---|---|---|
| 01 | 자기 주도성 | 당신이 직접 설계하는 언어 학습의 혁명 | green | - |
| 02 | 초정밀 발음 교정 | 음소 단위까지 쪼개어 완성하는 완벽 발음 | blue | - |
| 03 | 무한 생성 커리큘럼 | AI가 실시간으로 생성하는 무한 커리큘럼 | purple | - |
| 04 | 다국어 동시 학습 | 하나를 배울 때 셋을 얻는 압도적 효율 | peach | 돋보기 (언어Pills 확대) |
| 05 | 실속형 가성비 | 거품은 빼고 실력만 채운 압도적 가성비 | gold | ⭐ 별표 (메뉴 항목) |

### 각 이미지 공통 구성
- **상단**: 메인 카피 (강조 단어 하이라이트) + 서브 카피
- **중앙**: 폰 목업 (484px, 실제 앱 스크린샷 삽입, 둥근 모서리)
- **하단**: 추천 문구 5줄 (⭐⭐ 이런 분들께 딱! 맞는 앱입니다 + 4항목)
- **footer**: PronunFit 로고 (아이콘 + 3D 텍스트)

### 리사이즈 사이즈
- 1080×1920 (Play Store 스크린샷)
- 1242×2208 (App Store 5.5")
- 1290×2796 (App Store 6.7")

### 6개 언어
- ko (한국어), en (English), jp (日本語), es (Español), ru (Русский), vn (Tiếng Việt)

### 폴더 구조
```
promo_images/
├── generate.mjs          # 범용 생성기
├── capture.mjs            # HTML→PNG 캡처
├── resize_all.py          # 리사이즈
├── generate_promo0X_all.mjs  # 각 Promo별 일괄 생성 스크립트
├── logo.png               # PronunFit 앱 아이콘
├── Promo_01/              # 자기 주도성
│   ├── app_screenshot_*.png  # 6개 언어 스크린샷
│   └── output/
│       ├── promo_01_*.png    # 6개 언어 원본
│       └── {lang}/           # 3사이즈 리사이즈
├── Promo_02/              # 초정밀 발음 (단일 스크린샷)
├── Promo_03/              # 무한 커리큘럼
├── Promo_04/              # 다국어 동시 학습 (돋보기)
├── Promo_05/              # 실속형 가성비 (별표)
├── generate_feature_graphic2.py  # Feature Graphic 생성
└── feature_v3_*.png       # 가로형 Feature Graphic (1024x500)
```

### Feature Graphic (가로형 1024x500)
- Gemini API (gemini-2.5-flash-image + imagen-4.0-generate-001) 사용
- 3D "PronunFit" 로고 + "a Smart Multi Languages Learning App with AI" 문구
- 사실적 flat-lay 스타일: 민트 노트북, 이어폰, 커피, 마이크, 국기핀
- 소품 중앙 60% 배치 → 가장자리 잘림 방지
