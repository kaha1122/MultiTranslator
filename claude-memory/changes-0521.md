---
name: changes-0521
description: 2026-05-21 비영어 customInput 의미 손실 4탭 일괄 fix — Step 0(native interpret) + isCustom 플래그(category 강제 우회) 2-layer 적용 + Capgo v1.5.49 production OTA
metadata: 
  node_type: memory
  type: project
  originSessionId: c5983a41-0da1-45c0-beeb-697c7a119710
---

# 2026-05-21 — 비영어 customInput 의미 보존 4탭 일괄 fix

## 배경
사용자 보고: Free Talking customInput에 베트남어 `"Giới thiệu với người bạn mới"`(자기소개) 입력하면 AI가 무관한 공항 체크인 시나리오를 만듦. 영어/한국어는 정상. 러시아어도 동일 패턴.

Firestore freeTalkHistory 직접 확인 결과: `summary`는 베트남어(`"Hỏi về ưu đãi ở quán cà phê"`)인데 `dimensions`는 영어(`responder_role:"barista"`, `topic_focus:"special offer"`)로 분리 — 언어 일관성 깨지고 일반 영어로 정규화돼 의미 손실.

## 원인 (2단계 발견)

**1차 진단**: 영어 프롬프트가 비영어 입력을 영어 분류축에 강제 매핑.

**1차 fix** (commit `94bfa23`, Render server only): 4개 endpoint(buildStartPrompt, scene-sentence, scene-answer, listening-passage)에 **[Step 0: Detect Scene/Topic Input Language]** 블록 추가 — "input의 언어를 먼저 detect → 영어 번역 거치지 않고 NATIVE로 해석".

**2차 진단** (사용자 재현 후): Step 0만으론 부족. baseline `category='locations'`가 [conversationPrompt.js:146](server/utils/conversationPrompt.js#L146)의 `"scene IS the physical place"` 강제 매핑을 발동 → "자기소개"를 장소로 매핑 불가 → random 장소(공항) 픽. **category 강제 매핑이 진짜 원인**.

**2차 fix** (commit `5a00518`, 클라 4 + 서버 5): **isCustom 플래그 패턴**:
- 클라: customInput 사용 시 `isCustom: true`를 모든 endpoint payload에 명시 전송
- 서버: isCustom=true면 category-aware 강제 매핑 우회 + "scene/topic 텍스트 의미 trust" 분기 활성화

A안(서버 단독 LLM 자체 판단)도 가능했지만 사용자가 B안(클라 명시 플래그) 선택 — "원천적으로 제거될 것 같다". 결정론적 차단으로 더 안전.

## 변경 범위 (commit `5a00518`)

| 영역 | 파일 | 변경 |
|---|---|---|
| 클라 | [ScenePractice.jsx](src/components/ScenePractice.jsx) | scene-sentence/answer fetch + onFreeTalkStart에 `isCustom: isCustomSelected` |
| 클라 | [useConversation.js](src/hooks/useConversation.js) | converse-start payload에 isCustom passthrough |
| 클라 | [VocabTab.jsx](src/components/VocabTab.jsx) | vocab-words payload에 `isCustom: !selectedTopic` |
| 클라 | [ListeningTab.jsx](src/components/ListeningTab.jsx) | listening-passage payload에 `isCustom: hasCustom` |
| 서버 | [conversationPrompt.js](server/utils/conversationPrompt.js) | buildStartPrompt에 isCustom 받아 Phase 0 category 분기 앞에 CUSTOM INPUT MODE override 블록 |
| 서버 | [converse.js](server/routes/converse.js) | req.body.isCustom → buildStartPrompt passthrough |
| 서버 | [scene.js](server/routes/scene.js) | scene-sentence/answer Step 0에 CUSTOM INPUT MODE 강조 |
| 서버 | [vocab.js](server/routes/vocab.js) | Step 0 신규 + CUSTOM INPUT MODE |
| 서버 | [listening.js](server/routes/listening.js) | 기존 Step 0에 CUSTOM INPUT MODE 추가 (passageKeywords 영어 유지 명시) |

## 검증 결과 (사용자 confirm)

| 탭 | 입력 | 생성 결과 |
|---|---|---|
| Free Talking | `"Giới thiệu với người bạn mới gặp"` (VI, default category=locations) | "Bạn đang đứng ở lối vào một buổi tiệc tại nhà một người bạn mới..." — 친구 집 파티 입구라는 자연스러운 setting ✅ |
| Listening | `"Đi du lịch Đà Nẵng"` (VI) | "My Trip to Da Nang" + 다낭 특유 본문(beach/sand/food) + passageKeywords 영어 유지 ✅ |
| Vocab | 동일 | 다낭 specific 어휘 ✅ |

## 배포

- **Vercel** (web): 5a00518 자동 배포 (~1분)
- **Render** (server): 5a00518 자동 배포 (~2분) — 이전 server-only 94bfa23도 포함
- **Capgo production OTA**: v1.5.49 (commit `37fb102` release bump), Android+iOS, channel pointer 검증 OK

## 보류 / 후속 작업

1. **topic_focus 영어 고정** ([conversationPrompt.js:414](server/utils/conversationPrompt.js#L414)): A안(현재 영어 유지)으로 운영. 2-필드 분리(`topic_focus_en` + `topic_focus_native`)는 별도 PR 검토 — Firestore freeTalkHistory 스키마 마이그레이션 동반(자연 회전, 백필 불필요).
2. **converse-reply (buildReplyPrompt)**: scene 원본 안 받고 scenarioMeta만 받음 → 추가 패치 불필요. start 시점에 해석된 메타가 reply에 인계됨.
3. **Vocab은 영어 dedup 필드 없음**: passageKeywords 같은 영어 정규화 키 없어서 Step 0만으로도 충분했으나 통일성 위해 isCustom 패턴 적용.

## 학습 — 디자인 패턴
[[feedback-custom-input-isCustom]] 참조 (재사용 가능한 2-layer 패턴 정리).
