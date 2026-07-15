---
name: changes-0523
description: 2026-05-23 종일 — 신규 유저 동선 정비 + Listening 한도/광고 보상 + Free Talking basic 강제 + freeTalkHistory 신뢰성 + push 환영 팝업 통합 + Capgo OTA 1.5.57~1.5.61 다단 배포
metadata: 
  node_type: memory
  type: project
  originSessionId: 8035627e-d5c4-453b-af67-eb711ccec64c
---

# 2026-05-23 종일 세션 — 신규 유저 UX 전면 정비 + Listening 시스템 확장 + Capgo 4회 OTA

이날은 큰 카테고리 6개 + 회귀 fix 3건 + Capgo Production 4회 연속 배포로 마무리. 신규 유저 첫 동선부터 Listening 한도/광고 보상까지 폭넓게 정비.

## 1. UI/UX 전면 정비 (commit 6d28161, 1.5.57 OTA)

### TabTutorial 전면 제거
- 매 탭 첫 진입마다 700ms 후 자동 발화되던 가이드 모달이 "팝업 너무 많이 뜬다" 부정 인상 호소 → 효용 < 노이즈 판단으로 전면 삭제
- src/components/TabTutorial.{jsx,css} 파일 삭제, src/App.jsx import + state + useEffect + 핸들러 2개 + render 블록 제거 (~45줄)
- freetalk_announce_seen 자동 캐싱은 유지 — 신규 유저는 정상 동선으로 Free Talking 만남
- src/components/FreeTalkingAnnounceModal.jsx 주석 갱신

### StreakIntroModal — 신규 유저 첫 세션 Step 6 (PushOptIn) 직후 발화로 이동
- 기존: 2nd+ 세션에만 발화 (initialLifecycleStageRef 가드)
- 신규: 첫 세션 Step 6 닫힌 직후 발화 — 신규 유저도 Streak 즉시 인지
- 게이트 재설계: lifecycleStage 의존 제거 → hasCompletedOnboarding + aiConsentAt
- 선행 모달 (showOnboarding/showAiConsent/showSubscriptionPrompt/showPushOptIn) 닫힐 때까지 대기
- TDZ 회피 위해 showOnboarding 선언 이후로 effect 위치 이동
- lifecycleStage 미부여 케이스 (과거 버그 잔존) 자연 해소

### StarGuideModal 신규 생성 — 첫 generate 후 행동 가이드
- 기존 인라인 starGuide(별표=저장만 안내) → 풍부한 3-step 동선 ("⭐ 별표 → 발음 통과 → Streak")
- src/components/StarGuideModal.{jsx,css} 신규 — Framer Motion + gold metallic 뱃지 + amber→mint 그라디언트 타이틀 + 파스텔 단계 카드 + mint CTA
- "다시 보지 않음" 체크박스 추가 — 미체크 닫기 시 다음 세션 재노출
- 트리거: totalGenerateCount >= 1 + sessionStorage 가드 (세션당 1회)
- localStorage 키 starGuideDone → starGuideDismissedV2 — 기존 사용자에게도 1회 자동 재노출
- i18n 10 locale (starGuideTitle/Step1/Step2/Step3/Cta), dead key starGuideDesc 제거
- 문구: ko "학습하고자 하는 카드 ⭐ → 발음 합격(qualified) → 매일 3장 모아 Streak 달성! 💎 보너스"

### Streak Reminder push → StarGuide 환영 팝업 강제 발화
- 정기 13:00 streak_reminder push 탭으로 진입 시 홈 + StarGuide 환영
- count/session/dismissedV2 가드 모두 우회 — 영구 dismiss 유저도 따뜻한 재참여 1회
- 선행 모달 닫힐 때까지 대기

## 2. freeTalkHistory 신뢰성 강화 — Phase 1+2 (commit b3f002e)

기존 freeTalkHistory 종료 데이터 (endedAt/durationMs/freeTurnCount/endedReason) 가 사용자 X 클릭에만 의존 → 강제 종료/앱 kill/홈버튼 시 모두 누락.

### Phase 1 — Incremental turn write (3초 debounce)
- 매 turn (submitFreeUtterance 응답 직후) `freeTurnCount + lastTurnAt` 만 Firestore 부분 update
- INCREMENTAL_WRITE_DEBOUNCE_MS = 3000
- endedAt 이미 있으면 skip (race-safe), 같은 turn 값이면 skip (중복 방지)
- resetSession / updateLastFreeTalkHistoryEnd 에서 펜딩 timer cleanup

### Phase 2 — Lifecycle 이벤트 3종 다중 후크
- `document.visibilitychange='hidden'` → `endedReason='lifecycle_visibility'`
- `window.pagehide` → `endedReason='lifecycle_pagehide'`
- Capacitor `App.appStateChange(isActive:false)` → `endedReason='lifecycle_appstate'`
- 모두 idempotent — 중복 발화 무해 (endedAt 검사)
- 강제 종료 케이스 대부분 캡처 (OS-level 이벤트 발화 보장)

### 보류
- Phase 3 (다음 세션 startSession 시 recovery)
- Phase 4 — **나중에 별도 적용** (Free Talking 광고 deferred flush, 항목 9 참조)

## 3. StreakIntro 회귀 fix (commit c2fd6ca)

증상: 신규 유저 StreakIntro "다시 보지 않음" 미체크 닫기 후 매 generate 마다 재발화.

원인 1: `profile.aiConsentAt` Timestamp 객체가 useEffect deps 에 직접 사용 → Firestore client SDK 가 매 snapshot 마다 새 Timestamp instance 생성 → generate → totalGenerateCount 증가 → onSnapshot fires → profile 새 객체 → Object.is 비교 false → effect 재실행.

원인 2: 세션당 1회 발화 가드 부재 (StarGuide 는 sessionStorage 보호되지만 StreakIntro 는 누락).

수정:
- deps 에서 `profile?.aiConsentAt` → `!!profile?.aiConsentAt` (boolean 안정화)
- sessionStorage `streakIntroShownThisSession` 가드 추가 (타이머 콜백 내부 마킹 → cleanup race 회피)

**재발 방지 학습**: Firestore Timestamp/DocumentReference/Array 등 객체 타입 필드를 React useEffect deps 에 직접 넣지 말 것. scalar 변환(`.seconds`, `.toMillis()`, `!!` boolean) 사용. 이 패턴 이제 3번 적용 (StarGuide / StreakIntro / StreakStatus).

## 4. Listening daily 한도 3 + 홈 게이지 (commit 5cf5641)

기존: Listening 무제한 generate → Gemini + Azure TTS 비용 가드 부재.

### AuthContext.jsx
- `TRIAL_DAILY_LISTEN_LIMIT=3` 상수 신설
- `dailyTrialListenReached` state + setter
- `isTrialListenLimitReached` 플래그 (hasBonusActive 우회) — Pron/FreeTalk 와 동일 패턴
- Provider value export

### App.jsx
- import 갱신 + useEffect sync (todayListenCount → reached)
- HomePage `dailyListenLimit` prop 하드코딩 10 → `TRIAL_DAILY_LISTEN_LIMIT`(3)
- ListeningTab 에 `isTrialListenLimitReached` prop 전달

### ListeningTab.jsx
- handleGenerate 시작점에 한도 가드 (trialLimitModal 재사용)
- passage 객체에 `counted: true` 플래그 추가 — first-play dedup safety net
- handlePassagePlay 첫 재생 dedup 분기 (정상 흐름에선 안 타지만 fallback)

### HomePage.jsx
- `dailyListenLimit` default 10 → 3

## 5. StreakStatusPopup 회귀 fix (commit a936264)

증상: StreakStatusPopup 닫은 직후 같은 세션 내 재발화 (1.5초 후).

원인: `dismissStreakStatus` 의 `updateDoc({ lastStreakStatusPopupAt: today })` 가 async 라 Firestore 반영 전 다른 dep change → effect 재실행 → `lastStreakStatusPopupAt === today` 게이트가 아직 미반영이라 통과 → setTimeout(1500ms) 다시. **StreakIntro 회귀 fix(c2fd6ca) 와 완전히 같은 패턴**.

수정: `sessionStorage 'streakStatusShownThisSession'` 세션 가드 추가 + 타이머 콜백 내부에서 마킹 (effect cleanup race 회피). 기존 Firestore `lastStreakStatusPopupAt` 게이트는 cross-session 매일 1회 정책용으로 보존.

## 6. Listening 첫 재생 시 AdsPoint 추가 차감 (commit 5a0c68e)

기존: Listening Generate 시에만 AdsPoint(15) 차감, 듣기 재생은 0 차감.
사용자 요청: "듣기 재생시 Ads Point에서 차감되기를 바랐던거야".

수정:
- App.jsx: `onFirstPlay={() => addAdPoints(1, bonusCost:5)}` prop 신설
- ListeningTab: passage 에 `adsCharged: false` 플래그 추가 — 첫 재생 dedup
- handlePassagePlay 신규 분기: `if (passage && !passage.adsCharged) { onFirstPlay?.(); setPassage({...adsCharged:true}); }`

passage 당 AdsPoint 패턴:
- Generate: +1 (기존)
- 첫 재생: +1 (신규)
- pause/resume/loop/Stop→Play 다시: 0 (메모리/서버 캐시)
- 새 passage 생성 → adsCharged=false 리셋 → 새 첫 재생 시 다시 +1

## 7. Free Talking basic 강제 + Listening 광고 보상 + 영구 보관 라벨 제거 + TrialLimitModal Listening 뱃지 (commit c295bd2 + ab7c218)

### Free Talking 항상 basic 진입
- ScenePractice.jsx difficulty 초기값 `useState('basic')` 강제 (userLevel 무시)
- userLevel 동기화 effect 제거
- 첫 사용자에게 intermediate 가 너무 어려워 우선 basic 으로 적응 유도
- 사용자가 화면에서 명시적으로 변경한 값은 세션 내 유지, 재마운트 시 또 basic
- 처음 c295bd2 에선 App.jsx onFreeTalkStart 에서 args.difficulty='basic' 으로 override 시도 → 화면 UI 는 사용자 default 그대로 표시되어 혼란 → ab7c218 에서 ScenePractice 자체 default 변경으로 fix
- 부수: 같은 ScenePractice 화면이 발음 연습 카드 생성도 담당 → 발음 카드도 default basic. "첫 사용자 basic 적응 유도" 일관.

### Listening 광고 보상 신설 — listenCredits +3 영구 적립
- AuthContext: `listenCredits` 필드 + `consumeListenCredits` 함수 + `isTrialListenLimitReached` 가드에 `listenCredits===0` 추가
- App.jsx `handleRewardedAd`: `'listens'` 타입 분기 — AdMob Bonus01 (rewardedCards) 재사용 (별도 unit 미발급), Rewarded 이벤트에서 listenCredits +3 Firestore 적립
- 사이드바: 보라색 "+3 Listening" 광고 버튼 추가 (Free Talking/Pron 패턴 일치)
- onGenerate 콜백: 한도 도달 + listenCredits>0 시 credits 우선 소비 (Pron 의 onPronSuccess 와 동일 패턴)

### "(영구 보관)" 문구 제거 (10 locale)
- `reward.watchAdFreeTalk` / `watchAdPron` 갱신 + 발음 10회→5회 표기 수정
- 신규 `reward.watchForListen` / `watchAdListen` 추가

### TrialLimitModal — Listening 뱃지 추가 (commit c295bd2 + 4c649be)
- 기존 🗣️ Free Talking + 🎤 Pronunciation 에 🎧 Listening 3종 표시
- `listenCount` prop accept + useAuth 에서 `TRIAL_DAILY_LISTEN_LIMIT/listenCredits` 받음
- App.jsx 에서 `listenCount={todayListenCount}` 전달

### TrialLimitModal 문구 + 아이콘 수정 (commit 4c649be)
- `trial.limitDesc` 갱신 (10 locale): "하루 카드 10장, 발음 10회, 또는 Free-Talking 2회" (카드 한도 폐기됨 + Listening 누락) → "발음 10회, Free-Talking 2회, Listening 3회 한도에 도달했습니다."
- `trial.seeSidebarReward` 갱신: "+2 Free-Talking / +5 발음 / +3 Listening 버튼"
- 아이콘 🗣️ → 💬 (사이드바 Free-Talking 메뉴 lucide MessageCircle 와 시각 일관성)

## 8. reengagement_* push 도 StarGuide 트리거 + Capgo 1.5.59 bump (commit 92756b8)

사용자 iOS 보고: streak push 받았는데 StarGuide 안 뜸. 진단:
- 서버 streak push 2종: `streak_reminder` (13:00 정기) + `streak_risk` (22:00 위험) + reengagement_* 2종 (D1/D3/D5 또는 D2/D4/D6)
- 사용자가 실제로 받은 push 가 `reengagement_*` 였을 가능성 — 기존 코드는 홈 이동만 하고 StarGuide 트리거 안 함

수정 — 네 종류 모두 "다시 학습 시작" 동기 부여 메시지라 통합:
```jsx
if (typeof pushType === 'string' &&
    (pushType.startsWith('streak_') || pushType.startsWith('reengagement_'))) {
  setViewMode('home');
  setForceStarGuideFromPush(true);
}
```

기존 streak_* 만 매칭 + reengagement_* 홈 이동 두 분기 통합. 향후 streak_milestone 등 자동 커버.

## 9. Free Talking 광고 deferred flush — Phase 4 (commit a626772, 1.5.61 OTA)

사용자 iOS 보고: AdsPoint 1점 남은 상태에서 Free Talking Generate 시 인트로 TTS 와 동시에 인터스티셜 광고가 즉시 발화. 기대: "5턴 끝나면 광고".

원인: `onSessionStarted` (서버 200 직후) 콜백이 `addAdPoints(1, bonusCost:10)` 호출 → 14+1=15 임계 도달 → `showInterstitial()` 즉시 발화 → 인트로 3 메시지 TTS streaming 중 광고 끼어들어 UX 깨짐. iOS/Android/Web 모두 동일. 이전 분석에서 Phase 4 deferred flush 로 식별했으나 "Phase 1+2만 충분" 으로 보류되었던 사안.

수정 (App.jsx):
- `addAdPoints` 에 `options.deferAd` 옵션 추가 — true 면 임계 도달해도 광고 발화 skip, 점수만 localStorage 누적. 호출자가 적절한 시점에 `flushPendingAd()` 책임.
- 신규 `flushPendingAd()` — 누적 점수가 임계 이상이면 광고 발화. 임계 미달/쿨다운/adsReady 미준비면 no-op. `addAdPoints` 의 발화 로직과 동일 (쿨다운 60s, 실패 시 점수 롤백).
- Free Talking `onSessionStarted`: `addAdPoints(1, bonusCost:10, deferAd:true)` — 인트로 진행 중 광고 차단, 점수는 정상 누적.
- Free Talking `onClose`: `flushPendingAd()` 호출 — 사용자 X 닫기 / Turn 한도 도달 후 닫기 / idle 종료 후 닫기 모든 경로에서 발화 보장.

강제 종료 시: flush 호출 못 되지만 localStorage 의 누적 점수는 보존 → 다음 세션 첫 액션 (다른 탭 generate / 발음 등) 에서 자연 발화. 수익 손실 0.

다른 액션 (Vocab / Scene / Listening / Pron) 은 영향 X — `deferAd` 옵션 미사용.

## 10. 사용자 보고 "Daily 한도 차감 안 됨" — 의도된 hasBonusActive 동작 (코드 변경 없음)

사용자: Free Talking 완료 + X 종료 했는데 daily 한도 차감 안 됨.

진단 결과: `hasBonusActive=true` (bonusPoints > 0) 일 때 `onSessionStarted` 에서 `incrementDailyFreeTalk` 호출 안 함 — 2026-05-13 코멘트로 명시된 의도된 동작 ("보너스 활성 시 daily 한도 차감 X — 사용자 의도 일치"). 사용자에게 보너스가 있어 daily 면제된 케이스. 회귀 아님.

**Why**: 보너스는 사용자 보상 적립분 (review/referral/streak milestone 등) — 사용자가 "추가 서비스" 로 적립한 것이라 daily 한도 + 광고 부담 둘 다 면제.

**How to apply**: 향후 "daily 차감 안 됨" 류 보고 들어오면 먼저 `bonusPoints` 확인. tier 'trial' + bonusPoints>0 면 정상 동작. 변경 원하면 사용자에게 정책 재검토 제안.

## 11. 후속 회귀 fix 2건 — Listening 광고 보상 시스템 보완

### 1.5.62 — 홈 게이지 분모에 listenCredits 반영 누락 (commit d3b2efd)
증상: Listening 광고 시청 → `listenCredits` Firestore +3 정상 적립되지만 홈 화면 게이지바 분모가 항상 3 (TRIAL_DAILY_LISTEN_LIMIT) 으로 표시 → 사용자 입장 "한도 안 늘어남".

원인: [App.jsx HomePage prop 전달부](src/App.jsx#L4093) — `dailyListenLimit={TRIAL_DAILY_LISTEN_LIMIT}` 에 `+ listenCredits` 누락. Pron `+ pronCredits` / FreeTalk `+ freeTalkCredits` 와 일관성 X.

Fix: 1줄. `dailyListenLimit={TRIAL_DAILY_LISTEN_LIMIT + listenCredits}` — 광고 1회 시청 후 3 → 6 으로 분모 갱신.

다른 표시는 처음부터 정상이었음 (TrialLimitModal 🎧 뱃지, `isTrialListenLimitReached` 가드, `consumeListenCredits` 우선 소비) — App.jsx 의 HomePage prop 만 누락.

### 1.5.63 — 보너스 활성 시 daily 차감 X 정책 누락 (commit bfc3fd3)
증상: `bonusPoints > 0` (보너스 활성) 사용자가 Listening generate 시 `addAdPoints` 는 보너스 소비로 광고 카운터 skip 되지만 `incrementDailyListen()` 은 그대로 호출되어 daily 한도 차감됨.

원인: c295bd2 commit (Listening 광고 보상 시스템 추가) 시 `hasBonusActive` 분기 미러 누락. Free Talking 의 onSessionStarted (App.jsx:5073) + Pron 의 onPronSuccess (App.jsx:781) 둘 다 `hasBonusActive` 분기로 daily 면제하는데 Listening 의 onGenerate 만 빠짐.

Fix ([App.jsx:4258-4272](src/App.jsx#L4258-L4272)):
```jsx
onGenerate={() => {
  incrementListenGenerate();        // lifetime 분석 (항상)
  if (!hasBonusActive) {            // ← 신규 분기 (1.5.63)
    if (한도 초과 + credits>0) consumeListenCredits(1);
    else incrementDailyListen();
  }
  addAdPoints(1, { bonusCost: 5 });  // bonus 활성이면 내부 skip (기존 동작)
}}
```

정책 일관성 회복:
- 보너스 활성 시 광고 카운터 skip + **daily 카운트 도 skip** (Free Talking / Pron 과 동일)
- 보너스는 사용자 보상 적립분 (review/referral/streak milestone) — daily 한도 + 광고 부담 둘 다 면제하는 정책

## 12. Capgo Production OTA 6회 배포 — 종일 누적 (1.5.57 → 1.5.63)

| 버전 | 주요 변경 |
|------|----------|
| 1.5.57 | TabTutorial 제거 + StreakIntro 이동 + StarGuide 신규 + Streak Reminder push + freeTalkHistory Phase 1+2 + StreakIntro 회귀 fix |
| 1.5.58 | Listening daily 3 + 홈 게이지 + StreakStatus 회귀 fix + Listening 첫 재생 AdsPoint + streak_risk StarGuide 통합 |
| 1.5.59 | (bump만, Capgo 미배포 — 곧바로 추가 변경 후 1.5.60 으로 진행) |
| 1.5.60 | Free Talking basic 강제 + Listening 광고 보상 + 영구 보관 라벨 제거 + TrialLimitModal Listening 뱃지 + 문구/아이콘 수정 + reengagement_* push StarGuide 통합 |
| 1.5.61 | Free Talking 광고 deferred flush (Phase 4) |
| **1.5.62** | **홈 게이지 분모에 listenCredits 반영 누락 fix** |
| **1.5.63** | **보너스 활성 시 daily 차감 X 정책 누락 fix (Free Talking/Pron 일관성)** |

## 알려진 한계 — 보류 사항

### iOS native 익명 사용자 앱 업데이트 후 onboarding 재발화
- changes-0517 의 known issue (1.2.11 → 1.3.1 업데이트 시 신규 익명 UID 생성 → onboarding 재발화)
- Self-heal effect (App.jsx:1857) 의 `user.isAnonymous` SKIP 가드 때문에 익명 유저 백필 안 됨
- 사용자가 "더 확인하고 추가 수정 필요 시 다시 논의" 로 보류
- 후속 작업 시 [[reminder-self-heal-anonymous]] 참조

## 핵심 재발 방지 학습

1. **Firestore Timestamp/Array 를 useEffect deps 에 직접 넣지 말 것** — snapshot 마다 새 reference 라 effect 매 fire. boolean (`!!`) 또는 scalar (`.toMillis()`) 변환 필수. 이 패턴 [[changes-0523]] 에서 3번 적용 (StarGuide / StreakIntro / StreakStatus).

2. **비동기 Firestore write 에 의존하는 modal trigger 는 sessionStorage 세션 가드 필수** — `updateDoc` 의 async 라운드트립 동안 다른 dep change 시 effect 재실행해도 재발화 차단. 타이머 콜백 내부에서 마킹 (cleanup race 회피).

3. **광고/리소스 차감은 critical UX 흐름 중에 끼어들지 않도록 deferAd 패턴** — 인트로/대화 진행 중 즉시 발화 회피, 종료 시점에 flush. 강제 종료 시 localStorage 누적값으로 다음 세션 자연 발화 보장.

4. **신규 사용자 동선의 default 는 "쉬운 쪽"으로 강제** — Free Talking 의 default basic 처럼, 사용자 default(intermediate)가 있어도 신규 진입 화면은 basic. 사용자가 명시 변경한 값은 그 세션 유지.

5. **"daily 한도 차감 안 됨" 보고는 먼저 `bonusPoints` 확인** — tier='trial' + bonusPoints>0 면 의도된 면제 동작.

6. **push handler 분기는 prefix 매칭으로 통합** — streak_* / reengagement_* 처럼 향후 신규 type 자동 커버. 명시 분기 (streak_reminder, streak_risk, ...) 보다 유지보수성 ↑.

7. **새 광고 보상 카테고리 추가 시 4지점 동기화 필수** — 신규 카테고리(예: Listening) 광고 보상 추가 시 다음 모두 점검:
   - **AuthContext**: `xxxCredits` 필드 + `consumeXxxCredits` 함수 + `isTrialXxxLimitReached` 가드에 `xxxCredits===0` 반영 + Provider value export
   - **App.jsx handleRewardedAd**: 신규 type 분기 (`'xxxs'`) + amount + field
   - **App.jsx HomePage prop**: `dailyXxxLimit={LIMIT + xxxCredits}` (1.5.62 결함 — `+ xxxCredits` 누락하면 게이지 분모 고정)
   - **App.jsx onGenerate 콜백 (해당 탭)**: `hasBonusActive` 분기 (보너스 면제) + credits 우선 소비 (한도 도달 시) + incrementDaily* (한도 미달 시) + `addAdPoints`. **Free Talking 의 onSessionStarted / Pron 의 onPronSuccess 패턴 mirror 필수** (1.5.63 결함 — `hasBonusActive` 분기 누락하면 보너스 활성 시 daily 차감됨)
   - **TrialLimitModal**: `🎧 {count}/{LIMIT + xxxCredits} /day` 뱃지 + Listening 등 다른 카테고리와 함께 표시

   1.5.62/1.5.63 두 회귀가 모두 c295bd2 commit (Listening 광고 보상 시스템 첫 도입) 의 mirror 누락에서 발생. 향후 비슷한 추가 시 위 4지점 checklist 로 점검 권장.
