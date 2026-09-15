---
name: reminder-admob-blackout-restore
description: AdMob 광고 재개 절차 — 계정 정지 지속(2026-09-16 기준 미해제). ADS_ENABLED 복구 + SSV 콘솔 등록이 선행 조건
metadata: 
  node_type: memory
  type: project
  originSessionId: ce2195e0-9f36-47ca-98f7-645a1f413b12
  modified: 2026-09-15T21:34:57.515Z
---

**상태(2026-09-16 확인)**: AdMob 계정 **아직 정지 중**. 8/15 정지, 심사 ETA 9/15였으나 미해제 —
콘솔에서 광고 단위 설정(SSV URL 등록 포함)도 불가한 상태. `ADS_ENABLED = false` 유지 중.

**2026-08-23 조치**: `src/config/ads.js`의 `ADS_ENABLED = false` 로 전 광고 경로를 JS 레이어에서 차단.
차단 지점 5곳: 배너(useAdMob 배너 effect) / 전면(showInterstitialAd) / 보상형 2종
(handleRewardedAd·handlePronAllowanceAd + 사이드바 버튼 렌더) / TTS 광고 프롬프트(bumpTtsPoint) /
adProvider(adsReady·showInterstitial). TrialLimitModal 은 부모가 핸들러를 null 로 넘겨 자동 숨김.
배포: OTA production 2.1.27.

**Why**: ① 배너가 admob-active 클래스만 붙이고 실광고 미노출 → 하단 "빈 광고칸" 고착
(FailedToLoad 3회 임계는 Loaded/SizeChanged 가 카운터를 리셋해 발동 안 함)
② 보상형은 FailedToLoad → `alert('광고 오류: ...')` 로 실유저에게 에러 노출.
날짜 자동 해제(Date 비교)는 **일부러 안 썼다** — 계정이 안 풀렸는데 자동으로 켜지면 무증상 재발한다.

**2026-09-16 조치 — SSV 전환(커밋 9629ea6, staging push / main·OTA 미배포)**:
정지의 유력 원인인 무효 트래픽 대책. 보상 지급 권위를 클라 주장 → Google 서명 SSV 콜백으로 이관.
`server/routes/admobSsv.js`(GET /api/admob-ssv, ECDSA P-256 검증 + transaction_id 멱등 단일 tx),
`adReward.js` 광고 지급 2개는 `ADMOB_SSV_ENFORCED`(기본 on)로 차단, 클라는
`prepareRewardVideoAd({ ssv:{userId, customData} })` 전달만(네이티브 무변경 → OTA 가능).
포인트 10pt 이상이면 충전 광고 미노출(임계는 최대 단일 차감액 FT 10pt 기준 — 5pt는 데드락).
[thermal] Rewarded 가 아니라 **Dismissed 에서만 promise settle** — SSV 전환으로 서버 왕복 await 가
사라지며 `endAudioSession` 이 광고 재생 중 실행돼 busy 무음 실패하던 경로(0617 발열) 차단.

**How to apply — 재개 절차 (순서 엄수)**:
1. AdMob 콘솔에서 계정 정지 해제 + 실제 노출 재개 확인 (플래그 켜기 **전에**)
2. **SSV 콜백 URL 등록** — 보상형 광고 단위 4개(Android Bonus01/02, iOS Bonus01/02) 각각
   `https://multitranslator.onrender.com/api/admob-ssv`. ⚠ 이 등록 전에 서버가 main 에 올라가면
   레거시 지급은 막혔는데 SSV 콜백은 안 와서 **보상 공백**이 생긴다(광고 OFF 동안엔 무해).
3. main push → Render 재배포 → 실기기 1회 테스트 → Render 로그 `[AdMobSSV] GRANTED` 확인
4. `src/config/ads.js` → `ADS_ENABLED = true`
5. `npm run build && npm run check-i18n && npm run check-secrets` → ios-heat-guard → commit →
   OTA(production) → `channel currentBundle production` 포인터 검증
6. 실기기: 배너 노출 + 탭바 위치 정상(데드존 14px 은 `.admob-active` 한정이라 자동 복귀) +
   사이드바 🎬/🎤 버튼 복귀 확인
7. **배너 실패 임계 로직 보강 검토** — `Loaded` 가 실노출 없이도 `_consecutiveFailures` 를
   리셋해 무한 빈칸을 만든 게 드러남. 성공 리셋을 `SizeChanged(height>0)` 로만 한정하는 안.

**롤백 레버**: SSV 문제 시 Render env `ADMOB_SSV_ENFORCED=0` + 재시작 → 레거시 클라 지급 복귀
(코드 배포 불필요). 광고 전체 문제 시 `ADS_ENABLED=false` + OTA.

**보상 공백(미적용)**: 차단으로 Trial 이 보상광고 +20×5회/일(최대 +100pt)과 발음한도 +10×5회를
잃는다. 일일 자동충전 상향(server/routes/adReward.js `daily-topup` 10/30 → 30/50, Render 즉시 반영)
안을 제시했으나 사용자가 차단만 적용 선택 — 이탈 신호 보이면 이 레버부터 검토.

[[changes-0823-admob-blackout]] [[pending-ios-fixes]] [[changes-0617-thermal-ad]]
