---
name: changes-0522
description: 2026-05-22 종일 작업 — Gemini Flash-Lite 503 outage 종합 대응(retry/Flash fallback shared helper/GEMINI_MODE 운영자 토글/JSON mode 강제) + Free Talking 기회 보호 retry UI + freeTalkHistory 분석 데이터 + Vercel Pro 전환
metadata: 
  node_type: memory
  type: project
  originSessionId: c5983a41-0da1-45c0-beeb-697c7a119710
---

# 2026-05-22 — Gemini 503 outage 종일 대응 + Free Talking UX 보강

## 배경 (전날까지 누적 상황)

5/21 저녁부터 Gemini 2.5 Flash-Lite의 503 UNAVAILABLE 다발. community 보고로는 4월부터 진행 중인 long-running outage. 공식 status page는 정상 표기지만 [Google AI Forum](https://discuss.ai.google.dev/t/production-downtime-gemini-2-5-flash-gemini-3-flash-preview-503-service-unavailable/139749)에서 사용자 다수 호소 ("all day, every day for the last week"). Google staff는 "exponential backoff" 권고만, 사용자들 "6-7회 retry해도 fail". 우리 PronunFit도 5/21 사고 — Free Talking / Vocab / Listening / Translation 모두 503 노출.

5/21에 1차 대응한 것: converse-start retry 3회 + backoff, isCustom 분기 hotfix, 7 endpoint responseMimeType 추가, Free Talking 기회 보호 retry UI (v1.5.50~1.5.52, commits 5a00518~917b977). 그래도 부족 → 5/22 종일 추가 강화.

## 커밋 시간순 (오늘 5/22 만)

| Commit | 버전 | 분류 | 한 줄 |
|---|---|---|---|
| `917b977` | v1.5.52 | UI+서버 | ftc-error column layout + reply 503 retry UX + converse-reply retry 안전망 |
| `1e4090d` | 서버만 | 핵심 | 전 8 endpoint shared helper(callGeminiJson/callGeminiText) + Flash 모델 fallback |
| `41fafee` | v1.5.53 | 클라 | freeTalkHistory에 startedAt/endedAt/durationMs/freeTurnCount/turnLimit/endedReason 추가 |
| `3737e51` | 서버만 | 운영 | GEMINI_MODE 운영자 토글 (auto/fast/flash 3 모드) |

## 1. Flash 모델 fallback 통합 (`1e4090d` — 가장 큰 변경)

**핵심**: 모든 Gemini 호출이 동일 helper 사용 → primary 모델 N회 retry → 최후 fallback 모델 1회 escalate.

- `server/utils/geminiCall.js` 신규: `callGeminiJson` + `callGeminiText` 두 helper
- `server/config/gemini.js`: PRIMARY_MODEL(`gemini-2.5-flash-lite`) + FALLBACK_MODEL(`gemini-2.5-flash`) 분리, `geminiUrl(apiKey, model)` 시그니처에 model 인자 추가
- 적용 endpoint 7개 (이전 converse-start만 inline retry 있던 것 포함): translate / translate-memo / vocab-words / listening-passage / scene-sentence / scene-answer / converse-start / converse-reply / converse-summarize

**비용 시뮬레이션**: 평소(95%) 1x + outage(5%) 5x = 평균 ~1.25x. 전면 Flash 변경 5x 대비 75% 절감.

**실측 검증** (배포 직후 ConverseReply 로그):
```
attempt1 Flash-Lite → 503 fail
attempt2 Flash-Lite → 503 fail
attempt3 Flash-Lite → timeout 30s
escalating to gemini-2.5-flash
✅ gemini-2.5-flash succeeded (Flash-Lite outage rescued)
```
사용자는 ~38초 대기 후 정상 응답 (fail 0).

## 2. GEMINI_MODE 운영자 토글 (`3737e51`)

**필요성**: 1e4090d 적용 후에도 Flash-Lite 503이 너무 빈번. 운영자가 비상시 즉시 "Flash만 강제" 토글 원함.

env 한 줄로 3 모드 전환 (Render dashboard에서 즉시):
| 모드 | primary attempts | 용도 |
|---|---|---|
| `auto` (기본) | 3 | 평소 |
| `fast` | 1 | Flash-Lite 불안정 + 응답 시간 단축 |
| `flash` | 0 (건너뜀) | 완전 outage 비상 — 비용 5x but 안정 |

잘못된 값은 'auto'로 fallback + warn. 시작 시 모드 출력 (auto는 info, override는 ⚠️ warn).

## 3. Free Talking startError UI 분리 + reply 503 retry UX (`917b977`)

**문제 1**: v1.5.51의 startError 모달이 한 줄에 [한국어 메시지 + 영어 detail("AI service is temporarily busy") + 버튼] 가로 나열 → 답답 + 영어 노출.

**Fix**: `.ftc-error` flex-direction:column + `<small>{startError}</small>` UI에서 제거(console.error로만) + 10 locale `freeTalk.startError` 친화화 ("대화를 시작하지 못했어요. 잠시 후 다시 시도해주세요.").

**문제 2**: Free Talking **대화 중** 503 발생 시 사용자에게 그냥 ⚠️만 표시되고 재시도 수단 X. turn 카운트는 보존되지만 UX 끊김.

**Fix**:
- `useConversation.retryLastReply()`: 마지막 user_free의 sttRaw로 submitFreeUtterance 재호출 (실패한 user_free + ai placeholder 제거 후 재시작)
- ChatBubble: AI placeholder.replyError 영역에 보라색 **[다시 시도]** 버튼 + RotateCcw 아이콘
- FreeTalkingChat: `onRetryReply={m.replyError ? retryLastReply : undefined}` 전달

추가로 converse-reply route에도 retry 안전망 (converse-start 패턴 복제, 나중에 1e4090d에서 shared helper로 통합됨).

## 4. freeTalkHistory 시간/turn 분석 데이터 (`41fafee`)

**요청**: Firestore freeTalkHistory.situations[]에 세션 시작/종료/소요 시간/자유 발화 횟수 기록.

**구현**: `useConversation.js`만 변경.
- `appendFreeTalkHistory` 호출 시 `startedAt` 추가 + `lastHistoryKeyRef` 기록
- `freeTurnCountRef` ref: latest 값 캡처 (closure 회피)
- `updateLastFreeTalkHistoryEnd(reason)` 함수: 마지막 situation에 `{endedAt, durationMs, freeTurnCount, turnLimit, endedReason}` 추가. idempotent (이미 endedAt 있으면 skip).
- `useEffect [sessionEnded, endedReason]`: 자동 호출 (user/limit/idle/closed 모두 캡처)
- `resetSession` fallback: 모달 즉시 닫는 경로도 `endedReason='closed'`로 기록

저장 스키마:
```
situations[N] = {
  createdAt, summary, dimensions,
  startedAt, endedAt, durationMs, freeTurnCount, turnLimit, endedReason
}
```

endedReason 4종: `user` / `limit` / `idle` / `closed`.

검증 (실 사용자 record): durationMs 228,290 = 3분 48초, freeTurnCount 4/5, endedReason 'user'.

## 5. Vercel Hobby 빌드 큐 stuck 사고 → Pro 전환

41fafee 푸시 후 ~1시간 동안 Vercel 라이브 번들이 옛 1e4090d 그대로. 라이브 번들 검색 결과 startedAt/endedAt/durationMs 키 0. dashboard 확인 결과:
- 3737e51: Queued (대기)
- 41fafee: Initializing (시작 단계 stuck)
- 1e4090d: Ready + Current (라이브)

원인: Vercel Hobby 플랜 concurrent build 제한. 누적 deploy 시 stuck. 사용자가 **Pro로 전환** → 즉시 큐 풀리고 41fafee/3737e51 Ready → 새 hash `index-Dt9Puk-i.js` 라이브 + 6개 신규 필드 모두 검증됨.

## 6. 모든 채널 v1.5.53 일치 확인

| 채널 | 버전 | 상태 |
|---|---|---|
| Render (서버) | 3737e51 | ✅ |
| Vercel (웹) | v1.5.53 | ✅ (Pro 전환 후) |
| Capgo production OTA | 1.5.53 | ✅ |

## 진단 도구 (외부 검색)

WebSearch + WebFetch로 Gemini outage 공식 공지 조사. 결과 [feedback_gemini_503_resilience](feedback_gemini_503_resilience.md) 참조.

- [status.cloud.google.com](https://status.cloud.google.com/incidents/41E5S3mkTGDfkZuJZH5k): 최신 incident는 2026-02-27 (resolved). 5/15~5/22 incident 없음.
- [Google AI Forum thread](https://discuss.ai.google.dev/t/production-downtime-gemini-2-5-flash-gemini-3-flash-preview-503-service-unavailable/139749): 4월부터 5월까지 community 다수 보고. 공식 인정 없음.
- [Flash-Lite implicit caching 미작동](https://discuss.ai.google.dev/t/gemini-2-5-flash-lite-implicit-caching-not-working-despite-meeting-documented-requirements/107342): cached_content_token_count=0

## 보류된 작업

- **C 옵션 (prompt 다이어트)**: buildReplyPrompt 31KB → 18~20KB. Flash 응답 11초 → 7~8초 단축 가능. 응답 품질 영향 측정 필요해서 별도 PR.
- **모델 fallback 변경**: `gemini-2.5-flash` → `gemini-1.5-flash` 또는 다른 provider. 1.5는 instruction following 약간 약함. 측정 후 결정.
- **converse.js의 unused axios import**: cleanup 보류 (다른 endpoint 미참조 확인되면 제거)

## 핵심 학습
[[feedback-gemini-503-resilience]] 메모리에 재사용 패턴 정리.
