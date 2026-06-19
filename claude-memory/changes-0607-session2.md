---
name: changes-0607-session2
description: "2026-06-07 2차 — 광고 수익화 전면 개편(메이저 v2.0.0): 단일 포인트 풀(bonusPoints, 1일차30/매일+10) + 하드캡 절대(FT2/Pron10/Listen3) + 전면광고 완전 제거 + 비용 게이팅(FT10/Listen5/Pron2/기타1, TTS 0점시 차단) + 포인트/한도 팝업 분리 + 상단게이지 Listening 추가. eCPM $1.84(보상형 ~$12) 적자 진단 기반. Capgo production 2.0.0."
metadata: 
  node_type: memory
  type: project
  originSessionId: c0caf0e9-26ac-4c92-9dcf-5ed266f3bbd0
---

# 2026-06-07 2차 — 광고 수익화 전면 개편 (적자 구조 차단)

## 배경: 광고로 Azure 비용 못 덮음 + 무제한 누수
- 실측 eCPM **블렌디드 $1.84**(VN 다수). 광고 1회 ≈ ₩2.5 < 발음 1회 비용(₩3). **보상형만은 ~$12**(Bonus01 $0.20/15노출 + Bonus02 $0.09/9 = $0.29/24).
- 구조적 누수: Trial이 **보상광고 무제한 시청 → 일일 한도 초과**(credits 적립) = 무제한 무료 학습. 5월 광고 ₩30k < Azure ₩40k.
- 단건 손익(보상형 $12): 발음 ~본전 / Listening·FreeTalk 적자 → 캡으로 출혈 묶고 Pro 전환 유도가 답.

## 새 모델 (사용자 확정)
- **단일 통합 풀** = 기존 Firestore `users.bonusPoints` 재사용. **AdPoint(localStorage interstitialPoints) 시스템 통째 삭제**(전면광고 제거).
- **일일 충전**: 1일차 **30**, 2일차+ 매일 **+10**(reset 아닌 누적). `claimDailyTopUp`(AuthContext, 날짜 트랜잭션 가드, Trial 전용, getToday 재사용).
- **하드캡 절대**: FreeTalk **2**/Pron **10**/Listen **3** 일. 포인트 있어도 초과 불가, Tier 변경만. credits 우회 제거(기존 credits 무시/사장).
- **포인트 비용**: FreeTalk 10 / Listening 5(생성) / Pron 2 / Vocab·Scene 생성 1 / **TTS 재생 1**(MISS만, 캐시 무료). 카드 저장 무과금.
- **게이팅**: `isTrialXLimitReached = tier==='trial' && (dailyXReached || bonusPoints < cost)`. 차감 `addAdPoints`→`consumeBonusPoints`. 부족 시 막힘→사이드바 충전(+5) or 업그레이드. 전면광고 안 뜸.
- **사이드바**: 3개 보상버튼 → 단일 "보너스포인트 충전(+5)". 서버 `POST /api/bonus/ad-reward`(routes/adReward.js, 쿨다운60s+일일5회, grantBonusPoints source 'adReward'). 클라 직접 increment 금지(위변조).
- **한도 모달 2종**(requestLimitModal(feature)로 사유 판정): 하드캡 도달='cap'(업그레이드만, "내일 다시") / 포인트 부족='points'(영역1 구독 "광고·한도·포인트 무제한"+업그레이드 / 영역2 충전버튼 앱전용+차감 칩 한줄 FT−10/Listen−5/발음−2/기타−1).
- **Streak 팝업(StreakIntro/StreakStatus/StarGuide) Trial 제외**.

## 변경 파일
- server: `routes/adReward.js`(신규), `utils/bonusPoints.js`(VALID_SOURCES +adReward), `index.js`(마운트)
- `context/AuthContext.jsx`: claimDailyTopUp+useEffect, isTrialXLimitReached 재정의, POINT_COST export, consumeBonusPoints
- `App.jsx`: AdPoint/전면광고/flushPendingAd 삭제, addAdPoints→consumeBonusPoints, 게이팅 단순화, 헤더 `🎁 bonusPoints`, 사이드바 단일버튼, handleRewardedAd→서버, requestLimitModal+trialLimitReason, Streak 가드, 상단 게이지 Listening 추가
- `components/TrialLimitModal.jsx`: cap/points 2모달
- `components/ListeningTab.jsx`: onTtsCharge(passage/sentence MISS −1)
- `locales/*`(10): reward.topUpBonus(+Desc), trial.pointsTitle/pointsDesc/pointsUpgradeHint/costGuideTitle/costOther 등

## 테스트(staging) 발견·수정 이슈 6건
1. **일일충전 미부여(blocker)**: useEffect deps `profile?.lastTopUpDate`(신규/기존 undefined→미변화) → profile 로드 시 effect 안 돎 → bonusPoints=0 → **모든 액션 차단**. **deps `!!profile`로 수정**(처음엔 `profile` 객체로 했다가 매 snapshot 재실행→트랜잭션 폭주 → `!!profile`로 로드 1회만).
2. **충전 충돌 폭주(failed-precondition)**: `consumeBonusPoints` runTransaction이 markActiveDay 등 동시 user-doc 쓰기와 낙관적 락 충돌 → 콘솔 폭주+재시도 낭비. **updateDoc(increment(-clamp))로 변경**(원자 연산, 음수는 클라 profile.bonusPoints clamp + 게이트 사전차단).
3. **게이지 분모 credits 더함(2/7)**: `LIMIT + credits` 7곳(상단바·홈진도·설정) → `LIMIT`만(하드캡).
4. **포인트/한도 팝업 미분리**: requestLimitModal(feature)가 하드캡 도달여부로 cap/points 판정.
5. **포인트 모달 충전버튼**: 웹엔 보상광고 없음 → 충전버튼 앱(native) 전용(웹 미노출). 차감 항목 한 줄 칩 간략화.
6. **상단 게이지 Listening 누락**: 💬/🎤에 🎧 추가. 박스 크기 유지 위해 `.tsb-gauges` 압축(gap 2px, bar 5→4px, text 10→9px, icon 12→11).

## 추가 이슈 7 — TTS 0점 차단 게이트 (best-effort → 게이트)
- 문제: TTS 차감이 best-effort라 0점에도 새 TTS(Vocab/카드/Listening 지문·문장) 작동.
- 수정: `tryConsumeTtsPoint()`(App) — 신규 합성(서버 fetch) **직전** 호출. Trial 0점→차단+포인트부족 팝업(requestLimitModal 'tts'), ≥1→1점 차감, Pro/BYOK 통과. 캐시 hit(메모리/IndexedDB/보존오디오/문장캐시)은 게이트 전 return → 0점에도 재청취 무료. handleSpeak는 fetch-후 차감→fetch-전 게이트로, ListeningTab onTtsCharge→onTtsGate(passage/문장 fetch 전).

## 배포 (최종 버전 흐름)
- Capgo staging: 1.5.100→101(충전 deps blocker)→102(폭주/게이지/팝업)→103(consume increment+모달정리+thermal idle 25e5f47).
- production: 1.5.99 유지 → **1.5.103 승격**(`channel set production --bundle 1.5.103`, 재업로드X) → **1.5.105**(게이지 Listening 추가, 1.5.104 admob bg fix는 타세션) → **메이저 v2.0.0**(TTS 0점 차단 포함, bundle upload --channel production).
- 서버/웹(adReward 엔드포인트, 게이팅)은 main push로 production 자동 배포.
- 채널 정렬: production 2.0.0 / staging 1.5.103(뒤처짐 — 다음 staging 테스트 시 2.0.0+ 로).

## 재사용 교훈
- **광고만으론 Azure 적자 못 메꿈**(eCPM $1.84). 흑자 경로 = **Pro 전환** + 하드캡 출혈 상한. 광고는 throttle/전환 장치.
- **단일 문서 동시 트랜잭션 = failed-precondition 폭주**: 카운터성 차감은 transaction보다 `updateDoc(increment)`(원자 연산, 경합 내성). 음수는 클라값 clamp+사전 게이트로.
- **useEffect deps에 "신규 유저는 undefined인 값"만 쓰면 로드 시 안 돎** → `!!obj`(로드 플래그)로 트리거. 반대로 객체 전체를 deps로 두면 매 snapshot 재실행→트랜잭션 폭주.
- **통합이 오히려 코드 단순**: AdPoint 이중 시스템 제거 > 2풀 리워크(삭제가 더 많음).
- 사장 필드(credits)는 게이팅에서 빼되 정의는 두면 미참조 안전(점진 정리).
- Capgo 승격은 `channel set --bundle`(재업로드 X). [[feedback_capgo_verify]]
- [[changes-0606-session3]] [[changes-0607]] [[feedback_deploy]]
