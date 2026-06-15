# PronunFit v2 — Phase 1 변경계획 (확정본)

> 작성: 2026-06-14 · 기준 스펙: `docs/PronunFit-v2-implementation-prompts.md` (Phase 1)
> 본 문서는 사용자 지시 + 코드 조사 결과로 **확정된** Phase 1 실행계획이다. V2 원문과 어긋나는 4건의 결정을 포함한다.

## 확정 결정 (V2 ↔ 사용자 지시 차이 4건)

| # | 결정 | 비고 |
|---|------|------|
| **D1** 네비 개편 | **채택** — 하단 네비 = `[home, library, translation, scene]` (홈/단어장/번역기/Free Talking). "단어장"=**Library(저장카드 복습)**. Vocab·Listening은 단계학습에서만 진입. 동영상 **잠정삭제**, 통계 **사이드바 이동** | V2 Phase1 §8 "기존 탭 유지"를 넘어섬 |
| **D2** Free Talking Pro 게이팅 | **Phase 3로 미룸** — Phase 1에선 Free Talking **현행 유지**(전 tier 개방) | 과금/tier 변경은 Phase 3로 격리 |
| **D3** 70-dot 보드 | **미니그리드 + 단/지문 반반(단일언어)** 까지만. 멀티언어 1~3 아크 세그먼트는 Phase 4 | 언어 pill 바는 Phase 1 포함(활성언어 전환) |
| **D4** 단어→지문 연동 | **지문 단어 주입 포함** — 서버 `listening.js`에 `wordsToInclude` 추가. Render 재배포 필요(OTA 아님) | V2 Phase1 "서버 생성 변경 금지"를 넘어섬 |

**포인트 차감(첫 30pt/매일 10pt/발음 2점/TTS 첫합성 1점·캐시 무료)은 이미 코드와 일치 → 무변경.**

## 데이터 모델

신규 서브컬렉션 `users/{uid}/topicProgress/{topicId}--{lang}`:
```jsonc
{
  topicId, lang,
  wordMastered, passageMastered,      // 고유 통과 수 (wordKeys/passageKeys 길이와 동일)
  wordKeys: [], passageKeys: [],       // 멱등 dedup용 (멀티 디바이스/세션)
  status: "locked"|"in_progress"|"mastered",
  byLevel: { basic:{word,passage}, intermediate:{...}, advanced:{...} },
  updatedAt
}
```
- 마스터 조건: `wordMastered >= W_TARGET(5)` AND `passageMastered >= P_TARGET(4)`.
- **`users/{uid}` 본문에 절대 write 금지** (iOS 발열 규칙6) — 전부 서브컬렉션. onSnapshot 금지, getDocs 1회 + 백그라운드 setDoc.

## 파일 변경 매니페스트

**신규**
- `src/config/learningPath.js` — W_TARGET/P_TARGET, UNITS, COURSE_ORDER, TOPIC_INDEX, 색상맵, 마스터/현재토픽 헬퍼
- `src/config/onboardingPhrases.js` — 학습어별 고정 인사문장 (fr/es 긴 버전)
- `src/hooks/useTopicProgress.js` — 진행 모델 훅 (useDailyProgress 패턴)
- `src/components/LearningPathHome.jsx` — 계단 + 언어 pill + 70 미니그리드
- `src/components/TopicHub.jsx` — 단어/지문 게이지, 순차 잠금
- `src/components/OnboardingPronChallenge.jsx` — 5-A/B/C 첫 발음 챌린지

**수정**
- `src/hooks/useAudioRecorder.js` — `skipCount` 옵션 (무차감)
- `src/components/OnboardingModal.jsx` — `firstPron` step 삽입
- `src/components/VocabTab.jsx` — preset 진입 + `onTopicPass`
- `src/components/ListeningTab.jsx` — preset + `onTopicPass` + `wordsToInclude`
- `server/routes/listening.js` — `wordsToInclude` 파라미터
- `src/App.jsx` — 홈 교체·네비 개편·preset 배선
- `src/locales/*.json` ×10 — `onboarding.firstPron.*`, `learningPath.*`

## 작업 순서 (commit 단위, 각 commit 전 ios-heat-guard PASS → `.heat-guard-pass` touch)

1. **config + useTopicProgress 훅** (순수 추가, 무위험) ← *현재 단계*
2. 온보딩 첫발음 (useAudioRecorder skipCount + OnboardingPronChallenge + OnboardingModal + i18n)
3. LearningPathHome + 미니그리드 + 언어 pill
4. TopicHub + VocabTab/ListeningTab preset 진입 + recordPass 배선
5. 서버 listening.js `wordsToInclude` + 클라 전달 (Render 재배포)
6. 네비 개편 (TAB_ORDER/사이드바, 홈 교체) — 마지막 스위치
7. 각 단계: `npm run lint && build && check-i18n` → heat-guard PASS

## 사이드 이펙트 점검

**🚨 Critical**
- iOS 발열: topicProgress/recordPass가 `users/{uid}` 본문에 write 안 하도록(서브컬렉션 전용). 계단/미니그리드 무한 애니 금지, `prefers-reduced-motion` 존중.
- 서버 `listening.js`: Render 재배포 필요(OTA 아님). `wordsToInclude` 빈 값 하위호환 필수.

**🟡 Minor**
- 탭 제거 ↔ `viewModeHistoryRef`/path-init/딥링크 충돌 점검.
- `useAudioRecorder` skipCount 기본 false → 기존 5개 호출처 무영향.
- 안드로이드 WebView 계단 스크롤 height-0 retry 가드.

**🟢 영향 없음**
- 포인트 시스템(무변경), 기존 Library/Translation/FreeTalk, AI동의 별도 모달.
- 역사적 데이터: 기존 유저 topicProgress 없음 → 전부 locked 시작, soft-lock이라 즉시 학습 가능. vocabHistory/dailyProgress 스키마 무변경.

## 미해결/후속 확인
- `firestore.rules`: `topicProgress` 서브컬렉션이 owner catch-all 규칙에 포함되는지 통합 단계에서 검증 (freeTalkTranscripts와 동일 패턴이면 규칙 추가 불요).
- 통계(stats) 사이드바 이동 후 진입 경로 UX.
- 동영상 탭 컴포넌트는 남겨두되 네비에서만 제거 (완전 삭제는 별도 결정).
