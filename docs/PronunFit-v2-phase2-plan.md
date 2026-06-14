# PronunFit v2 — Phase 2: Write-through Seed 캐시 (확정 계획)

> 작성: 2026-06-14 · 기준: 사용자 5대 요구사항 + Phase 1 코드. 핵심 = **결정적·순차적·전역 공유 seed 캐시**.

## 핵심 개념
- 현재 vocab/listening은 **유저별** Gemini 생성(개인 vocabHistory, avoidWords 회피).
- Phase 2 → **전역 canonical 시퀀스**: 같은 토픽/유닛에서 모든 유저가 **같은 단어를 같은 순서로**.
- 코드(seedKey)로 식별, 5개 단위 페이지(단어)·1개 단위(지문)로 누적, offset(커서)로 순차 소비.
- frontier(미생성 페이지)만 첫 요청자가 Gemini 생성 → seed append → 이후 전원 무료.

## 결정 사항
- **TTS (확정)**: seed 콘텐츠 음성은 **첫 유저가 Azure 합성 → Firebase Storage 저장 → 전원(네이티브 보유 무관) 그 Azure 음성 재생**(품질 일관성 우선). durable 캐시(`tts-cache/{sha256}.mp3`) 1회 합성·공유. 배치에서 Azure pre-render 사전 적재. (네이티브 우선 라우팅은 비-seed·custom 콘텐츠에만 유지. 네이티브 음성 캡처·저장은 web/플러그인 한계로 불가.)
- **Listening 자동화 (확정)**: seed가 있으면 **지문 자동 로드 + 문장 카드 자동 생성**. 이를 위해 passageSeed에 **문장별 주석(번역·발음기호·학습팁)까지 seed화**(지문 생성 시점에 함께 생성). 클라는 진입 시 Gemini 호출 0으로 지문+문장 카드 자동 렌더.
- **Pre-seed**: 배치 스크립트로 Unit 1(+head 언어) 사전 생성.

## 1. 데이터 모델
**Firestore (서버 admin write 전용, authed read, 클라 write 금지 — rules 추가)**
```jsonc
// vocabSeed/{topicId}--{level}--{sourceLang}--{targetLang}
{ topicId, level, sourceLang, targetLang,
  words: [ { word, pronunciation, meaning, example, examplePronunciation,
             exampleTranslation, learningTip[] }, ... ],  // 순서 고정, 5씩 누적
  updatedAt }
// passageSeed/{topicId}--{type}--{level}--{sourceLang}--{targetLang}
{ topicId, type, level, sourceLang, targetLang,
  passages: [ { title, titleTranslation, passage, passagePronunciation,
                passageTranslation, passageKeywords[], angle,
                sentences: [ { text, translation, pronunciation, learning_tip } ] }, ... ], // 1씩 누적
  updatedAt }
// sentences[] = 지문 생성 시점에 문장 분리 + 주석 일괄 생성 → 클라가 per-user Gemini 없이 문장 카드 자동 렌더
```
**TTS — Firebase Storage** `tts-cache/{sha256(ssml)}.mp3` (기존 durable 캐시 재사용). seed 텍스트 결정적 → 전원 동일 해시 → 1회 합성·전원 공유. Learning Tip은 seed 단어 객체 텍스트로 포함.

**firestore.rules**: `match /vocabSeed/{doc} { allow read: if request.auth != null; allow write: if false; }` (passageSeed 동일).

## 2. 서버 — 순차 공유 서빙 (vocab.js / listening.js)
```
요청: { topicId, level, sourceLang, targetLang, offset, isCustom }
1) isCustom → 기존 개인 생성 경로(seed 우회)
2) seedKey 조회 (인메모리 LRU → Firestore)
3) seed.length >= offset+N → slice(offset, offset+N) 반환 (source:'seed', Gemini 0)
4) frontier → Gemini 생성(avoid=기존 seed 전체) →
   트랜잭션: 재조회 후 length<=offset이면 append, 아니면 이미 채워진 slice 반환(경합 방지)
   → 반환 (source:'gemini')
```
- 경합 안전: 생성은 트랜잭션 밖, append만 트랜잭션+length 재확인.
- vocab N=5, passage N=1.

## 3. 클라 — 커서 + 자동 로드
- 유저별 커서: `vocabHistory/{seedKey}.seedCursor`(소비 단어 수, 기본 0). 요청 offset=커서, 반환 수만큼 +.
- **TopicHub→Vocab 진입(preset) 시 자동 generate(offset=커서)** → 버튼 없이 5장 즉시.
- "다음 5장" → offset += 5.
- 기존 유저 구 vocabHistory와 분리: seedCursor 0부터 시작.

## 4. Listening — D4 통합 + 자동 카드
- passageSeed 동일 모델. 첫 Generate가 canonical 지문 + **문장별 주석(sentences[])** 함께 생성·저장, 전원 재사용.
- **자동화**: seed 존재 시 진입(preset) → 지문 자동 로드 + **문장 카드 자동 나열**(VocabWordCard 재사용). per-user `annotate-sentence` Gemini 호출 제거(주석은 seed에서).
- **D4 학습단어 주입 변경**: per-user studied → **해당 토픽 seed 단어** 주입. seed 단어는 전원 동일 → 지문도 결정적·공유 + 학습단어 재등장 유지.
- UI 변경: 현재 "문장 탭→카드 1개" → 문장 카드 자동 나열(단계학습 진입 시). 비-seed/standalone은 기존 동작 유지 가능.

## 5. TTS 동작 (확정 — seed는 Azure 저장 우선)
- **seed 콘텐츠**: 첫 유저가 **Azure 합성 → Firebase Storage(`tts-cache/{sha256}`) 저장 → 전원(네이티브 보유 무관) 그 Azure 음성 재생**(품질 일관성). `durable:true`로 Azure 경로 강제.
- 배치 pre-seed에서 seed 단어/예문/지문/문장 TTS를 Azure로 pre-render → Storage 사전 적재(첫 유저도 즉시 저장본).
- **비-seed/custom 콘텐츠**: 기존 handleSpeakSmart(캐시→네이티브→Azure 폴백) 유지.
- 네이티브 음성 자체의 서버 저장은 web/플러그인 한계로 불가 → 저장본은 Azure로 통일.

## 6. 배치 pre-seed 스크립트
- `scripts/seed-vocab.js`(+`seed-passage.js`): head combos(상위 src/tgt × Unit1 × basic) 텍스트 생성(Gemini) + Azure TTS pre-render → Firestore seed + Storage. idempotent(기존 skip). GEMINI/AZURE 키는 env(미커밋).

## 7. 텔레메트리
- 응답 `source:'seed'|'gemini'` + 서버 로그 → hit-rate/Gemini 절감 측정.

## 구현 서브페이즈
- 2-1 vocabSeed 서버 read-through + 순차 서빙 + rules + 인메모리 LRU
- 2-2 클라 seedCursor + preset 자동 로드
- 2-3 passageSeed(listening) + seed 단어 주입
- 2-4 seed TTS durable 라우팅(Azure 폴백 durable) 
- 2-5 배치 pre-seed 스크립트(Unit1 + head 언어) + TTS pre-render
- 2-6 텔레메트리

## 사이드 이펙트 / 리스크
- 🚨 서버(vocab.js/listening.js) 변경 → Render 재배포. seed 빈 값/구버전 클라 하위호환 필수.
- 🚨 Storage 쓰기량 — seed 단어 TTS 다수. head 언어×Unit1로 범위 제한, durable 해시 dedup.
- 🟡 기존 유저 vocabHistory ↔ seedCursor 정합(0부터 시작).
- 🟡 발열: seed read는 서버측 getDoc, 클라 onSnapshot 없음.
- 🟢 포인트/한도 무관, i18n 무관.

## 미해결/확인
- seed 콘텐츠 품질 검수(Gemini 생성물이 canonical로 고정되므로 1회 품질이 영구). 검수 단계 필요 여부.
- isCustom(커스텀 토픽)은 seed 미적용(per-user) 유지.
