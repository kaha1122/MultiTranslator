---
name: 2026-05-01 Re-engagement Push 시스템 구축 + Production 배포
description: 미접속 유저 자동 복귀 푸시 — lifecycleStage 기반 D1/D3/D5(starter) + D2/D4/D6(engaged), 국가별 local 10시, 매시간 cron, 2,158명 백필 완료
type: project
originSessionId: c6698add-4a6d-4a17-9a62-7d4c04af08b6
---

# Re-engagement Push 시스템 (2026-05-01 구축 + 운영 시작)

## 배경 — GA 분석에서 시작
2026-04-30 GA 30일 데이터 분석에서 발견:
- 활성 4.7K vs 재방문 1K (재방문율 ~21%)
- 신규 3.4K vs 재방문 1K → **신규의 ~70% 1회성 이탈**
- 4/19~24 급락 (FB App ID 이전 + IG 90일 쿨다운 + Azure Speech F0 장애 동시 발생)

**결정**: retention이 진짜 병목. D1/D3/D5 미접속 자동 복귀 푸시를 1차 레버로 채택.

## 최종 정책 (구현됨)

| 그룹 | 윈도우 | 메시지 |
|---|---|---|
| `lifecycleStage` ∈ {`starter`, null/undefined} + FCM | **D1, D3, D5** | `reengagement_starter` (Message A) |
| `lifecycleStage` ∈ {`engaged`, `subscriber`} + FCM | **D2, D4, D6** | `reengagement_engaged` (Message B) |

**제외 조건** (윈도우 무관):
- `fcmTokens` 비어있음/없음
- `reengagementOptOut === true`
- `tier === 'admin'`
- `createdAt` 24h 이내 (D0 신규 — onboarding 트랙 별도)
- 같은 윈도우 이미 발송됨 (`reengagementSentAt.{d1At..d6At}`)
- `currentNativePlatform === 'ios'` AND `REENGAGEMENT_IOS_ENABLED !== 'true'` (env flag, 1차 비활성)

**`isAnonymous` 조건은 제외하지 않음** — 익명도 starter/engaged 가능. (사용자 명시 결정)

## Firestore 스키마 (신규 필드)

| 필드 | 위치 | 설명 |
|---|---|---|
| `lastActiveAt: Timestamp` | `users/{uid}` | `useDailyProgress.markActiveDayIfFirst` 트랜잭션이 그날 첫 의미있는 행동 시 갱신. 단순 앱 오픈은 갱신 안 함. |
| `reengagementOptOut: boolean` | `users/{uid}` | 기본 false(옵트인). NotificationSettings 토글로 변경. 별도 토글 — subscriptionAlertOptOut과 분리. |
| `reengagementSentAt: { d1At, d2At, d3At, d4At, d5At, d6At: Timestamp }` | `users/{uid}` | 윈도우별 idempotency. cron이 update할 때 dot-path FieldValue.serverTimestamp() 사용. |
| (collection) `reengagementLogs/{ts-{countries}}` | top-level | cron 실행별 1 doc — `ranAt, targetCountries, totals{candidates,sent,failed}, skipAggregate`. dryRun 모드는 기록 안 함. |

**Firestore 인덱스** (수동 생성 필요했음):
- `users` 컬렉션, **`geoCountry ASC + lastActiveAt ASC`** 복합 인덱스
- 첫 cron 실행 시 인덱스 누락 에러 → 콘솔 자동 생성 링크 클릭 → 5~10분 빌드 → "사용 설정됨"

## 메시지 카피 (`server/utils/sendPush.js` `PUSH_MESSAGES`)

10개국어 직접 작성 (ko/en/ja/zh-CN/vi/es/fr/de/ru/pt-BR):

**reengagement_starter** (Message A) — 한국어 원문:
- Title: "PronunFit과 함께 오늘의 학습 진행해 보실까요?"
- Body: "어학 공부는 매일매일 꾸준히 학습을 이어가는게 중요하니까요"

**reengagement_engaged** (Message B) — 한국어 원문:
- Title: "PronunFit과 함께 오늘도 학습을 계속 이어가 볼까요?"
- Body: "매일 카드 10장 학습하는 습관을 만들어 보아요"

## 발송 시간 — 각 국가 local 10시

cron 매시간 실행 (`0 * * * *`) → 매 실행마다 "지금 local 10시인 국가" 식별 후 그 국가 유저만 처리.
- `server/utils/countryTimezone.js`: 35+ 국가 IANA TZ 매핑, `Intl.DateTimeFormat`로 DST 자동 처리
- `geoCountry` → 1차 우선
- `geoCountry` 없으면 `deviceLang → 대표 국가` fallback (예: ko→KR, en→US, vi→VN)
- 둘 다 없으면 KR fallback (KST 10시)

검증된 동작 예시: 5/1 09:49 UTC cron 실행 → BST/WEST/IST 적용된 GB/PT/IE가 local 10:49 → 정확히 잡힘 ✅

## Cron 엔드포인트

`POST /api/cron/reengagement-push` (`server/routes/reengagement.js`)

| 모드 | 호출 형태 | 용도 |
|---|---|---|
| 정상 cron | `?` 없이 | 실발송 |
| dryRun | `?dryRun=1` | 후보/메시지 미리보기, 발송 없음, log 기록 안 함 |
| 단일 유저 강제 | `?onlyUid=<uid>&forceWindow=D3` | 본인 폰 테스트, idempotency 우회 |
| 단일 유저 시뮬 | `?onlyUid=<uid>&dryRun=1` | 발송 없이 어떤 윈도우 매칭되는지 확인 |

dryRun preview 응답에 `lang, sourceLang, deviceLang, tokens` 노출 (디버깅용).

## 🔑 sourceLang 우선 fix (실운영 중 발견)

### 문제
처음 `sendReengagementPush`는 `data.deviceLang`만 사용 → 한국 사용자가 영어 푸시를 받음.

### 원인
`deviceLang`은 [src/context/AuthContext.jsx](src/context/AuthContext.jsx#L64) 첫 가입 시 `navigator.language.split('-')[0]`로 **한 번만** 설정됨. 이후 갱신 안 됨. 영어 브라우저로 가입한 한국 유저는 `deviceLang='en'`으로 stale.

### 해결 (commit 649eedc)
`server/utils/sendPush.js`에 신규 헬퍼 추가:
```js
function pickLangForUser(userData) {
    return pickLang(userData?.sourceLang || userData?.deviceLang);
}
function renderMessageForUser(type, userData) { ... }
```

`sourceLang`(앱에서 사용자가 선택한 UI 언어)이 진짜 선호도. **`sendSubscriptionPush`에도 같은 버그 있어서 함께 수정**.

→ 이후 본인 폰 한국어 푸시 정상 도착 검증 완료.

## 📦 백필 — `lastActiveAt` 일괄 설정 (1회성)

### 문제
`lastActiveAt` 필드는 오늘 commit `cb60370`에서 신설. 기존 유저는 필드 없음 → Firestore `where('lastActiveAt', '>=', X)` 쿼리가 자동 제외 → re-engagement cron이 기존 유저를 영영 못 잡는 갭.

### 해결 (commit 8b4468a)
신규 엔드포인트 `POST /api/cron/backfill-last-active`:
- 모든 유저 doc 페이지네이션 순회 (batch 500, maxBatches 50 = 25,000명/호출)
- 이미 `lastActiveAt` 있는 doc은 skip (실데이터 보존)
- 그 외 모든 유저에게 `lastActiveAt = '2026-05-01T00:00:00.000Z'` (오늘 UTC 자정) 일괄 set
- batch write로 효율 처리, idempotent (재호출 안전)
- dryRun 모드 지원

### 백필 시각 결정 — 오늘 UTC 자정 (B 옵션)
다른 후보들과 비교:
- A. `now` (실행 시각) — 다음 cron에서 D0이라 발송 안 됨
- **B. 오늘 UTC 자정 (5/1 00:00)** ✅ — 내일 KST 10시 cron의 D1 윈도우 [5/1 00:00, 5/2 00:00) 안에 들어가 starter D1 즉시 매칭
- C. 어제 UTC 자정 (4/30 00:00) — D2 매칭이라 starter D1 건너뛰고 D3부터. 내가 처음에 잘못 설명해서 사용자가 C 선택했지만 정정 후 B로 진행.

### 실행 결과 (2026-05-01 19:36 KST 즈음)
- HTTP 200, 4.9초
- 5 batches, **2,158명 전체 업데이트** (skipped 0)
- complete: true

→ 5/2 (D+1)부터 5/7 (D+6)까지 5-6일 drip 스케줄 자동 시작.

## 운영 결정 사항 (기록)

| 항목 | 결정 |
|---|---|
| Render Web Service URL | `https://multitranslator.onrender.com` (Service ID `srv-d6hor0paae7s73c1vs30`) |
| `CRON_SECRET` 환경변수 | **미설정** (옵션 B). `requireCronAuth` middleware의 fallback이 미설정 시 통과시킴. 1차 출시는 보안 단순화. **TODO: 1~2주 안정화 후 옵션 A로 보안 강화 별도 작업** |
| Render Cron Job | `pronunfit-reengagement-push` (Service ID `crn-d7q7p5m8bjmc73btvfb0`) — `0 * * * *`, Singapore region, Starter instance |
| Cron Job command | `curl -fsS -X POST "$RENDER_URL/api/cron/reengagement-push" -w "\nHTTP %{http_code} time=%{time_total}s\n"` |
| Cron Job env vars | `RENDER_URL=https://multitranslator.onrender.com` |
| Cron Job 빌드 | Source Code = repo, Language = Node, Build Command = `echo ok` (npm install 불필요), Branch = main |
| 발송 시작 | 2026-05-02 KST 10:00 (UTC 01:00) — 한국 starter D1 첫 발송 예정 |

## 클라이언트 변경 (수정된 파일)

- 신규: `server/routes/reengagement.js`, `server/utils/countryTimezone.js`
- 수정: `server/utils/sendPush.js` (PUSH_MESSAGES 2종 + sendReengagementPush + sourceLang fix)
- 수정: `server/index.js` (라우트 등록)
- 수정: `src/hooks/useDailyProgress.js` (markActiveDayIfFirst 트랜잭션에 `lastActiveAt: serverTimestamp()` 추가)
- 수정: `src/utils/pushNotifications.js` (`loadReengagementAlertPref/setReengagementAlertPref` 헬퍼)
- 수정: `src/components/NotificationSettings.jsx` (복귀 알림 토글 UI)
- 수정: `src/locales/*.json` × 10 (4개 키 추가: `reengagement`, `reengagementDesc`, `reengagementOn`, `reengagementOff`)
- 수정: `src/App.jsx` (`pushNotificationActionPerformed` 리스너에 `reengagement_*` → `setViewMode('home')` 분기)

## 배포 이력 (production main 직접 push)

| Commit | 내용 |
|---|---|
| `cb60370` | feat(retention): 시스템 초기 구축 (D1-D6 + 국가별 local 10시 + 매시간 cron + 10국어 i18n + 토글) |
| `649eedc` | fix(push): sourceLang 우선 — deviceLang stale로 영어 푸시 발송 문제 해결 |
| `8b4468a` | feat(retention): backfill 엔드포인트 — lastActiveAt 2,158명 일괄 set |
| `7ed537a` | chore(diagnostic): user-lang-stats 엔드포인트 — sourceLang 분포 조회 |
| `181f6fe` | chore(diagnostic): user-lang-stats에 geoCountry 커버리지 추가 |
| `6d36d5b` | fix(retention): TZ_BY_COUNTRY 35→185개국 확장 + processNoGeoCountry 안전망 (unmapped 637→0) |
| `09babf7` | (다른 세션) 익명→실계정 마이그레이션 데이터 손실 차단 + self-heal 확장 |
| `67714f6` | chore(diagnostic): recent-reengagement-logs 엔드포인트 — cron 결과 일괄 조회 |
| `eebee6b` | feat(retention): backfill-engaged 엔드포인트 — 특정 국가 engaged D2 강제 트리거 (코드만 deploy, 사용 안 함) |
| `48fd476` | chore(diagnostic): recently-sent-d2 + stage-by-country 엔드포인트 — 5/3 9명 발송 진단용 |
| `4477423` | fix(retention): sent 카운트 정확화 — FCM 실도달 기준 (result.sent > 0)으로 변경 |
| `502f5fb` | chore(diagnostic): user-info 엔드포인트 — 단일 UID 진단 (FCM 미등록 원인 분석용) |
| `941bb27` | feat(push-optin): A1 카피 + Later 제거 + 7일 재표시 — fcmTokens 회복 강화 (10국어 + X 닫기 + dismissCount cap 3 + fcmTokenUpdatedAt 기반 판정) |

> 메모리 규칙: "main은 production 요청 시에만". 사용자가 명시적으로 "Render는 Production으로 배포 진행해줘" 요청하여 main 직접 push 진행.

## 검증 결과 ✅

- ✅ Render `/ping` 헬스체크 정상
- ✅ dryRun 응답 정상 (인덱스 빌드 후)
- ✅ Firestore 복합 인덱스 빌드 완료 (`users / geoCountry + lastActiveAt`)
- ✅ TZ + DST 자동 처리 검증 (5/1 09:49 UTC에 GB/PT/IE 정확히 매칭, BST/WEST/IST 적용)
- ✅ 본인 폰에 한국어 Message B 도착 (sourceLang fix 후)
- ✅ stale FCM 토큰 자동 정리 (4개 중 3개 정리, 1개 유효)
- ✅ Render Cron Job Trigger Run 성공 (HTTP 200, 1.57s)
- ✅ 백필 2,158명 일괄 set, complete: true
- ✅ TZ 매핑 35→185개국 확장 후 unmapped 갭 637→0명, 전체 2,158명 cron 대상 확보

## 📊 진단 데이터 (2026-05-01 백필 직후 user-lang-stats)

### sourceLang vs deviceLang
| 지표 | 수 | % |
|---|---:|---:|
| 총 유저 | 2,158 | 100% |
| sourceLang 보유 | **1,346** | **62.4%** |
| deviceLang 보유 | 2,080 | 96.4% |
| 둘 다 | 1,319 | 61.1% |
| 둘 다 없음 (en fallback) | 51 | 2.4% |
| **fcmTokens 보유 (실 발송 가능)** | **590** | **27.3%** |

### sourceLang 분포 (사용자가 직접 선택한 UI 언어)
| Lang | 수 | % |
|---|---:|---:|
| 🇻🇳 vi | **505** | **37.5% (최대)** |
| 🇰🇷 ko | 263 | 19.5% |
| 🇷🇺 ru | 212 | 15.8% |
| 🇺🇸 en | 211 | 15.7% |
| 🇪🇸 es | 95 | 7.1% |

→ **베트남어 시장이 압도적 1위**. 메모리상 흐릿했던 "주력 시장" 정량 확정.

### 핵심 인사이트 — sourceLang + deviceLang fallback 조합 효과 (사용자 칭찬 결정)
- 1,346명: sourceLang으로 정확한 UI 선호 언어
- 761명: sourceLang 없지만 deviceLang으로 자연스러운 fallback (브라우저/OS 언어가 곧 UI 언어인 경우)
- 51명: 'en' 최종 fallback
- deviceLang 분포에는 미지원 23종 언어 (uk/uz/id/kk/km/ka/bn/ar/my/el/th/tr/cs 등) 등장 — 이들 유저도 sourceLang 우선 정책 + 미지원 lang은 'en' 자동 fallback으로 모두 정확히 처리됨
- **결론**: sourceLang 우선 + deviceLang fallback 조합이 견고하게 작동. UI 미지원 언어도 안전하게 영어로 흘림. (사용자 명시 칭찬: "fallback으로 deviceLang 넣어놨던것이 효과가 좋네")

## 🚨 후속 발견 + 해결 — geoCountry 미매핑 갭 (commit 6d36d5b)

### 발견 (그림1 케이스)
실제 유저 doc 검토 중 발견:
- uid `7yliCqOm8FMnGmZoQE32R7VVO1p2`, geoCountry='UZ' (우즈벡), deviceLang='ru', sourceLang 없음, fcmTokens 보유
- → 영영 발송 안 됨

### 원인 — 3중 갭
1. **갭 1 (제일 큼)**: `TZ_BY_COUNTRY` 35개국만 매핑 → UZ는 `targetCountries`에 영영 안 들어감
2. **갭 2**: `processNoGeoCountry`가 "geoCountry 있는 유저"는 모두 skip → unmapped geoCountry 케이스 fallthrough
3. **갭 3 (덜 중요)**: createdAt 24h 이내라 다음 cron 시점엔 D0 SKIP

### 진단 데이터
user-lang-stats에 `geoCountryCoverage` 추가하여 분석:
- mapped: 1,118명 (51.8%)
- **unmapped: 637명 (29.5%)** — 거의 1/3
- missing: 403명 (18.7%)

unmapped Top: UZ 141, KG 68, VE 46, KZ 34, TJ 32, UA 30, CD 27, SV 22, NI 19, HN 19, PK 19, PA 18, UY 15, GE 13, BD 11 + 45개 추가 국가.

### 해결 (즉시 적용)
**변경 1 — `TZ_BY_COUNTRY` 대폭 확장** (countryTimezone.js):
- 35개국 → **185개국** (사실상 전세계)
- 추가: 중앙아시아 5(UZ/KZ/KG/TJ/TM), 코카서스+동유럽 8(UA/BY/MD/GE/AM/AZ/MK/AL 등), 중남미 25+(VE/CO/PE/EC/BO/PY/UY/SV/NI/HN/PA/GT/HT/CR/CU/DO 등), 남아시아/동남아(PK/BD/LK/NP/MM/KH/LA/MV/BT/AF/MN), 중동(QA/KW/BH/OM/JO/LB/SY/IQ/IR/YE/PS), 아프리카 50+, 오세아니아 11

**변경 2 — `processNoGeoCountry` 안전망** (reengagement.js):
```js
// 변경 전: if (geo) continue
// 변경 후: if (geo && TZ_BY_COUNTRY[geo]) continue
```
→ 매핑 없는 geoCountry도 effectiveCountry(deviceLang fallback) 경유 처리. 미래 신규 ISO 코드 자동 catch.

### 검증 (after deploy)
- mapped: 1,118 → **1,755 (+637)**
- unmapped: 637 → **0** ✅
- missing: 403 (변화 없음, 의도대로 noGeoCountry 처리)
- **2,158명 전체 cron 대상 확보** (이론상 100% 커버)

## D+N 윈도우 계산 기준 (참고용 메모)

`getWindowRange()`의 `setHours(0,0,0,0)`은 서버 로컬 타임 기준이며, Render는 **UTC**로 돌아가므로 결국 **UTC 자정**이 기준점.

→ 한국 유저 관점에서 D+N의 day boundary는 **KST 09:00**, KST 자정 아님. 하루 중 KST 00:00~09:00 사이 활동은 직관과 1일 어긋남. 다른 시간대는 시프트 폭이 다름.

→ v1은 acceptable approximation, 데이터 누적 후 fine-tuning 단계에서 per-user-TZ 자정 기반으로 수정 가능.

## 후속 작업 (Phase 2)

- 보안 강화: `CRON_SECRET` 추가 + 기존 subscription cron caller에도 헤더 추가
- US 동부/중부 타임존 분리 (현재 PT 단일)
- A/B 메시지 분기 + `reengagementLogs`에 어떤 카피 보냈는지 기록
- D7+ 장기 휴면 윈도우 (별도 카피, 30일 cycle)
- 발송 후 24h 내 lastActiveAt 갱신 = return rate 추적
- 웹 푸시 (Tier 1) 도입 후 데스크톱/iPhone 웹 유저 확장
- iOS 심사 통과 후 Render env에 `REENGAGEMENT_IOS_ENABLED=true` 추가
- D+N day boundary를 per-user-TZ 자정 기준으로 정확화
- 베트남어 시장 (505명, 37.5%) 대응 강화 — 메모리/번역/UX/이메일 등 별도 검토
- user-lang-stats 진단 엔드포인트는 1회용 — Phase 2에서 유사 분석 필요 시 재사용 또는 제거 검토

## 🚀 첫 자동 발송 결과 (2026-05-02 00:00 ~ 03:00 UTC)

### 누적 (13 cron runs, 발송 있었던 3개)

| UTC 시간 | KST | 대상 국가 | sent / candidates |
|---|---|---|---:|
| **01:00** (5/2) | 10:00 | **KR, JP, KP** | **73 / 331** |
| **02:00** (5/2) | 11:00 | CN, TW, HK, MO, SG, MY, PH, MN, BN | 4 / 136 |
| **03:00** (5/2) | 12:00 | **VN, TH, ID, KH, LA** | **198 / 643** ⬅ 베트남 비중 큼 |
| 누적 | | 16개국 | **275 / 1,110** |

- **275명 D1 푸시(Message A) 정상 발송, failed 0건 ✅**
- 모두 **starter/null 유저** (D1 윈도우는 starter 전용)
- engaged 유저는 같은 cron에서 D2 윈도우 미매칭 (stage-mismatch skip 37건)
- 베트남 시장(198명)이 한국(73명)을 앞섬 — sourceLang 분포(vi 505 > ko 263)와 일치

### Skip 사유 분포 (전체 13 runs)
- `no-tokens`: **537** — FCM 미보유 유저, 가장 큰 비중
- `not-local-10`: 344 — processNoGeoCountry에서 effectiveCountry 시간 안 맞음
- `stage-mismatch`: 37 — D1 윈도우인데 engaged → D2 대기
- `d0-new`: 18 — 가입 24h 이내 (오늘 신규 가입한 유저들)

### 5/2 잔여 자동 발송 예정 (UTC 04:00 ~ 5/3 00:00)
- UTC 04:00 — *(IN 30분 오프셋 이슈로 매칭 안 됨, 알려진 한계)*
- UTC 05:00 — UZ, KZ, KG, TJ, TM, PK, AF
- UTC 06:00 — AE, SA, QA, KW, BH, OM, IR(미매칭)
- UTC 07:00 — RU, TR, JO, LB, SY, IQ, EG, SD
- UTC 08:00 — DE, FR, ES, IT, NL, PL, GB, PT, AT, CH, SE, NO, DK, FI, GR, CZ, BE, IE, HU, RO, BG, etc. (CEST/BST DST)
- UTC 13:00 — BR
- UTC 14:00 — CO, PE, EC, PA, JM
- UTC 15:00 — VE, BO, DO, CL, AR (지역마다 변동)
- UTC 16:00 — MX, CR, GT, NI, HN, SV, BZ
- UTC 17:00 — US (PT)

### 알려진 한계
1. **30분 오프셋 국가 매칭 누락** — IN(인도), IR(이란), AF(아프가니스탄), MM(미얀마 +6:30), NP(네팔 +5:45), VE(베네수엘라 -4:30 X 폐지), MV(몰디브 X 30분 아님). 매시간 정각 cron으로는 local hour=10 매칭 불가 (local 09:30 또는 10:30). → **Phase 2: 매 30분 cron 검토** 또는 30분 오프셋 국가 별도 처리.
2. **D+N 윈도우 UTC 자정 기준** — KST 사용자 입장에서 day boundary가 09:00. 직관과 1일 어긋남 가능 (acceptable v1).
3. **백필 효과** — 모든 유저 lastActiveAt = 5/1 00:00 UTC라 5/2 D1 (starter), 5/3 D2 (engaged), 5/5 D4 (engaged), 5/7 D6 (engaged) 자연 drip. 6일 후 자동 종료.

## 운영 도구 추가 (5/2)

진단/운영용 신규 엔드포인트 (요청 시 활용):

| 엔드포인트 | 용도 |
|---|---|
| `POST /api/cron/recent-reengagement-logs?limit=N` | 최근 N개 cron 실행 + 집계 조회 (운영 모니터링) |
| `POST /api/cron/user-lang-stats` | sourceLang/deviceLang/fcmTokens/geoCountry 분포 진단 |
| `POST /api/cron/backfill-engaged?country=XX&targetDate=YYYY-MM-DD&dryRun=1` | 특정 국가 engaged 유저의 lastActiveAt을 특정 날짜로 일괄 set. 다음 정상 cron이 자연스럽게 D2 발송 트리거 (5/2엔 KR/VN 모두 cron 시간 지나서 미사용, 향후 비슷한 운영 상황 재사용) |

## 5/2 운영 일지 + 의사결정 메모

- KST 10시 cron 결과(73명) 확인 후 사용자가 "engaged까지 오늘 보내고 싶다" 요청
- VN cron 시간(UTC 03:00) 직전이라 backfill-engaged 엔드포인트 신속 구현(commit eebee6b) → 호출 직전에 사용자가 "VN 시간도 지났다" 판단으로 중단 결정
- 결과: 코드는 deploy됐지만 호출 안 됨. 자연 흐름대로 5/3에 KR/JP engaged D2 (KST 10시), VN/TH/ID engaged D2 (UTC 03:00) 자동 발송 예정.
- **교훈**: 향후 cron 시간 직전에 운영 변경 결정 시 시간 여유를 30분+ 이상 확보. backfill-engaged는 다른 국가/시점 운영에 재사용 가능하게 보존.

## 🔍 5/3 D2 발송 결과 + sent 로직 정확화 fix

### 5/3 KR/JP/KP D2 cron 결과 (UTC 01:00)
- candidates 339, **sent=9 표기**, failed=0
- skip: no-tokens 205, not-local-10 69, stage-mismatch 53, d0-new 3
- 9명 모두 KR sourceLang=ko (subscriber 4 + engaged 5, 절반 익명)

### KR/JP/KP lifecycleStage × fcmTokens 분포 (`stage-by-country` 진단)
| 국가 | starter | null | engaged | subscriber | 합 | FCM 보유 |
|---|---:|---:|---:|---:|---:|---:|
| KR | 133(27 fcm) | 76(22 fcm) | 18(5 fcm) | 6(2 fcm) | **233** | **56** |
| JP | 1(1) | 2(0) | 1(0) | 0 | 4 | 1 |
| KP | 0 | 0 | 0 | 0 | 0 | 0 |

→ **KR 90%가 starter/null** (D1/D3/D5 대상, 209명). engaged/subscriber 24명(10%) 중 fcm 보유 7명만.
→ "신규 70% 1회성 이탈"(GA 데이터)이 lifecycleStage 분포로도 확인됨.

### 🚨 발견 문제 — sent 카운트 부풀림 + 잘못된 idempotency 마킹
9명 중 5명이 **fcmTokensCount=0** 상태. 발송 시점엔 토큰 있었지만 모두 invalid(stale)여서 FCM 응답에서 cleanup → 진단 시점에 0개. 그런데 cron은 sent +=1 + d2At 마킹 했음.

원인: `sendReengagementPush`의 `result.ok`는 try-catch가 정상 종료되면 무조건 true. FCM이 모든 토큰 invalid 응답해도 ok=true. cron의 `if (result.ok)` 분기는 이를 그대로 sent로 간주.

영향:
- 부풀려진 sent 카운트 (실 도달 4명, 표기 9명)
- 잘못된 idempotency 마킹 → 5명에게 D2 재시도 기회 상실 (다음 D4/D6도 cleanup 후 no-tokens skip이라 영영 못 받음)
- failed 카운트 0 (사실상 5명 미도달인데 0)

### Fix (commit 4477423) — sent 판정 로직 분기
| 케이스 | sent +=1 | d2At 마킹 | skipReason |
|---|---|---|---|
| dryRun + ok | ✅ would-send | ❌ | - |
| live + ok + result.sent > 0 | ✅ 실 도달 | ✅ | - |
| live + ok + result.sent === 0 | ❌ | ❌ | `fcm-all-invalid` |
| !ok | ❌ | ❌ | `result.reason` (failed +=1) |

3곳 모두 적용: `processWindow`, `processNoGeoCountry`, `processOnlyUid`.

### 영향 (포워드)
- 5/4 이후 cron부터 sent는 실 도달 기준으로 정확
- 모든 토큰 invalid 유저는 `fcm-all-invalid`로 분리 카운트 → 운영 모니터링 가능
- d2At 마킹 안 된 유저: 다음 cron에서 cleanup 후 fcmTokens 비워져 자연스럽게 no-tokens skip → 자동 정리

### 영향 (백워드 — 5/3 D2 데이터)
이미 마킹된 5명 d2At는 그대로. 영향:
- 5/4 D3 (starter), 5/5 D4 (engaged), 5/6 D5 (starter), 5/7 D6 (engaged)
- 해당 5명 (engaged/subscriber): D4, D6에서 no-tokens skip (fcmTokens 비어있음). 결과적으로 영영 못 받음 — 받을 방법 없음 (토큰 invalid).
- starter는 무영향 (D2/D4/D6 안 받음)

→ **데이터 dirty이지만 영향 미미. 정정 작업 불필요** (cleanup 자연 작동).

## 신규 진단 엔드포인트 (5/3 추가)

| 엔드포인트 | 용도 |
|---|---|
| `POST /api/cron/recently-sent-d2?hours=N` | 최근 N시간 d2At set된 유저 리스트 (uid+geo+lang+stage+fcm) |
| `POST /api/cron/stage-by-country?countries=KR,JP,...` | 국가별 lifecycleStage × fcmTokens 교차 분포 |
| `POST /api/cron/user-info?uid=X` | 단일 유저 doc 진단 (FCM 미등록 원인 분석용) |

## 🚨 5/3 후속 발견 — fcmTokens=0 유저 다수, PushOptInModal "Later" 영구 dismissal

### 발견 배경
사용자가 "FCM Token 없는 유저가 다시 로그인했을 때 추가하는 로직 적용했는데 왜 반영 안 됨?" 질문. 두 UID 진단:

| UID | stage | activeDay | 상황 |
|---|---|---|---|
| `QlF0wl1A...nk1` (sow1991, ko, KR) | engaged | 3 | 4/29 가입, 5/3 활동, fcmTokens=[], **fcmTokenUpdatedAt=null**, **subscriptionAlertPromptShown=true** |
| `e8VWkSTa...ci2` (vi, VN, 익명) | starter | 1 | 5/3 KST 15:45 가입(2분 활동), fcmTokens=[], **fcmTokenUpdatedAt=null**, **subscriptionAlertPromptShown=true** |

→ 둘 다 PushOptInModal 표시됐지만 토큰 등록 실패(거부/Later/X). 영구 플래그 때문에 재표시 안 됨.

### 근본 원인 — 코드 흐름
- [App.jsx:4856](src/App.jsx#L4856) onClose 핸들러: `subscriptionAlertPromptShown: true` 영구 set (허용/거부 무관)
- [App.jsx:1564-1568](src/App.jsx#L1564-L1568) ProfileHeal: `perm.receive === 'granted'`만 통과 → 거부/prompt 상태는 무시
- [PushOptInModal.jsx](src/components/PushOptInModal.jsx) `handleAccept`: 권한 거부 시 그냥 close (no error to user)
- 결과: 한 번 dismissed → 영영 fcmTokens 0
- 추가 모순: 카피는 "구독/결제 필수 알림"이라 framing하지만 실제 발송 콘텐츠(D1~D6 학습 리마인더)는 카피에 명시 안 됨 → 동의 범위 외 발송 회색지대

### 수정 (commit 941bb27) — A1 카피 + Later 제거 + 7일 재표시 시스템
**1. PushOptInModal 재작성**:
- "Later" 버튼 제거 → "Allow" 단독 + 우상단 X 닫기 아이콘 (Apple escape hatch 유지, 시각적 우선순위 낮춤)
- onClose에 결과 인자 전달: `'registered'` / `'denied'` / `'dismissed'`
- 영구 플래그 set 안 함 (재표시 가능)

**2. App.jsx `shouldShowSubscriptionPrompt` 로직 변경**:
- 기존: `subscriptionAlertPromptShown !== true`만 통과 → 1회 영구
- 신규: `fcmTokenUpdatedAt` 존재 여부로 판정 (한 번이라도 등록 성공 시 영영 안 띄움)
- 7일 스누즈 (`pushOptInLastShownAt`) + 누적 dismiss cap 3회 (`pushOptInDismissCount`)
- 레거시 `subscriptionAlertPromptShown: true` 유저들 자동 재표시 자격

**3. App.jsx onClose 핸들러**:
- `registered`: `pushOptInLastShownAt` set (dismissCount 증가 X)
- `denied`/`dismissed`: `pushOptInLastShownAt` set + `pushOptInDismissCount += 1`

**4. 10국어 카피 A1로 전면 교체**:
- title: "학습 알림을 받아보시겠어요?" 류 (10국어)
- body: "매일 학습 리마인더와 구독 갱신·결제 알림을 보내드립니다. 광고는 없습니다."
- 학습 알림 + 결제 알림 모두 명시 → 실제 발송 시스템과 일치
- `common.close` 키 10국어 추가 (X 아이콘 aria-label)

### Firestore 신규 필드
- `users/{uid}.pushOptInLastShownAt: Timestamp` — 마지막 모달 표시 시각
- `users/{uid}.pushOptInDismissCount: number` — 누적 거부 횟수 (cap 3)
- `subscriptionAlertPromptShown` 필드는 **새 코드에서 사용 안 함** (legacy data 보존)

### 기대 효과
- 레거시 dismissed 유저 (1346 sourceLang 보유 유저 중 fcm=0인 부분 + others) 자동 재표시 자격
- KR engaged/subscriber 24명 중 fcm=0인 17명 (5/3 D2 cron에서 missed) — 다음 앱 오픈 시 즉시 재표시
- VN 신규 유저들 — 가입 직후 dismissed라도 7일 후 재시도 (그동안 engaged 전이 가능성)
- register() 진짜 성공한 유저만 영영 안 뜸 (fcmTokenUpdatedAt 기준)

### 후속 측정 (1주일)
- fcmTokens 보유 유저 비율: 5/3 시점 590명(27.3%) → 5/10 측정. 회복분 추적
- A1 카피 동의율 (registered / shown) 비율
- dismiss 3회 cap 도달 유저 수
- 신규 가입 후 fcmTokens 등록 비율 변화

## 1주일 후 점검 항목 (2026-05-08경)

- `reengagementLogs` 일별 발송량 / 성공률 / skip 사유 분포
- GA에서 신규→재방문 전환률 변화 (특히 VN 시장 모니터링 — 첫날 198명으로 가장 큰 발송)
- 발송 후 24h 내 활동 재개 유저 비율 (return rate)
- 푸시 무시 / opt-out 비율 (`reengagementOptOut === true` 누적)
- FCM stale token cleanup 양 (운영 건전성 지표)
- 베트남 시장 관련 의사결정 — 광고/마케팅에 베트남 집중 검토

근거: 5-6일 drip이 끝나면 효과 평가 가능 시점.
