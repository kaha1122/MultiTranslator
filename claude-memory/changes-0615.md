---
name: changes-0615
description: "2026-06-15 포인트 경제 개편(TTS 듣기 차감 도입·Listening 생성5→2·지문2·광고+20) + 차감 디바운스 flush(iOS 발열완화) + preset/durable/seed-TTS 동작 확정. 커밋 1f42f2f push 완료(웹/서버 자동배포, 모바일 OTA 대기)"
metadata: 
  node_type: memory
  type: project
  originSessionId: cf7c0308-eb18-433b-a6ca-a88a75d2b6c6
---

# 2026-06-15 포인트 경제 개편 + 디바운스 발열완화

커밋 **`1f42f2f`** (main push 완료). 직전 `fa75e75`(통과배지 중앙이동)도 함께 push됨. 웹(Vercel)·서버(Render) 자동배포, **모바일은 Capgo OTA 미반영(대기)**.

## 1. 포인트 경제 개편 — 차감 확대 + 획득 상향

배경: TTS가 그동안 거의 무료(네이티브 우선 + seed durable `_skipGate`)였음 → 광고 유도 위해 듣기·생성에 차감 확대. **차감은 Azure 실비용과 분리된 "포인트 경제(광고/구매 유도)" 목적.**

**최종 차감(Trial)**:
- Vocab 생성 1 / **Listening 생성 5→2** (addAdPoints + `POINT_COST.listen` 5→2)
- 발음 평가 2 (전 탭 공통 — Vocab/Listening/**Library**/Video. Azure STT 실비라 어디서든 차감)
- 단어·예문·문장 TTS 각 1 (첫 청취, **세션 단위 first-only**, 반복 무료)
- **지문 TTS 1→2** (`onTtsGate(2)`)
- Translation 카드·예문 TTS 각 1
- **Library: TTS 듣기만 무료**(복습), 발음 평가는 2점 차감

**획득**: 첫 30·Daily 10 유지, **광고 보상 +10→+20**([server/routes/adReward.js] `AD_REWARD_AMOUNT`), 포인트 판매(+200) 유지.

**구현 핵심**:
- TTS 차감은 `handleSpeakSmart`에서 `opts.ttsCost` 넘긴 호출(카드)만 대상 → Translation/Vocab/Listening은 ttsCost:1, **Library는 ttsCost 없음=무료**. 세션 추적은 `ttsChargedRef`(Set, cacheKey 단위) → 반복 청취 무료, 앱 재시작 시 리셋.
- VocabWordCard speak 래퍼: `_skipGate` 제거, 항상 `ttsCost:1` + seed면 `durable:true`. → seed도 첫 청취 1점(Azure는 Storage라 무과금이지만 포인트는 차감).
- 지문 fallback·durable 분기는 `_skipGate`로 이중차감 방지.

## 2. 차감 디바운스 flush (iOS 발열완화, 핵심)

문제: TTS 차감 도입 → `consumeBonusPoints`(=`users/{uid}` 본문 write) 빈도 급증 → 발열 규칙6(users write→AuthContext onSnapshot→App 재렌더 폭주) 악화.

해결([src/context/AuthContext.jsx]):
- 차감을 즉시 write 하지 않고 `pendingFlushRef`에 누적 → **4초 setTimeout + visibilitychange(hidden)/pagehide/unmount 시 `flushBonusDeduct`로 1회만 `updateDoc(increment(-amount))`**. write·onSnapshot 횟수 수십→1로 축소.
- 화면·게이트 잔액 = `bonusPoints = max(0, profile.bonusPoints - optimisticSpent)` (optimistic overlay). 차감 즉시 반영(게이트는 `optimisticSpentRef` 동기, 화면은 state).
- 서버 잔액 하락(onSnapshot) 시 `reconcile effect`(deps `[profile?.bonusPoints]`)가 optimisticSpent를 같은 양 내려 **깜빡임 없이 수렴**. 증가(topup/광고/구매)는 무시. 모든 차감이 consumeBonusPoints 경유라 감소분=우리 flush분.
- contextValue useMemo deps에 `optimisticSpent` 포함(즉시 표시). uid 변경 시 overlay/pending 리셋. 타이머·리스너 cleanup 완비.
- ios-heat-guard 2회 PASS: write 빈도 감소 확인, 무한 재렌더 루프 없음(reconcile은 setState만, profile.bonusPoints는 onSnapshot으로만 변경→루프 차단).

## 3. 동작 확정(설계 이해, 추후 참고)

- **preset vs 비-preset**: v2에서 **Vocab/Listening 탭은 오직 홈 학습경로(TopicHub)를 거쳐서만** 진입(사이드바에 직접 항목 없음, [App.jsx] 주석 명시) → **항상 preset → 항상 durable(seed)**. 비-preset(native 우선) 경로는 Translation/Library/Scene 등 탐색·복습 탭에만 해당.
- **TTS 라우팅 순서**(handleSpeakSmart): ①메모리캐시 ②IndexedDB ③`opts.durable`이면 Azure durable(Storage) **★네이티브보다 먼저** ④네이티브(무료) ⑤네이티브 실패 시 Azure 폴백. → seed(preset)는 네이티브 폰이어도 durable로 가서 **seed 오디오 정상 생성·공유**. 네이티브로 인해 seed 안 만들어지는 일은 비-preset 탐색에서만.
- **음성 파일 연결 = content-addressed**: 파일명=`sha256(SSML)`, seed 문서에 파일명 저장 안 함. `gs://trnaslatorapp.firebasestorage.app/tts-cache/{sha256}.mp3`.

## 미배포(모바일 OTA 대기)
- 1f42f2f·fa75e75는 웹/서버 자동배포됨. **iOS/Android 앱 반영하려면 Capgo OTA 별도 배포 필요**(버전 bump + bundle upload + 채널 currentBundle 검증).

## 교훈
- TTS 차감은 Azure 비용(캐시·durable로 0 가능)과 **분리된 포인트 경제** — "무료 엔진(네이티브)이라도 포인트는 받는다"가 가능/의도.
- 차감 빈도가 올라가면 곧 users-body write 빈도 = 발열. **머니로직 정확도 유지하면서 write만 디바운스**(optimistic overlay + reconcile)가 정석. reconcile은 "모든 감소가 단일 경로 경유"라는 불변식 위에서만 성립.
- 발음 평가(STT)는 실비라 전 탭 공통 차감, TTS(캐시가능)는 탭별 정책 차등 가능.

[[changes-0614]] [[changes-0606-session2]] [[feedback_side_effect_check]]
