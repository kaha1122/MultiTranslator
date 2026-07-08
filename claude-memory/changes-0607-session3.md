---
name: changes-0607-session3
description: "2026-06-07 3차 — FreeTalk 프롬프트 학습목적 강화+TTS 원가절감 / Pro 무제한→월캡(발음1000·FT100·Listen200)+상단바 월게이지 / 포인트 인앱구매(200pt/$0.99, RC consumable, webhook 멱등적립) 전체 구현 → Capgo production 2.0.2 승격. Android 실결제 검증 완료."
metadata: 
  node_type: memory
  type: project
  originSessionId: c0caf0e9-26ac-4c92-9dcf-5ed266f3bbd0
---

# 2026-06-07 3차 — 프롬프트 개선 + Pro 월캡 + 포인트 인앱구매 (→ production 2.0.2)

## 1. FreeTalk 원가절감 + 학습목적 프롬프트 강화 (서버/Render)
원가 분해: **TTS ~56% / STT ~34% / Gemini ~10%**. TTS billable의 ~40%가 express-as 마크업(Azure는 마크업도 과금, `<speak>`/`<voice>`만 제외).
- **① express-as 제거** ([converse.js converse-tts](server/routes/converse.js)): `<mstts:express-as>` 래핑 삭제(중립 톤) → 세션 TTS ~24%↓. 대부분 기본 style="chat"이라 톤 체감 작음.
- **② reply 길이 단축**: buildReplyPrompt rule9 비basic 1~3→**1~2** + 단어수 예산(inter≤12/adv≤20) 연동. firstAiReply도 동일.
- **학습목적**(conversationPrompt.js): 두 프롬프트 [Role] 직후 **[Pedagogical Frame]** 신설(현실성<이해가능성, 수준 어휘/길이 예산 강제) + buildStartPrompt Phase0 **⑥ TARGET VOCABULARY**(고빈도·재사용 어휘로 case 선택, basic=top800) + basic 구체값 단순화(흔한 값만).
- 비트레이트는 TTS 원가와 무관(글자수 과금) — 효과 없음.

## 2. Pro 무제한 → 월 한도 (클라 게이팅, 유료라 저위험)
- **PRO_PRON_LIMIT 1500→1000** + **PRO_FREETALK_LIMIT=100** + **PRO_LISTEN_LIMIT=200** 신설. **Premium 무제한 유지**.
- 월 리셋: 기존 `proPronResetMonth` 공통 앵커로 **3종 카운트 동시 0**(새 필드 불요, 기존 Pro 호환). `incrementProFreeTalk`/`incrementProListen`(tier 가드).
- 게이팅: `isProFreeTalk/ListenLimitReached` + FreeTalk(onFreeTalkStart)/Listening(prop OR+콜백 라우팅)/발음(6핸들러 Pro 라우팅). 도달 시 **requestProLimitModal()→reason 'proMonthly'**.
- TrialLimitModal **proMonthly 분기**: "이번 달 한도 · 다음 달 1일 리셋" + Premium 업셀(Trial 'cap'/'points'와 별개).
- **상단 고정바**: Trial 일일3종 / Pro **월 3종**(💬/100·🎤/1000·🎧/200) / Premium "∞ Premium". **목표달성(Target) 게이지 제거**(홈에 있음). `.tsb-gauges` 압축 유지.
- 문구: 사이드바 `proDesc` + 모달 `proFeature1/3` 새 캡 반영(10 locale).

## 3. 포인트 인앱 구매 (소비성 IAP, +200) — 신규 매출채널
- **상품**: `pronunfit_points_200` (Play 일회성+iOS Consumable, 동일 ID). $0.99 baseline → **KRW 1,200 / VND 20,000** 국가별 튜닝. **멀티수량 OFF**(Play "단일 거래 2개+ 허용" 체크 해제 → 수량 스텝퍼 제거 → 고정 200 적립 코드와 정합).
- **RevenueCat**: Product 등록, **entitlement 미연결**(소비성). 기존 **"Firestore Sync" webhook(All events)**이 그대로 라우팅 → **새 webhook 불요**.
- **서버**: [webhook.js](server/routes/webhook.js) `NON_RENEWING_PURCHASE` + product==points → `grantBonusPoints(200,'pointPurchase')`. **멱등**: `pointPurchases/{transaction_id}`.create() (ALREADY_EXISTS→skip). **sandbox 가드보다 먼저 처리**(TestFlight 검증). bonusPoints.js: `pointPurchase`는 **tier 무관 항상 적립**(결제=실돈, Pro skip 예외).
- **클라**: `handleBuyPoints`(getProducts INAPP→purchaseStoreProduct), RC configure 시 `pointsPriceString` 조회. 사이드바 추가학습 + 포인트부족 모달 둘 다 🪙 **보너스포인트(구매)+200·가격** 버튼(trial+native+가격조회 성공시). 광고 버튼은 "🎬 보너스포인트(광고)+5". 적립은 webhook→Firestore onSnapshot 자동 반영.
- **자격**: 구매 버튼 UI는 trial+native만 노출. 적립은 tier 무관(만일의 경로 대비). Pro는 게이팅이 카운트라 포인트로 안 풀려 무의미 → trial만 정답.
- **검증**: Android 실결제 "결제 완료" 확인. iOS는 **미승인** → sandbox/TestFlight만 표시.

## 4. 배포 (production 2.0.2)
- main push로 서버(Render: 프롬프트+webhook) + 웹 배포. Capgo: staging 2.0.1→2.0.2 → **`channel set production --bundle 2.0.2`** 승격(재업로드X). 2.0.0(개편)→2.0.2(프롬프트+Pro캡+포인트).

## 5. 남은 작업 (TODO)
- **iOS IAP 심사 제출**: 심사 스크린샷은 앱 지원 규격(1290×2796 등, 72dpi RGB flatten 둥근모서리X)과 일치 필수. 424px 크롭→1290×2796 업스케일본 생성([promo_images/ios_submit](promo_images/ios_submit))했으나 흐림 → **풀해상도 폰 스크린샷 권장**. 이미 승인된 구독 IAP가 있어 **앱 바이너리 없이 독립 제출 가능**. 승인돼야 iOS 유저 구매 가능.
- production 모니터링: `bonusPoints` 적립 / `pointPurchases/{tx}` / 6월 Azure 청구서 TTS 하락폭.

## 6. FreeTalk 신규유저 포인트 낭비 방지 — 레이어1 완료(production 2.0.3) / 레이어2-A 보류
- 진단: 실로그상 신규 유저가 오프너만 보고 **freeTurnCount 0·4초 만에 닫아 −10점 낭비**(잘 이해/활용 못함). 2회=20점.
- **레이어1(완료, production 2.0.3)**: 차감·카운트(일일/Pro/총)를 `onSessionStarted`→**`onFirstUserTurn`**(첫 free turn=freeTurnCount 0→1)로 이동. FreeTalkingChat `firstTurnChargedRef`(세션시작 시 리셋, 편집 재생성 1→0→1 이중차감 방지). 게이트는 열기 시점 유지. → **열고 안 쓰고 닫으면 0점**. 하드캡은 engaged 기준 카운트. (commit 546b9ff)
- **레이어2-A(보류, 사용자 숙고 중)**: 캔드(저장) 튜토리얼 — 첫 진입 시 언어별 1회 생성→Firestore 캐시 재사용, 코치마크 워크스루, 0점/device or 캐시 Azure TTS, `freeTalkOnboarded` 플래그. **판단 기준: Layer1이 bail "비용"은 이미 제거 → 2-A의 가치는 "이해/참여"뿐. `freeTurnCount 0 비율`(열고 안 쓴 세션)을 며칠 측정 → 여전히 높으면 효과적/낮으면 부수적.** 데이터(freeTalkHistory.freeTurnCount) 이미 있음.

## 재사용 교훈
- **Google Play 멀티수량 토글**("단일 거래 2개+ 허용") 켜져 있으면 고정금액 webhook이 과소지급(2개 사도 200만) → **OFF가 최선**(수량 반영하려면 RC webhook엔 quantity 없어 Play Developer API 검증 필요 = 과함).
- **RC 소비성**: entitlement 안 씀 / webhook `NON_RENEWING_PURCHASE`로 적립 / 멱등 = store transaction_id `.create()` / **결제 적립은 Pro-skip 예외**(실돈).
- **기존 RC webhook(All events)는 새 이벤트타입도 자동 라우팅** → 중복 webhook 만들지 말 것(이벤트 2배).
- Azure TTS는 **SSML 마크업도 과금** → express-as/prosody 제거가 "캐시 못 막는 신규합성" 원가 절감 레버. FreeTalk TTS가 세션 원가 최대.
- 작은모델 프롬프트는 **[Pedagogical Frame]을 [Role] 직후 최상위 배치**해야 현실성 규칙을 누르고 학습목적이 지배.
- [[changes-0607-session2]] [[changes-0606-session3]] [[feedback_capgo_verify]] [[feedback_client_server_parity]]
