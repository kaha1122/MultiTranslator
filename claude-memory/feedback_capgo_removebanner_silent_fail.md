---
name: Capgo plugin removeBanner는 silent 실패 가능 — _bannerShowing 가드 신뢰 금지
description: useAdMob의 cleanup이 fire-and-forget으로 호출하는 removeBanner가 race로 silent 실패하면 native banner 잔류 + JS state 불일치 발생. Pro 전환 시 광고 잔류 회귀의 근본 원인.
type: feedback
originSessionId: 2c4f1767-d455-4e57-a50b-05e2c2d8c72e
---
# Capgo removeBanner silent 실패 + _bannerShowing 가드 함정

`@capacitor-community/admob`의 `removeBanner()`는 fire-and-forget으로 호출되는 경우 race로 silent 실패할 수 있다. JS state(`_bannerShowing=false`)와 native 실제 상태(banner 잔류)가 불일치할 수 있다.

**Why**:
- React useEffect cleanup은 await 불가 → `removeBanner()`는 Promise 반환만 하고 `.catch(()=>{})`로 에러 묻힘
- Native plugin은 다른 작업(OAuth dialog, ATT prompt 등)으로 busy하면 race 발생 가능
- Logout cleanup 직후 immediately Login 같은 빠른 전환에서 특히 발생

**증상 예시** (2026-05-09 사용자 보고):
1. Anonymous Trial: `_bannerShowing=true`, native banner 표시
2. Logout: cleanup의 `removeBanner` silent 실패 → native banner 잔류, JS는 false로 reset
3. Login as Pro: Pro removal effect가 `if (isPaid && _bannerShowing)` 가드에서 SKIP (false라서) → 새 removal 안 일어남
4. **결과: Pro 사용자에게 광고가 stuck**

**How to apply**:

### Pro removal effect — 가드 제거 + retry 안전망
```js
useEffect(() => {
    if (!isNativePlatform()) return;
    if (!isReady) return;
    if (isPaid) {
        // _bannerShowing 가드 제거 — JS state vs native 불일치 가능성. 항상 시도.
        (async () => {
            if (_adMob) {
                try {
                    await _adMob.removeBanner();
                } catch {
                    // 1차 실패 시 200ms 후 재시도
                    setTimeout(() => _adMob?.removeBanner?.().catch(() => {}), 200);
                }
            }
            setOffset(false);
            _bannerShowing = false;
        })();
    }
}, [isPaid, isReady]);
```

### Trial setup cleanup — 동일 재시도 패턴
```js
return () => {
    cancelled = true;
    listenerHandles.forEach(h => h?.remove?.());
    setOffset(false);
    _bannerShowing = false;
    // React cleanup은 await 불가 — fire-and-forget + 1차 실패 시 200ms 재시도
    if (_adMob) {
        _adMob.removeBanner?.().catch(() => {
            setTimeout(() => _adMob?.removeBanner?.().catch(() => {}), 200);
        });
    }
};
```

**Pro 콜드스타트 안전성**: `_adMob` 미로드 → `if (_adMob)` false → setOffset만 호출 → 무영향.
**중복 호출 안전성**: removeBanner는 banner 없을 때 native 측에서 no-op (또는 catch로 에러 무시). 두 번 호출돼도 안전.

**일반 룰**: useAdMob의 module-level `_bannerShowing` 변수는 정확한 native 상태를 반영하지 않을 수 있다. 광고 제거가 필요한 경로에서는 가드 신뢰하지 말고 항상 시도해야 한다.

**히스토리**:
- 2026-05-09 사용자 보고 — logout → Pro 로그인 시 광고 stuck. 두 번째 logout/login 사이클에서 자력 회복(우연히 두 번째 removeBanner 성공). Capgo v1.5.9 (commit 762be42)에서 위 패턴으로 영구 fix.
- 같은 race가 발생할 수 있는 다른 transition: 다운그레이드(Pro→Trial 후 setup), 익명→실계정 전환 등. 모두 동일 패턴으로 안전망 작동.
