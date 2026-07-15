---
name: Azure Speech 리소스 정보 (TrnslatorApp)
description: Azure Speech Services 리소스 식별자, 티어 이력, 쿼터 관련 패턴 참조
type: reference
originSessionId: d874b2d1-2d2d-412e-8cd0-be8d5673e04d
---
# Azure Speech Resource — TrnslatorApp

## 리소스 식별자

| 항목 | 값 |
|---|---|
| **리소스 이름** | `TrnslatorApp` |
| **리소스 타입** | Cognitive Services (`Microsoft.CognitiveServices/accounts`) |
| **API 종류** | SpeechServices |
| **리전** | Korea Central (`koreacentral`) |
| **리소스 그룹** | `TrnslatorApp` |
| **엔드포인트** | `https://koreacentral.api.cognitive.microsoft.com/` |
| **STT 엔드포인트** | `https://koreacentral.stt.speech.microsoft.com/` |

## 구독 정보

| 항목 | 값 |
|---|---|
| **구독 이름** | `Azure 구독 1` |
| **구독 ID** | `b98d11d4-65ae-41fe-a715-a1d013d53054` |
| **디렉터리** | `Default Directory (swhakagmail.onmicrosoft.com)` |
| **플랜** | **Azure 플랜 (MCA 기반 종량제)** — 유료 PAYG, 지출 한도 없음 |
| **소유자** | SEUNGWOO HA |

## 리소스 Full ARM Path

```
/subscriptions/b98d11d4-65ae-41fe-a715-a1d013d53054/
  resourceGroups/TrnslatorApp/
  providers/Microsoft.CognitiveServices/
  accounts/TrnslatorApp
```

## 티어 이력

| 날짜 | 변경 | 사유 |
|---|---|---|
| 초기 | F0 (Free, `SpeechServices.F0`) | 초기 개발/테스트 |
| **2026-04-24** | **F0 → S0** (Standard, `SpeechServices.S0`) | **쿼터 초과로 실유저 분석 실패 → 업그레이드** |

## 현재 설정 (2026-04-24)

- Environment variable: `AZURE_SPEECH_KEY` (server/.env + Render)
- Key 길이: 84자 (프리픽스 `AypTLY85...`, 서픽스 `...ueZD`)
- 사용 위치:
  - [server/routes/analyze.js](server/routes/analyze.js) — Pronunciation Assessment
  - [server/routes/tts.js](server/routes/tts.js) — Text-to-Speech

## Resource Provider 등록 상태
- `Microsoft.CognitiveServices`: **Registered** (재등록 완료 2026-04-24)
- `Microsoft.Insights`: 미확인 (필요 시 등록 — 메트릭/알림용)

## 티어별 한도 (참고)

**F0 (Free)** — 과거 사용:
- 월 5시간 오디오 (STT/PA 포함)
- 시간당 20 transactions
- 쿼터 초과 시 Azure는 WebSocket을 **code 1007**로 close + `errorDetails="Quota exceeded"` 반환

**S0 (Standard)** — 현재:
- Pronunciation Assessment: $1 / 1시간 real-time
- STT base: $1 / 1시간
- 기본 concurrent: 20 RPS (상향 요청 가능)
- **Azure Plan PAYG 청구** — 월별 Azure Portal Cost Management에서 확인

## 중요 패턴 — 티어 전환 시 관측된 현상 (2026-04-24)

### Quota Cache Coherency Lag
**증상**: F0 → S0 전환 직후 매 요청마다 1차 실패 / 2차 성공 패턴 반복

**원인**: Azure는 key별 쿼터 상태를 region 단위 분산 캐시에 보관. 티어 변경 후 메타데이터/토큰은 즉시 S0로 갱신되지만, 쿼터 enforcement 레이어의 캐시는 stale(F0) 상태 유지. 첫 요청이 "희생양"이 되어 cache miss를 트리거 → 백엔드가 master에서 재조회 → S0로 갱신. 다음 요청은 warm cache hit.

**SDK 에러 매핑** (비자명):
```
Azure API 응답: 빈 JSON + WebSocket close code 1007 + "Quota exceeded"
    ↓
Node SDK (microsoft-cognitiveservices-speech-sdk):
    result.properties.SpeechServiceResponse_JsonResult = null/undefined
    ↓
PronunciationAssessmentResult.fromResult(result) 호출 시:
    throwIfNullOrUndefined(json, "json") → Error: "throwIfNullOrUndefined:json"
```

즉 **"throwIfNullOrUndefined:json"** 은 SDK 파싱 실패로 보이지만 **근본은 쿼터/인증/NoMatch** 중 하나. `CancellationDetails.errorDetails` 로 실제 원인 구분 필요.

**해소**:
- 자연 해소: 6~24시간 내 분산 캐시 전체 reconciliation
- 즉시 해소: Key 재생성으로 entitlement 전체 재빌드

## 관련 메모
- [reminder-azure-speech-s0-cache-check.md](reminder-azure-speech-s0-cache-check.md) — 2026-04-25 자연 해소 체크
- [changes-0424.md](changes-0424.md) — 2026-04-24 대응 상세
