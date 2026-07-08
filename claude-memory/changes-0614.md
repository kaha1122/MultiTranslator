---
name: changes-0614
description: 2026-06-14 PronunFit v2 배치(학습완료=발음통과 전환·마스터1단어1문장·goal60·코칭캐시·페이지캐시·홈UX) + TDZ 프로덕션 크래시 핫픽스 + 통과배지 중앙이동 + Phase4 콤보 폐기/Phase5 완료 결정 + seed·TTS 구조 정리
metadata: 
  node_type: memory
  type: project
  originSessionId: cf7c0308-eb18-433b-a6ca-a88a75d2b6c6
---

# 2026-06-14 작업 정리 (v2 배치 + 핫픽스 + 설계확정)

PronunFit v2(학습경로 홈 + 단계학습 + seed 모델) 후속 정비. 실유저 테스트 로그 기반 리파인 배치 + 프로덕션 크래시 핫픽스.

## 1. v2 리파인 배치 — 커밋 `78eba14` (main push 완료, Vercel/Render 배포됨)

- **학습 완료 기준 전환: 카드 저장 → 발음 통과** (사용자 요구 "카드 저장이 학습 완료가 되어선 안 됨"). [App.jsx] `incrementAchievement`를 save 핸들러 5곳(Translation/Video/Scene/Vocab/Conversation)에서 제거하고 `handleTopicPass`(발음통과 지점)로 이동. Daily 목표·Vocab 5/5 모두 발음통과로 카운트.
- **토픽 마스터 기준 완화: 1단어 + 1문장** ([src/config/learningPath.js] `W_TARGET=1, P_TARGET=1`, 기존 5/4). 단어 1개·문장 1개만 통과하고 나가도 홈 TopicHub 노드가 Mastered 색으로 바뀜.
- **발음 목표 기본 점수 80 → 60 하향** (여러 컴포넌트 `languageGoals[x] || 80` → `|| 60`: VocabTab/ScenePractice/Library/FreeTalkingChat 등).
- **발음 코칭 리질리언스 + 빈도 절감** ([server/routes/analyze.js]): Gemini 직접호출 → `callGeminiText`(Flash fallback) 라우팅 + 점수버킷 in-memory 캐시(`coachCache` Map, `COACH_MAX` 상한, key=`sourceLang|scoreBucket|referenceText`). 프로덕션 503 관찰이 동기. 실패 시 fallbackTip.
- **컴포넌트 페이지 캐시**: 동일 토픽 재진입/같은 offset이면 네트워크 없이 즉시 복원. VocabTab `loadedPagesRef`(useRef Map), ListeningTab `loadedPassagesRef`. 키=`${historyKey}--${offset}`.
- **카드 상단 발음통과 배지**: VocabWordCard에 `passed`(=assessmentResult 점수 ≥ targetGoal) 조건부 `<CheckCircle> 통과` 배지. Vocab/Listening 공용.
- **홈 노드 아이콘 +30% 확대** ([LearningPathHome.css/jsx]): 노드 60→78px, 행높이 68→84, 중앙선 top/bottom 34→42, 라벨 바깥간격 90→102px, 내부 lucide 아이콘 Check24→31/Play22→29/Lock18→23/dot14→18.
- **StreakIntroModal 버튼 통합**: 하단 "후에"+"통계 탭에서 보기" 2버튼 → **"시작" 단일 버튼**(닫고 학습 시작). `handleCta`/`onCta` 제거. i18n `streak.intro.start` 10 locale 추가(parity 1265 keys).
- **scripts/seed-vocab.js**: vn(vi→en) seed 지원.
- 검증: build·check-secrets·check-i18n·ios-heat-guard 전부 PASS.
- **vn seed 적재**: `vi→en` Unit1 10토픽 SKIP_TTS=1(텍스트만, 레이트리밋 회피). 음성은 실유저 write-through로 자연 충전.

## 2. 프로덕션 TDZ 크래시 핫픽스 — 커밋 `3eb70d7` (push 완료)

- **증상**: prod `ReferenceError: Cannot access 'O' before initialization` → 루트 에러바운더리 전체 크래시. JP source로 Vocab 첫 5단어 자동 로드 시 발생.
- **원인**: 위 배치에서 pass 배지 추가 시 [VocabTab.jsx] VocabWordCard의 `const passed = !!assessmentResult && ...`를 `const { ..., assessmentResult } = useAudioRecorder(...)` **위**에 둠 → `assessmentResult`(압축명 'O') 선언 전 참조 TDZ. 78eba14에서 유입된 회귀.
- **수정**: `passed` 계산을 destructuring **뒤로 이동**.
- **영향 범위**: 웹(pronunfit.com)만(방금 배포된 빌드). iOS/Android 네이티브는 v2 배치를 Capgo OTA로 안 올려 이전 번들 사용 → 무사.
- **재발방지**: [[bug-patterns]]에 "TDZ 변종 — 훅 destructuring 반환값 선언 전 참조" 기록. lint가 android/ios 산출물로 crash해 no-use-before-define 미검출 → **변경 컴포넌트를 실제 렌더하는 동작 테스트 필수**.

## 3. 통과 배지 위치 수정 — 커밋 `fa75e75` (⚠️ 로컬만, push 안 함)

- 통과 배지가 `top:8;right:8`이라 우상단 🔊/⭐ 버튼과 겹침 → `top:8; left:50%; transform:translateX(-50%)` **상단 중앙** 정렬. 사용자가 "배포는 다른 것과 함께" 요청 → push 대기.

## 4. 설계 확정 / 결정 사항 (코드 변경 없음, 이해 합의)

- **기존 구독자 학습 이력 단절(합의)**: 구버전 개인 `vocabHistory.words`는 새 seed 모델에서 "이미 학습함"으로 인식 안 됨 → seed 1번부터 재시작. 키 차이: 개인=`topic--level--targetLang`(sourceLang 없음) / seed=`topic--level--src--tgt`. 진도/마스터는 `topicProgress`(발음통과 기반)로 추적. 중복 감수하기로 결정(마이그레이션 비권장).
- **다음 단어 흐름 = `vocabHistory.seedCursor`(정수 커서)**. topicProgress(마스터기록·streak 전용)와 **별개**. Generate(advance)=cursor+5 → 서버가 글로벌 `vocabSeed` offset slice 반환. topicProgress 키는 `topic--targetLang`(sourceLang 무관, level은 `byLevel` 내부필드). seedCursor 엣지: sourceLang 도중 전환 시 seed 길이 불일치로 빈 slice 가능(드묾, 미수정).
- **TTS 음성 연결 = content-addressed(중요)**: seed 문서에 음성 파일명 저장 안 함. **파일명 = sha256(SSML)**. 텍스트+언어+보이스가 결정론적 SSML → 동일 해시 → 동일 경로 `gs://trnaslatorapp.firebasestorage.app/tts-cache/{sha256}.mp3`. 3-tier: 인메모리 LRU(ttsCache) → Storage durable(ttsDurableCache) → Azure 합성+write-through. durable은 **preset(단계학습) 경로만**(`ttsDurable={!!preset}`). 같은 문장은 토픽 달라도 파일 1개 공유.
- **Phase 5 = 완료 처리**: durable TTS 캐시 ✅완료 / TTS pre-cache는 도구(seed-vocab.js warmTts) 완성+부분실행(en 일부, vn은 skip) / Tier-0 정적번들(오프라인 내장)은 **미착수·보류**(네이티브 재빌드 필요, 효용 낮음, 다음 AAB/IPA 묶음). 핵심(durable)은 다 됨 → 충분하다고 결정.
- **Phase 4 = 교차언어 콤보 폐기**: 언어별 진도는 홈 pill 전환(언어별 70-dot·계단 재색칠)으로 충분. 콤보 불가 이유=언어별 seed 독립 생성이라 position이 같은 개념을 안 가리킴 → 정렬하려면 "개념 앵커(conceptSeed)" 도입 필요(재정렬·재생성 비용). USP 대비 과투자 판단 → 폐기. 아크 보드(점 1개를 활성언어 1~3개 아크 세그먼트로)만 향후 후보(데이터는 topicProgress 언어별 저장돼 있어 렌더만 SVG 아크로 교체, 발열=정적 렌더).

## 배포 상태
- `fa75e75` 통과배지 중앙이동 — 2026-06-15 `1f42f2f`(포인트 개편)와 함께 **push 완료**(웹/서버 자동배포). 모바일 OTA는 대기. 상세 [[changes-0615]].

[[changes-0612-thermal]] [[feedback_commit_heredoc]] [[bug-patterns]]
