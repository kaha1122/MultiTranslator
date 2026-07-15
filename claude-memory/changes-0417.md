---
name: changes-0417
description: 2026-04-17 변경 — LearningGauge 난이도라벨 버그수정 / Translate 탭 AI 자동 입력언어 감지+38개 언어+sourceLang 부가번역 / Tip 언어 모순 수정 / 모든 카드에 모국어 번역 + placeholder i18n / Trial 한도팝업 네이티브 리워드 안내 / Listening 대화 A/B 여-남 voice 교차 (Azure SSML 다중 voice)
type: project
originSessionId: 3e6e168e-bb68-44ce-83d6-9ce816577575
---
**Why:** Translate 탭을 "진짜 38개 언어 번역기"로 재탄생시키는 동시에, Listening 대화를 실제 역할 대화처럼 체감되게 만들고, 무료 체험 한도 도달 시 리워드 버튼 노출을 강화해 수익·학습 UX 동시에 개선. 커밋 6개, main push 3회, Render 재배포 1회 포함.

**How to apply:**
- Translate 탭 관련 이슈(입력 언어·카드 구성·프롬프트 language rule) 대응 시 이 파일부터 확인. 특히 프롬프트의 "하드코딩된 언어 금지 문구"가 sourceLang과 충돌했던 경험(Tip이 첫 target 언어로 잘못 작성) 재발 방지.
- Listening 대화 voice 관련 수정 시 server/routes/tts.js의 `{voiceFemale, voiceMale, styles}` 구조와 `turns`/`dialogueSeed` 인터페이스 계약을 그대로 유지. 같은 `dialogueSeed`는 항상 같은 배치 보장 필요.
- Trial 한도 메시지 변경 시 네이티브/웹 분기(`window.Capacitor?.isNativePlatform?.()`)를 유지 — 웹에는 아직 "추가 학습" 섹션이 없음.

---

## 1. LearningGauge 난이도 라벨 버그 — `scene.diffHigh` → `scene.diffAdvanced` (commit 7864570)

### 증상
통계 탭([LearningGauge.jsx:222](src/components/LearningGauge.jsx#L222))에서 "고급" 난이도 버튼 라벨이 "scene.diffHigh" 키 문자열 그대로 노출됨.

### 원인
`advanced` → `'High'`로 잘못 매핑해 존재하지 않는 i18n 키 `scene.diffHigh`를 요청 → fallback으로 키 문자열 표시.

### 수정
다른 5곳([App.jsx:3178](src/App.jsx#L3178), [ScenePractice.jsx:508](src/components/ScenePractice.jsx#L508), [Library.jsx:257](src/components/Library.jsx#L257), [ListeningTab.jsx:375](src/components/ListeningTab.jsx#L375), [VocabTab.jsx:453](src/components/VocabTab.jsx#L453))과 동일 패턴 `charAt(0).toUpperCase() + slice(1)` 사용.

### 교훈
"같은 목적 코드가 여러 곳에 분산"되어 있을 때 하나만 비정상으로 남을 수 있음. 변경 시 grep으로 같은 로직 전파 확인 필수.

---

## 2. Translate 탭 전면 개편 — AI 자동감지 + 38개 언어 + sourceLang 부가번역 (commit 3b588bd, d9fdf1c, 3564c54)

### 2.1 핵심 변경: inputLang 수동 선택 UI 전면 제거

**제거 내역** [App.jsx](src/App.jsx):
- `inputLang` state/setInputLang + localStorage(`inputLang` 키)
- "input-lang-selector" 버튼 UI ([2724-2752](src/App.jsx#L2724))
- `inputLang` 리셋 useEffect
- Video→Translate `setInputLang(langCode)` 호출
- 프롬프트 `Input text language: ${inputLangName}` 줄

**대체 스키마**: AI가 `detectedLang` 반환 → 3 케이스 분기

### 2.2 3 케이스 분기 로직

| 케이스 | 조건 | 렌더 카드 순서 | 감지 카드 부가 표시 |
|---|---|---|---|
| **A** | detected = sourceLang | targetLangs | 없음 (모국어) |
| **B** | detected ∈ targetLangs | targetLangs | 감지 카드 밑에 sourceLang 번역 |
| **C** | detected ∉ {sourceLang, ...targetLangs}, 38개 중 하나 | **[detected, ...targetLangs]** (맨 앞) | 감지 카드 밑에 sourceLang 번역 |
| **폴백** | detected = "other" (숫자/이모지/식별불가) | targetLangs | 없음 + 상단 노란 배너 |

클라이언트 판정 ([App.jsx:1497-1508](src/App.jsx#L1497)):
```js
const rawDetected = (result.detectedLang || '').trim();
const detectedIsValid = rawDetected && rawDetected !== 'other' && supportedCodes.includes(rawDetected);
const isNative = !detectedIsValid || rawDetected === sourceLang;
const inTargets = detectedIsValid && targetLangs.includes(rawDetected);
const isCaseC = detectedIsValid && !isNative && !inTargets;
```

### 2.3 Gemini 프롬프트 재작성 (App.jsx:handleTranslate)

추가 Task:
- **Task 0 (신규)**: `detectedLang` 반환 — 38개 코드 중 하나 또는 `"other"`
- **Task 7 (신규, 조건부)**: `detectedLang !== sourceLang`이면 `sourceTranslation` top-level 필드로 번역 반환
- **Task 8 (신규, 조건부)**: 케이스 C일 때 `detectedLangData: {translation=원문, pronunciation}` + `detectedLangTip: [...]` 반환

### 2.4 Tip 언어 모순 수정 (commit d9fdf1c) — 중요

**증상**: 한국어 모국어 + 영·일·불 target에서 아랍어 입력했더니 모든 카드의 Tip이 일본어로 작성됨.

**원인** ([App.jsx:1421 원래](src/App.jsx#L1421)):
```
Every string MUST be written in ${sourceLangName}.
Do not use any other language for tips — not English, not French, not Korean.   ← 하드코딩
Only ${sourceLangName}.
```
`${sourceLangName}=한국어`일 때 "한국어로 써라" + "한국어 쓰지 말라" **자기모순** → AI 혼란 → 첫 target(일본어)로 폴백.

**수정**: 하드코딩 목록 제거, 다음으로 재작성:
```
CRITICAL LANGUAGE RULE: Every tip string MUST be written in ${sourceLangName}
(language code "${sourceLang}"), because ${sourceLangName} is the user's native
language and the only language they read fluently.
Do NOT write tips in any target language. Do NOT mix languages within a tip.
If you are unsure, default to ${sourceLangName}.
```

**교훈**: 프롬프트에 하드코딩된 언어명·코드 금지. 항상 `${sourceLang}`/`${sourceLangName}` 변수로.

### 2.5 모든 카드에 sourceLang 번역 부가 표시 (commit 3564c54)

**범위 확장**: 초기엔 "감지 카드에만" 표시했지만, 사용자 요청으로 **모국어 카드 제외 모든 카드**에 표시 (학습/저장 용도).

**케이스별 값**:
- 케이스 A: `sourceTranslation = inputText` (입력 자체가 모국어 번역)
- 케이스 B/C: `result.sourceTranslation` (Gemini 반환)
- 폴백: 빈 값

**렌더 조건**: `langCode !== sourceLang && sourceTranslation`

**Firestore 저장** ([App.jsx:1630 부근](src/App.jsx#L1630)):
```js
cardData.sourceTranslation = (langCode !== sourceLang && sourceTranslation) ? sourceTranslation : '';
```

**Library 복원** ([Library.jsx:410 부근](src/components/Library.jsx#L410)): `sourceTranslation={card.sourceTranslation || ''}` 전달 → 기존 카드는 빈 값으로 안전.

### 2.6 TranslationCard 확장 ([TranslationCard.jsx](src/components/TranslationCard.jsx))
- prop `sourceTranslation` 추가
- `.translated-text` 바로 아래 조건부 `<p className="source-translation-text font-${sourceLangCode}">` 렌더
- CSS: 회색 `#6b7280`, 좌측 3px 보더 `#e5e7eb`, 폰트 0.95rem

### 2.7 Placeholder i18n (commit 3564c54)
- textarea `"Enter text to translate"` → `t('translate.placeholder')`
- 10개 locale: `translate.placeholder` 키 추가, 한국어 예: "번역할 문장을 입력하세요 (38개 언어 지원)"
- 영어: "Enter text to translate (38 languages supported)"

### 2.8 감지 실패 배너
- [App.jsx:2820](src/App.jsx#L2820) 근처에 `detectionFailed` state 기반 조건부 배너
- 문구: `translate.detectionFailed` — 한국어 예: "입력 언어를 감지하지 못해 기본 번역만 수행했습니다. 오타가 없는지 확인해 보세요."
- 10개 locale 전부 번역 완료
- `rawDetected === 'other'` 일 때만 표시 (진짜 지원밖 언어는 거의 해당 없음 — 38개 커버)

### 2.9 Firestore 스키마 호환성
- `cardData.inputLang` 필드에 `detectedLang || sourceLang` 주입 — 기존 필드명 유지 (Library/필터 호환)
- `cardData.sourceTranslation` 신규 필드 (기존 카드는 없음 → `|| ''` fallback)

### 2.10 Render 서버 변경 불필요
[server/routes/translate.js](server/routes/translate.js)는 `prompt` 문자열을 그대로 Gemini에 전달하는 passthrough → 클라이언트 프롬프트 변경만으로 새 동작 실현.

---

## 3. Trial 한도 팝업 — 네이티브 앱에서 사이드바 리워드 버튼 안내 (commit 7bd8eab)

### 배경
Trial 사용자가 하루 한도(카드 10개, 발음 20회) 도달 시 [TrialLimitModal](src/components/TrialLimitModal.jsx)이 뜸. 기존 메시지 "내일 다시 만나요!" 대신 **네이티브 앱에서는** "+5 카드 / +10 발음" 리워드 광고 버튼 안내로 교체.

### 제약
[App.jsx:2392](src/App.jsx#L2392)의 "추가 학습" 섹션은 `tier === 'trial' && window.Capacitor?.isNativePlatform?.()` 조건 → **네이티브에서만** 렌더. 웹에는 존재하지 않음 → 웹에서는 기존 메시지 유지.

### 구현
- `trial.seeSidebarReward` 10개 언어 i18n 신규 (예: "더 학습을 원하시면, 사이드바의 +5 카드 / +10 발음 버튼을 활용하세요")
- [TrialLimitModal.jsx](src/components/TrialLimitModal.jsx) 내부에서 `window.Capacitor?.isNativePlatform?.()` 감지 → `messageKey = isNative ? 'trial.seeSidebarReward' : 'trial.seeYouTomorrow'`
- 긴 문장 대응: 네이티브일 때 `fontSize: '0.82rem'`, `wordBreak: 'keep-all'`, `lineHeight: 1.45`, `margin: '6px 0 0'`

### 다른 구성 요소는 그대로
🎯 아이콘, `trial.limitTitle`, `trial.limitDesc`, 🃏/🎤 사용량 배지, ✨ `trial.upgradeBtn` — 변경 없음.

---

## 4. Listening 대화 모드 — A/B 턴을 여성/남성 voice로 교차 재생 (commit 4245bc4)

### 설계 결정 과정
- 사용자가 "A=여자, B=남자"로 구분 원함 → 최종 구현은 **안 B: 대화 생성 시 deterministic 스왑**
- Random on generation (같은 대화는 항상 같은 배치, 새 대화 Generate 시 해시 변화로 재결정)
- 3인 이상 대화 불가능 여부 확인: [server/routes/listening.js:45](server/routes/listening.js#L45)에서 프롬프트가 "2 people (Speaker A and Speaker B)"로 고정 → A/B만 처리하면 충분

### Azure Neural voice 38개 언어 남/녀 매핑 조사 완료
기존 voice(여성) + 남성 쌍 조사 (learn.microsoft.com 문서 기반). 38개 전부 남성 voice 존재 확인:
- en: Jenny/**Guy**, ko: SunHi/**InJoon**, ja: Nanami/**Keita**, zh-CN: Xiaoxiao/**Yunxi**
- sw: Zuri/**Rafiki**, th: Premwadee/**Niwat**, uk: Polina/**Ostap** 등 전부 대응
- 폴백(pitch shift) 불필요

### 서버 변경 ([server/routes/tts.js](server/routes/tts.js))

**Voice map 구조 변경**: `{voice, styles}` → `{voiceFemale, voiceMale, styles}`
```js
'en': { voiceFemale: 'en-US-JennyNeural', voiceMale: 'en-US-GuyNeural', styles: ['chat','cheerful',...] }
```

**`/api/azure-tts` body 확장**:
- `turns: [{speaker: 'A'|'B', text: string}]` — 신규, 있으면 다중 voice SSML
- `dialogueSeed: string` — 해시 seed (대화 단위 일관성)
- `text`, `langCode`, `emotion`, `byokAzureKey`, `byokAzureRegion` — 기존 유지

**로직 분기**:
- `turns` 있음 → `simpleHash(dialogueSeed) % 2 === 1`이면 `A=male, B=female`, 아니면 반대. 턴별 `<voice xml:lang='...' name='...'>` 태그 연속. `emotion` 스타일은 각 턴 `<mstts:express-as>`에 중첩.
- `turns` 없음 → 기존 단일 voice 경로 (voiceFemale 기본) — Translate/Scene/Vocab/에세이 등 **모든 기존 호출 하위호환**.

**헬퍼**:
```js
const simpleHash = (str) => {
    let h = 0;
    for (let i = 0; i < String(str || '').length; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
};
```

### 클라이언트 변경 ([ListeningTab.jsx](src/components/ListeningTab.jsx))

**신규 헬퍼**:
- `parseDialogueTurns(text)`: `"A: ..."` 라인 배열로 파싱. 프리픽스 없는 줄은 직전 턴에 이어붙임.
- `extractSpeaker(line)`: 단일 라인에서 speaker/text 분리.
- `simpleHashString(str)`: 서버와 동일한 해시 규칙.

**전체 대화 재생** ([handlePassagePlay:143 부근](src/components/ListeningTab.jsx#L143)):
```js
const isDialogue = passageType === 'dialogue';
const dialogueTurns = isDialogue ? parseDialogueTurns(passage.text) : [];
const hasTurns = dialogueTurns.length > 0;
const dialogueSeed = hasTurns ? simpleHashString(passage.text) : null;

body: hasTurns
    ? { turns: dialogueTurns, dialogueSeed, langCode: selectedLang }
    : { text: ttsText, langCode: selectedLang }
```

**개별 문장 재생** (`playSentence` 신규 — 문장 클릭 핸들러):
- 대화 모드 + A:/B: 프리픽스 감지 시 → `turns: [{speaker, text}], dialogueSeed=hash(passage.text)` 단일 턴 요청
- 같은 dialogueSeed 덕에 **전체 재생과 동일한 성별 배치 유지**
- 파싱 실패 시 기존 `onSpeak` 폴백

**`cleanDialogueForTTS`**: 단일 voice 폴백용으로만 유지.

### 동작 시나리오
1. Listening 탭 → 대화 토글 → Generate → 대화 지문 생성 (A:/B: 포맷)
2. ▶️ 전체 재생: A 턴 → 여성(또는 남성, 해시 결과), B 턴 → 반대 voice 교차
3. 개별 문장 클릭: 해당 화자의 동일 voice 재생
4. 같은 대화 반복/루프 재생: 항상 같은 배치 유지 (deterministic)
5. Generate 재호출로 새 지문 → 새 해시 → 성별 재배치 가능

### Scene 탭 — 이번 스코프 제외
사용자 확인: Scene의 Response/Answer 카드는 각자 독립 재생 버튼을 갖는 구조 (Listening의 연속 재생과 다름). 사용자 판단에 따라 **Listening 먼저, Scene은 나중**으로 연기.

### 배포
- Vercel main push 완료
- Render `server/routes/tts.js` 변경 → 자동 재배포 감지됨
- Android Capgo OTA: 필요 시 다음 단계 (native 코드 변경 없음, 웹번들만)

---

## 5. 메시지·프롬프트 아키텍처 메모

### 프롬프트 Task 번호 현황 ([App.jsx](src/App.jsx) handleTranslate)
- Task 0: Language Detection (신규)
- Task 1: Translation
- Task 2: Input Type (word/sentence)
- Task 3: Educational Tips (언어 규칙 강화)
- Task 4: Pronunciation (기존 "others: Romanization" 규칙이 38개 전부 커버)
- Task 5: Difficulty Classification
- Task 6: Example Sentence (word only)
- Task 7: Source-Side Translation (조건부, 신규)
- Task 8: Detected-Language Extra Card (조건부, 신규)

### i18n 키 추가 내역
- `translate.placeholder` (10개) — 입력창 안내
- `translate.detectionFailed` (10개) — 감지 실패 배너
- `trial.seeSidebarReward` (10개) — 네이티브 한도 팝업

### Firestore savedCards 스키마 추가
- `sourceTranslation` (string, 기본 '') — 모든 translation 카드에 포함 (기존 카드 호환: `|| ''` fallback)

---

## 6. 배포 현황
- **Vercel 웹**: 6개 커밋 모두 main push, 자동 배포 완료
- **Render 서버**: `server/routes/tts.js` 변경 포함 커밋 push → 자동 재배포 완료
- **Android Capgo OTA / AAB**: 이번 세션에서 수행 안 함, 필요 시 다음 단계

## 7. 테스트 권장 항목
1. Translate A/B/C/폴백 4시나리오 — 각 카드 밑 sourceLang 번역 부가, 감지 배너 동작
2. Tip이 모국어로 작성되는지 (아랍어·태국어 등 드문 언어 포함)
3. Library 재진입 시 저장된 sourceTranslation 복원
4. Listening 에세이 회귀 — 여성 단일 voice 정상
5. Listening 대화 — 전체/개별/루프 재생 시 A/B 배치 일관성
6. Trial 한도 팝업 (네이티브 앱) — 새 메시지 표시
7. Gauge "고급" 라벨 정상 노출
