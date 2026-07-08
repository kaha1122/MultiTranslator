---
name: changes-0418
description: 2026-04-18 변경 — 발음 평가 팝업 UI 3차 개편 (음소 Syllables/NBestPhonemes/글자/단일엔트리 단어 4단 폴백 + 단어별 점수 상시 표시 + 첫 3회 탭힌트·자동오픈 + 헤더 🔊 스피커 + ScenePractice props 누락 + CJK 배지 inline으로 행간격 대폭 축소) / Capgo staging APK 사이드로드 플로우 확립 (v1.4.21~1.4.24) / Android ANR 초기 진단 (Facebook SDK latest.release 의심, 관망 결정)
type: project
originSessionId: 3e6e168e-bb68-44ce-83d6-9ce816577575
---
**Why:** 전날 완성한 Translate/Listening 대규모 기능이 staging 배포된 상태에서, 사용자가 안드로이드 APK로 직접 테스트하며 발음 평가 팝업의 발견성·언어별 심볼 누락·간격·스피커 버튼 등 세부 UX 문제를 순차 발견 → 당일 3차례 개선 + OTA 반복.

**How to apply:**
- 발음 평가 팝업 관련 버그·기능 요청 시 이 파일부터 확인. 특히 "음소 심볼이 // 로 빈다" 증상은 **4단 폴백 체인**(Phonemes → NBestPhonemes → Syllables → Phoneme 원본) + 클라이언트 2단 보조 폴백(글자 수 일치 분할 / 단일 엔트리 단어 전체) 구조를 이해한 뒤 원인 좁힐 것.
- ScenePractice/VocabTab/TranslationCard/Library 4곳 모두 PronunciationAssessment 렌더 — props 누락 쉽게 발생. 신규 prop 추가 시 4곳 일괄 grep 필수.
- Capgo staging 테스트는 **APK 사이드로드**(네이티브 서명은 동일 keystore, 서명 변경 X)로 진행. Play Store 프로덕션 앱과 동일 서명이므로 기존 앱 삭제 후 설치 필요 없이 덮어씌움 가능 (APK 사이드로드 플로우 아래 참조).

---

## 1. Capgo Staging 배포 플로우 확립 (v1.4.21 → v1.4.24)

### 빌드·업로드 명령
```bash
# 1. 버전 bump (package.json) — 같은 버전 재업로드 불가
# 2. staging 채널 빌드 (__CAPGO_CHANNEL__ = 'staging' 주입)
CAPGO_CHANNEL=staging npm run build
# 3. 번들 업로드
npx @capgo/cli bundle upload --channel staging
```

### APK 사이드로드 (staging 테스트 기기용)
```bash
CAPGO_CHANNEL=staging npm run build
npx cap sync android
cd android && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleRelease
# 출력: android/app/build/outputs/apk/release/app-release.apk (~29MB)
```
- 서명은 `release-keystore.jks` 사용 (Play Store AAB와 동일 keystore) → Play Store 프로덕션 앱과 덮어쓰기 충돌 없이 설치 가능
- 전송: 카카오 "나에게 보내기"/Drive/USB 중 편한 방법
- 설치 후 앱 실행 → `__CAPGO_CHANNEL__ = 'staging'`이 빌드에 박혀 있어 staging 채널의 최신 OTA 번들 자동 다운로드·적용

### 오늘 업로드된 staging 번들
- v1.4.21 — changes-0417의 5건(Listening A/B voice 등) staging 반영
- v1.4.22 — 발음 평가 1차 개편 (Syllables fallback + 단어 점수 + 탭 힌트)
- v1.4.23 — 발음 평가 2차 (헤더 🔊 버튼 + 간격 축소 + CJK 글자 폴백)
- v1.4.24 — 발음 평가 3차 (ScenePractice props 누락 + 배지 inline + 단일엔트리 폴백 + NBestPhonemes)

---

## 2. Android ANR 초기 진단 (2026-04-17 발견 → 관망 결정)

### 증상
```
okio.SegmentPool.take (SegmentPool.kt:79)   ← 루트 차단
↓
com.getcapacitor.BridgeActivity.onCreate (BridgeActivity.java:42)
↓
com.arigems.pronunfit.MainActivity.onCreate (MainActivity.java:10)
```
- ANR은 **네이티브 onCreate**에서 발생 — 웹/JS 변경과 무관
- `okio.SegmentPool.take`는 HTTP/파일 I/O 중 할당 병목 신호

### 의심 1순위: **Facebook SDK `latest.release`**
[android/app/build.gradle:54](android/app/build.gradle#L54):
```gradle
implementation 'com.facebook.android:facebook-login:latest.release'
```
- 버전 비핀 → 매 빌드마다 FB가 push하는 최신 버전 땡겨짐 (재현 불가능한 regression 위험)
- Facebook Login SDK 16+는 **ContentProvider auto-init** → onCreate 이전에 OkHttp/okio로 네트워크 콜
- GitHub Issues에 ANR 리포트 다수

### 권장 조치 (미실행, 사용자 관망 결정)
1. 버전 고정: `implementation 'com.facebook.android:facebook-login:17.0.2'`
2. AndroidManifest.xml에 FB auto-init 비활성화 3가지 meta-data:
   ```xml
   <meta-data android:name="com.facebook.sdk.AutoInitEnabled" android:value="false" />
   <meta-data android:name="com.facebook.sdk.AutoLogAppEventsEnabled" android:value="false" />
   <meta-data android:name="com.facebook.sdk.AdvertiserIDCollectionEnabled" android:value="false" />
   ```
3. Play Console Android vitals → ANR 탭에서 기기/OS/버전 분포 확인

### 사용자 판단
- "원인 아직 불명확하니 지켜보고 재발 시 다시 점검" — 일단 관망
- 재발 시: Play Console ANR 리포트(기기·OS·버전 분포)와 오늘 날짜 이후 증가 추세 확인해 원인 좁힐 것

---

## 3. 발음 평가 팝업 UX 3차 개편 (commit c7164a0, 5874a28, 0b2d2ad)

### 3.1 Wave 1 (c7164a0) — 기초 UX
**서버** [server/routes/analyze.js](server/routes/analyze.js):
- CJK 언어(일본어·중국어·한국어 등)는 Azure가 `Phonemes[].Phoneme`을 빈 문자열로 반환 → UI에서 `//`만 표시되던 문제
- Phonemes에 실제 기호가 있으면 우선, 없으면 Syllables[] fallback, 그것도 없으면 Phonemes 원본 — **3단 폴백**

**클라이언트** [PronunciationAssessment.jsx](src/components/PronunciationAssessment.jsx) + [.css](src/components/PronunciationAssessment.css):
- 단어 아래에 작은 회색 `accuracyScore` **항상 표시** (`.word-score` 0.65rem, `#94a3b8`)
- 첫 3회 평가까지 단어 신호등 상단에 💡 힌트 표시 (`localStorage: pronAssessHintCount`, max 3)
- 첫 3회 평가까지 `accuracyScore<60` 단어가 있으면 그 단어 팝업 **자동 오픈** (교육 효과)
- 4회차부터는 힌트·자동오픈 모두 없음, 사용자 자율 탐색
- `.word-item` padding `6/8px` + `min-width: 44px` + `-webkit-tap-highlight-color`로 모바일 터치 타겟 확대
- `:hover`는 `@media (hover: hover)`로 감싸 **데스크탑 한정** — 모바일 이중 탭 방지
- `:active { transform: scale(0.96) }` 탭 피드백

**i18n** — `scores.tapHint` 10개 언어 (한국어: "단어를 탭하면 음소별 상세 분석이 나와요")

### 3.2 Wave 2 (5874a28) — 팝업 헤더 재구성 + CJK 글자 폴백
**[PronunciationAssessment.jsx](src/components/PronunciationAssessment.jsx) 변경**:
- 팝업 헤더에서 🔍 이모지 제거, 대신 **🔊 Volume2 버튼** 추가 (단어 전체 TTS 재생)
- props 확장: `langCode`, `onSpeak` 추가 (없으면 버튼 조건부 비활성)
- 음소 심볼 빈 값일 때 **클라이언트 글자 폴백**: 단어 글자 수와 phoneme 배열 길이가 같으면 글자 단위로 분할 (히라가나 단어 등)

**[PronunciationAssessment.css](src/components/PronunciationAssessment.css) 간격 축소** (1차):
- `.phoneme-microscope` padding `16px` → `10/12px`
- `.phoneme-header` margin-bottom `12→4`, padding-bottom `8→4`
- `.phoneme-list` gap `12→6`
- `.phoneme-speak-btn` 신규 (파란 아이콘 + hover 배경)

**부모 props 배선 (3곳)**:
- [TranslationCard.jsx:441](src/components/TranslationCard.jsx#L441) — `langCode`, `onSpeak={onSpeakText}`
- [VocabTab.jsx:198](src/components/VocabTab.jsx#L198) — `langCode={selectedLang}`, `onSpeak`
- ⚠️ **ScenePractice.jsx:142 누락** — Wave 3에서 수정

### 3.3 Wave 3 (0b2d2ad) — 대화연습 누락 fix + 행간격 근본 축소 + 카타카나 대응
**🔊 버튼 누락 원인 추적**:
- 사용자가 "02.대화연습" 화면에서 🔊 버튼 안 보인다고 제보
- grep `PronunciationAssessment` → [ScenePractice.jsx:142](src/components/ScenePractice.jsx#L142)가 `langCode`/`onSpeak` props 미전달
- 컴포넌트는 `onSpeak && langCode` 조건부 렌더 → 조건 실패로 버튼 숨김
- props 전달 추가 (ScenePracticeCard에 이미 `langCode`, `onSpeak` 함수가 있어 그대로 전달)

**행간격 근본 축소**:
- 사용자가 "간격 충분히 안 좁혀짐" 재제보
- 원인: `.error-badge`가 `position: absolute; top: -20px`로 word-item 위 **20px 돌출** → 행간 12px만으론 배지가 윗 행 내용을 침범 → gap 축소 불가
- **해결**: badge를 `inline-block`로 전환 (absolute 제거)
  ```css
  .error-badge {
      display: inline-block;
      font-size: 0.55rem;
      padding: 1px 5px;
      margin-bottom: 2px;
      /* 제거: position: absolute, top: -20px, z-index: 2 */
  }
  ```
- 이후 패딩·갭 대폭 축소:
  - `.words-traffic-light` gap `12/14 → 4/10`, padding `10 → 4`
  - `.word-item` padding `6/8 → 2/6`
  - `.word-score` margin-top `4 → 2`
- `.words-traffic-light { align-items: flex-end }` 추가 → 배지 유무로 항목 높이 달라도 **단어/밑줄/점수 라인 일관 정렬**

**카타카나 외래어 "ショッピング" 대응**:
- Azure가 카타카나 외래어에 대해 **phonemes 배열 1개 entry + 빈 문자열**만 반환 (Syllables도 없음)
- 사용자 화면: 1개 바만 표시, 심볼 `//`
- 클라이언트 글자 폴백은 `chars.length === phonemes.length` 조건 필요 — "ショッピング" 6자 ≠ 1 phoneme → 적용 안 됨

**4단 폴백 체인** (최종):
1. **Phonemes** — 실제 기호 있으면 사용 (영/불/독/서/러 IPA)
2. **NBestPhonemes[0].Phoneme** — Azure 내부 대체 후보 (카타카나 등에서 간혹 채워져 있음) ← **신규**
3. **Syllables** — CJK 음절
4. **Phonemes 원본** — 빈 값이어도 점수는 있으므로 표시

**클라이언트 보조 폴백 2단**:
1. `chars.length === rawPhonemes.length` → 글자 단위 분할 (히라가나 등)
2. `rawPhonemes.length === 1` → **단어 전체를 심볼로 표시** ← **신규** (카타카나 외래어 대응)

**CSS 심볼 컬럼 유연화**:
```css
.phoneme-symbol {
    min-width: 45px;   /* was: width: 45px */
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```
→ 짧은 기호(`/d/`)는 여전히 45px, 긴 단어 폴백(`/ショッピング/`)은 최대 120px까지 확장, 초과 시 ellipsis

---

## 4. 최종 동작 매트릭스 (언어·반환 형태별)

| 단어 예시 | Azure 반환 | 표시 |
|---|---|---|
| 영어 "Das" | Phonemes `[{d}, {a}, {s}]` | `/d/ /a/ /s/` 3개 바 |
| 독일어 "Das" (빈값 케이스) | Phonemes `[{}, {}, {}]` | NBestPhonemes → Syllables 시도 → 그래도 빈값이면 Phoneme 원본 (`//` 3개) |
| 일본어 히라가나 "いただく" | Phonemes 4개 빈값 + Syllables 있음 | Syllables 사용 `/い/ /た/ /だ/ /く/` 또는 글자 폴백 |
| 일본어 카타카나 "ショッピング" | Phonemes 1개 빈값, Syllables 없음 | 단일엔트리 폴백 → `/ショッピング/` 1개 바 |
| 한자 "可能" | Phonemes 3개 빈값, Syllables 있음 | Syllables 사용 또는 글자 폴백 (chars=2 ≠ 3 → 글자 폴백 skip → // 3개 유지) |

---

## 5. props 스키마 정리 (PronunciationAssessment)

```js
<PronunciationAssessment
    data={assessmentResult}          // Azure 평가 결과 전체
    sourceLangCode={sourceLang}      // 모국어 (i18n용)
    langCode={targetLang}            // ✨ NEW: 대상 언어 (🔊 TTS 언어)
    onSpeak={(text, lang) => void}   // ✨ NEW: TTS 재생 함수 (없으면 🔊 버튼 숨김)
/>
```

**4개 호출 지점 모두 props 일치 확인 완료**:
- [TranslationCard.jsx:441](src/components/TranslationCard.jsx#L441) → `onSpeak={onSpeakText}`
- [VocabTab.jsx:198](src/components/VocabTab.jsx#L198) → `onSpeak={onSpeak}`
- [ScenePractice.jsx:142](src/components/ScenePractice.jsx#L142) → `onSpeak={onSpeak}` (ScenePracticeCard 내부 prop)
- [Library.jsx:403+](src/components/Library.jsx#L403) — TranslationCard 경유로 자동 전파

---

## 6. localStorage 신규 키

- `pronAssessHintCount` — 발음 평가 첫 3회 힌트·자동오픈용 카운터 (최대 3까지 증가 후 정지)

---

## 7. 배포 현황
- **Vercel 웹**: 3커밋 모두 main push, 자동 배포 완료
- **Render 서버**: `analyze.js` 변경 포함 → 자동 재배포 (Syllables + NBestPhonemes fallback 반영)
- **Capgo staging**: v1.4.22 → v1.4.23 → v1.4.24 순차 업로드 (Checksum 전부 로그 보존)
- **Android Capgo production**: 미반영 (staging 검증 후 사용자 요청 시 production 채널 업로드)
- **AAB 네이티브 재빌드**: 불필요 (웹번들만 변경)

---

## 8. 학습·주의사항

### Azure Speech 데이터의 언어별 비일관성
- 문서상 "Phoneme granularity 완전 지원" 언어도 실제로는 빈 문자열 반환 가능
- 특히 카타카나 외래어는 단일 엔트리만 반환하는 경향 (음절 분석 생략)
- **폴백 체인 필수** — 단일 포인트 의존 금지

### props 일괄 추가 시 grep 3곳+ 체크
- PronunciationAssessment처럼 여러 곳에서 재사용되는 컴포넌트에 **신규 prop**을 조건부 렌더 기준으로 쓰면, 단 한 곳이라도 누락되면 그 경로만 기능 사라짐
- 4/17 개편 때 ScenePractice 누락, 사용자가 발견해서 4/18 Wave 3에서 수정 — grep 반드시 선행할 것

### CSS absolute positioning은 주변 간격에 숨은 제약
- 자식이 `position: absolute`로 돌출하면 부모 간격을 좁히기 어려움
- 작은 뱃지·인디케이터는 **inline-flow**로 두는 게 레이아웃 제어 유연
- 문제 재발 시 "absolute이면서 top/bottom 음수인 자식"을 먼저 의심할 것
