---
name: reminder-admob-blackout-restore
description: 2026-09-15 이후 AdMob 광고 재개 절차 — ADS_ENABLED 플래그 복구 체크리스트 (계정 정지 대응으로 전 광고 경로 차단 중)
metadata:
  type: project
---

**2026-08-23 조치**: AdMob 계정 정지(2026-08-15~, 심사 ETA 2026-09-15)로 광고가 전달되지 않아
`src/config/ads.js`의 `ADS_ENABLED = false` 로 전 광고 경로를 JS 레이어에서 차단했다.
차단 지점 5곳: 배너(useAdMob 배너 effect) / 전면(showInterstitialAd) / 보상형 2종
(handleRewardedAd·handlePronAllowanceAd + 사이드바 버튼 렌더) / TTS 광고 프롬프트(bumpTtsPoint) /
adProvider(adsReady·showInterstitial). TrialLimitModal 은 부모가 핸들러를 null 로 넘겨 자동 숨김.

**Why**: ① 배너가 admob-active 클래스만 붙이고 실광고 미노출 → 하단 "빈 광고칸" 고착
(FailedToLoad 3회 임계는 Loaded/SizeChanged 가 카운터를 리셋해 발동 안 함)
② 보상형은 FailedToLoad → `alert('광고 오류: ...')` 로 실유저에게 에러 노출.
날짜 자동 해제(Date 비교)는 **일부러 안 썼다** — 9/15에 계정이 안 풀렸는데 자동으로 켜지면
같은 증상이 무증상 재발한다.

**How to apply — 재개 절차 (순서 엄수)**:
1. AdMob 콘솔에서 계정 상태 + 실제 노출 재개 확인 (플래그 켜기 **전에**)
2. `src/config/ads.js` → `ADS_ENABLED = true`
3. `npm run build && npm run check-secrets` → ios-heat-guard → commit → OTA(production) →
   `channel currentBundle production` 포인터 검증
4. 실기기: 배너 노출 + 탭바 위치 정상 + 사이드바 🎬/🎤 버튼 복귀 확인
5. **배너 실패 임계 로직 보강 검토** — 이번 사고에서 `Loaded` 가 실노출 없이도
   `_consecutiveFailures` 를 리셋해 무한 빈칸을 만든 게 드러남. 성공 리셋을
   `SizeChanged(height>0)` 로만 한정하는 안 검토.

**보상 공백(미적용)**: 차단으로 Trial 이 보상광고 +20×5회/일(최대 +100pt)과 발음한도 +10×5회를
잃는다. 일일 자동충전 상향(server/routes/adReward.js `daily-topup` 10/30 → 30/50, Render 즉시 반영)
안을 제시했으나 사용자가 **3번(차단)만 적용** 선택 — 이탈 신호 보이면 이 레버부터 검토.

[[changes-0823-admob-blackout]] [[pending-ios-fixes]]
