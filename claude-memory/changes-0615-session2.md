---
name: changes-0615-session2
description: "2026-06-15 2차 — Listening 지문 단어장 저장(공유 컴포넌트)·결합생성(지문먼저→단어)·포인트/UX 배치(#3~#9)·테스트수정(이중외곽선/레이아웃/재진입무차감영속/Listening한도5/FT진입차단). 커밋 acb1816+a4d5959 main push"
metadata: 
  node_type: memory
  type: project
  originSessionId: cf7c0308-eb18-433b-a6ca-a88a75d2b6c6
---

# 2026-06-15 2차 — 지문 단어장 + 결합생성 + 포인트/UX 대형 배치

커밋: `acb1816`(지문저장·결합생성·#3~#9) + `a4d5959`(테스트수정·enh). 둘 다 **main push 완료**. 모바일 Capgo OTA는 대기. [[changes-0615]](1차=포인트 경제)에 이어짐.

## 1. Listening 지문 → 단어장(Library) 저장
- **ListeningPassageView**(신규 공유 컴포넌트): ListeningTab·Library 동일 UI. 지문 카드(제목·컨트롤·본문·발음/번역 토글)+자체 재생 로직 내장(passagePlaying/loopMode/AbortController/세대토큰, cleanup: passage.text 변경·isActive=false·unmount). ListeningTab 인라인 지문 블록을 이걸로 교체. **옛 재생 코드(handlePassagePlay/openSentenceCard 등)는 dead code로 잔존 — 후속 클린업 대기.**
- 헤더 레이아웃(테스트 후 확정): **1줄 아이콘(반복토글>지문재생>별표) / 2줄 제목 / 3줄 번역**.
- 저장: `savePassageCard`(App.jsx) → `inputType:'L'`, `sourceType:'listening'`, `passageData`(title/text/발음/번역/sentences/passageType) **스냅샷 복사**(seed 참조 아님). 중복 방지(text+listening). essay·dialogue 모두 저장 가능.
- Library: `inputType:'L'` 카드는 ListeningPassageView로 동일 렌더(조회·재생만, 문장 발음연습 없음, TTS 무료). 필터 **W/S/L** 단일선택(기본 {W,S,L}), i18n `library.typeListening`.
- **#1 이중 외곽선 수정**: `.library-card-wrapper .listening-passage-card { border:none }`(App.css) — wrapper 외곽선만.

## 2. 결합 생성 — 지문 먼저 → 단어 추출 (정합성)
- 배경: 기존 단어먼저→지문이 단어 끼워넣기(forced 위험). 변경: 1회 Gemini로 자연스러운 지문 작성 후 **그 지문에서** 핵심 단어 5개 추출 → 단어/지문 100% 정합.
- **server/utils/generateUnit.js**(신규): `{words[5], passage{...essay}}` 반환. vocab.js **seed MISS(frontier)**에서 호출 → vocabSeed + passageSeed(essay) **동시 저장**(offset 정렬: passageOffset = vocabOffset/SEED_PAGE).
- **기존 seed 보존**: vocab/passage HIT는 그대로 서빙, appendAndSlice race-guard로 덮어쓰기 안 함 → 결합생성은 새 frontier만. custom/구클라는 기존 word-only 유지. dialogue는 listening.js on-demand(word-first weave) 유지.
- 효과: 단어 Generate 1회로 지문까지 확보 → Listening 진입 시 passageSeed HIT(무생성). **단, 사용자 차감은 유지**(onGenerate가 seed HIT 포함 모든 성공 fetch에서 호출, 재진입만 면제).

## 3. 포인트/UX 배치 #3~#9 + 테스트 수정
- **#3** Daily 목표 기본 3→**10** (마이그 v4, 기존 유저도 1회 reset, 이후 사용자 설정 보존).
- **#4** bonus02(`AD_UNITS.rewardedProns`) 광고 → **오늘 발음 허용량 +10**. 서버 `/api/bonus/pron-allowance`(쿨다운+일캡5, `dailyProgress.pronBonus` 누적·자동리셋, date는 클라 로컬). `effectivePronLimit = TRIAL_DAILY_PRON_LIMIT + todayPronBonus`(게이트·게이지·팝업). `handlePronAllowanceAd`. **사이드바 버튼 + 한도(cap)팝업 버튼** 둘 다, "당일 한정·포인트 아님" 명시(i18n pronAllowanceAd/Desc).
- **#5** Listening 생성 비용 2→**3**(POINT_COST.listen=3+addAdPoints(3)). 한도팝업 차감안내: FT 제거 / Listening −3 / **지문 −2 추가**(i18n costPassage). cap팝업 FT칩 제거.
- **#6** Free Talking **Pro/Premium 전용**: `onFreeTalkStart` tier 분기 + **enh3** 사이드바 Scene·하단탭 💬 진입 시 화면 전환 전 `requestProOnlyModal`("Pro/Premium 전용입니다"). ⚠️ **Scene 탭 전체 차단**(발음연습 포함) — FreeTalk만 막을지 미확정(사용자 확인 대기).
- **#7** Learning Tip 보강: 단어팁 2-3→**3-4개**(+nuance/실수/기억법), 문장 learning_tip 1→1-2문장. **신규 생성분만**(기존 seed 불변).
- **#8 재진입 무차감**: ① 지문 TTS 세션 chargeKey dedup(ttsChargedRef, 재진입 무료) ② **영속 chargedMax**(enh1): vocab/listeningHistory에 `chargedMax`(차감완료 최대 offset) 저장 → offset ≤ chargedMax 재진입은 **세션 바뀌어도 무차감**, 새 페이지(offset>chargedMax)만 차감.
- **#9 재진입 자동로드**: `autoGenKeyRef`를 preset(topicId/lang/level) 변경 시 리셋하는 effect 추가(Vocab·Listening) → 섹션 닫았다 열면 버튼 없이 캐시 페이지 자동 표시.
- **enh2** Listening 일일 한도 3→**5** (TRIAL_DAILY_LISTEN_LIMIT, 게이지·팝업 단일 상수).

## 배포 / 미해결
- `acb1816`·`a4d5959` main push(Vercel prod + Render). **모바일 OTA 대기**(rewardedProns 광고유닛은 기존이라 네이티브 재빌드 불필요, JS는 OTA 필요).
- **미확정 결정**: enh3 범위(Scene 전체 vs FreeTalk만). dead code 클린업(ListeningTab 옛 재생).

## 교훈
- 콘텐츠 정합은 **생성 순서**가 핵심 — passage-first→extract가 forced-injection보다 자연스럽고 단어/지문 일치 보장.
- "재진입 무차감"은 **영속 마커(chargedMax)** 필요 — 세션 캐시만으론 앱 재시작 후 재차감. 단조증가 max로 멱등.
- 결합생성은 **기존 seed HIT 보존 + frontier만 신방식**이면 마이그레이션 없이 점진 적용 가능(appendAndSlice race-guard가 덮어쓰기 차단).
- TTS/생성 차감 = Azure 비용과 분리된 **포인트 경제**(seed HIT·무료엔진이라도 사용자 차감), 단 재학습(재진입)은 면제.

[[changes-0615]] [[changes-0614]] [[feedback_side_effect_check]] [[bug-patterns]]
