---
name: 2026-04-21 변경사항
description: RevenueCat entitlement miss 오탐 다운그레이드 근본수정(클/서 3단 가드), PayPal start_time 이중결제방지, PayPal SDK 로딩 최적화, 설정 NEW 뱃지 웹 영구표시 버그수정, Translation/Scene UX 개선, 후리가나/핀인 sanitizer, 결제 통화 판정 phoneCountry 기반 전환 (Capgo v1.4.53)
type: project
originSessionId: d951046a-563d-4f92-bb08-ab0f03fbcf97
---
# 2026-04-21 변경사항

**배포 상태**: Capgo production v1.4.53, Vercel `5b2f370`, Render 자동배포 완료

## 사건 개요

사용자(`vTXu7ZlWNXMOjXw5Orco2KKUaR72`, sw.haka@gmail.com)가 두 차례에 걸쳐 **정상 구독 상태임에도 tier=trial로 오탐 다운그레이드** 되는 현상 보고. Firestore `tier:"pro"`, `subscriptionExpiresAt:2026-04-28`, `tierSource:"revenuecat"`, `planId:"rc_promo_Pro_monthly"` 상태에서 발생.

- **1차 (12:52)**: 안드로이드 앱 콜드 스타트 중 "구독 만료" 팝업 표시 → 분석 결과 cold-start race condition
- **2차 (16:34)**: 웹 로그인 시 서버 `/api/check-subscription`이 동일 버그로 강제 다운그레이드 → 팝업은 클라 fix로 차단됐으나 tier=trial 상태 발생

## 근본 원인 (3곳 동일 로직 + 서버 엔드포인트 1곳)

RevenueCat `getCustomerInfo()` / `restorePurchases()`가 active entitlement을 못 잡으면 (promo `rc_promo_*` 미반영, SDK 초기화 race, API miss 등) **Firestore `subscriptionExpiresAt` 유효성 무시하고 즉시 tier=trial 강제 다운그레이드**.

## 수정 내용

### A. RC 오탐 다운그레이드 가드 추가 (핵심 버그 fix)

모든 경로에 공통 로직 적용:
```js
const expiresAt = profile?.subscriptionExpiresAt?.toDate?.()
    ?? (profile?.subscriptionExpiresAt ? new Date(profile.subscriptionExpiresAt) : null);
if (expiresAt && new Date() < expiresAt) {
    return; // skip downgrade
}
```

1. **클라이언트 (`7ac2ec8`)** — 3곳:
   - [AuthContext.jsx:374](src/context/AuthContext.jsx#L374) RC sync useEffect
   - [App.jsx:514](src/App.jsx#L514) restorePurchases 후 다운그레이드
   - [App.jsx:277](src/App.jsx#L277) lostPaid 팝업 가드 (방어적 2중 안전망)

2. **서버 (`4d7327c`)** — `/api/check-subscription` ([subscription.js:270](server/routes/subscription.js#L270)):
   - 웹 로그인 시 호출되는 엔드포인트
   - 동일 가드 누락 상태였음 → 클라 fix 후에도 웹 경유 다운그레이드 재발
   - 2차 사건의 실제 범인
   - 교훈: [feedback_client_server_parity.md](feedback_client_server_parity.md) 저장

### B. PayPal 웹 결제 이중 청구 방지 (`a672ff5`)

- [UpgradeModal.jsx:871](src/components/UpgradeModal.jsx#L871) `createSubscription`에 `start_time` 추가
- 기존 구독 `subscriptionExpiresAt`이 미래면 그 시점부터 PayPal 첫 청구
- PayPal은 승인 후 `APPROVED` 상태(scheduled)로 대기 → 해당 시각에 첫 청구 + 자동갱신 시작
- 서버 `/api/paypal-activate`는 이미 `sub.status === 'APPROVED'` 허용 상태라 scheduled subscription과 호환

### C. PayPal SDK 로딩 waterfall 단축 (`e2d4507`)

사용자가 "선택" 버튼 클릭 후 PayPal 버튼이 뜨기까지 **1분+ 체감 지연** 발생 → 이하로 단축:

1. `index.html`에 preconnect 2줄 추가 — paypal.com / paypalobjects.com DNS/TCP/TLS warmup
2. `UpgradeModal.jsx`의 `@paypal/react-paypal-js`를 `lazy()` → 정적 import 전환
   - React lazy 청크 다운로드 waterfall 단계 제거
   - `PayPalScriptProvider`가 모달 오픈 즉시 mount → SDK 스크립트 삽입이 "선택" 클릭 전부터 시작
- Main bundle +5KB gzip (기존 분리 청크 7.4KB 흡수, net loss 미미)
- **시크릿 창 cold start에서 거의 실시간 표시 검증 완료**

### D. 설정 NEW 뱃지 웹 영구 표시 버그 (`1d105b4`)

- 현상: 웹 유저가 설정 진입해도 사이드바 빨간 dot이 매 로그인마다 표시
- 원인: NotificationSettings의 토글들이 `disabled={!isNative}` → 웹에서 `onChange` 발생 불가 → `markSeen()` 호출 경로 차단
- [NotificationSettings.jsx:99](src/components/NotificationSettings.jsx#L99) auto-markSeen useEffect 추가:
  - `active=true` + `!seen` 상태에서 1.5초 후 `markSeen()` 자동 호출
  - 기존 auto-scroll로 섹션이 시야에 들어오므로 "사용자가 봤다"는 의미로 정당
  - 웹/네이티브 공통, 기존 토글 기반 markSeen도 유효

### E. 타 세션 커밋 네이티브 반영 누락분

1.4.51 Capgo 업로드 이후 main에 올라갔으나 Capgo 미반영이었던 클라이언트 커밋 2개도 이번 1.4.52에 함께 배포됨:

- **`16efb78`** Translation tips + Scene 스크롤 안정화:
  - Translation 프롬프트 최상단 `[ABSOLUTE OUTPUT RULE]` 섹션 신설
  - tips/detectedLangTip/exampleTranslation 3필드를 한 번에 커버
  - "설명은 모국어, 인용만 타겟어" 대조 few-shot 제공 (한국어→일본어 예시)
  - ScenePractice 스크롤: VocabTab/NotificationSettings 검증 패턴으로 교체 (`.app-container` 직접 + RAF+150ms + height=0 5회 재시도 + sticky header 높이 차감)
- **`3f7a9d2`** 후리가나/핀인 sanitizer:
  - ja: 한자 뒤 `（たべる）` 제거
  - zh-CN/zh-TW: 한자 뒤 `(kāfēi)` 제거 (성조기호 필수 조건으로 false positive 회피)
  - 서버(scene/vocab/listening) + 클라이언트(App.jsx Translation + stripAnnotations.js) 양쪽 적용

## 2차 사건 수동 복구

사용자 계정 `vTXu7ZlWNXMOjXw5Orco2KKUaR72`:
- Firestore `tier: "trial"` → `"pro"` 수동 복구 (사용자 직접 수정)
- `autoRenew: false`는 유지 (원래 promo 취소 상태였음)
- `tierUpdatedAt`도 갱신

## Capgo 1.4.52 배포에 포함된 누적 변경 (1.4.50 대비)

Capgo 1.4.50 → 1.4.52 점프 (1.4.51은 중간 업로드였으나 `5719f1e` 버전 bump 커밋만 있던 상태).

네이티브 사용자 체감 변경:
- RC cold-start 오탐 다운그레이드 차단 (A)
- Translation/Scene UX 개선 (E-16efb78)
- TTS 후리가나/핀인 반복 발음 이슈 해결 (E-3f7a9d2)
- 설정 NEW 뱃지 자동 해제 (D)

### F. 결제 통화 판정 정책 전면 전환 (`5b2f370`, Capgo v1.4.53)

[사건] 구독 만료 예정 팝업 → 갱신하기 → **한국 사용자인데 USD/PayPal 화면 표시** → PayPal은 한국↔한국 거래 금지 정책이라 결제 불가능.

[원인 1차 분석] 클라 `detectCountry()`([src/utils/detectCountry.js](src/utils/detectCountry.js))가 `ipwhois.app` API에 의존. 간헐적 실패(rate limit/CORS/네트워크)로 fallback US/USD 판정. Timeout 5초라 응답 못 받으면 5초 지연.

[원인 2차 분석 — 실데이터] `server/users_export_2026-04-08.csv` 집계:
```
Total users: 340
phoneCountry empty:  328 (96.5%) ← 대부분이 null
phoneCountry set:     12 (3.5%)  → KR 8, US 2, 오염 2
```
→ 원인: 문서 생성 로직([AuthContext.jsx:84,130](src/context/AuthContext.jsx))에서 phoneCountry 미기록. 프로필 편집/전화 인증 UI 거쳐야만 저장됨. 대다수 유저가 영원히 null.

[정책 전환] "실시간 IP 기반" → "phoneCountry 기반":
- 한국 유저는 한국 번호 외에 쓸 이유 없음 (결정적 신호)
- 해외 거주 한국인도 한국 카드(KRW) 결제 선호 (해외 수수료 절약)
- IP 의존성 완전 제거 — 외부 API 실패 영향 무관

[수정 1] [UpgradeModal.jsx:333](src/components/UpgradeModal.jsx#L333):
```js
const isKR = profile?.phoneCountry === 'KR';
```

[수정 2] 기존 null 유저 자동 보완 useEffect ([AuthContext.jsx:298](src/context/AuthContext.jsx#L298)):
```js
useEffect(() => {
    if (!user?.uid || !profile) return;
    if (profile.phoneCountry) return; // 이미 있으면 skip
    const inferred = profile.geoCountry
        || (profile.sourceLang === 'ko' ? 'KR' : null);
    if (!inferred) return;
    updateDoc(doc(db, 'users', user.uid), { phoneCountry: inferred }).catch(() => {});
}, [user?.uid, profile?.phoneCountry, profile?.geoCountry, profile?.sourceLang]);
```
우선순위: geoCountry(서버 IP 감지) → sourceLang='ko' 추정. 96.5% null 유저가 다음 로그인 시 자동 해소.

[수정 3] 신규 유저 문서 생성 시 phoneCountry 즉시 기록 ([AuthContext.jsx:87, 133](src/context/AuthContext.jsx#L87)):
```js
detectGeoInfo().then(info => {
    updateDoc(docRef, {
        geoCountry: info.country,
        geoCity: info.city || '',
        geoRegion: info.region || '',
        phoneCountry: info.country, // ← 신규 추가: 결제 통화 결정 기본값
    });
});
```

[시나리오 검증]
- 현재 사용자 (phoneCountry='KR' 있음): 즉시 KRW ✅
- 한국인 + null + geoCountry='KR': 1회만 USD, 다음 로그인부터 KRW ✅
- 한국인 + null + geoCountry null + sourceLang='ko': sourceLang 추정으로 'KR' 세팅 ✅
- 미국인 + null + geoCountry='US': 'US' 세팅, USD 유지 ✅
- 한국→미국 이민 + phoneCountry='KR' 유지: KRW (한국 카드 쓰는 한 정상)
- 한국 여행 중 미국인: sourceLang 'ko' 아니면 geoCountry 'US' → USD ✅
- VPN/해외 경유: phoneCountry 기준이라 영향 없음 (기존 IP 기반의 최대 약점 해소)

[타임라인]
- 배포 직후: 기존 null 유저는 여전히 USD
- 첫 재로그인: 자동 보완 useEffect 발동 → phoneCountry 채워짐
- 두 번째 로그인부터: 올바른 통화 표시
- → "다음 로그인 1회만 지나면 96.5% → 거의 0% 해소"

[관련 원래 설계 맥락] [changes-0405.md](changes-0405.md)에서 `detectCountry`(결제용, 클라 직접)와 `detectGeoInfo`(프로필 기록용, 서버 경유) 분리한 이유는 iOS WKWebView 안정성 + "실시간 IP 기반 통화 결정". 오늘 정책을 "실시간 IP" → "phoneCountry 기반"으로 전환하며 `detectCountry()` 자체는 fallback용으로만 남음(향후 제거 검토 가능). 원래 설계 의도(해외 여행 중이면 USD 안내)는 포기했으나, 실사용 니즈(한국인은 해외에서도 KRW 선호)에 부합.

## 검증 / 사이드이펙트 점검

### A-가드 사이드이펙트 표 (16시나리오 점검 결과)
- 정상 활성 구독자: 영향 없음 (첫 분기로 빠짐)
- 실제 만기 (expiresAt 지남, RC off): 정상 다운그레이드 + 팝업
- RC EXPIRATION webhook 수신 후: tier=trial + expiresAt 이력보존(과거) → 가드 통과 정상
- Apple/Google 환불 → RC webhook: 정상
- Toss 전액환불: `tierSource='toss'`로 바뀌어 RC 분기 미진입
- RC API 일시 오류: **개선** (기존 오탐 차단)
- RC 프로모션(`rc_promo_*`) 유저: **해결**
- Family Sharing / 멀티 디바이스: **개선**
- 사용자 자발 취소 (willRenew=false): expiresDate까지 active 유지 → 정상 분기

### Vercel env 검증
`VITE_PAYPAL_CLIENT_ID`, `VITE_PAYPAL_PLAN_PRO_1/3`, `VITE_PAYPAL_PLAN_PREMIUM_1/3` 5개 모두 Vercel 프로젝트에 설정됨 확인 (로딩 지연 원인에서 제외).

## PayPal 추가 발견 사항 (미해결, 미조치)

1. **한국↔한국 PayPal 제약**: "한국에 등록된 PayPal 계정 간에는 결제 불허" 정책 → 한국 사용자 실질적으로 Toss만 사용 가능. USD로 뜨는 문제는 F단계에서 phoneCountry 기반으로 전환하며 근본 해결.
2. **RenewalReminderPopup find() 로직 버그**: `REMINDER_DAYS=[10,7,2]`에 대해 `.find(d => diffDays <= d)` 호출 시 항상 `10`만 반환 → 의도된 "10일/7일/2일 전 3회 알림"이 실제론 "10일 이내 1회"로만 동작. 현재 사용자 경험상 큰 문제는 없어 미수정. 추후 정렬 순서 변경(`[2,7,10]`) 검토 가능.
3. **detectCountry() fallback 경로 잔존**: F단계로 IP 의존성은 주 경로에서 제거됐으나 `detectCountry` 함수 자체는 다른 용도(예: 국가 관련 다른 분기)에서 아직 쓰일 수 있어 유지. 향후 사용처 전수 조사 후 완전 제거 여부 결정.

## 커밋 목록 (이 세션)

- `7ac2ec8` fix: RC entitlement miss 시 만기일 전 강제 다운그레이드 방지
- `5719f1e` chore: bump version to 1.4.51 (Capgo production 배포 반영)
- `4d7327c` fix(server): /api/check-subscription도 RC miss 시 만기일 가드 추가
- `a672ff5` feat(paypal): 기존 구독 만기일부터 첫 결제 시작 (이중 결제 방지)
- `e2d4507` perf(paypal): PayPal SDK 로딩 waterfall 단축 — preconnect + lazy→static import
- `1d105b4` fix: 설정 NEW 뱃지 웹 영구 표시 버그 + 1.4.52 Capgo 동기화
- `5b2f370` fix: 결제 통화 판정을 phoneCountry 기반으로 단순화 + null 유저 자동 보완 (Capgo v1.4.53)

## 타 세션 커밋 (같은 날 배포에 포함)

- `16efb78` fix: Translation tips 모국어 강제 강화 + Scene 카드 스크롤 안정화
- `3f7a9d2` fix: 일본어 후리가나/중국어 핀인 주석 서버·클라이언트 sanitizer 추가

## 연관 메모리

- [feedback_client_server_parity.md](feedback_client_server_parity.md) — 본 사건에서 배운 규칙, 향후 tier/구독 로직 수정 시 클라/서버 양쪽 grep 필수
