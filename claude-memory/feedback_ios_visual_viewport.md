---
name: iOS WKWebView visual viewport zoom stuck — 차단 + 회복 양쪽 필요
description: iOS Safari/WKWebView가 input focus 또는 native dialog dismiss 후 visual viewport zoom 1.0 복귀 안 되는 알려진 버그. position:fixed 요소들이 layout viewport에 anchor되어 "사라진 것처럼" 보이는 시각 회귀 일괄 발생.
type: feedback
originSessionId: 2c4f1767-d455-4e57-a50b-05e2c2d8c72e
---
# iOS WKWebView visual viewport zoom stuck

iOS Safari/WKWebView는 다음 트리거 후 visual viewport가 zoom 상태로 stuck되어 자동 1.0 복귀 안 됨:

**트리거**:
1. `<input>` / `<textarea>` / `<select>` focus 시 font-size < 16px
2. Native dialog dismiss — Apple Sign In `ASAuthorizationController`, Google Sign In, Facebook SDK, ATT prompt, in-app browser 등

**Why**: iOS WebKit의 알려진 버그. WKWebView가 visual viewport 자동 reset 안 함.

**증상**:
- 화면이 더 크게 보이고 page > viewport 상태로 pan/swing 가능 ("둥둥 떠다님")
- `position:fixed` 요소(tab-nav, pseudo-element 등)는 **layout viewport**에 anchor → visual viewport 밖으로 밀려 화면에서 사라진 것처럼 보임
- Native overlay (AdMob banner 등)는 screen 좌표라 그대로 → 모든 web 요소를 가린 것처럼 보임
- Visually: tab-nav, 흰색 safe-area cover 사라짐 / native ad가 화면 전체를 덮은 것처럼

**How to apply**:

두 가지 조합으로 차단 + 회복:

### (1) 차단 — iOS 한정 input 16px floor (App.css)
```css
html.platform-ios input,
html.platform-ios textarea,
html.platform-ios select {
  font-size: max(16px, 1em);
}
```
Specificity 0,0,1,2 → 일반 `.foo input { font-size: 0.9rem }` (0,0,1,1) override. `!important` 불필요.
Android/Web은 `.platform-ios` 클래스 미부여 → 자동 차단.

### (2) 회복 — viewport meta 강제 reset (src/utils/resetIOSViewport.js)
```js
export function resetIOSViewport() {
    if (window.Capacitor?.getPlatform?.() !== 'ios') return;
    const viewport = document.querySelector('meta[name=viewport]');
    if (!viewport) return;
    const original = viewport.getAttribute('content');
    viewport.setAttribute('content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            viewport.setAttribute('content', original);
        });
    });
}
```
~16ms (2 RAF)간만 lock → 사용자 인지·accessibility 영향 거의 없음.

호출 지점:
- `App.jsx`: `useEffect(() => { resetIOSViewport(); }, [user])` — auth 변경 시
- `useAdMob.js`: `showBanner` 성공 직후 — banner 표시 후 viewport 정리

**디버깅 팁**:
- position:fixed 요소가 안 보이면 → layout viewport 밖으로 밀린 것일 수 있음
- 위치가 "엉뚱"하면 → zoom 상태에서 native vs web 좌표 어긋남
- viewport meta 동적으로 보거나 `window.visualViewport.scale`로 zoom 상태 확인

**히스토리**:
- 2026-05-09 사용자 보고로 발견 (Capgo v1.5.7 → v1.5.8). 처음엔 input focus만 의심해 16px floor만 적용했다가 OAuth 로그인에서도 동일 증상 발견 → resetIOSViewport 유틸 추가로 완결. 두 가지를 보완 관계로 함께 유지.
