---
name: changes-0419
description: 2026-04-19 — 익명→실계정 전환 profile 유실 수정(A+B+C), 카드 고정 serialNumber 도입, savedCardCount 정합성 마이그레이션, Capgo 1.4.29
type: project
originSessionId: 763688e7-6555-4b6f-bd90-603ebe928f94
---
# 2026-04-19 세션

## 1. 익명→실계정 전환 시 언어/온보딩 필드 유실 해결

### 발견 경위
Firestore users 문서에서 `sourceLang`/`targetLangs`/`tier` 누락된 실계정 사용자 발견 (예: UID `6UmrJgmADiNW3v8vReGwb1HNRvI2`, deviceLang='vi', Thương Trần). 앱은 폴백 로직으로 동작은 하지만 **다기기 동기화 불가 + 데이터 품질 이슈**.

### 근본 원인 (3중첩)
1. **AuthContext onSnapshot vs Login profileData setDoc race condition**
   - 실계정 로그인 시 AuthContext.jsx([실계정 자동 생성 분기](src/context/AuthContext.jsx#L113-L140))가 먼저 target UID 문서에 `createdAt`+`hasCompletedOnboarding: false` 자동 생성
   - 직후 서버 `/api/migrate-anonymous`([account.js:213](server/routes/account.js#L213))가 `isExistingAccount = targetDoc.exists && targetData.createdAt`로 판정 → **"기존 계정"으로 오판** → 카운터만 합산, 언어 필드 복사 건너뜀
2. **Login.jsx/Signup.jsx에 클라이언트 백업 병합 없음** — 서버 실패 시 회복 불가
3. **설정 메뉴의 sourceLang/targetLangs 변경은 localStorage에만 저장** — Firestore 미반영 ([App.jsx handleSaveSettings](src/App.jsx#L1379-L1392) 주석 "Bug 수정"에도 Firestore 동기화 없었음). userLevel(defaultLevel)만 예외적으로 Firestore 저장.

### A. 근본 수정 — 클라이언트 백업 anonFields 병합
- 신규: [src/utils/anonProfileMigrate.js](src/utils/anonProfileMigrate.js) — `readAnonProfileFields(anonUid)` 헬퍼. Firestore 익명 profile에서 sourceLang/targetLang/targetLangs/defaultLevel/userLevel/hasCompletedOnboarding/dailyGoal 필드 읽어옴
- 적용 패턴(13곳):
  - `const prevAnonUid = ...` 직후 `const anonFields = prevAnonUid ? await readAnonProfileFields(prevAnonUid) : {};` (signInWithCredential 전, 아직 익명 세션이라 자기 문서 접근 권한 있음)
  - profileData 초기 객체에는 anonFields **스프레드 안 함**
  - **`if (additionalInfo?.isNewUser)` 블록 내에서만 `Object.assign(profileData, anonFields)` 병합** — 재로그인(기존 계정) 시 기존 Firestore 값 보호
  - `hasCompletedOnboarding = anonFields.hasCompletedOnboarding === true` (익명이 이미 완료했으면 true 유지)
- 수정 경로:
  - Login.jsx × 6: Google/Facebook/Apple × 네이티브/웹
  - Signup.jsx × 7: Google/Facebook/Apple × 네이티브/웹 + handleSignup(이메일 신규가입)
  - email 재로그인(Login handleLogin): 수정 안 함 — 기존 계정 profile이 정답, 혹시 누락되면 B가 커버

### B. 방어 로직 — App.jsx self-heal useEffect
- 실계정 사용자 + profile에 sourceLang/targetLangs/defaultLevel/tier 중 누락 감지 시
- 현재 기기의 React state(localStorage/navigator.language 폴백) 기반으로 즉시 복원 + Firestore 저장
- 익명 사용자(user.isAnonymous)는 early return
- 기존에 망가진 사용자도 앱 실행만 하면 자동 복구 → 별도 admin 스크립트 불필요
- 의존성 `[user?.uid, profile?.sourceLang, profile?.tier]` — 복원 후 missing={} 종료로 무한루프 없음

### C. 설정 언어 변경 Firestore 동기화 — debounce 500ms (방안 2.5)
- useEffect로 sourceLang/targetLangs 변경 감지 → 500ms debounce → `updateUserProfile({ sourceLang, targetLang, targetLangs })`
- profile과 동일값이면 skip (onSnapshot 초기 동기화 시 불필요 쓰기 방지)
- 연속 클릭 시 마지막 1번만 저장 (Firestore 쓰기 최소화)
- 사용자가 "설정 저장" 버튼 안 눌러도 반영
- 커밋: `568e282`

### 검증 완료
sw.haka@gmail.com 계정 웹앱 테스트 — 익명으로 스페인어 설정 후 Google 신규가입 전환 시 Firestore users에 sourceLang='es', targetLangs, hasCompletedOnboarding:true 정상 저장 확인.

## 2. 카드 고정 serialNumber 도입 (3 Phase)

### 문제
기존 카드 번호는 [Library.jsx](src/components/Library.jsx)에서 `savedCards.length - globalIndex`로 매번 계산 → **카드 삭제 시 다른 카드 번호 변동**. 사용자가 "ID처럼 고정된 번호"를 원함.

추가로 발견: "10/10" 배지가 Firestore `limit(limitCount)` 페이지네이션된 로드 결과 기준이라 **실제 전체 카드 수와 불일치**. 사용자는 "21개 중 필터 10개" 식으로 전체 기준 숫자를 원함.

### Phase 1 — Admin 마이그레이션 API (서버 먼저 배포)
- [server/routes/account.js](server/routes/account.js) `POST /api/admin/assign-card-serials` 추가
- BUILD_SECRET 인증, `{ dryRun: bool }` body
- 로직:
  1. users 컬렉션 순회 (각자)
  2. savedCards where userId (복합 인덱스 회피 위해 orderBy 없이 get 후 메모리 `sort((a,b) => createdAt_a - createdAt_b)`)
  3. `isDeleted !== true` 필터
  4. serialNumber 없는 카드에만 1부터 순차 부여 (createdAt asc — 오래된 게 1번)
  5. users/{uid}.cardSerialMax = 최종 최대 번호
  6. **시작점 보호**: `existingMaxSerial`(이미 번호 있는 카드 중 최댓값)과 `currentCounter` 중 큰 값부터 이어서 부여 → 클라이언트 신규 카드 먼저 번호 쓴 상태에서도 충돌 없음
  7. 500건 배치 분할 (Firestore 한도)
  8. `savedCardCount` 정합성도 함께 보정 (실제 활성 카드 수와 불일치 시 업데이트)
- 커밋: `dac662e` → `6769659` (Firestore 복합 인덱스 회피, where+orderBy → where만 후 메모리 sort) → `3f149d2` (savedCardCount 추가)
- **실행 결과**: 94명 유저 397장 카드에 serialNumber 부여, 5명 유저 savedCardCount 보정

### Phase 2 — Library 표시 로직
- [Library.jsx:401-402](src/components/Library.jsx#L401-L402): `card.serialNumber ?? (기존 폴백 계산식)` — 마이그레이션 전 카드나 누락 케이스 안전 폴백
- **"10/10" 문제 동시 해결** — Firestore 쿼리 재설계:
  - `limit(limitCount)` 제거, searchTerm 분기 제거 → user의 모든 활성 카드 1회 onSnapshot 구독
  - `const visibleCards = searchTerm ? filteredCards : filteredCards.slice(0, limitCount)` — 화면 페이지네이션만 slice로
  - `hasMore = !searchTerm && filteredCards.length > limitCount` 파생값 (state 제거)
  - 무한 스크롤: limitCount += 10 (이미 받아둔 filteredCards에서 더 보여줌, 네트워크 쿼리 없음)
  - `{filteredCards.length}/{savedCards.length}` 배지가 이제 "필터 결과 전체수/전체 저장 카드수" 정확히 표시

### Phase 3 — 신규 카드 저장 시 serialNumber 부여
- 신규: [src/utils/cardSerial.js](src/utils/cardSerial.js) — `assignNextCardSerial(uid)` 함수
  - Firestore `runTransaction`으로 `users/{uid}.cardSerialMax` 원자적 +1, 새 값 반환
  - 경쟁 조건 자동 재시도
- App.jsx 저장 함수 4곳에 적용 (addDoc 직전):
  - `saveToFirebase` (Translation 탭, 1685)
  - `saveVideoCard` (Video 탭, 1723)
  - `saveSceneCard` (Scene 탭, 1776)
  - `saveVocabCard` (Vocab/Listening 공용, 1835)
- 중복 체크 실패 시는 assignNextCardSerial 호출 전 return → 카운터 낭비 없음

### 2단계 배포 전략 (중요)
**Phase 1 서버 배포 + 마이그레이션 실행 → 그 다음 Phase 2+3 클라이언트 배포** 순서 필수.
- 이유: 클라이언트 먼저 배포 시 신규 카드가 cardSerialMax=1부터 시작 → 기존 카드(번호 없음) 마이그레이션과 충돌 위험
- 실제 순서:
  1. `dac662e` → `6769659` → `3f149d2` 서버 커밋 (Render 재배포)
  2. `/api/admin/assign-card-serials` dryRun → 실제 실행 (397장/94명, 5명 savedCountFixed)
  3. `2eba0bb` 클라이언트 커밋 (Vercel 자동 배포)
- 만일 순서가 뒤집혀도 **시작점 보호** 로직이 충돌 방지하지만 UX 어색(신규 카드=1번, 기존=2~N)

### 검증 완료
sw.haka@gmail.com (UID vTXu7ZlWNXMOjXw5Orco2KKUaR72) savedCardCount 13 → 19 보정 확인. 실제 컬렉션 활성 카드 수와 일치.

## 3. Capgo Production 1.4.29 OTA 배포

- 버전: `1.4.28 → 1.4.29`
- Bundle SHA256: `a37f13f8...`
- 채널 포인터 검증 완료: `currentBundle production = 1.4.29`
- 커밋: `452f159`

## 4. 사이드 이펙트 점검 패턴 (오늘 세션 전반)

### 경쟁 조건 방어 일관 적용
- 클라이언트에서 익명 profile 미리 읽기 (signInWithCredential 전, 익명 세션 동안)
- 서버 migrate 성공/실패 무관하게 클라이언트 setDoc merge:true로 백업 병합
- `isNewUser`로 **재로그인 시 기존 계정 설정 보호** (상황별 분기)

### Firestore 복합 인덱스 회피
- 1회성 마이그레이션이면 `where + orderBy` 대신 `where`만 쿼리 후 메모리 sort — 인덱스 생성 시간 절약
- 정기 쿼리에만 인덱스 투자

### Idempotent 마이그레이션
- 재실행 안전: serialNumber 이미 있으면 skip, savedCardCount 맞으면 skip
- dryRun 옵션으로 사전 영향 범위 확인

### 2단계 배포 패턴 (클라이언트+서버 동시 변경 시)
- 서버(API) 먼저 → 데이터 마이그레이션 → 클라이언트(UI) 나중

## 5. 후속 과제

- **Capgo iOS OTA**: 여전히 비활성화 상태. 이번 변경은 Xcode Cloud 빌드 후 App Store로만 iOS에 반영됨
- **AAB 재빌드**: 이번 변경 불필요 (네이티브 플러그인 변경 없음, Capgo로 Android 신규 설치자에게 첫 실행 직후 반영됨)
- **savedCardCount 계속 불일치 방지**: 저장/삭제 경로에서 incrementSavedCard/decrement 일관 적용 검토 (이번엔 마이그레이션으로만 보정)
- **Firestore 헤비유저 대응** (현 시점 불필요): 카드 1000장 넘는 사용자 나오면 우선 `limit(1000)` 한 줄 추가로 상한 설정(현재 onSnapshot 쿼리는 limit 없음). 최신 1000장까지만 로드하고 그 이후는 기존 클라이언트 필터+slice 방식 유지 — **1줄 변경으로 99%+ 커버**.
  - serverside count(getCountFromServer) + cursor pagination(startAfter) 재설계는 **과도한 대응**. 필터 조합(언어/유형/별표/기간)을 서버 쿼리로 변환 시 복합 인덱스 6~10개 필요, 클라이언트 필터 유연성 상실, onSnapshot 실시간성 부분 포기.
  - 정말 1000장 넘는 파워유저가 생기면 그때 "검색" UI 안내 또는 archive 기능 도입을 먼저 고려

## 6. 커밋 기록 (오늘)

1. `568e282` fix: 익명→실계정 전환 시 언어/온보딩 설정 유실 + 설정 변경 다기기 동기화
2. `dac662e` feat(admin): 기존 savedCards serialNumber 일괄 부여 API 추가 (마이그레이션)
3. `6769659` fix(admin): assign-card-serials — Firestore 복합 인덱스 불필요하도록 메모리 정렬
4. `2eba0bb` feat: 카드 고정 serialNumber 부여 + Library 전체 카운트 표시
5. `3f149d2` feat(admin): assign-card-serials에 savedCardCount 정합성 보정 추가
6. `452f159` chore: version bump 1.4.28 → 1.4.29 (Capgo production OTA)

실행된 Admin API:
- `POST /api/admin/assign-card-serials {"dryRun": true}` → stats: usersProcessed 94, cardsAssigned 397
- `POST /api/admin/assign-card-serials {"dryRun": false}` → 실제 397장 serialNumber 부여
- `POST /api/admin/assign-card-serials {"dryRun": true}` (3f149d2 후) → stats: savedCountFixed 5
- `POST /api/admin/assign-card-serials {"dryRun": false}` → 실제 5명 savedCardCount 보정
