---
name: firestore-schema
description: Firestore 스키마 확정 — users/{uid} 35+ 필드, savedCards 30+ 필드, verifiedPhones, 서브컬렉션 4종
type: project
originSessionId: c6698add-4a6d-4a17-9a62-7d4c04af08b6
---
## users/{uid} (메인 유저 문서)

| 구분 | 필드 | 타입 |
|------|------|------|
| 프로필 | uid, email, displayName, createdAt, updatedAt | string/timestamp |
| 등급 | tier (trial/pro/premium/admin), tierUpdatedAt | string/timestamp |
| 구독 | planId, subscriptionMonths, subscriptionCurrency (KRW/USD), subscriptionStartedAt, subscriptionExpiresAt, autoRenew, tossBillingKey, tossCustomerKey, lastRenewedAt | mixed |
| 카운터 | trialCardCount, savedCardCount, trialPronCount, proPronCount, proPronResetMonth | number/string |
| 분석용 | translationGenerateCount, sceneGenerateCount, vocabGenerateCount, totalGenerateCount | number |
| 전화 | phoneNumber, phoneVerified, phoneCountry | string/boolean |
| BYOK | byokGeminiKey, byokAzureKey, byokAzureRegion | string |
| 온보딩 | hasCompletedOnboarding | boolean |
| 활동 추적 | lastActiveDay (YYYY-MM-DD), lastActiveAt (Timestamp), activeDayCount, lifecycleStage (starter/engaged/subscriber) | mixed |
| 푸시 | fcmTokens[], fcmTokenUpdatedAt, subscriptionAlertOptOut, reengagementOptOut, reengagementSentAt{d1At..d6At} | mixed |
| 플랫폼 | currentNativeVersion, currentNativePlatform (android/ios), firstNativeVersion, firstNativePlatform, geoCountry, deviceLang | string |

**제거됨**: `membership` (2026-03-15, `tier`로 대체)

## 서브컬렉션 (4종)
- `users/{uid}/dailyProgress/{YYYY-MM-DD}` — count, saveCount, pronCount, listenCount, *GenCount, dailyGoal, achievedKeys[], updatedAt
- `users/{uid}/pronunciation_records/{textHash}` — cardId, originalText, timestamp, scores{}, words[]
- `users/{uid}/sceneHistory/{sceneId--diff--style--lang}` — sentences[], updatedAt
- `users/{uid}/vocabHistory/{topicId--level--lang}` — words[], updatedAt

## savedCards/{cardId} (최상위 컬렉션)
- 공통: userId, userEmail, langCode, sourceLang, inputType (W/S), sourceType (translation/scene/vocab), sourceText, translatedText, pronunciation, difficulty, createdAt, isDeleted, deletedAt, starred, pronunciationScore
- Vocab 전용: example, exampleTranslation, examplePronunciation, categoryId, topicId
- Scene 전용: scene, category, sceneHint, selectedEmotion, interactionType
- 메모: memos[], userNotes[], annotations[], learningTip[]

## verifiedPhones/{phoneNumber} (최상위 컬렉션)
- userId, verifiedAt — 전화번호 중복 방지용 레지스트리

## reengagementLogs/{YYYYMMDDHH-{countries}} (최상위 컬렉션, 2026-05-01~)
- ranAt, targetCountries[], totals{candidates,sent,failed}, skipAggregate{reason: count}
- Re-engagement cron 매시간 실행별 1 doc. 발송 모니터링용
