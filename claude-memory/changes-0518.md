---
name: changes-0518
description: 2026-05-18 종일 세션 — Streak 푸시 시스템 FCM 전환 + FCM dedup + 카드 표시 일관성 + Translation 발음기호 + UI/i18n 정정. Capgo v1.5.39 → v1.5.45 staging+production OTA. wjsemd234 사고 추적 결과 마이그 누락 아님 확정.
metadata: 
  node_type: memory
  type: project
  originSessionId: 2c3730c6-e5be-4aeb-942a-901a350033c0
---

# 2026-05-18 (KST) 종일 세션 요약

## 배포 결과
- **Git**: 60f8f81 → cea6fea (10+ commits)
- **Capgo staging/production**: v1.5.39 → **v1.5.45** (production promote 완료, `--ignore-metadata-check` 적용 — JS만 변경, native code change 0 검증)
- **Vercel/Render**: 모두 자동 배포 완료

## 1. Streak Push 시스템 — LocalNotifications → 서버 cron FCM 전환

### 1-1) 22시 Streak Risk 가드 교체 (사용자 사고 fix)
- **사고**: 4일 streak 유저(본인)가 22시 알림 기다리며 미루다 오전 카드 1장만 접속 → lastActiveAt 갱신 → 쿼리 가드에 걸려 22시 알림 미수신 → streak 끊김
- **Before** ([reengagement.js:331](server/routes/reengagement.js#L331)): `where('lastActiveAt', '<', tsStartOfToday)` — 오전 접속만 해도 영구 제외
- **After**: 쿼리 가드 제거 + 각 후보당 `dailyProgress/{today}.goalAchievedToday === true` 1회 read로 skip
- **효과**: 단순 접속자에게도 알림 도달, dailyGoal 달성자에게만 skip (메시지 본문 정확성 유지)

### 1-2) 13시 Streak Reminder 신설 (회귀 근본 해결)
- **회귀 원인** (이전 9a1303f 작업): Android LocalNotifications 12:30 OS chain이 schedule 시점 톤이 박혀 streak 구간 변경 시 갱신 안 됨. 매번 cancel+schedule하면 chain 끊김 silently fail → 영구 누락.
- **해결**: 서버 cron FCM 13:00으로 완전 전환. 발송 직전 Firestore에서 streakCurrent 새로 읽어 personalize.
- **신규 파일**:
  - [server/utils/streakReminderPool.js](server/utils/streakReminderPool.js) — bucket(start/early/forming/week1/week2/month/legend) × 10 locale × variantIdx 메시지 풀
  - server/utils/countryTimezone.js — `countriesAtLocalHour13` 헬퍼
- **server/utils/sendPush.js**: `sendStreakReminderPush` 추가 (dryRun preview + stale token 정리)
- **server/routes/reengagement.js**: `processStreakReminderForCountry` + cron 13시 슬롯 통합
- **대상**: streakCurrent>=1 + fcmTokens 보유 + streakReminderOptOut !== true + 가입 24h 이상
- **idempotency**: `lastStreakReminderDate === today` skip

### 1-3) 클라 LocalNotifications 12:30 schedule 제거 + 잔존 chain mount-time cleanup
- [src/App.jsx](src/App.jsx) — 두 useEffect의 schedule 호출 모두 제거. 권한 grant + FCM 등록 + Firestore opt-out 미러만 유지.
- **잔존 chain 정리**: mount 시 `LocalNotifications.cancel({ id: 1001 })` 1회 호출 (localStorage `localNotif12_30_cleaned_v1` flag로 idempotent).

### 1-4) NotificationSettings UI 정리
- 시간 선택 위젯 (`<input type="time">`) 제거 → "매일 오후 1시에 Streak 리마인더가 전송됩니다." 안내 박스
- `handleTimeChange` 함수 삭제
- 토글 ON/OFF 시 `streakReminderOptOut` Firestore 미러 추가
- "매일 연습 리마인더" → "매일 Streak 리마인더" (10 locale 명칭 정정)
- 신규 i18n: `notifications.reminderFixedAt13` × 10 locale (1190 → 1191 keys)

### 1-5) Admin tool — `/api/admin/preview-streak-push`
- BUILD_SECRET 인증, 시각 매칭 우회 dryRun preview
- vTXu7Zl 검증: "Streak 2일째! / 짧은 시간이라도 매일이 중요해요" (bucket=early, lang=ko) — 정상 작동 확인

## 2. FCM 토큰 Instance ID prefix dedup (사용자 사고: zmxn1999)

### 사고 패턴
한 유저의 `fcmTokens` 배열에 같은 prefix(`fe_uWz5oQQm3GuV1Txngw7:APA91...`) 토큰 2~3개 누적 → `sendEachForMulticast`가 각각 발송 → **같은 알림이 1단말에 2~3번 표시**.

### 원인
- 콜론 앞 prefix = **Instance ID** = 같은 단말 식별자
- 옛 코드는 `arrayUnion`만 사용 → 회전된 새 토큰(다른 문자열)을 별개로 누적
- **server/routes/account.js** migrate-anonymous + **src/utils/pushNotifications.js** saveFcmTokenToFirestore 양쪽 모두 결함

### Fix
양쪽 모두 prefix 기반 dedup으로 교체:
- 같은 prefix의 옛 토큰 제거 + 새 토큰 추가 + Set으로 동일 문자열 dedup
- 다른 단말(폰+태블릿) prefix 달라 그대로 보존

### Admin Script: `server/cleanup-fcm-duplicates.js` (one-off)
- 모든 users doc 스캔 + 같은 prefix 중복 시 배열 마지막(최신) 토큰만 유지 (arrayUnion append 순서 보장)
- 사용: `node cleanup-fcm-duplicates.js [--dry-run] [--uid=xxx]`
- 실행 결과: 3,124명 스캔, 6명 ≥2 토큰, **2명 cleanup**
  - `zmxn1999@gmail.com`: 2 → 1
  - `pronunfit@yahoo.com`: 3 → 1

## 3. 카드 발음기호 표시 — VocabTab → Library 흐름 일관성 fix

### 3-1) examplePronunciation 끊긴 곳 4군데 (사용자 No49 yùndòng 카드 사고)
- 중국어/일본어 카드를 VocabTab에서 생성 시에는 보이지만 Library 저장 후 사라짐
- **데이터 흐름 끊긴 곳**:
  - VocabTab.handleSave: onSaveToLibrary 호출 시 누락
  - ListeningTab.handleSave: 동일 누락
  - App.jsx saveVocabCard destructure + Firestore set 누락
  - TranslationCard: prop 시그니처 없음 + EXAMPLE 박스 미표시
  - Library.jsx + App.jsx Translation tab `<TranslationCard>` prop 전달 누락
- **Fix**: 위 모든 곳에 `examplePronunciation` 추가. VocabTab과 동일 톤 (`.card-example-pron` 보라색 #6366f1)

### 3-2) saveVocabCard 중복 silent fail 차단
- **사고**: 5장 카드 중 첫 카드 별표 클릭 시 저장 안 됨 (Gemini가 흔한 단어 첫 카드 배치 → 이미 Library 보유 → silent fail)
- 옛: `if (active) return null;` → VocabTab handleSave의 `if (!cardId) return` 가드로 silent fail
- 코멘트 의도와 코드 불일치 ("기존 ID 반환"이라 했지만 null)
- **Fix**: dup 발견 시 `updateDoc({ pronunciationScore })` (새 점수 갱신) + `active.id` 반환 → 별표 채움 + Library 자동 이동

### 3-3) Translation saveToFirebase에 examplePronunciation 저장 누락
- 3-1과 별개 사고: Translation 탭은 별도 `saveToFirebase` 함수 사용
- cardData object에 examplePronunciation 필드 자체 미포함 → Firestore에 저장 안 됨
- **Fix**: `examplePronunciation: translationExamples[langCode]?.examplePronunciation || ''` 한 줄 추가

## 4. Translation 탭 발음기호 prompt 결함

### 진단
- 서버 `server/routes/translate.js`는 단순 Gemini 프록시 — **prompt를 클라가 만들어 보내는 구조**
- 클라 prompt schema에 `examplePronunciation` 필드 자체 없음 (Vocab/Listening server prompt와 sync 안 됨)
- 메인 `pronunciation`도 schema description이 약함 (`"..."` placeholder)

### Fix (App.jsx)
- Task 4 rule 강화: `pronunciation` + `examplePronunciation` 둘 다 zh-CN/zh/ja/ru에 **REQUIRED non-empty** 강조
- `data` entry schema에 `examplePronunciation` 필드 추가
- `detectedLangData` schema 확장 (example, exampleTranslation, examplePronunciation)
- 클라 `newExamples` 추출 2곳(langCode loop + detectedLang)에 `examplePronunciation: entry.examplePronunciation || ''`

## 5. Free Talking pronunciation 강화 (converse prompt)

### 진단
- 서버 schema는 이미 `pronunciation` 필드 요청 (line 391, 401, 961)
- 클라 매핑 (useConversation.js:502) + 표시 (ScenePractice.jsx:128) 모두 정상
- **원인**: Gemini Flash-Lite가 응답 schema 일부 누락 (빈 string 또는 필드 omission)

### Fix (옵션 1만 적용)
- [server/utils/conversationPrompt.js](server/utils/conversationPrompt.js) 3곳 schema에 `(REQUIRED, non-empty)` + `**CRITICAL: an empty string for zh-CN/zh/ja/ru makes the response invalid.**` 추가
- 잔존 누락 시 follow-up: pinyin-pro / kuroshiro 라이브러리 fallback 또는 retry

## 6. UI/i18n 정정

### 6-1) 한도 초과 popup
- `seeSidebarReward`: `+5 카드` → `+2 Free-Talking` (10 locale)
- 사이드바 보상 버튼 정책 변경 반영

### 6-2) Upgrade popup Pro 섹션
- `proFeature2` (Free-Talking 20회/일) 제거
- 실제로는 Pro에서 무제한이지만 추후 제한 도입 가능성 고려해 표기 자체 삭제
- UpgradeModal.jsx 5곳 featureKeys 배열에서 제거 + 10 locale 키 삭제 (1191 → 1190 keys)

### 6-3) StreakStatusPopup 자동 소거 시간
- 6초 → **10초**
- 베트남어/러시아어 등 긴 텍스트 + milestone 정보 + 남은 일수까지 충분히 읽을 시간 확보
- 사용자 추가 검증 요청 (Vercel 캐시 가능성 — 강제 새로고침 안내)

## 7. CategorySlider 자동 스크롤

### 요청
VocabTab/ListeningTab의 random topic 선택 시 7개 카테고리 슬라이더도 선택된 카테고리 그림으로 자동 이동.

### 1차 시도 (c2ba273) 실패
`requestAnimationFrame`만으로는 부족 — VocabTab/ListeningTab이 display:none 상태로 선마운트되어 mount 시점 `trackRef.scrollWidth = 0`.

### 2차 fix (f116d86) 성공 패턴
- 즉시 scroll 시도 + 실패 시 **ResizeObserver**로 trackRef 너비 0→양수 전환 감지하여 1회 실행
- ResizeObserver 미지원 시 폴링 폴백 (3초 timeout)
- 첫 발화 'auto' (즉시 정렬), 이후 선택 변경 'smooth'
- `done` 플래그 + cleanup으로 중복 실행 방지

## 8. wjsemd234 (x6bNZnhEx) "마이그 누락" 추적 — 가정 자체 부정확 확정

### 진단 결과
사용자가 "익명 5H7e0pjy → 실계정 x6bNZ 마이그에서 학습이력 누락" 주장 → 데이터로 검증 결과 **매핑 자체가 잘못**.

| UID | 정체 | 가입 시각 | 학습 이력 |
|---|---|---|---|
| 익명 5H7e0pjy7 | **하언경의 익명** | (anon) | totalGenerateCount: 3, activeDayCount: 1 |
| 실계정 3etE... | **`haj0416527@gmail.com` / 하언경** | 2026-03-26 | totalGenerateCount: 80, savedCardCount: 1 |
| 실계정 x6bNZ... (wjsemd234) | **`wjsemd234@gmail.com`** | **2026-05-17 06:26** | 모든 카운터 undefined + 서브컬렉션 0건 |

- archive 조회: `5H7e0pjy → 3etE` 2026-05-03 22:09에 이미 마이그 완료. `→ x6bNZ` archive 0건.
- **wjsemd234는 익명→실계정 마이그 자체가 발생하지 않음** (Google Sign-In으로 바로 가입, Auth created vs Firestore createdAt 1초 차)
- "학습 이력 누락"이 아니라 "학습 이력 처음부터 0"

### ada5bcc(어제 commit) 패치 자체는 정당
진단(wjsemd234 케이스) 부정확해도 코드 fix는 production 배포 OK:
- D1/D2 isNewUser 시그널: race 방어 (이론적 위험 존재)
- D4/D5 머지 화이트리스트 보강 (freeTalkCredits/pronCredits/streak max-merge 등): 실제 마이그 발생 시 명백한 데이터 손실 방지
- staging 검증 통과 + 사이드이펙트 점검 완료

### 학습
- **archive 조회로 매핑 검증** 가능 — 사용자 추정과 다른 케이스 식별
- **archive 없으면 마이그 자체가 없었다는 강력한 시그널** — 그냥 신규 가입

## 9. 발견된 한계 / Follow-up

### Gemini Flash-Lite 503 UNAVAILABLE
- 사용자 Render 로그 발견: 5/18 09:44~09:55 동안 6건 503 UNAVAILABLE
- "This model is currently experiencing high demand" — quota 아니라 Gemini 서버 자체 과부하 (transient)
- VocabWords / ConverseReply 양쪽 영향
- 재시도 로직 미구현 (follow-up 권장: 옵션 A 재시도 + 옵션 B 친절 메시지)

### dailyProgress 키는 device local timezone 기준
- vTXu7Zl 데이터 분석: 키 일부가 KST 환산 시 어긋남 (예: '2026-03-25' 키가 UTC 21:50 = KST 03-26 06:50)
- → 사용자가 미국/유럽 timezone에서 학습한 흔적
- `activeDayCount = 36` = `dailyProgress doc 개수 36` 일치 → 카운트 자체는 정확
- **잠재 결함**: 22시 streak risk cron이 `geoCountry IANA TZ` 기준 키 조회 → 출장 timezone 차이 큰 사용자엔 키 mismatch 가능 (`goalAchievedToday` 체크 실패)
- 한국 거주 대다수 사용자엔 영향 없음. 보류 또는 follow-up (옵션 B: geoCountry 고정 / 옵션 C: 사용자별 timezone 기록).

### examplePronunciation 옛 카드 backfill
- 기존 저장된 카드는 `examplePronunciation` undefined → Library 표시 안 됨 (`&&` 가드로 안전)
- 사용자에게는 "해당 카드 삭제 후 재저장" 안내 (간단)
- 대규모 backfill은 비용 + 복잡도 큼 — 자연 도태 예상

### CategorySlider 자동 스크롤 (사용자 검증 대기)
- f116d86 deploy 후 사용자 web에서 정상 확인 필요
- ResizeObserver fallback 폴링도 작동하는지

## 10. 배포 운영 패턴 학습

### Capgo native metadata-check false positive
- 1.5.44 / 1.5.45 production promote 시도 시 `@capgo/capacitor-updater`, `@revenuecat/purchases-capacitor`, `capacitor-voice-recorder` "native code changed" 경고
- 검증: 1.5.39 → 1.5.45 사이 `android/`, `ios/`, `package-lock.json`, 의존성 plugin version 모두 **변경 0**, `package.json` `version` 필드만 변경
- `--ignore-metadata-check` 안전하게 적용 (changes-0515.md 패턴 그대로)

### staging → production 흐름
- 사용자 명시 promote 요청 시 staging upload + currentBundle 검증 후 production set
- `currentBundle <channel>` 명령으로 채널 포인터 일치 확인 필수 (feedback_capgo_verify.md 룰)

## 11. Capgo 배포 timeline

| 시각 | 버전 | 채널 | 내용 |
|---|---|---|---|
| 오전 | 1.5.40 | staging | 22시 가드 + 13시 reminder + 클라 LocalNotif 정리 |
| 오전 | 1.5.41 | staging | streak push 검증 |
| 오전 | 1.5.42 | staging | FCM dedup + examplePronunciation Library 표시 |
| 오후 | 1.5.43 | staging | saveVocabCard 중복 fix |
| 오후 | 1.5.44 | **staging → production** | Translation 발음 + popup UI 정정 (첫 production promote) |
| 저녁 | 1.5.45 | **staging → production** | StreakStatusPopup 10s + Translation 저장 fix + CategorySlider race 해결 |

## 12. 신설 Firestore 필드 (인덱스 무영향)
- `streakReminderOptOut` (bool): 13시 정기 리마인더 옵트아웃
- `lastStreakReminderDate` (YYYY-MM-DD): idempotency
- `lastStreakReminderAt` (Timestamp): 관측용
- `examplePronunciation` (string): 카드 예문 발음 기호

## 핵심 교훈

1. **사용자 사고 진단은 데이터 검증 필수** — wjsemd234 케이스처럼 사용자 추측이 정확하지 않을 수 있음. `migrationArchive` 조회로 진실 식별 가능.
2. **Capgo `--ignore-metadata-check` 안전 사용** — `android/`, `ios/`, lock 파일 변경 0 검증 + JS only 확인 후. 한 번 더 검증해두면 위험 0.
3. **display:none 선마운트 race**는 ResizeObserver로 안정 해결. `requestAnimationFrame`만으로는 부족.
4. **Instance ID prefix dedup**은 같은 단말의 토큰 회전 누적 차단 — `arrayUnion`은 같은 문자열만 멱등.
5. **Translation prompt는 클라가 만드는 구조** — vocab/listening server prompt와 별도 관리. examplePronunciation 같은 필드 sync 누락 위험.
6. **schema description 강화**: `"..."` placeholder는 약함. `REQUIRED non-empty` + 위반 시 invalid 명시가 Gemini schema 준수 빈도 ↑.
