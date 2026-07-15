---
name: changes-0320
description: 2026-03-20 작업 내용 — 익명 계정 처리, AdMob 배너/보상광고, 사이드바 구독섹션, AI Coach 프롬프트 개선 등
type: project
---

# 2026-03-20 변경 사항 (v1.3.3 ~ v1.3.7 + server)

## 1. 툴바 카드 게이지 보너스 반영 (v1.3.3)

**파일**: `src/App.jsx` line ~2065

**문제**: 보상 광고 시청 후 카드 보너스(`rewardBonus.cards`)가 내부 limit 체크에는 반영됐지만, 상단 툴바 게이지 표시(x/10)에는 반영 안 됨.

**수정**:
```js
// Before
const limit = TRIAL_DAILY_CARD_LIMIT; // 10
// After
const limit = TRIAL_DAILY_CARD_LIMIT + rewardBonus.cards;
```
발음 게이지는 이미 `pronLimit = TRIAL_DAILY_PRON_LIMIT + rewardBonus.prons`로 되어 있었음.

---

## 2. 신규 Anonymous 유저 첫 방문 시 가입 유도 팝업 제외 (v1.3.4)

**파일**: `src/App.jsx` line ~135

**문제**: 매일 날짜 바뀐 첫 방문 시 "무료 계정 만드세요" 팝업이 뜨는데, 그날 처음 가입한 신규 anonymous 유저에게도 동일하게 뜨는 문제.

**원인**: `anonSignupPromptDate` localStorage가 없으면(= 첫 방문) 팝업을 띄우는 로직.

**수정**:
```js
// lastShown이 null이면 최초 방문 → 날짜만 기록하고 팝업 생략
if (!lastShown) {
  localStorage.setItem('anonSignupPromptDate', today);
  return;
}
// 날짜 바뀐 재방문만 팝업 표시
```

**적용 범위**: 웹 + Android 동일 (같은 App.jsx 코드). Android는 v1.3.4 Capgo staging 배포로 반영.

---

## 3. LandingPage Download 버튼 수정 (v1.3.5, v1.3.8)

**파일**: `src/components/LandingPage.jsx`, `src/App.jsx`

### v1.3.5: showInstall 조건 제거 실수
- 처음엔 `showInstall &&` 조건을 추가해서 PWA prompt 없으면 숨겼으나 잘못된 판단
- 이후 버튼은 항상 표시로 되돌림

### 최종 수정 (handleInstallClick):
```js
if (deferredPrompt) {
  deferredPrompt.prompt(); // PWA 설치
  ...
  return;
}
// deferredPrompt 없을 때: OS별 안내
if (isIOS) → 공유 버튼 안내
if (isAndroid) → Chrome ⋮ 메뉴 → 앱 설치 안내
else → 데스크톱 설치 아이콘 안내
```

### Footer 스크롤 팝업도 동일하게 수정:
- `showInstall &&` 조건 제거 → 항상 footer 도달 시 팝업 표시
- `useEffect` dependency에서 `showInstall` 제거

---

## 4. 설정 페이지 구독 현황 UI 수정 (v1.3.6)

**파일**: `src/App.jsx` line ~2668

**수정 1**: Trial 유저 카드/발음 usage를 한 줄에서 두 줄로 분리
```jsx
// Before: 🃏 카드: 6/10/day · 🎤 발음: 9/20/day (한 줄)
// After:
🃏 카드: 6/10/day
🎤 발음: 9/20/day  // <br/> 추가
```

**수정 2**: 업그레이드 버튼에서 ✨ 이모지 제거
```jsx
// Before: ✨ {getT(sourceLang, 'upgrade.btnLabel')}
// After: {getT(sourceLang, 'upgrade.btnLabel')}
```

---

## 5. 사이드바 구독 플랜 섹션 추가 (v1.3.6)

**파일**: `src/App.jsx` (sidebar section), `src/locales/*.json` (10개 언어)

**위치**: 기존 `구독` 단일 버튼을 대체하여 "추가 학습" 섹션과 동일한 스타일의 카드형 섹션으로 교체.

**UI 구성**:
- 섹션 제목: `nav.subscriptionTitle` (ko: "구독 플랜")
- 🌟 Pro 카드 (노란 계열): `subscription.proDesc` → "카드 무제한 · 발음 1,500회/월"
- 👑 Premium 카드 (보라 계열): `subscription.premiumDesc` → "카드 · 발음 무제한"
- 두 버튼 모두 클릭 시 UpgradeModal 오픈

**추가된 i18n 키** (10개 언어):
- `nav.subscriptionTitle`
- `subscription.pro`, `subscription.proDesc`
- `subscription.premium`, `subscription.premiumDesc`

---

## 6. AdMob 배너 광고 수정 (v1.3.7)

**파일**: `src/hooks/useAdMob.js`

**문제**: 배너 광고가 한 번도 표시되지 않음.

**원인**: `showBanner`를 TOP/BOTTOM 두 번 호출했는데, 플러그인 내부에서 두 번째 호출 시 첫 번째 배너를 제거한 후 두 번째 배너 생성 시도 → 실패 → 아무것도 안 보임.

**수정**:
- 하단 배너 하나만 운영 (`BannerAdPosition.BOTTOM_CENTER`)
- `setOffset` 호출을 `showBanner` 직후 → `BannerAdPluginEvents.Loaded` 이벤트 핸들러 안으로 이동 (실제 로드 완료 후 레이아웃 조정)
- 리스너 핸들을 배열로 관리하여 cleanup 시 정확히 제거 (누수 방지)
- `--admob-top` CSS 변수는 항상 0px, `--admob-bottom`만 조정

**현재 AD_UNITS** (`IS_TESTING = true`):
```js
bannerBottom:  'ca-app-pub-3940256099942544/6300978111' // Test
// Production:
bannerBottom:  'ca-app-pub-8626604652301297/4166267528' // Banner02
```

---

## 7. AI Pro Coach 프롬프트 개선 (server)

**파일**: `server/routes/analyze.js` - `generateCoachingTip()`

**문제**: 중국어 "电影(diànying)" 발음 평가 후 코치 팁에서 "电影" 대신 번역어 "영화"를 사용함.

**원인**: 프롬프트에 원문 단어를 그대로 쓰라는 규칙이 없었음.

**수정 1 - 프롬프트 Rule 1 강화**:
```
Write the entire tip in ${targetLangName}. However, when referring to
specific words or phonemes, ALWAYS use the ORIGINAL script/characters
(e.g., write "电影" or "diànyǐng", NEVER translate them into
${targetLangName} equivalents like "영화" or "movie").
```

**수정 2 - 음소 데이터 프롬프트 포함**:
```js
// Before: - "电影": Accuracy 66, Error: Mispronunciation
// After:  - "电影": Accuracy 66, Error: Mispronunciation
//           [phonemes: d(90), j(72), a(80), n(85), j(45), i(38), ŋ(70)]
```
→ Gemini가 어떤 음소가 약한지 구체적으로 파악 가능

**수정 3 - 언어 맵 보완**:
- `vi` (Vietnamese) 추가
- fallback `'Korean'` → `'English'` 변경
- `sourceLangCode` 전체 매칭 우선 후 `-` 앞 코드 fallback

---

## 버전 히스토리 (이번 세션)

| 버전 | 내용 |
|------|------|
| v1.3.3 | 카드 게이지 rewardBonus.cards 반영 |
| v1.3.4 | 신규 anonymous 첫 방문 팝업 제외 |
| v1.3.5 | Download 버튼 수정 (1차) |
| v1.3.6 | 구독 사이드바 섹션, 설정 페이지 UI 수정 |
| v1.3.7 | AdMob 배너 단일 운영으로 수정 |
| server | AI Coach 프롬프트 원문 보존 + 음소 데이터 + 언어맵 |

## Capgo 배포 방법 (확립된 플로우)

```bash
# API key는 ~/.capgo 에 저장됨: 0a03a6f5-7ddc-4862-aba3-f62ebf89eec3
node "/c/Users/User/AppData/Roaming/npm/node_modules/@capgo/cli/dist/index.js" \
  bundle upload com.arigems.pronunfit \
  --channel staging --bundle 1.x.x --path ./dist \
  -a 0a03a6f5-7ddc-4862-aba3-f62ebf89eec3
```
- `capgo` 전역 명령어는 bash에서 shim 오류로 직접 node 실행 필요
- `--bundle` 플래그로 버전 지정 (package.json과 맞춰야 함)
