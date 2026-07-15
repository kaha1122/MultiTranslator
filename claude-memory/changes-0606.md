---
name: changes-0606
description: "2026-06-06 — Free Talking 후속 보강: establishedFacts 값퇴행 방어(서버 key-merge) + \"반응 먼저(3-beat)\" 대화 + facts 강등금지 프롬프트 / 사용법 가이드 문구 \"따라하기\" 오해 제거(10 locale). 실유저 로그 분석 기반. Capgo prod 1.5.91"
metadata: 
  node_type: memory
  type: project
  originSessionId: b1cc88f4-cf0b-42bd-8f30-46abd5e16027
---

# 2026-06-06 — Free Talking 실유저 로그 분석 기반 후속 보강 2건

[[changes-0603]]의 A(history -30)/B(establishedFacts slot memory)/대화로그(freeTalkTranscripts) 배포 후, 실제 `freeTalkTranscripts` 로그를 보고 두 가지 회귀/오용을 추가로 잡았다.

## 1. establishedFacts 값퇴행 방어 + 반응먼저 + 강등금지 (commit 36ae09f, 서버전용/Render)

### 발견 (일본어 로그)
- 일본어 세션에서 모델이 `party_size: 8`을 다음 턴 `party_size: asked, awaiting answer`로 **강등**하고 "何名様ですか?"를 **재질문** → f 누적이 무너짐. (영어 로그2는 juice→apple→price→payment 정상 누적되던 것과 대비)
- 원인: (a) Flash-Lite 일본어 coherence 약함 + STT 노이즈(要約↔予約, 五名↔米), (b) **서버 정규화가 길이 기반**(`next.length >= priorFacts.length`)이라 개수 그대로면 값 강등(8→asked)을 못 막음.

### Fix
- **서버 `mergeEstablishedFacts`** (server/routes/converse.js): key 기반 병합으로 교체. `attribute:` 앞부분을 key로, **구체값 슬롯을 모델이 'asked'로 되돌려도 무시(구체값 유지)**, 새 구체값은 갱신(정정 허용), 새 key는 누적. prior 순서 유지 후 신규 append. 단위검증 5/5(강등차단·누적·드롭복원·정정·log2재현).
- **프롬프트** (server/utils/conversationPrompt.js):
  - RUNNING STATE + 출력 JSON 지시에 "구체값을 'asked, awaiting answer'로 되돌리지/재질문 말 것" + 일본어 워크드 예시(八名→party_size:8 고정)
  - **Phase1 Rule2를 "반응 먼저(3-beat)"로 격상**: (a) react(사용자 발화에 자연 반응) → (b) fulfill/answer → (c) advance(다음 질문 1개). 우산 예시("Oh, is it raining? Here's an umbrella. When will you be back?") + formulaic/non-sequitur 금지. basic 난이도는 "짧은 반응 포함 1~2문장"으로 완화(기존 '1문장 8단어' 타이트 제한 해제).

### 비용/성능 점검 (사용자 요청)
- merge는 **순수 in-memory**(req.body의 priorFacts + Gemini 응답 in-memory). **Firestore read/write +0, LLM 호출 +0, latency ~0**. 유일 증가는 프롬프트 input 토큰 +1~2%(예시 추가). 큰 비용 effect 없음. (converse-reply 라우트는 원래 DB I/O 0건)

### 배포 후 검증 로그 (양호)
- 일본어 식당예약 세션: party_size:5 → +reservation_time → +reservation_name **강등 없이 단조 누적**, 인원수 재질문 0, 매 턴 "～でいらっしゃいますね"(확인)→답변→질문 3-beat 동작. ✅
- 잔존(사소·자가복구): 턴3 "米です"는 "五名です(ごめい)" STT 오인식인데 Phase0 intent recovery가 못 잡음 → 다음 턴 AI가 "米？"로 반응하며 되물어 자가복구(단 임의로 "8名?" 추측은 어색). CJK 숫자 동음이의 보정 + 혼란시 추측금지는 미진행(보류).

## 2. 사용법 가이드 문구 "따라하기" 오해 제거 (commit 4717648, v1.5.91, 클라/10 locale)

### 발견
- 신규 유저가 "✨Free-Talking 사용법" 안내의 **"먼저 상황 설명과 예시 대화를 듣고 따라 해보세요"**를 보고, 하단 **마이크 버튼으로 예시 대화를 그대로 흉내**(opener 사용자 발화 + AI 대사까지 parroting)내다 제자리만 돌고 2턴 만에 종료하는 오용 로그 확인. (마이크=다음 자유발화용인데 "따라하기"로 오인)

### Fix (freeTalk.guideStep1/guideStep3, 10 locale 일괄 + FreeTalkingChat.jsx fallback)
- guideStep1: "…듣고 **따라 해보세요**" → "…듣고 **다음 대화를 상상해 보세요**"
- guideStep3: "대화 중 [💎카드 만들기]로 핵심 표현 저장" → "**주고 받은 메시지를 탭 하여 카드를 열고 학습하세요**" (따라하기=메시지 탭→카드, 마이크=자유발화로 역할 분리 명확화)
- guideStep2 유지. 이모지(👂🎤💎)는 JSX 상수라 불변. check-i18n 통과(1202키 parity). [[feedback_i18n_completeness]]
- 다국어 일괄 수정은 임시 node 스크립트로 정확 문자열 치환(치환 횟수 검증) 후 삭제 — Edit가 파일별 사전 Read 요구해 비효율일 때 유용한 패턴.

## 컨텍스트 (별도 배포, 이 세션 작업 아님)
- v1.5.90 (commit bfa520b/4472858): "직접입력란 항상 노출 + 장소/상황 버튼 2개씩". 직접입력(타이핑) 경로를 열어 마이크 흉내 오용 완화에 보조.

## 배포 요약
- Capgo production: 1.5.88(B) → 1.5.89(대화로그) → [1.5.90 직접입력] → **1.5.91(가이드 문구)**. 서버 merge+프롬프트(36ae09f)는 버전 bump 없는 Render 전용 배포.
- 채널 승격은 재업로드 아닌 `channel set production --bundle <v>`. 업로드 후 `channel currentBundle`로 검증.

## 재사용 교훈
- **작은모델 slot 무결성은 프롬프트만으론 부족** → 서버 key-merge로 데이터 레이어에서 강등/드롭 방어(graceful, in-memory, 비용 0). 프롬프트는 행동 유도, 서버는 최후 방어선. [[feedback_client_server_parity]]
- **대화 자연스러움 = react→fulfill→advance 3-beat** (단순 답변+질문 금지).
- **UX 안내 문구의 동사 하나가 오용 유발**: "따라 해보세요"가 마이크 parroting 유발. 입력수단별 역할(마이크=자유발화 / 탭=학습) 명확화 필요. 문구 변경도 i18n 10 locale 일괄 + check-i18n 필수.
- 실유저 `freeTalkTranscripts` 로그가 회귀/오용 진단의 결정적 근거가 됨(도입 목적 b 달성).
