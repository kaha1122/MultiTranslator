---
name: changes-0607
description: 2026-06-07 Android 광고 사라짐 fix v1.5.98 + Production APK logcat 진단법 확립 + 별건 의심 3건 보류
metadata: 
  node_type: memory
  type: project
  originSessionId: f2b857c4-904d-4e12-9027-909755c30066
---

# 2026-06-07 Android 광고 사라짐 fix + 진단법 + 잔존 의심 3건

## 1. 증상 & 가설 정렬

사용자 보고: Android 폰에서 평소 사용 중 갑자기 하단 배너 광고가 사라지고 하단 탭바가 화면 맨 아래로 붙음. 일정 시간 후 자연 복귀(때로는 앱 종료까지 안 옴). iOS 발열 fix 이후 빈도 증가 의심.

초기 가설 4개:
1. 인터스티셜 후 `resumeBanner` 누락 (v1.5.66 hideBanner/resumeBanner race)
2. **`FailedToLoad` → `setOffset(false)` 즉시 호출로 CSS layout collapse** ⭐
3. v1.5.83 `AuthContext.Provider` useMemo deps 문제 → cleanup 발화
4. v1.5.80 `data-app-idle` CSS 가드 충돌

## 2. 진단 — Production APK에서 logcat 캡처

핵심 발견: **Production APK는 Chrome DevTools inspect 불가** (`android:debuggable=false`). 하지만 **logcat은 debuggable 여부와 무관**하게 시스템 로그를 보여줌 → AdMob SDK native 로그로 간접 진단 가능.

### 운영 명령 (PowerShell + adb)
```powershell
adb logcat -c
adb logcat -v threadtime *:S Ads:V Capacitor:V Chromium:V `
  | Tee-Object -FilePath "$HOME\Desktop\admob-watch.log"
```

또는 Android Studio Logcat 필터바:
```
package:com.arigems.pronunfit | tag:Ads
```

### 결정적 증거 (23:43:34 ~ 23:44:42, 66초 사라짐 잡힘)

정상 패턴:
```
[t]      setTestDeviceIds (요청 시작)
[t+0.2]  Received log <Google:HTML> + SDK version + HTTP timeout
[t+2~3]  canOpenAppGmsgHandler disabled x4 (creative 렌더 완료)
```

**비정상 (23:43:34)**:
```
23:43:34.256  setTestDeviceIds                   ← 요청 시작
23:43:34.477  SDK version
23:43:34.480  HTTP timeout
              ❌ Received log 없음 / canOpenAppGmsgHandler 없음
              ⏳ 66초 침묵
23:44:40.736  setTestDeviceIds                   ← SDK 자동 재시도
23:44:42.536  canOpenAppGmsgHandler disabled x4 ← 정상 렌더 복귀
```

→ 23:43:34 요청 실패(FailedToLoad) → 우리 listener가 즉시 `setOffset(false)` → CSS `.admob-active` class 제거 → 광고 자리 collapse → 66초 후 SDK 자동 재시도 성공 시 자연 복귀.

**JS console.error는 Capacitor release 빌드에서 logcat forward 안 됨** — `console.error('[AdMob Banner] FailedToLoad:', ...)` 직접 안 보이지만 SDK native 로그 패턴(요청 → 응답 없음 → 재시도)으로 충분히 확정.

## 3. Fix — v1.5.98 (commit cce2dfe)

[src/hooks/useAdMob.js](src/hooks/useAdMob.js) FailedToLoad threshold 도입:

```js
let _consecutiveFailures = 0;
const FAIL_THRESHOLD = 3;

// FailedToLoad: 카운터 증가, 3회 미만이면 CSS 유지
listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.FailedToLoad, (e) => {
    _consecutiveFailures++;
    console.error(`[AdMob Banner] FailedToLoad (${_consecutiveFailures}/${FAIL_THRESHOLD}):`, JSON.stringify(e));
    if (_consecutiveFailures >= FAIL_THRESHOLD) {
        setOffset(false);
    }
}));

// SizeChanged + Loaded: 카운터 reset + offset 복원
listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
    _consecutiveFailures = 0;
    setOffset(info?.height || DEFAULT_BANNER_HEIGHT);
}));
listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.Loaded, () => {
    _consecutiveFailures = 0;
    setOffset(DEFAULT_BANNER_HEIGHT);
}));
```

**효과**:
- 1-2회 일시 실패: CSS layout 유지 → 사용자 인지 0 → 다음 갱신 자연 복귀
- 3회 연속(약 6분 — auto-refresh 120s × 3): 진짜 장애 신호로 보고 setOffset(false)

**배포**: Capgo production OTA 즉시 (사용자 명시 요청 — staging 우회). SHA256 `ddf44c54...`. 채널 currentBundle 검증 완료.

## 4. 별건으로 분리 — 잔존 의심 3건

같은 진단 세션에서 발견했으나 v1.5.98 fix 범위 밖이라 **별건 보류**:

### A. PronunFit 프로세스 8분마다 죽음 — 비정상
25분 logcat에서 PID 3개 관찰: 21763 → 28522 (23:23:48~23:24:06 사이 죽음) → 2733 (23:26:11~23:31:10 사이 죽음). 평균 수명 8분. 매우 비정상.
- 가능 원인: 메모리 압박 / v1.5.86 lazy mount 영향 / Capacitor 8 회귀 / Android 절전
- 별도 조사 필요 (Android Profiler / 메모리 프로필링)
- v1.5.98과 무관

### B. 앱 백지 화면 (2026-06-07 00:02~04)
스크린샷: 메인 콘텐츠 영역 완전 백지, 하단 탭바만 살아있음. 사용자가 발열 fix shutdown 영향 의심.
- 사용자 확인: **폰 발열 0** — OS thermal throttling 가설 기각
- 로그에서 본 것: PronunFit WebView 내부 DNS 선택적 실패 (gms 프로세스는 같은 hostname 정상 응답, 우리 앱 WebView만 fetch 실패)
- 후보 원인: Android App Standby Bucket이 `rare`/`restricted` → 네트워크 throttle / 데이터 절약 모드 / 배터리 최적화 제한
- 사용자 폰 측 **설정 → 앱 → PronunFit → 배터리 → 백그라운드 사용 제한** 확인 필요 (대기 중)

### C. DNS 선택적 실패 (`Unable to resolve host "googleads.g.doubleclick.net"`)
같은 hostname을 gms는 resolve 성공, 우리 앱 WebView만 실패. JS Uncaught TypeError: Failed to fetch lidar.js.
- AdMob tracking ping pa=1~5 모두 DNS 실패
- 우리 코드 산물 아님 (JS는 네이티브 네트워크 stack 못 건드림)
- App Standby 또는 OS-level network policy 의심
- 재발 시 재논의 보류

## 5. 노이즈 분류 (반복 등장 — 무시해도 됨)

| 로그 | 의미 | 액션 |
|---|---|---|
| `Received log message: <Google:HTML> ... SDK ... out of date` | @capacitor-community/admob 8.0.0이 끌어오는 play-services-ads 버전 구식. 모든 ad 요청마다 등장 | 다음 AAB 빌드 시 plugin 최신 버전 검토 ([[pending-aab-fixes]] 추가 권고) |
| `canOpenAppGmsgHandler disabled x4` | 광고 creative의 "이 앱이 deep-link 열 수 있나?" gmsg 거부. `<queries>` manifest 선언 안 한 영향 | 광고 표시 자체엔 무영향 — 무시 |

## 6. 진단 인프라 — Layer B 보류

OTA 가능한 진단 로그 강제 forward (`Logger.warn` 또는 native plugin 호출로 release 빌드에서도 logcat 노출) 제안했으나 **사용자가 보류** — v1.5.98만으로 사용자 증상 해결되는지 1주일 모니터링 후 재발 시 추가 판단.

재발 시 추가할 후보:
- FailedToLoad code 정확히 (3=No fill / 2=Network / 0=Internal / 1=Invalid request)
- 우리 앱의 useAdMob useEffect setup/cleanup 로그
- tier/profile 변화 로그 (v1.5.83 useMemo 의심 시)

## 7. 교훈 / 재사용 패턴 [[feedback_admob_failtoload_threshold]]

광고 SDK의 일시 실패(FailedToLoad)는 일상적 — **즉시 layout 정리는 UX 회귀**. 반드시 threshold 또는 debounce 처리.

```
DON'T: FailedToLoad → 즉시 setOffset(false) → 사용자 광고 갑자기 사라짐 인지
DO:    FailedToLoad → 카운터 증가 → N회 연속 시에만 setOffset(false)
       Loaded/SizeChanged → 카운터 reset + offset 복원
```

같은 패턴이 iOS도 공유 코드 경로 → 미래 iOS 회귀 보고 시 같은 fix가 동작.

## 8. 운영 메모

- v1.5.98 production OTA 적용 후 1주일 모니터링
- 재발 0건: 완전 종료
- 재발 1건+: Layer B 진단 로그 추가 → 정확한 fail code 확정 후 threshold 조정 (3→5 등)
- 별건 A/B/C는 사용자 보고 빈도에 따라 우선순위 결정

## 관련 메모

- [[feedback_side_effect_check]] — 모든 코드 변경 시 사이드 이펙트 점검 의무
- [[feedback_capgo_verify]] — Capgo bundle upload 후 channel currentBundle 검증 (이번에도 수행)
- [[reference-capgo-cli-auth]] — Capgo CLI v7.111.2 + CAPGO_TOKEN env (이번 배포 사용)
- [[changes-0606-session3]] — 직전 작업 (Azure TTS 비용 다이어트)
