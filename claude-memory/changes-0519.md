---
name: changes-0519
description: 2026-05-19 — Azure Speech 비용 분석(WebSearch) → 발음 한도 20→10 + 광고 보상 +10→+5 + Web Pro 가격 인상(KRW ₩9k/$5.99). Capgo v1.5.45 → v1.5.46 staging+production OTA. RevenueCat 가격 sync는 store pass-through.
metadata: 
  node_type: memory
  type: project
  originSessionId: 2c3730c6-e5be-4aeb-942a-901a350033c0
---

# 2026-05-19 작업 요약

## 배포 결과
- **Git**: f116d86 → f00f7e5 (5+ commits)
- **Capgo staging/production**: v1.5.45 → **v1.5.46** (production promote 완료, `--ignore-metadata-check`)
- **Vercel/Render**: 자동 배포 완료

## 1. Azure Speech 비용 분석 (WebSearch)

### 가격 (2026 S0 Standard tier)
- **STT 실시간**: $1.00/audio hour
- **Pronunciation Assessment add-on**: $0.30/audio hour → 발음 평가 총 **$1.30/audio hour**
- **Neural TTS Standard prebuilt**: $15/1M chars (Commitment 2000M tier $7.50/M)

### 단위 비용
- 발음 평가 1회 (4초 audio): **$0.00144**
- TTS 1회 (60 chars): **$0.0009**
- Free Talking STT 1 turn (8초): **$0.0022**

### 광고 수익 vs 비용 분석
- 한국 보상형 광고 eCPM: iOS $29, Android $11.23 (Q1 2024) — 학습앱 조정 시 Android ~$8, iOS ~$20
- **광고 1회 시청 ($0.010) < 발음 10회 비용 ($0.0144)** → Android/저eCPM 지역에서 break-even 적자
- DAU 100명 가정 추정 Azure 월 비용 ~$200 vs 광고 수익 ~$15/월 → Pro 구독이 보전 구조

## 2. 비용 절감 적용 (commit 21ab2d3)

### 발음 일일 한도 20 → 10
- [AuthContext.jsx:317](src/context/AuthContext.jsx#L317) `TRIAL_DAILY_PRON_LIMIT = 10`
- 효과: Free 사용자 일 발음 비용 $0.029 → $0.0144 (50% 절감)

### 광고 보상 +10 → +5
- [App.jsx:789](src/App.jsx#L789) `const amount = type === 'freeTalks' ? 2 : 5;`
- 효과: 광고 1회 시청 단가($0.010) > 발음 5회 비용($0.0072) → +38% 흑자

### i18n 10 locale 동기화
- `watchForProns` (사이드바 버튼): "+10 발음" → "+5 발음"
- `seeSidebarReward` (한도 popup 안내): "+10" → "+5"
- `limitDesc` (한도 안내): "20 pronunciation tests" → "10 pronunciation tests"

## 3. Web Pro 가격 인상 (commit ce1e947)

| Plan | Before | After | discount |
|---|---|---|---|
| Pro 1개월 KRW | ₩4,990 | **₩9,000** | — |
| Pro 3개월 KRW | ₩13,990 (7%) | **₩22,000 (18%)** | hardcoded 18 → 실표시 19% (calcDiscounts 자동) |
| Pro 1개월 USD | $3.49 | **$5.99** | — |
| Pro 3개월 USD | $8.99 (14%) | **$14.99 (17%)** | hardcoded 17 |
| Premium 1/3 KRW/USD | 변경 없음 | — | — |

### 발견: calcDiscounts가 hardcoded 덮어씀
[UpgradeModal.jsx](src/components/UpgradeModal.jsx) `calcDiscounts` 함수가 PLAN_CONFIGS의 hardcoded discount를 자동 계산값으로 덮어씀. 화면엔 자동 계산 결과 표시. 향후 cleanup 시 `discount: null`로 두면 충분.

## 4. RevenueCat 가격 sync 메커니즘 — Store Pass-Through

### 핵심
- RevenueCat은 **자체 가격 저장 X** — Google Play / App Store에서 가격 자동 받아 SDK로 pass-through
- 클라가 `purchases.getOfferings()` 호출 → `product.priceString` / `product.price` / `product.currencyCode` 반환
- [UpgradeModal.jsx:99](src/components/UpgradeModal.jsx#L99) `price: product.priceString` 그대로 표시
- **사용자가 store에서 가격 조정하면 Native 앱은 자동 반영, 코드 변경 0**

### RevenueCat dashboard에는 Pricing 탭 없음
- Products 페이지에 status/entitlements만 표시
- "dashboard and event prices are all in USD" (events `price_in_purchased_currency` 필드에 실 통화 가격)
- 사용자가 dashboard에서 가격 못 찾는 게 정상

### 가격 검증 방법 (3가지)
1. **Google Play Console** (Android 즉시) — 각 product의 Base prices
2. **App Store Connect** (iOS) — Price Schedule, "Approved/Ready for Sale" 상태
3. **클라 SDK debug log** — `console.log(product.priceString)` 임시 추가

### Pro 가격 적용 timeline
- Google Play: 사용자 어제 조정 → 즉시 sync
- App Store: 사용자 어제 조정 → Apple 검토 4~24h → 다음날 sync

## 5. Capgo 배포 흐름 (오늘 진행)

| 시각 | 버전 | 채널 | 내용 |
|---|---|---|---|
| 새벽 | 1.5.45 | staging → production | 어제 잔여 묶음 (StreakStatusPopup 10s + Translation 저장 fix + CategorySlider race) |
| 오후 | 1.5.46 | staging | 발음 한도 20→10 + 광고 보상 +10→+5 + Web Pro 가격 + i18n 10 locale |
| 저녁 | 1.5.46 | **staging → production** | promote 완료 (사용자 검증 후) |

## 6. 신규 학습

### RevenueCat 가격 검증 패턴
- Dashboard "Pricing 탭" 없음 — store pass-through 구조
- 가격 sync 검증은 store(Google Play Console / App Store Connect) 또는 클라 debug log
- 사용자 dashboard에서 가격 못 찾으면 → 이 메커니즘 안내

### calcDiscounts 자동 계산 vs hardcoded
- `PLAN_CONFIGS.discount`는 hardcoded지만 실제 화면에 calcDiscounts 자동 계산값이 적용됨
- 새 가격 변경 시 hardcoded 정확히 안 맞춰도 무방 — 자동 계산이 진실
- 코드 cleanup 시 `discount: null` 권장

### 비용-수익 break-even 분석
- 한국 Android 보상형 광고 eCPM $11 기준 광고 1회 ≈ $0.010
- Azure 발음 평가 1회 ≈ $0.00144
- 1:10 보상 비율 = 광고 $0.010 < 비용 $0.0144 (24% 적자)
- 1:5 보상 비율 = 광고 $0.010 > 비용 $0.0072 (38% 흑자)

## 7. 잔존 follow-up (감시 대상)

### 사용자 reaction 모니터링 (24~48h)
- DAU 추세 (한도 절반 축소 후 이탈 신호)
- 카드/Free Talking 사용량 변화
- Pro 전환율 (₩9,000으로 인상됐어도 한도 축소로 압력 ↑ 기대)
- Azure Portal 실 비용 감소 추세 확인

### Apple iOS 가격 sync 검증
- 어제 App Store Connect 조정 → 내일 새 가격 적용 예상
- RevenueCat dashboard iOS product Status "Approved" 확인
- 클라에서 native iOS 사용자 가격 $5.99 표시 확인

### 자동 갱신 기존 구독자 (grandfathering)
- 옛 가격(₩4,990 / $3.49)로 가입한 Pro 구독자 갱신 시 가격 정책 미확인
- Toss billingKey 자동 갱신 로직 점검 필요 (server/routes/subscription.js)
- Apple/Google 기본 정책: 기존 구독자 옛 가격 grandfathering (보통)

### Gemini Flash-Lite 503 재시도 (5/18 잔여)
- 어제 발견된 transient 503 UNAVAILABLE 빈도 — 재시도 로직 미구현
- 사용자 미요청 상태

## 8. 핵심 결정 / 정책

| 항목 | 결정 |
|---|---|
| 발음 일일 한도 | **20 → 10** (Azure 비용 절감) |
| 광고 보상 (pron) | **+10 → +5** (break-even 회복) |
| 광고 보상 (freeTalks) | +2 그대로 |
| Web Pro 가격 (KRW) | ₩4,990/₩13,990 → **₩9,000/₩22,000** |
| Web Pro 가격 (USD) | $3.49/$8.99 → **$5.99/$14.99** |
| Premium 가격 | 변경 없음 (Web KRW ₩16,990/₩35,000, USD $10.99/$24.99) |
| Native 가격 | RevenueCat 자동 sync — 사용자가 store에서 조정 (Google 완료, Apple 내일) |
| StreakStatusPopup 자동 소거 | 6s → 10s (어제 작업 + 오늘 production 반영) |

## 핵심 교훈

1. **RevenueCat은 단순 store pass-through** — Dashboard에 가격 표시 없는 게 정상. 가격 검증은 store 또는 클라 SDK log.
2. **calcDiscounts 자동 계산이 hardcoded 우선** — 가격 변경 시 hardcoded discount 정확히 안 맞춰도 화면은 정확 (자동 계산).
3. **광고 보상 비율은 단순 사용자 가치가 아니라 비용 회수 관점** — 광고 eCPM × 1 vs 보상 행위 비용 비교가 손익 정확.
4. **Azure Speech S0 비용 직선 비례** — 발음 한도 축소가 가장 직접적 비용 절감 lever.
5. **Capgo `--ignore-metadata-check` 안전 사용 패턴 일관 적용** — JS only 변경 + native lock 0 검증 확인 후 (changes-0515.md, 0518.md, 0519.md 누적).
