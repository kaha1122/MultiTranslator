---
name: changes-0418-session2
description: 2026-04-18 2차 — 신규 유저 이탈방지(스플래시 이미지 전면교체+온보딩 언어UX개선), 일본어 발음평가 히라가나 치환, AAB v1.2.6 code25 + Capgo 1.4.27/1.4.28
type: project
originSessionId: 763688e7-6555-4b6f-bd90-603ebe928f94
---
# 2026-04-18 2차 세션

배경: Meta 광고 유입 사용자(특히 스페인어/베트남어/러시아어)가 Firestore에 deviceLang만 남기고 sourceLang/targetLang 없이 이탈하는 현상 조사. 원인은 "첫 진입에서 '한국 앱' 오인"으로 판단 → 스플래시/온보딩 전면 개선. 추가로 일본어 발음평가 음소 공백 이슈 해결.

## 1. 원인 분석 (스페인어 사용자 이탈)

- i18n 파일(es.json) 및 폴백 로직 검증 → **스페인어 번역은 완전**, 한국어 폴백 시나리오 없음
- `detectBrowserSourceLang` ([App.jsx:71-78](src/App.jsx#L71-L78))은 `es-ES`, `es-419` 모두 `es`로 정확 매핑
- 실제 함정: **스플래시 "무료 다국어 발음학습 단어장" 한국어 태그라인** + 온보딩 첫 화면 🇰🇷 한국어가 맨 위 배치 → 첫 시각적 인상이 "한국 앱"

## 2. 스플래시 이미지 생성 (Nano Banana 2)

- **정확한 모델 ID**: `gemini-3.1-flash-image-preview` (404: `gemini-3.1-flash-image`, `gemini-3-flash-image`)
- **Gemini Python SDK**: `client.models.generate_content(model, contents=[prompt, PIL.Image, PIL.Image], config=GenerateContentConfig(response_modalities=["IMAGE","TEXT"]))` — 여러 이미지 입력 가능
- `aspect_ratio="9:16"`는 `types.ImageConfig(aspect_ratio=...)` 또는 Imagen4 `GenerateImagesConfig(aspect_ratio=...)`
- 스크립트 4종 작성 (모두 `.env`에서 `VITE_GEMINI_API_KEY` 자동 로드, API키 하드코딩 금지):
  - `promo_images/generate_splash.py` (초기 후보 탐색)
  - `promo_images/generate_splash_v2.py` (베트남/한국 국기 포함 + Pillow 텍스트 오버레이 시도)
  - `promo_images/compose_splash_nano.py` (base + 로고 레퍼런스 → 합성)
  - `promo_images/fix_red_circle.py` (빈 빨간 원 인페인팅 제거)

## 3. 최종 스플래시 이미지 선정 및 적용

- 최종본: `promo_images/splash_final_fixed_2_20260418_154726.png` (9:16, 768×1408 PNG)
- JPG 변환 저장: `src/assets/splash-bg.jpg` (Q88 progressive, 148KB)
- 구성: 우드 책상 + 민트 노트북 + 마이크 핀 + 커피잔 + 이어버드 + 국기 7개(🇺🇸🇰🇷🇯🇵🇨🇳🇫🇷🇪🇸🇻🇳) + 민트 3D "PronunFit" + "A Smart Multi Languages Learning App with AI"
- 참조: Feature graphic `feature_v3_imagen4_1_20260328_180115_1024x500.png`에서 로고 스타일 추출

## 4. SplashScreen 컴포넌트 리팩터

- [src/components/SplashScreen.jsx](src/components/SplashScreen.jsx): 기존 링/웨이브/텍스트 UI 전부 제거, 배경 이미지 하나로 단순화. fade-out 타이밍(1.8s→2.3s) 유지
- [src/components/SplashScreen.css](src/components/SplashScreen.css): 모바일(cover 꽉채움) + 데스크톱(원본 비율 세로박스) 분기
- **핵심 기법**: `.splash-inner { max-width: calc(100vh * 768 / 1408); }` — 이미지 원본 비율로 가로 상한 제한
  - 모바일 (430×932): max-width 509px보다 width 100%(=430px)가 작아서 100% 우선 → 꽉 채움
  - 데스크톱 (1920×1080): max-width 589px로 제한 → 중앙 세로박스, 양옆 `#f3efe8` 여백
- 기존 `.splash-fading` 페이드 아웃, aria-label="PronunFit" 유지

## 5. OnboardingModal 언어 UX 개선

### 5-1. LANGUAGES 배열 재정렬 ([OnboardingModal.jsx:18-25](src/components/OnboardingModal.jsx#L18-L25))
```js
const reorderByDefault = (list, defaultCode) => {
  if (!defaultCode) return list;
  const idx = list.findIndex(l => l.code === defaultCode);
  if (idx <= 0) return list;
  return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
};
```
- step 0(모국어 선택)에서만 `useMemo(() => reorderByDefault(LANGUAGES, defaultSourceLang))` 사용
- 10개 언어 모두 적용됨 (es/vi/ru/pt-BR/ja/zh-CN/fr/de/en/ko)
- `ko`는 원래 첫 번째 → 재정렬 불필요(idx<=0 가드로 스킵)
- step 1/2(학습언어 선택)는 기존 `availableForTarget`/`availableForMore` 순서 유지 — 영향 범위 격리

### 5-2. 선택 강조 강화 ([OnboardingModal.css:83-118](src/components/OnboardingModal.css#L83-L118))
- 테두리 `2px → 3px`, 배경 `#f0fdf4 → #ecfdf5` (더 선명한 민트)
- 그림자 0.15 → 0.28, `transform: translateY(-1px)` (살짝 떠오름)
- **체크 배지**: 우상단 22px 원형 `#00a884` 배경에 흰색 `✓` — JSX에서 `{isSelected && <span className="onb-lang-check">✓</span>}`
- 모든 step(모국어/학습언어)에 일관 적용

## 6. 스플래시 데스크톱 과대확대 버그 + 수정

- **증상**: 웹앱 데스크톱 브라우저에서 `background-size: cover`가 9:16 이미지를 가로 기준 꽉 채워 엄청 확대됨 (국기가 화면 절반)
- **모바일은 정상** (뷰포트 비율 유사)
- **수정**: inner 박스 구조로 변경, `max-width: calc(100vh * 768 / 1408)` 적용 — 위 4번 참조
- 커밋 `84b4873`로 즉시 핫픽스

## 7. 일본어 발음평가 한자 → 히라가나 치환

### 7-1. 문제
- 일본어 Scene/Vocab 카드(예: "今年の年末には...") 발음평가 시 PronunciationAssessment 팝업의 음소 상세가 `"//"` 공백
- 원인: Azure Speech SDK에 **한자 포함 referenceText**를 보내면 Phoneme 배열이 빈 값으로 반환됨

### 7-2. 조사 결과 (핵심 발견)
- Gemini 프롬프트 ([server/routes/scene.js:110](server/routes/scene.js#L110), [vocab.js:86](server/routes/vocab.js#L86), [listening.js:94](server/routes/listening.js#L94)): `"For ja: hiragana reading"` 지시 이미 존재
- **반환 JSON에 `pronunciation` 필드로 히라가나가 이미 들어옴** (예: "ことしのねんまつには かいしゃからまとまった...")
- 클라이언트에서 [ScenePractice.jsx:121-122](src/components/ScenePractice.jsx#L121-L122)로 **화면 표시까지 되고 있지만 발음평가 요청에는 사용 안 됨**
- 즉 **별도 라이브러리(kuroshiro/wanakana) 불필요** — 기존 데이터 재활용만 하면 됨

### 7-3. 수정 ([dbdadf2](https://github.com/kaha1122/MultiTranslator/commit/dbdadf2))
- [ScenePractice.jsx:64-72](src/components/ScenePractice.jsx#L64-L72):
  ```js
  const referenceText = (langCode === 'ja' && generated.pronunciation)
    ? generated.pronunciation : generated.sentence;
  ```
- [VocabTab.jsx:38-50](src/components/VocabTab.jsx#L38-L50):
  ```js
  const referenceText = (selectedLang === 'ja')
    ? (practiceMode === 'word'
        ? (w.pronunciation || w.word)
        : (w.examplePronunciation || w.example || ''))
    : practiceText;
  ```
- 히라가나 필드 없으면 원문 폴백 → 역호환

### 7-4. 중국어 의도적 제외
- `zh-CN` `pronunciation` 필드에는 **pinyin**이 들어옴 (예: "jīn nián de..."). 
- Azure는 **한자 기반 평가가 더 정확** (pinyin 전송 시 오히려 인식 실패 가능)
- 따라서 중국어는 현재 로직 유지 (한자 그대로 Azure에 전송)
- 러시아어는 `pronunciation`이 강세표시 원문이라 거의 동일 → 기존 동작 무영향

### 7-5. 후속 과제 (미처리)
- **TranslationCard(Library 카드 재생)**: pronunciation props가 체인에 없음 — App.jsx 호출부 확장 필요
- **Firestore Scene 카드 저장 시 pronunciation 필드 빈 문자열 하드코딩** ([App.jsx:1752](src/App.jsx#L1752)) — 저장 후 재생 시 여전히 한자. 신규 생성 카드는 즉시 효과만 동작

## 8. Azure CJK phoneme 기호 한계 진단

- Firestore `pronunciation_records` 확인 결과: **accuracyScore는 정상, phoneme 기호는 빈 문자열("")**
- word는 히라가나로 잘 분리됨(내 수정 반영 확인됨). 단 Azure가 일본어에 phoneme 기호를 반환하지 않음
- **Azure Speech 구조적 한계**: 영어/독일어/스페인어/프랑스어/러시아어 등은 IPA/SAPI 기반 기호 제공하지만 **ja-JP/zh-CN/ko-KR은 점수만 반환, 기호는 empty**
- 팝업 화면은 [PronunciationAssessment.jsx:139-153](src/components/PronunciationAssessment.jsx#L139-L153)의 **클라이언트 폴백**(기호 빈값 + 글자수==phoneme수 → 단어 글자로 대체)으로 정상 표시 중
- **결론**: 팝업 동작은 문제없음. Firestore 저장값만 `""`. 추후 Firestore 품질 개선 원하면 [analyze.js:85-111](server/routes/analyze.js#L85-L111)에 글자단위 폴백 서버측 추가 가능 (이번엔 보류)

## 9. AAB 재빌드 (v1.2.6 code 25)

- versionCode 24 → 25, versionName "1.2.5" → "1.2.6"
- 스플래시/온보딩 개선이 **신규 Play Store 설치자의 첫 진입 경험**에 결정적이라 AAB 재빌드 필요 (Capgo OTA만으로는 첫 실행 시 구버전 노출)
- `scripts/build-aab.sh` 호환성 수정: `grep -oP` (Windows Git Bash에서 "supports only unibyte" 오류) → `awk -F'"'` 기반으로 교체
- 빌드 결과: `android/app/build/outputs/bundle/release/app-release.aab` (29 MB, 빌드 31초)
- Firestore `config/app.latestNativeVersion` → 1.2.6 자동 업데이트 (build-aab.sh 내장 로직, 서버 API `/api/admin/update-config` 경유)
- Play Console 수동 업로드 단계는 사용자가 직접 수행

## 10. Capgo OTA Production 배포

- **1.4.27**: 스플래시/온보딩 개선 ([ed33481](https://github.com/kaha1122/MultiTranslator/commit/ed33481), [84b4873](https://github.com/kaha1122/MultiTranslator/commit/84b4873)) 배포 (checksum `24ec9b01...`)
- **1.4.28**: 일본어 히라가나 발음평가 치환 ([dbdadf2](https://github.com/kaha1122/MultiTranslator/commit/dbdadf2)) 배포 (checksum `4680adba...`)
- 각 배포 후 `npx @capgo/cli channel currentBundle production`으로 포인터 일치 검증 수행 (feedback_capgo_verify 규칙)

## 11. AAB 재빌드 불필요 판단 기준 (일본어 수정 케이스)

- 일본어 수정은 **src/ JS 파일만 변경**(ScenePractice.jsx, VocabTab.jsx) → 순수 웹 레이어
- 네이티브 플러그인/AndroidManifest/권한/capacitor.config.json/package.json 의존성 변경 없음
- 또한 이 개선은 **첫 진입 이탈 방지와 무관**(발음평가 팝업은 앱 깊숙한 흐름) → 첫 실행 시 구버전 노출해도 큰 문제 없음
- 결론: **Capgo OTA만으로 충분**, AAB 재빌드 스킵

## 12. 커밋 기록

1. `ed33481` feat: 신규 유저 이탈 방지 — 스플래시 이미지 교체 + 온보딩 언어 UX 개선
2. `84b4873` fix: 스플래시 이미지 데스크톱 과대확대 수정 — 원본 비율 유지 중앙 박스
3. `02532b8` chore: version bump 1.4.26 → 1.4.27 (Capgo production OTA)
4. `f47782a` build: AAB v1.2.6 (code 25) — 스플래시/온보딩 개선 네이티브 반영
5. `dbdadf2` fix: 일본어 발음평가 음소분석 공백 해결 — 한자 대신 히라가나를 referenceText로 사용
6. `e9c18be` chore: version bump 1.4.27 → 1.4.28 (Capgo production OTA)

## 13. 사이드 이펙트 점검 요약

- SplashScreen props 인터페이스 `{ onFinish }` 유지 — App.jsx 호출부 무변경
- i18n `splashTagline` 키(10개 언어 파일) 이제 미사용 dead code, 남겨둠 (영향 없음)
- `detectBrowserSourceLang`이 `ko`인 사용자는 원래 첫 번째 언어 → 재정렬 미발동, 기존 UX 동일
- 번들 크기: `splash-bg.jpg 148KB` 추가(Vite asset pipeline 해시 처리)
- 일본어 TTS/화면표시는 여전히 한자 노출(영향 없음), 발음평가 referenceText만 히라가나
- Firestore 저장 카드 역호환: 기존 필드 없으면 원문 폴백 자동 적용

## 14. 테스트 환경 팁 (재활용)

- 데스크톱 Chrome에서 언어별 테스트:
  - 시크릿 창(`Ctrl+Shift+N`) + DevTools(`F12`) → 커맨드 팔레트(`Ctrl+Shift+P`) → "Show Sensors" → **Locale 필드에 직접 입력**(드롭다운 아님, `es-ES`/`vi-VN`/`ru-RU` 등)
  - 또는 Console 한 줄: `localStorage.setItem('sourceLang', 'es'); localStorage.removeItem('deviceOnboardingDone'); location.reload();`
- 온보딩 모달은 익명 계정 신규 또는 `hasCompletedOnboarding !== true + !localStorage.deviceOnboardingDone` 조건에서만 표시 → 본인 실계정은 일반 창에서 모달 안 뜸, 시크릿 창 필수

## 15. 번들 스페인어 사용자 최종 경험 흐름 (기대)

1. 스플래시 2.3초 — 민트 3D PronunFit + 7개 국기(🇻🇳🇪🇸 포함) + 이미지 내 "다국어 앱" 시각적 메시지. 한국어 태그라인 없음
2. 온보딩 제목 스페인어(`"¿Cuál es su idioma nativo?"`) + 🇪🇸 Español이 **최상단 + 체크 배지 + 민트 테두리**로 "이미 내 언어가 선택됨" 인지 즉시
3. 이후 학습언어/레벨 선택으로 자연스럽게 이동
