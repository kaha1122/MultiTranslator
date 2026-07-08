---
name: changes-0619
description: 2026-06-19 seed 커서 desync 빈페이지 brick 근본수정(frontier-safe slice) + 관측 로그 + review 무차감
metadata: 
  node_type: memory
  type: project
  originSessionId: 85722361-cdc8-4681-9873-a1eaccff8499
---

# 2026-06-19 — Vocab/Listening seed 커서 desync brick 근본수정

**증상**: 중국어→영어 등에서 특정 노드(예 `morning/basic`) "단어 생성"이 영구 먹통(빈 화면). intermediate(offset=0 fresh)는 정상. 실측: 유저 cursor=15/chargedMax=15, 글로벌 풀 `vocabSeed/morning--basic--zh-CN--en`=단어 10개.

**근본 원인**: 클라 `seedCursor`(per-user)가 글로벌 seed 풀보다 앞서면(desync), 서버 `seedCache.appendAndSlice`가 `merged.slice(offset, offset+count)`로 **빈 배열** 반환 → 서버 200+`words:[]` → 클라가 정상 페이지로 오인 → 차감+커서전진+빈캐시 → **영구 brick**.
- desync 발생원: ① `appendAndSlice` 트랜잭션 실패 폴백이 생성물을 영속 없이 클라에만 서빙 ② 클라가 빈 배열에도 커서 전진·차감 ③ **클라 커서 키 `topic--level--targetLang`엔 sourceLang 없는데 서버 seed 키 `topic--level--sourceLang--targetLang`엔 있음** → 설정에서 source 전환 시 새 source 풀(작거나 0)보다 커서가 앞서 동일 brick.

**수정(커밋 1846e07, main 로컬 — staging 배포/OTA 대기)**:
- `server/utils/seedCache.js appendAndSlice`: frontier append 시 요청 offset이 아니라 **실제 추가 위치(`existing.length`)에서 슬라이스** → 빈 배열 대신 방금 만든 frontier 페이지 반환, 풀이 커서를 따라잡으며 **self-heal**. `offset==existing.length`(정상 동기화)면 결과 100% 동일. dedup으로 신규 0개(토픽 소진)면 `start=max(0,len-count)` 마지막 페이지 복습 서빙.
- `server/routes/vocab.js`: 서빙 단어가 전부 생성 전 풀(seedItems)에 있었으면 `source:'review'`(소진 복습=무차감 신호). self-heal(새 단어 append)은 풀에 없던 단어라 review 아님 → 정상 과금.
- `src/components/VocabTab.jsx`: 빈 단어 배열 수신 시 차감/커서저장/캐시 없이 재시도 안내 early return(보험). `source==='review'`면 차감 skip. dead-code `if` 제거.
- 관측: `'CURSOR DESYNC'`(uid 포함)·`'SEED EXHAUSTED'` 경고 로그 → Render 로그 grep으로 재발 즉시 탐지.

**기존 brick 유저는 서버 패치만으로 데이터 조작 없이 자동 복구**(chargedMax 동일이면 재차감 0).

**미수정(의도적)**: 커서 키에 sourceLang 추가 = 정확하지만 전 유저 커서 고아화→재과금 리스크 커서 보류. source 전환 시 턴 헤더(`Math.floor(offset/5)+1`)가 cross-source로 1~N 앞서 표시되는 cosmetic만 잔존(기능·과금 무해, 사용자 합의). self-heal을 항구 방어선으로 유지.

**검증**: build/check-secrets PASS, mobile-production-guardian 리뷰(🟡→actionable 반영), ios-heat-guard PASS(오히려 brick 시 users 본문 write 제거로 발열 표면 감소). [[bug-patterns]]
