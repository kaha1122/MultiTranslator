---
name: firebase-auth-persistence-no-migration
description: Firebase Auth persistence 타입 변경 시 Capacitor WebView에서 기존 세션 자동 마이그레이션 안 됨 (Phase 1-C 실패 사례). Android IndexedDB→localStorage 절대 시도 금지
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 047e8c7b-4b52-4d83-9356-64911ca38854
---

# Firebase Auth Persistence 타입 변경 시 자동 마이그레이션 불가 (Capacitor WebView)

**규칙**: Capacitor WebView 환경에서 Firebase Auth의 `setPersistence()` / `initializeAuth({ persistence })` 로 persistence 타입을 갑자기 바꾸면, 기존 다른 타입에 저장된 세션은 **자동으로 옮겨가지 않음**. 모든 기존 유저가 신규 익명 UID로 다시 시작하는 사고 발생.

**Why**: 2026-05-17 Phase 1-C 시도 — Android Firebase Auth를 default(IndexedDB) → `browserLocalPersistence`(localStorage)로 전환. 1.2.11 → 1.3.1 업데이트 시:
- IndexedDB에 저장돼 있던 기존 Google 로그인 세션 abandon
- localStorage는 빈 상태 → Firebase가 "로그인 안 됨" 판정 → AuthContext 20초 timeout 후 신규 anon 사인인
- 결과: 사용자 단말에서 "무료 계정 만들기" 화면 + Firestore에 신규 익명 user 문서 생성 확인 ([changes-0517.md](changes-0517.md) 상세)

Firebase 공식 문서엔 "auto migrate" 가능하다는 식으로 적혀있지만 Capacitor WebView (capacitor:// 스킴 + http://localhost) 환경에선 실제로 작동 안 함.

**How to apply**:
- ❌ **금지**: Android Firebase Auth persistence를 IndexedDB → localStorage 갑자기 전환 (또는 그 반대)
- ✅ **유지**: iOS = `browserLocalPersistence` (처음부터 그랬으니 마이그레이션 issue 없음), Android = default IndexedDB
- IndexedDB hang/timeout rare 케이스는 [src/context/AuthContext.jsx](src/context/AuthContext.jsx)의 20초 timeout 폴백(Phase 1-B)으로 흡수
- 향후 정말 persistence 변경이 필요하면:
  1. **수동 마이그레이션 로직 먼저**: IndexedDB에서 기존 session token 직접 읽어 localStorage에 복사 → 그 다음 persistence 전환
  2. **multi-persistence 배열 시도**: `[indexedDBLocalPersistence, browserLocalPersistence]` — 단 Firebase는 첫 번째 사용 가능한 것만 쓰는 것으로 보임, 효과 의문, 실험 필요
  3. **Internal Testing Track으로 반드시 사전 검증** — production 직행 절대 금지 (대규모 익명 UID 분실 위험)
- 관련: [pending-aab-fixes.md](pending-aab-fixes.md) (Phase 1-C 항목 REVERTED 상태)
