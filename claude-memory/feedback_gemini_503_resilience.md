---
name: feedback-gemini-503-resilience
description: Gemini 503 UNAVAILABLE outage 종합 대응 패턴 — shared helper (callGeminiJson/callGeminiText) + 3회 retry + Flash 모델 fallback + GEMINI_MODE 운영자 토글. 4월부터 진행 중인 Flash-Lite 글로벌 outage 대응 (공식 미인정).
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c5983a41-0da1-45c0-beeb-697c7a119710
---

PronunFit의 Gemini API 호출은 server/utils/geminiCall.js의 shared helper(callGeminiJson, callGeminiText)를 통해 일원화. 모든 Gemini endpoint 추가/수정 시 이 helper 사용. retry/backoff/모델 fallback/에러 분류가 helper 1곳에서 관리됨.

**Why:**
Gemini 2.5 Flash-Lite는 2026-04월부터 글로벌 503 UNAVAILABLE outage가 지속 중 ([Google AI Forum thread 139749](https://discuss.ai.google.dev/t/production-downtime-gemini-2-5-flash-gemini-3-flash-preview-503-service-unavailable/139749)). 공식 status page는 정상 표기 + Google 인정 없음 + staff 권고는 "exponential backoff"뿐인데 community 다수 보고 "6-7회 retry해도 fail". 우리 PronunFit도 5/21~5/22에 Free Talking / Vocab / Listening / Translation 모두 503 노출되어 사용자 경험 거의 다 마비. 단순 inline retry는 코드 중복 + 신규 endpoint 추가 시 retry 빠뜨림 위험. 모델 전면 변경(`gemini-2.5-flash`)은 비용 5x 부담. → shared helper로 retry + fallback 일원화 + GEMINI_MODE 운영자 토글로 비상 대응까지 패턴화. 비용 평균 ~1.25x (전면 변경 5x 대비 75% 절감).

또한 implicit caching도 Flash-Lite에서 작동 안 함 ([Forum 107342](https://discuss.ai.google.dev/t/gemini-2-5-flash-lite-implicit-caching-not-working-despite-meeting-documented-requirements/107342) — cached_content_token_count=0 반환). cachedContents explicit API는 구현 복잡 + cache lifecycle 관리 부담으로 보류.

**How to apply:**

1. **새 Gemini endpoint 추가 시**:
   - `axios.post(geminiUrl(...))` 직접 호출 금지. 반드시 `callGeminiJson` 또는 `callGeminiText` 사용
   - `genConfig`에 `responseMimeType: 'application/json'` 필수 (JSON 응답 endpoint). 미지정 시 모델이 "Đã hiểu. T..." 같은 자연어 prefix로 응답해 parse 실패 — 2026-05-22 Vocab 사고
   - validate 함수로 최소 필드 검증 (예: `(p) => Array.isArray(p?.words) && p.words.length > 0`)
   - label 인자로 endpoint 이름 명시 (로그 추적용)

2. **운영 중 503 빈도 증가 감지 시 GEMINI_MODE 토글**:
   - `auto` (기본): Flash-Lite 3회 + Flash fallback. 평소 운영 비용 ~1.25x
   - `fast`: Flash-Lite 1회만 시도 → 즉시 Flash escape. 응답 시간 단축 + 비용 ~2~3x
   - `flash`: Flash-Lite 건너뛰고 Flash 직행. 가장 안정 + 비용 5x. **단점: Flash 자체가 본질적으로 느림 (작은 prompt ~8s, 큰 prompt ~11s)**
   - Render Dashboard → Environment → `GEMINI_MODE` 추가/수정 → ~30~60s 자동 재배포
   - 회복 신호: Flash-Lite 호출 성공 사례 다시 보이거나 community thread에서 해소 보고
   - 회복 시: env 삭제 또는 `auto` 복귀

3. **Flash-Lite outage 100% 케이스**:
   - fast 모드는 Flash-Lite 성공 0% 상황에서 flash 모드 + Flash-Lite 1회 시도 시간 추가 = flash보다 ~1초 느림. 의미 없음
   - 이런 경우 `flash` 직행이 합리적
   - 동시에 prompt 다이어트(C 옵션) PR로 Flash 응답 시간 단축 검토 — 11초 → 7~8초 가능

4. **timeout 30초 영향**:
   - 503은 보통 ~1초 안에 quick fail (timeout 무관)
   - 다만 Flash-Lite가 가끔 30초 hang (ECONNABORTED) → fast 모드 worst case ~35초
   - 빈도 심화 시 helper의 TIMEOUT_MS 30→10 단축 PR 검토

5. **모니터링**:
   - Render Logs에서 다음 패턴 추적:
     - `gemini-2.5-flash-lite attempt1 retryable fail: AI server busy` → 정상 retry
     - `Flash-Lite exhausted → escalating to gemini-2.5-flash` → fallback 발동
     - `✅ gemini-2.5-flash succeeded (Flash-Lite outage rescued)` → fallback 성공
   - fallback 발동 빈도가 일정 비율(예: 30%) 이상이면 fast/flash 모드 토글 또는 모델 변경 검토

6. **공식 status page는 신뢰하지 말 것**:
   - `status.cloud.google.com`은 Flash-Lite outage를 인정 안 함 (5/15~5/22 incident 0건)
   - 진짜 상태는 [Google AI Developers Forum](https://discuss.ai.google.dev/)에서 community 보고로 판단

**관련 도구**:
- 진단 스크립트: `server/check-user-tier.js` (사용자 호출어 "진단 스크립트로 UID 확인해줘")
- 모델 fallback shared helper: `server/utils/geminiCall.js`
- 모드 설정: `server/config/gemini.js` (PRIMARY_MODEL, FALLBACK_MODEL, GEMINI_MODE)

**잠재적 후속 작업**:
- C 옵션 — buildReplyPrompt 다이어트 (31KB → 18~20KB) — 응답 품질 영향 측정 후 결정
- Flash-Lite outage 장기화 시 다른 provider 검토 (OpenAI, Anthropic) — 큰 마이그레이션
- Vercel Hobby → Pro 전환 사례: 2026-05-22 빌드 큐 stuck (concurrent build 제한) → 즉시 풀림. 향후 빌드 누적 stuck 발생 시 동일 점검 권고

**관련 history**: [[changes-0522]]
