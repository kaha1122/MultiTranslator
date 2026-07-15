---
name: feedback-custom-input-iscustom
description: 비영어 customInput 의미 손실 해결 패턴 — Step 0(native interpret) + isCustom 플래그(category 강제 매핑 우회) 2-layer 필수. AI 생성 endpoint 추가 시 동일 패턴 적용.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c5983a41-0da1-45c0-beeb-697c7a119710
---

PronunFit의 AI 생성 endpoint(Free Talking, Scene, Vocab, Listening 등)가 사용자 customInput을 받을 때, **비영어 입력(베트남어/러시아어 등)의 의미를 보존하려면 2-layer 처리 필수**:

- **Layer 1 — Step 0 블록**: 프롬프트 본문 최상단에 "입력 텍스트의 언어를 먼저 detect → 영어 번역 거치지 않고 NATIVE로 해석" 지시
- **Layer 2 — isCustom 플래그**: 클라가 customInput 사용 시 `isCustom: true`를 payload에 명시 전송 → 서버 프롬프트 내 category 강제 매핑/사전분류 강제를 우회하는 분기 활성화

**Why:**
영어로 작성된 프롬프트는 비영어 입력을 영어 분류축에 강제 매핑하는 압력이 있고, 추가로 category 같은 사전 분류 신호가 있으면 LLM이 입력 텍스트 의미보다 분류를 우선시함. Step 0만으론 부족했던 실사례: 베트남어 `"Giới thiệu với người bạn mới"`(자기소개)를 default category=`locations`와 함께 보내면, Phase 0의 `"scene IS the physical place"` 강제 매핑이 발동 → AI가 무관한 random 장소(공항 체크인)를 픽하고 거기 자기소개를 끼워 넣음. isCustom 플래그로 분류 매핑 자체를 우회한 뒤에야 "친구 집 파티 입구"라는 자연스러운 setting을 골랐음(2026-05-21 검증).

A 옵션(서버 단독 fix — 텍스트와 category 모순을 LLM이 자체 판단)도 가능하지만, 클라가 명시 신호를 전달하는 B 옵션(2-layer)이 **결정론적으로 원천 차단**되어 더 안전. 사용자가 명시적으로 "B로 가는 게 원천적으로 제거될 것 같다"고 선택.

**How to apply:**

1. **새 AI 생성 endpoint 추가 시**:
   - 클라이언트 fetch payload에 `isCustom: <bool>` 추가 (i18n 키 시나리오는 false, customInput은 true)
   - 서버 req.body에서 isCustom 추출 → prompt builder에 전달
   - 프롬프트 머리에 Step 0 블록 + `${isCustom ? 'CUSTOM INPUT MODE 강조 블록' : ''}` 조건 inject

2. **기존 endpoint에서 비영어 customInput 이슈 보고 시**:
   - 우선 isCustom 플래그 전송/수신 여부 확인
   - 영어 dedup 키 필드(예: passageKeywords, topic_focus)는 그대로 두고 "Step 0은 INPUT 해석만, 출력 필드 언어 규칙은 그대로"라고 명시
   - i18n 카드 시나리오(isCustom=false) 동작 회귀 1회 확인 — 분기 미발동으로 기존 그대로여야 함

3. **isCustom 분기 안에서 주의**:
   - "text가 PLACE 같으면 location으로, SITUATION/ACTION 같으면 free setting으로" 자체 판단 위임
   - 영어 예시만 넣지 말고 비영어 예시(베트남어/러시아어/한국어) 함께 inline — 모델이 분류 가능한 입력으로 인식하는 정확도가 올라감

**관련 코드 패턴**: [[changes-0521]] 참조.

**잠재적 후속 작업** (별도 PR 검토):
- `topic_focus` 영어 dedup 키 → `topic_focus_en` + `topic_focus_native` 2-필드 분리 (Firestore freeTalkHistory 마이그레이션 동반, 점진 회전으로 백필 불필요). 현재는 A안(영어 유지)으로 운영.
