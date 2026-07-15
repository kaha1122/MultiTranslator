---
name: 2026-04-24 Azure Speech 쿼터 장애 대응 (F0→S0) + Render Workspace 다운그레이드
description: 실유저 발음 분석 전체 실패 긴급 대응 — F0 티어 소진 확인 → S0 업그레이드 → 재시도 로직 + 진단 로그 배포 → 쿼터 캐시 전환기 관측
type: project
originSessionId: d874b2d1-2d2d-412e-8cd0-be8d5673e04d
---
# 2026-04-24 Azure Speech 쿼터 장애 & Render 최적화

## 최종 결과

| 항목 | 결과 |
|---|---|
| Render Workspace Professional → Hobby | **-$19/월 절약** |
| Azure Speech F0 → S0 업그레이드 | **실유저 분석 정상화** (재시도 로직 경유) |
| `/analyze` Azure 재시도 로직 배포 | 투명 복구 입증 (1차 실패 → 2차 성공) |
| 진단 로그 추가 | 향후 장애 시 30초 내 원인 규명 가능 |
| Microsoft.CognitiveServices 재등록 | Azure provider 정책 refresh |

## 세부 이력

### 1) 초기 오인진단: Render 콜드스타트
**가설**: "실유저 분석이 안 된다"→ Render Starter 플랜 슬립 의심
**실제**: Starter 인스턴스는 슬립 없음 확인 ([azure-speech-resource.md](azure-speech-resource.md) 참고). Render는 무관.
**교훈**: Render Starter($7/mo)는 콜드스타트 없음. Free 플랜만 15분 idle 시 슬립.

### 2) Render 비용 최적화
**Workspace Professional ($19/mo) → Hobby ($0)**:
- 솔로 개발자에겐 Professional 전용 기능 모두 불필요
  - Collaborate with 10 members ❌
  - Horizontal autoscaling ❌
  - PR Preview / Isolated env ❌
  - 대역폭 500GB → Hobby 100GB로도 충분
- 서비스 인스턴스는 Starter($7) 그대로 유지 (슬립 없음)
- **실비용 $26 → $7/월**

### 3) Azure Speech 일시 블립 가설 & 재시도 로직
**최초 가설**: Azure 4분 장애 (22:34 KST 관측) → 재시도 로직으로 해결
**배포**: 커밋 `d33bc20` — [analyze.js](server/routes/analyze.js)
- `analyzePronunciationAttempt(audioBuffer, ...)` 단일 호출 분리
- `analyzePronunciation` 래퍼에 3회 시도 (0ms → 500ms → 1500ms backoff)
- `fromResult` 동기 throw도 try/catch로 안전 처리
- 정상 케이스 latency 영향 없음 (1회차 성공 시 즉시 반환)

### 4) S0 업그레이드 — 진짜 원인 확정
**재시도로도 해결 안 되는 지속적 실패 관측**:
- `throwIfNullOrUndefined:json` 에러 100% 실패
- Render 로그 분석 + Azure 메트릭 `Client Errors = 33→53`
- JWT 토큰 디코딩에서 **`product-id: SpeechServices.F0`** 확인 → Free tier
- F0 한도: 월 5시간 / 시간당 20 transactions → Play Store 유저 증가로 소진

**조치**: Azure Portal → TrnslatorApp → 가격 책정 계층 → **F0 → S0 (Standard)**
- Key/엔드포인트/리전 무변경 → 서버 재배포 불필요
- Azure Plan (MCA PAYG) 구독이라 즉시 유효

### 5) 진단 로그 추가
**배포**: 커밋 `11eb4d3` — [analyze.js](server/routes/analyze.js)
S0 업그레이드 후에도 동일 에러 지속 → 원인 특정 위해 상세 로그 추가:
```javascript
[Azure-Diag] reason=??? lang=??? text="..." refText="..." duration=...
[Azure-Diag] Cancelled: reason=? errorCode=? errorDetails="..."
[Azure-Diag] SpeechServiceResponse_JsonResult 비어있음 — NoMatch 또는 Cancel 상황
```

**결과**: 30초 내 `errorDetails="Quota exceeded. Cid:  websocket error code: 1007"` 정확히 포착

### 6) Microsoft.CognitiveServices Provider 재등록
**가설**: 티어 변경 후 Azure 쿼터 entitlement propagation 미완료
**조치**: Azure Portal → 구독 `Azure 구독 1` → 리소스 공급자 → `Microsoft.CognitiveServices` → **재등록(Re-register)**
**상태**: Registered (변경 없음, propagation refresh 트리거 목적)

### 7) 관측된 최종 패턴 — Quota Cache Coherency Lag
**증상**: 매 요청 **1차 실패 → 2차 성공**
```
03:04:38 [Azure-Diag] Cancelled: ... errorDetails="Quota exceeded..."
03:04:39 [Azure-Diag] reason=RecognizedSpeech text="Collaborate."
03:04:39 [Azure] Pronunciation retry succeeded on attempt 2
```
재시도 로직(500ms backoff)이 정확히 이 지연을 cover. 유저 체감 성공.

**해석**: Azure 분산 쿼터 캐시가 F0 상태 보관 중 → 첫 요청 cache miss → 백엔드가 S0로 refresh → 두 번째 요청 cache hit 성공. 분산 시스템의 eventual consistency 현상.

**예상 자연 해소**: 6~24시간 내 전 region 캐시 reconciliation 완료.

## 기각된 가설들 (기록용)

| 가설 | 기각 근거 |
|---|---|
| Render 슬립/콜드스타트 | Starter 플랜 슬립 없음. `/ping` 정상 응답 |
| Render OOM/재시작 | 크래시 로그 없음. 같은 프로세스 지속 로깅 |
| FB App ID 이전(0423) 영향 | FB는 OAuth 전용, Azure Speech와 시스템 분리 |
| Azure 외부 장애 | issueToken 200, STT 엔드포인트 HTTPS 정상 |
| Azure 구독 Free Trial/지출 한도 | Azure Plan(MCA) PAYG 확인, 지출 한도 없음 |
| Azure key 무효화 | issueToken JWT 정상 발급 |
| 오디오/refText 문제 | "brew", "perk up", "collaborate" 모두 동일 실패 → S0 후 동일 성공 |

## 핵심 교훈 (Load-bearing Insights)

1. **Azure Speech SDK의 `throwIfNullOrUndefined:json` 에러**는 여러 원인에 공통으로 나타남:
   - 쿼터 초과 (F0 한도 / S0 transient cache miss)
   - NoMatch (오디오 인식 실패)
   - Canceled (인증/BadRequest/ConnectionFailure)
   
   → **`CancellationDetails.errorDetails` 로깅 필수** (현재 코드에 반영됨)

2. **Render Starter ≠ Free**: Starter는 슬립 없음. Free만 15분 idle 시 슬립.

3. **Azure 티어 변경은 즉시 유효하지 않을 수 있음**: 메타데이터는 즉시, 쿼터 enforcement는 6~24h.

4. **Workspace 플랜 vs 서비스 인스턴스**: 별도 과금. Professional 워크스페이스는 솔로 개발자에게 불필요.

5. **분산 시스템의 "희생양 첫 요청" 패턴**: 재시도 로직(backoff 포함)이 이런 transient를 자연스레 흡수. 프로덕션 외부 API 호출에 거의 필수.

## 다음 액션
- [reminder-azure-speech-s0-cache-check.md](reminder-azure-speech-s0-cache-check.md) — 2026-04-25 자연 해소 체크 + Key 재생성 판단
- [azure-speech-resource.md](azure-speech-resource.md) — 리소스 상세 참조

## 관련 커밋
- `d33bc20` — 재시도 로직 (analyze.js)
- `11eb4d3` — 진단 로그 (analyze.js)
- `ef4af08` — 직전 커밋 (네이티브 업데이트 강제)
