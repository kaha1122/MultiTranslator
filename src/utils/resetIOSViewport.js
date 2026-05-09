// iOS WKWebView visual viewport zoom stuck 해결 유틸
//
// 문제:
//   iOS WKWebView는 native dialog (Apple/Google/Facebook Sign In ASAuthorizationController,
//   ATT prompt, in-app browser 등) 가 dismiss될 때 또는 input focus 후 blur 시
//   visual viewport가 zoom 상태로 stuck되는 알려진 버그가 있다.
//   결과: page > viewport 상태로 "둥둥 떠다니는" 시각 회귀 + position:fixed 요소
//   (tab-nav, pseudo-element 등) 가 layout viewport에 anchor되어 화면 밖으로 밀림.
//
// 해결:
//   viewport meta를 잠깐 maximum-scale=1.0으로 lock해서 WKWebView가 visual viewport
//   를 강제로 재평가하게 만든 후, 다음 frame에 원래 meta로 복원.
//   ~16ms 동안만 lock되므로 사용자 인지 거의 없고 accessibility 영구 차단도 아님.
//
// 호출 시점:
//   - App.jsx [user] effect — auth state 변경 (logout/login/anonymous 전환) 시
//   - useAdMob.js showBanner 직후 — banner 표시 후 viewport 정리
//
// Android/Web은 platform 체크로 즉시 return → 영향 0.

export function resetIOSViewport() {
    if (typeof window === 'undefined') return;
    if (window.Capacitor?.getPlatform?.() !== 'ios') return;
    const viewport = document.querySelector('meta[name=viewport]');
    if (!viewport) return;
    const original = viewport.getAttribute('content');
    if (!original) return;
    // ~16ms 동안 scale 1.0 강제 lock — WKWebView가 visual viewport 재평가
    viewport.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
    );
    // 두 번째 frame에 원래 meta 복원 (한 번의 RAF는 너무 빨라서 WKWebView가 처리 못 할 수 있음)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            viewport.setAttribute('content', original);
        });
    });
}
