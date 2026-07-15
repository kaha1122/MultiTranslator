---
name: 다음 AAB 빌드 시 반영할 수정 대기열
description: Android 네이티브 AAB 릴리스 작업 시작 시 함께 반영할 누적 수정 항목 (2026-05-17 대부분 처리됨, 잔여 1건)
type: project
originSessionId: b2fc9777-8880-40d2-899d-793148a0ff28
---
# 다음 AAB 빌드 시 반영할 수정 대기열

## 트리거 (이 메모리를 상기시키는 신호)

사용자가 다음 중 하나를 언급/실행하면 이 메모리를 읽고 잔여 항목 반영 여부 재확인:

- "AAB 빌드", "Play Store 업로드", "Android 배포"
- `./scripts/build-aab.sh`, `versionCode` / `versionName` 증가 요청
- `android/app/build.gradle` 편집, dependencies 변경

## 2026-05-17 세션에서 처리된 항목 (history)

다음 항목들은 2026-05-17 commit 1774169 / ee618e2 에서 처리됨. 상세는 [changes-0517.md](changes-0517.md):

| 항목 | 처리 결과 |
|---|---|
| 1. Direct Boot 크래시 가드 (MainApplication.java) | 이미 적용된 상태 확인 (별도 작업 불필요) |
| 2. FB SDK `latest.release` → `17.0.2` pin | ✅ 적용 (commit 1774169) |
| 3. `@capacitor/share` 재등록 + ReferralModal native 분기 | ✅ 적용 + 사용자 단말 검증 통과 (commit 1774169) |
| 4. Phase 1-C: Android browserLocalPersistence 전환 | ❌ **시도 실패 → REVERT** (commit ee618e2). [feedback_firebase_persistence_no_migration.md](feedback_firebase_persistence_no_migration.md) 참고. 재시도 금지 |

## 🟡 잔여 대기 항목

### 5. Google Play Billing Library NPE 우회 — billing-client force (우선순위: 낮음)

> ⚠️ **2026-06-16 갱신 — 아래 "force 8.0.1" 수정안은 무효**: AAB v2.1.1(code36) 빌드 시
> `force 'com.android.billingclient:billing:8.0.1'` 적용했더니 **빌드 실패** — `8.0.1`은 Google/Maven
> 어디에도 게시되지 않은 버전(`Could not find com.android.billingclient:billing:8.0.1`).
> 의존성 사슬도 변경됨: `purchases-hybrid-common:17.47.0 → com.revenuecat.purchases:purchases:9.25.0`(아래 17.47.0→purchases-android 기록은 구버전). **v2.1.1은 이 force 없이 빌드함.**
> 재시도 전 ① 실제 게시된 billing 버전 확인(`dl.google.com/.../billing/`) ② 그 버전에 ProxyBillingActivity NPE 가드가 실제 포함됐는지 검증 필수. RevenueCat purchases 9.25.0이 끌어오는 billing 버전을 먼저 조사할 것.

**위치**: [android/app/build.gradle](android/app/build.gradle) dependencies 블록 위 (or 안)

**Crashlytics 지문**:
```
java.lang.NullPointerException:
  Attempt to invoke virtual method
  'android.content.IntentSender PendingIntent.getIntentSender()'
  on a null object reference
  at com.android.billingclient.api.ProxyBillingActivity.onCreate(billing@@8.0.0:15)
```

**의존성 사슬** (직접 선언 X, 모두 transitive):
```
@revenuecat/purchases-capacitor 12.2.4
  └─ com.revenuecat.purchases:purchases-hybrid-common 17.47.0
      └─ purchases-android (transitive)
          └─ com.android.billingclient:billing 8.0.0  ← NPE 발생점
```

**문제 메커니즘**: 결제 플로우 도중 OS가 메모리 부족/배터리 정책으로 우리 앱 프로세스를 kill → 사용자 복귀 시 OS가 `ProxyBillingActivity`를 자동 재생성하면서 `PendingIntent` extra가 saved instance state에서 유실 → `onCreate`의 `.getIntentSender()` 호출에서 NPE → 프로세스 크래시. Google billing-client 8.0.0의 알려진 이슈, 8.0.1+에서 가드 추가됨.

**영향 평가 (실유저 손해 거의 없음)**:
- 발생 조건: 저사양 단말 + 결제 중 백그라운드 멀티태스킹 + Google Play UI 장시간 체류 — 합치 전부 충족 시에만
- **결제 자체는 영향 없음** — Google Play 백엔드 거래 완료 → RevenueCat webhook으로 entitlement 활성화 → [server/routes/webhook.js](server/routes/webhook.js) `INITIAL_PURCHASE` 핸들러가 Firestore `users/{uid}.tier` 자동 업데이트 → 사용자 앱 재실행 시 [src/context/AuthContext.jsx](src/context/AuthContext.jsx)의 `getCustomerInfo()` + 5초 sync 폴백으로 tier 동기화
- 사용자 체감: "결제 중 앱 강제종료" 1회 → 신뢰도 하락 / 1성 리뷰 위험만

**수정안**: [android/app/build.gradle](android/app/build.gradle)의 `dependencies {}` 블록 위에 추가:
```gradle
configurations.all {
    resolutionStrategy {
        force 'com.android.billingclient:billing:8.0.1'
    }
}
```

또는 RevenueCat purchases-capacitor 12.x 후속 버전이 hybrid-common 18.x로 bump하면 자연 해소.

**관측 (2026-05-08 기준)**:
- 신규 크래시는 이 ProxyBillingActivity NPE **1건뿐** (영향 사용자 1명)
- hotfix 전환 임계 미충족, 다음 정식 AAB에 번들 처리 권장

**검증 필수**:
- AAB 빌드 후 Internal Testing에서 RevenueCat 샌드박스 결제 1회 (Trial → Pro 또는 Pro → Premium)
- billing 8.0.1 강제가 RevenueCat purchases-android 내부 호출 호환 (semver patch 안전 추정, 검증)
- 결제 플로우 중 강제 백그라운드 → 복귀 시나리오 1회 (최대한 OS kill 유도)

## 반영 시 주의

- **배포 원칙 준수**: staging 먼저 — [feedback_deploy.md](feedback_deploy.md)
- **사이드 이펙트 점검**: [feedback_side_effect_check.md](feedback_side_effect_check.md) 크로스플랫폼 영향 0 확인
- **버전 bump 수동**: [feedback_manual_native_version_update.md](feedback_manual_native_version_update.md) Play Store 공개 후 latestNativeVersion 수동 업데이트

## 관측 기준 (이 값 돌파 시 hotfix 전환)

| 기준 | 임계 | 조치 |
|---|---|---|
| 같은 지문 ANR/크래시 | 7일 3건 이상 | 즉시 분석 + hotfix 검토 |
| Crash-free users | < 99.7% | 즉시 분석 |
| 특정 기기/OS 집중 | 3건 이상 | 호환성 이슈 의심 |
