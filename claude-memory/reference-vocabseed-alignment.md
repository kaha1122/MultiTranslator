---
name: reference-vocabseed-alignment
description: "vocabSeed 풀 5배수 정렬 점검·보정 절차 (단어 \"1개만 보임\" 재발 대비 수동 도구)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 068350fc-6162-4b01-aa30-50deefb1d5a0
---

## 증상
학습 단어 Generate 시 마지막 페이지가 **5개가 아니라 1~4개만** 보임("단어 1개만 생성됨"). 좁은/basic 토픽에서 발생.

## 원인
`vocabSeed/{topicId--level--src--tgt}` 의 `words` 길이는 **SEED_PAGE(5)의 배수**여야 프론티어 페이지가 항상 5개로 서빙된다. 결합 unit 생성에서 [seedCache.appendAndSlice](server/utils/seedCache.js)의 하드 dedup이 그 라운드 신규를 5개 미만 append하면 풀 길이가 5의 배수에서 어긋나고(예: 16), 그 지점 offset 요청이 빈약 페이지를 받는다. 좁은 토픽에서 **재발 가능**(일회성 보정으로 영구 해결 안 됨).

## 수동 점검·보정 도구 (로컬, server/, untracked)
- 점검(읽기전용): `node server/scan-seed-misaligned.js` → `len % 5 != 0` 풀 목록 출력
- 보정: `node server/pad-seed-misaligned.js [--dry]` → 부족분만큼 신규 단어 생성·dedup 후 트랜잭션 append (= **pad 방식, 단어 손실 0**). `--dry`는 생성만 하고 쓰기 생략.
- 필요 env: `server/.env`의 `FIREBASE_SERVICE_ACCOUNT_BASE64` + `GEMINI_API_KEY` (다른 운영 스크립트와 동일)
- 사용자 호출어 제안: "**단어장 풀 정렬 점검해줘**"

## 이력
- 2026-06-21 1차 보정: 미정렬 6개 풀(`cleaning--basic--ko--en` 16→20, `morning--intermediate--vi--ja` 31→35 등)을 pad로 정렬. **데이터(Firestore) 변경이라 코드 배포 불필요, 전 유저 즉시 반영.**
- 같은 날 [generateUnit](server/utils/generateUnit.js)을 "지문 추출"→"단어·지문 자유 생성"으로 바꿔 단어 고갈 자체를 완화(커밋 4b36a74). 그래도 dedup으로 라운드당 5개 미만 append되면 정렬은 어긋날 수 있어 본 점검이 보험.
- 보정 방식은 serving-logic back-fill(반려됨) 대신 **데이터 보정(pad)** 으로 결정(사용자 합의).

관련: [[changes-0619]] (seed 커서 desync self-heal), [[changes-0615]] (seed 시스템·결합생성)
