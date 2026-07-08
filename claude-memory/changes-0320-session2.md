---
name: changes-0320-session2
description: 2026-03-20 2차 세션 — AdMob 광고 완성, 익명계정 뮤텍스, 웹앱 anonymous 복원, PWA 설치, i18n 보완 (v1.3.15~v1.3.21)
type: project
---

# 2026-03-20 2차 세션 변경 사항 (v1.3.15 ~ v1.3.21)

## 1. AdMob 배너 디버그 alert() 제거 (v1.3.15)

**파일**: `src/hooks/useAdMob.js`

- `FailedToLoad`, `showBanner 완료`, `초기화/배너 실패` 세 곳의 `alert()` 제거
- `BannerAdSize.BANNER` → `BannerAdSize.ADAPTIVE_BANNER` 변경 (전체 너비)
- **참고**: 테스트 광고(`isTesting: true`)는 항상 고정 320×50 크기 반환 → Production에서만 전체 너비 표시

---

## 2. Pro/Premium 유저 배너 광고 제외 (v1.3.16)

**파일**: `src/hooks/useAdMob.js`, `src/App.jsx`

```js
// useAdMob(tier) — tier가 pro/premium이면 배너 스킵
export const useAdMob = (tier) => {
    useEffect(() => {
        if (!isNativePlatform() || initialized.current) return;
        if (tier === 'pro' || tier === 'premium') return;
        ...
    });
};

// App.jsx
useAdMob(tier);
```

---

## 3. 인터스티셜 전면광고 추가 (v1.3.17)

**파일**: `src/hooks/useAdMob.js`, `src/App.jsx`

**Production adId**: `ca-app-pub-8626604652301297/6443880844` (Interstitial01)
**Test adId**: `ca-app-pub-3940256099942544/1033173712`

```js
// AD_UNITS에 interstitial 추가
// showInterstitialAd() 함수 export

// App.jsx: triggerInterstitialOnSave()
// - Trial 유저만 (pro/premium 제외)
// - localStorage 'interstitialSaveCount' 카운터
// - 5회 저장마다 인터스티셜 표시, 카운터 리셋
// - saveToFirebase, saveVideoCard, saveSceneCard, saveVocabCard 모두 적용
```

---

## 4. "광고 없음" 뱃지 추가 (v1.3.18)

**파일**: `src/App.jsx` (사이드바), `src/components/UpgradeModal.jsx`, `src/locales/*.json`

- 사이드바 Pro 카드 우측: 황색 뱃지 `{getT(sourceLang, 'subscription.noAds')}`
- 사이드바 Premium 카드 우측: 보라 뱃지
- UpgradeModal featureKeys에 `'upgrade.noAds'` 추가 (Pro/Premium 모두)
- 10개 언어 i18n: `subscription.noAds`, `upgrade.noAds`

---

## 5. 익명 계정 중복 생성 뮤텍스 추가 (v1.3.19)

**파일**: `src/context/AuthContext.jsx`

**문제**: `onAuthStateChanged`가 null로 여러 번 동시 호출될 때 async callback이 겹쳐 여러 anonymous 계정 생성 가능

**수정**:
```js
let anonSignInInProgress = false;

// signInAnonymously 직전:
if (anonSignInInProgress) return;
anonSignInInProgress = true;
try {
    await signInAnonymously(auth);
} finally {
    anonSignInInProgress = false;
}
```

**사이드바 광고 가림 수정**: `src/App.css`
```css
.sidebar {
    padding-bottom: var(--admob-bottom, 0px);
}
```

---

## 6. 웹앱 anonymous 복원 수정 (v1.3.20)

**파일**: `src/App.jsx`

**문제**: `showLanding = useState(true)` → 브라우저 닫고 재방문 시 Firebase가 anonymous 유저 복원해도 항상 랜딩페이지 표시

**수정**:
```js
// 앱 진입 시 localStorage 플래그 저장
const [showLanding, setShowLanding] = useState(
    () => localStorage.getItem('webAppEntered') !== '1'
);

// "무료로 시작하기" 클릭 시:
onStartFree={() => { localStorage.setItem('webAppEntered', '1'); setShowLanding(false); }}

// 로그아웃 시 플래그 제거:
localStorage.removeItem('webAppEntered');
```

**PWA manifest maskable 추가**: `public/manifest.json`
- icon-192.png, icon-512.png에 `"purpose": "any maskable"` 추가
- → Chrome `beforeinstallprompt` 발생 조건 충족 → Download 버튼 정상 작동

---

## 7. i18n install 안내 메시지 등록 (v1.3.21)

**파일**: `src/locales/*.json` (10개 언어), `src/App.jsx`

```js
// Before (하드코딩):
alert('앱으로 설치하려면:\nChrome 주소창 우측 ⋮ 메뉴 ...');

// After (i18n):
alert(getT(sourceLang, 'install.android'));
```

**추가된 키**: `install.ios`, `install.android`, `install.desktop` (10개 언어)

---

## 8. PWA 아이콘 잘림 수정

**파일**: `public/manifest.json`

**문제**: `"purpose": "any maskable"` → Chrome이 maskable 적용 시 중앙 80%만 표시 → 아이콘 잘림

**수정**: `"purpose": "any"`로 복원 (install prompt는 이미 정상 작동 확인됨)

---

## 버전 히스토리 (이번 세션)

| 버전 | 내용 |
|------|------|
| v1.3.15 | alert() 제거, ADAPTIVE_BANNER |
| v1.3.16 | Pro/Premium 배너 광고 제외 |
| v1.3.17 | 인터스티셜 광고 (카드 5장마다) |
| v1.3.18 | "광고 없음" 뱃지 사이드바+UpgradeModal |
| v1.3.19 | anonSignInInProgress 뮤텍스, 사이드바 padding-bottom |
| v1.3.20 | 웹앱 anonymous 복원, PWA maskable |
| v1.3.21 | install i18n 10개 언어, git push |
| hotfix | PWA 아이콘 잘림 → maskable 제거 |

## AdMob 현재 상태

```js
IS_TESTING = true // TODO: 실 광고 전환 시 false로 변경

AD_UNITS (production):
  bannerBottom:  'ca-app-pub-8626604652301297/4166267528'
  rewardedCards: 'ca-app-pub-8626604652301297/4860569967'
  rewardedProns: 'ca-app-pub-8626604652301297/4166267528'
  interstitial:  'ca-app-pub-8626604652301297/6443880844'
```

## 테스트 기기 정책
- AdMob 콘솔에 등록된 테스트 기기는 Production adId 사용 시에도 테스트 광고 표시
- IS_TESTING=false 전환 후 본인 폰에서도 테스트 광고 확인 가능
