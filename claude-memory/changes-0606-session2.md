---
name: changes-0606-session2
description: "2026-06-06 2차 — Azure TTS 비용 적자 진단·차단 3종: 서버 인메모리 LRU 캐시(Render) + Listening 재청취 재합성 누수 차단(존재하지 않던 캐시 가정 버그, OTA 1.5.93) + 저장카드 음성 기기 영속 캐시 IndexedDB(OTA 1.5.94). 5월 Azure ₩40,520(TTS 63%) > 광고 ₩30,000 적자."
metadata: 
  node_type: memory
  type: project
  originSessionId: c0caf0e9-26ac-4c92-9dcf-5ed266f3bbd0
---

# 2026-06-06 2차 — Azure TTS 비용 적자 진단 및 3종 차단

## 배경: 적자 구조 발견
- 5월 광고수익 ₩30,000 < Azure 비용 ₩40,520 → 적자. Azure 비용분해(Portal InvoiceDetails):
  - **Neural Text To Speech ₩25,498 (63%)** — TTS, **캐시 가능**
  - Speech To Text ₩12,653 (31%) + STT Enhanced(발음평가) ₩2,369 (6%) = 합 37% — 발음채점, **캐시 불가**(유저 음성)
- 핵심 통찰: 사용자는 "발음평가가 비싸다" 의심했으나 실제 본체는 **TTS(들려주기)**. 발음평가(STT)는 단가 쌈($1/audio hr)+일일한도, TTS는 긴 콘텐츠×반복×캐시미스로 폭증.

## 진단의 결정타: "존재하지 않는 캐시를 가정한" 버그
- [ListeningTab.jsx:192-193] 주석(5/23 작성): "같은 passage 반복재생(Stop→Play 다시): **서버 텍스트 해시 캐시**로 Azure 비용 0" → AdsPoint 차감 안 함.
- 그러나 그 "서버 해시 캐시"는 **6/6 전엔 존재하지 않았음**(이번에 처음 구현). 즉 5월 내내 긴 Listening 지문(SSML chars 441~502)을 **재생 종료 후 다시 누를 때마다 전체 재합성**. onended에서 `passageAudioRef=null`로 오디오 파괴 → 재생 시 재fetch.
- 게다가 재생은 AdsPoint 차감 안 해(첫재생만) → **재합성 비용은 나가는데 광고 수익 0**. 적자 직접 원인.
- 사용자 체감 증상: "재생 다시 누르면 버튼이 빙글빙글 돈다"(=재fetch 로딩). 사용자가 최초 문의했던 "Listening 다시 재생되냐"의 정체.

## 차단 3종 (배포 완료)

### 1. 서버 인메모리 LRU 캐시 (commit ca4cb2e, Render)
- `server/utils/ttsCache.js` 신규: `sha256(ssml)` 키 LRU(상한 300, env `TTS_CACHE_MAX`). 성공응답만 저장, BYOK bypass, 재시작 시 소멸(1회성 누적 없음).
- `server/routes/tts.js`: Azure 호출 직전 캐시 조회/저장. 응답계약(audio/mpeg) 불변 → 클라 변경 0.
- 같은 SSML 재요청 시 Azure 0. **크로스 유저/세션** 반복까지 잡음(클라 세션캐시가 못 잡던 부분).

### 2. Listening 재청취 로컬 재생 (commit 7ef6447, OTA prod 1.5.93)
- 전체 passage: onended에서 오디오/blob **파괴 안 함**(보존) → 재청취 시 로컬 재생(서버왕복·Azure 0, 스피너 제거). 재개분기를 "일시정지 재개 + 재생완료 후 재청취(ended면 currentTime=0)"로 통합.
- 문장별(dialogue `playSentence`): **클라 LRU 캐시(40)** 신규(`sentenceCacheRef`) → 같은 문장 반복 탭 시 서버 재요청 0.
- 정리: `stopPassageAudio`(passage변경/조건변경/탭이탈/언마운트 4곳)가 보존 오디오 + 문장캐시 일괄 revoke → 누수 차단.

### 3. 저장 카드 음성 기기 영속 캐시 IndexedDB (commit d95d4da, OTA prod 1.5.94)
- `src/utils/ttsAudioCache.js` 신규: IndexedDB(`pronunfit-tts`/`audio`) 영속 캐시, **LRU 500(저장카드 전용 풀)**, lastUsed 기준. 모든 op try/catch→실패 시 네트워크 폴백. indexedDB 없으면 비활성.
- `App.jsx handleSpeak`: **3-tier**(세션메모리 ttsCacheRef → IndexedDB → Azure). `opts.saved`일 때만 IndexedDB 사용.
- **저장카드만 영속**: Library onSpeak를 `(t,l,e)=>handleSpeak(t,l,e,{saved:true})`로 래핑([App.jsx:4451]) → 카드 내 단어/예문/음소 재생 전부 saved 태깅. 일반 생성카드(다시 안 볼 확률 높음)는 세션메모리만 → **churn이 저장카드 풀을 밀어내지 않게 분리**(사용자 요청).
- 캐시는 **재생 시점**에 발생 → 기존 저장카드도 다시 불러 재생하면 자동 캐싱(마이그레이션 불요). 첫 재생 1회만 합성, 이후 매일 재청취 Azure 0.

## 검증용 로그 (commit 7ef6447)
- `server/routes/tts.js`: 요청별 `[AzureTTS] HIT/MISS id=<sha8> lang chars` 로그(`TTS_LOG_VERBOSE`, 기본 ON, `=0`으로 끔) + `ttsCache.shortId`.
- `[TTSCache]` 10분 주기 snapshot(hitRate/hit/miss/evict).

## 검증 방법론 (재사용) — Render는 서버만, 클라 캐시는 "부재"로 증명
- **클라 캐시 작동 = 서버에 요청 자체가 안 옴** → Render 로그 무변화 / 브라우저 Network에 azure-tts 없음(`blob:` 206 media = 로컬 재생, 0kB).
- **서버 캐시 작동** = Render에 `HIT` 표시(요청은 왔으나 Azure 0). 단 HIT이 뜨면 그건 서버캐시지 클라캐시 아님.
- **IndexedDB(저장카드) 검증** = 같은 저장카드 2번째 재생에서 **MISS도 HIT도 없이 "조용"**해야 성공. (F12→Application→IndexedDB→pronunfit-tts/audio에 항목 확인)
- 실측 확인됨: MISS→HIT 전환(서버캐시 ✅), 저장카드 재청취 시 Render 무로그(IndexedDB ✅), passage 재청취 시 Network blob:만(클라캐시 ✅).

## 미해결/후속
- **6월 청구서 `Neural Text To Speech`** 하락폭 = 최종 정량검증(5월 ₩25,498 대비). `[TTSCache]` hitRate 추이.
- 검증 종료 후 Render env `TTS_LOG_VERBOSE=0` (선택).
- (별건 후보) **문장 타이밍 슬라이스**: passage TTS를 SDK(WordBoundary)로 받아 문장별 타임스탬프 저장→문장 클릭 시 전체오디오 seek 재생 → "전체+문장 이중 합성" 제거(중간규모 작업).
- (별건) 출력 `audio-48khz-192kbitrate`(~400kB/passage)는 Azure 비용엔 영향 없음(글자수 과금)이나 **모바일 데이터+캐시크기** 부담 → 24khz/48kbit로 낮추면 1/4(품질 trade-off).

## 재사용 교훈
- **TTS vs STT 분리해서 봐라**: TTS는 결정적(캐시 가능), STT/발음평가는 유저음성(캐시 불가). 비용 본체 오해 주의.
- **"캐시된다고 가정"한 코드는 그 캐시의 실존을 검증하라** — 주석이 가정한 서버 캐시가 실제로 없어 수개월 과금. 빌드통과≠동작.
- **durable 저장은 콘텐츠 성격으로 스코프**: 1회성(Listening 지문)엔 인메모리/세션(자동 증발), 반복학습(저장카드)엔 영속(IndexedDB). 한 풀에 섞으면 churn이 가치있는 걸 밀어냄.
- **클라 캐시 검증은 "요청 부재"로** — Render 로그/Network에 안 뜨는 게 정상이자 증거.
- Azure TTS 캐시키 = SSML 전체 해시(voice/emotion/dialogue swap/lang 자동 포함). 클라 cacheKey = `langCode:emotion:text`.
- [[changes-0606]] [[feedback_capgo_verify]] [[feedback_deploy]]
