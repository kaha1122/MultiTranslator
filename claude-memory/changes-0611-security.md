---
name: changes-0611-security
description: "2026-06-11 전체 코드 감사 + 보안/안정성 일괄 수정 (서버 권위, IDOR, fail-closed, firestore rules) — OTA 2.0.28 + 서버 1a9638c + rules(8b3ef99f) 전부 배포완료"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1cd65e01-8d9c-4984-8c5a-38316ec4f7fc
---

# 2026-06-11 전체 감사 + 보안 일괄 수정

6-에이전트 전체 코드 리뷰 후 사용자 승인으로 일괄 수정. **배포 완료(06-12)**: Capgo staging+production **2.0.28**, 서버 main `1a9638c`(Render **Manual Deploy** — auto-deploy 웹훅 1회 미발화, 다음 push 때 재확인). 외부 보안 프로브 전 통과(무토큰 AI/웹훅/cron 모두 401). **firestore.rules도 06-12 배포 완료** — REST API(`server/_deploy-firestore-rules.js`). 활성 ruleset `532c7e81`: 사용자 요청으로 **dailyTopUpLegacy() 한시 예외 포함**(구버전 클라 일일충전 +10/+30 + lastTopUpDate 단조증가 쓰기 허용 → 구버전 영향 0). ⏳ **OTA 2.0.28 보급(1~2주) 후 예외 제거 필수**: firestore.rules에서 dailyTopUpLegacy 제거 → `node _deploy-firestore-rules.js --release`. 롤백 체인: 532c7e81→8b3ef99f(예외 없는 신규칙)→aa6f6872(구규칙).
부수: 예외 커밋(438ad9c)에 병행 발열 세션의 staged 파일들(AuthContext profileEssence, ttsUsage 서브컬렉션 이전, heat-guard hook)이 함께 push됨 — 의도된 변경 확인, 빌드 통과. ttsUsage 서버 변경은 다음 Render 배포 때 활성화.

사전 설정 완료(06-12): Render env 신규 3종(CRON_SECRET/REVENUECAT_WEBHOOK_AUTH/UNSUBSCRIBE_SECRET) + reengagement cron에 `x-cron-secret` 헤더 + **renew-subscriptions cron 신설**(`pronunfit-renew-subscriptions`, 매일 UTC 01:00 — 기존엔 스케줄러 자체가 부재! Toss 구독자 0명이라 무피해) + Firestore 복합 인덱스(users: autoRenew+subscriptionExpiresAt) + RevenueCat Authorization header. 이날 PC 용량정리로 **Git 프로그램 삭제됨** → winget 재설치(2.54.0) + no-reply 이메일 재설정.

## 수정 완료 (코드)
1. **서버 권위**: 전 AI 엔드포인트 optionalAuth→requireAuth (analyze/converse 6종/azure-tts/scene-sentence/ocr/video-feed) + 인메모리 rate limiter(`server/middleware/rateLimit.js`, uid/IP 슬라이딩 윈도우) + 텍스트 길이 상한(azure-tts 1200자 등) + multer fileSize 10MB. 클라 3곳(coach-tts/OCR/video-feed) authFetch 전환 — **서버 먼저 배포하면 구버전 클라 401 → OTA 먼저 배포할 것**.
2. **결제**: toss-confirm-billing PLAN_CONFIG 단일 권위 테이블(tier/months/amount를 planId에서 도출, "pro가격으로 premium" 차단) + customerKey=req.uid 강제 + currency-planId 일치 / cancel-subscription IDOR(userId=req.uid) / paypal-activate requireAuth+custom_id 대조.
3. **migrate-anonymous**: providerData.length>0(실계정) 차단 — 임의 계정 파괴 차단. user-not-found는 허용(기존 시나리오).
4. **fail-closed**: CRON_SECRET/RC/Toss/PayPal/unsubscribe secret 미설정 시 503 거부 (`ALLOW_INSECURE_WEBHOOKS=1`로만 dev 우회) + timingSafeEqual + One-Click Unsubscribe POST 핸들러(RFC 8058).
5. **grant 멱등화**: `server/utils/claimOnce.js`(bonusClaims/{id}.create() 원자 마커) — reviewBonus/streak/referral 적용, adReward는 쿨다운+캡을 runTransaction화. **streak claim은 dailyProgress에서 서버 재계산**(streakCurrent 클라값 신뢰 제거, 앵커 ±2일 TZ 허용).
6. **클라 TTS**: handleSpeakFallback Android 플러그인 분기(차감 후 무음 fix) / handleSpeak IDB-await 후 stale 가드 + cacheKey in-flight dedup(연타 이중차감/이중Azure 차단) + Android TextToSpeech.stop 추가 / ListeningTab 폴백 _skipGate(이중차감 fix) / ttsCache.js 바이트 상한 50MB(TTS_CACHE_MAX_BYTES).
7. **rules-prep**: `firestore.rules` repo에 작성(미배포!) — tier는 trial 다운그레이드만/포인트 차감만/verifiedPhones 본인만. 클라: claimDailyTopUp→서버 `/api/bonus/daily-topup`(날짜 ±48h+단조증가=시계조작 차단), RC sync/restore 승격→check-subscription 위임, saveByokKeys tier:'admin' 제거(admin은 수동 설정).
8. 같은 날 앞 세션: 자정 카운터 리셋(useDailyProgress rolloverIfNeeded), FreeTalk 마이크 abort(배경/닫기), streak 푸시 신선도 컷(risk 2일/reminder 30일), 계정삭제 savedCards 쿼리 삭제+450 청크.

## 🚨 배포 시퀀스 (필수 순서)
① Capgo OTA(클라 전체) 먼저 → ② Render 서버 배포 → ③ OTA 보급 확인 후 firestore.rules 배포(firebase deploy --only firestore:rules). 역순이면 구버전 클라 401/permission-denied (try/catch라 크래시는 없음, 기능 일시 저하).
Render env 확인 필요: CRON_SECRET/REVENUECAT_WEBHOOK_AUTH/TOSS_WEBHOOK_SECRET/PAYPAL_WEBHOOK_ID/UNSUBSCRIBE_SECRET 실설정 (fail-closed라 미설정 시 해당 기능 503).

## 미수정 잔여 (다음 사이클)
- 웹훅 expiry 단조성 가드(out-of-order RC 이벤트), RC 웹 갱신 경계 grace, Toss 웹훅 raw-body HMAC(re-stringify 문제), 포인트 구매 환불 회수, FCM 로그아웃 토큰 제거, onPronSuccess stale tier 클로저, Translation 빈 sourceText, daily 카운터 절대값→increment, cron 500명 페이지네이션/catch-up, 포인트 차감 자체의 서버 이전(Phase 2).
- 진단 도구: `server/_fetch-firestore-rules.js` (배포된 rules 조회).
