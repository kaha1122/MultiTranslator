---
name: changes-0606-session3
description: "2026-06-06 3차 — Azure 단가 웹조사 확정 + 비용구조 정밀분해(TTS63/발음25/FreeTalk STT12) + SSML 과금 마크업 제거(prosody no-op + emotion express-as) + 로그 billable화 + Generate 광고점수 1→3(Listening·FreeTalk). OTA prod 1.5.95. [[changes-0606-session2]]"
metadata: 
  node_type: memory
  type: project
  originSessionId: c0caf0e9-26ac-4c92-9dcf-5ed266f3bbd0
---

# 2026-06-06 3차 — Azure 단가 확정·비용구조 분해 + SSML 과금 다이어트 + 광고점수 정합

[[changes-0606-session2]]의 캐시 3종(서버 LRU·Listening 재청취·저장카드 IndexedDB) 배포 후, **실제 단가를 웹검색으로 확정**하고 캐시가 못 막는 "처음 합성" 비용까지 직접 깎는 작업.

## 1. Azure 단가 확정 (웹조사, 공식 출처)
- **Neural TTS (standard prebuilt)**: **$15 / 100만 자** = $0.000015/자. 환산: billable 65자 ≈ ₩1 (₩1,380/$ 기준).
- **Speech to Text (실시간 standard)**: **$1 / 오디오 시간**.
- **발음평가 = Enhanced Feature 부가**: **+$0.30 / 시간** (기본 STT $1 위에 가산). 청구서 `Speech To Text` + `Enhanced Feature Audio` 두 줄로 분리되는 이유.
- 무료한도(F0): TTS 0.5M자/월·STT 5시간/월. **우린 S1(유료)라 무료버퍼 없음, 1자부터 과금**(F0→S0/S1 4월 전환).
- **SSML 과금 규칙(결정적)**: `<speak>`,`<voice>` 태그만 과금 제외. **`<prosody>`,`<mstts:express-as>` 및 속성은 전부 과금**(텍스트 포함). [출처: learn.microsoft.com Q&A 584662]

## 2. 5월 청구서 정밀 분해 (FX 무관 도출)
₩40,520을 단가 비율로 역산 (Enhanced/base = $0.30/$1.00 비율은 환율 무관):
- **TTS ₩25,498 = 62.9%** (~123만 billable 자)
- **발음평가 ₩10,266 = 25.3%** (base 7,897 + enhanced 2,369; ~5.7 오디오시간)
- **FreeTalk 음성인식(converse-stt) ₩4,756 = 11.7%** (~3.5시간; Enhanced 없는 STT)
- 교훈: 앞서 "STT 37%=발음평가"는 부정확. **발음평가 25% + FreeTalk STT 12%**로 분리됨.

## 3. SSML 마크업 다이어트 2종 (서버, 출력 영향 다름)

### 3-1. no-op prosody 제거 (commit e88f664, Render)
- 코드가 모든 텍스트를 `<prosody rate="0%" pitch="0%">`로 감쌌는데 **rate/pitch 0%=무변화 no-op**. 그런데 segment당 **~40 billable 자** 과금.
- tts.js(단일+대화) + converse.js(FreeTalk) 3쌍 제거. **출력 오디오 100% 동일**(no-op이라). express-as는 이때 유지.

### 3-2. emotion(express-as) 제거 (commit 808db7d, OTA 1.5.95)
- `<mstts:express-as style="...">`도 과금(~51자/segment). 짧은 영어 문장은 **과금의 ~68%가 emotion 마크업**.
- **tts.js에서만 제거**(/api/azure-tts 전체 → 중립 톤). voiceStyle 계산 삭제(EMOTION_TO_STYLE/emotion param은 dead로 잔존, 무해).
- **converse.js(FreeTalk)는 자연스러움 우선이라 express-as 유지** — 사용자 명시 정책.
- 검증: "I like to take this bus." → 전체 SSML 263 → **billable 24자**.

### 3-3. 로그 billable화 (808db7d)
- 기존 `chars=ssml.length`는 **전체 SSML(speak/voice 래퍼 ~188자 포함)이라 과대표시**. 사용자가 "I like to take this bus.가 263자?"로 혼란.
- `billable = ssml.replace(/<\/?(speak|voice)[^>]*>/gi,'').length` 로 교체 → `[AzureTTS] billable=N` = Azure 과금 기준.
- 효용: Render 로그 billable 총합 × $0.000015 = **일별 TTS 비용 실시간 추정**.

## 4. Generate 광고점수 1→3 (commit 8abf597, OTA 1.5.95)
- 적자 핵심 = 비싼 액션(생성)인데 광고 카운터(15점=전면광고, Trial 전용) 누적이 약함.
- **Listening Generate**: addAdPoints(1→3, bonusCost:5) [App.jsx:4359]
- **FreeTalk 세션시작**: addAdPoints(1→3, bonusCost:10, deferAd:true) [App.jsx:5148·5158 두 분기]
- **변경 안 함**: ① 지문 첫재생 onFirstPlay 1점 유지(4361) ② handleSpeak 무과금 유지(문장 탭·단어 재생 free).
- **설계 결정(사용자)**: "긴 문장(전체 지문)·생성은 과금 / 각 문장·단어 재생은 free" — 세밀학습 punish 안 하는 UX. 비용은 Generate 시점에서 회수, 재생은 캐시+express-as제거로 이미 저렴(문장당 ~24자).
- 주의: `addAdPoints`의 `points`(adsCost)는 광고카운터 누적량, `bonusCost`는 보너스풀 차감(보너스 활성 시 카운터 대신 보너스 소비→카운터 안 움직임). points는 15 근처면 매 액션 광고 위험이라 3은 안전.

## 핵심 코드 위치
- `addAdPoints(points, {bonusCost, deferAd, bonusOnly})` [App.jsx:727], AD_POINT_THRESHOLD=15.
- onFirstPlay 차감: [ListeningTab.jsx:210-213] `if(!passage.adsCharged){onFirstPlay?.()}`. 주석 "(15)"는 오기(실제 1점).
- Listening 문장 탭: [ListeningTab.jsx:689] splitIntoSentences로 문장별 클릭→playSentence(대화=자체fetch / 에세이=onSpeak). 생성(N) ≠ 재생호출(다수)의 원인.

## 검증 실데이터
- 일본어 유저: 오늘 essay 3 생성인데 MISS 27 → 문장별 탭 재생(각 새 문장=MISS, 반복만 HIT 3). 현 시스템 무광고 → Change C/onFirstPlay로 6점→광고 유도 검증.
- billable=155 → ₩3.21 / billable=5 → ₩0.10 (단가 검산). 적자는 "1건이 비싸서"가 아니라 무광고 대량 누적.

## 6. 유저별 TTS 사용량 집계 (commit 23d74c8, Render)
- 비용 가시성: 누가 얼마나 재생/과금/캐시적중하는지 `users/{uid}.ttsUsage`에 누적.
- **server/utils/ttsUsage.js 신규**: 인메모리 Map 누적 → 60초 batch flush(유저당 1write/분, 단일문서 연타 경합 회피, 450청크). 필드 `requests(=hit+miss)/miss(과금)/hit(서버캐시)/billableChars/updatedAt`.
- tts.js HIT/MISS 지점에 `recordTtsUsage(req.uid,{hit,billable})`. BYOK·익명미인증·dev 제외.
- 비용 = `billableChars × $0.000015`. miss/requests = 그 유저 캐시 미적중률.
- **한계(의도)**: 클라 캐시(메모리/IndexedDB) 재생은 서버 미도달이라 미집계 = "서버 도달 재생" 기준(비용 관점 정확). 재시작 ~60초 유실 허용(통계).
- **설계 판단**: feature별(Vocab/Scene/Listening)·클라행동까지 추적(Tier2)은 client+OTA 다수파일 변경이라 risk/effort 불균형 → "데이터가 의사결정 바꿀 때만" 원칙으로 **Tier0 단순집계(서버1파일)** 채택. 행동패턴은 nice-to-know로 보류.

## 재사용 교훈
- **Azure TTS는 SSML 마크업도 과금**(speak/voice만 제외). no-op prosody/express-as = 짧은 콘텐츠 과금의 대부분. 로그는 billable(speak/voice 제외)로 봐야 정확.
- **단가 = TTS $15/1M자, STT $1/hr, 발음평가 +$0.30/hr.** 비용구조 TTS63/발음25/FreeTalk STT12.
- **캐시 못 막는 "처음 합성"의 레버 = ① 마크업 축소 ② 광고점수 정합.** 반복은 캐시(session2), 처음은 이 둘.
- **광고점수 설계**: 생성=가중(3점), 재생=free가 비용회수+UX 균형. points는 작게(보너스풀로 가중), 카운터 무한루프 방지.
- [[changes-0606-session2]] [[feedback_capgo_verify]] [[feedback_deploy]]
