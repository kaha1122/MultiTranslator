---
name: changes-0517
description: 2026-05-17 종일 세션 — iOS first_open Analytics SDK 추가 + Phase 1-C 시도/실패/revert + Share native 분기 부활 + FB SDK pin + 1.3.2 production AAB 빌드
metadata: 
  node_type: memory
  type: project
  originSessionId: 047e8c7b-4b52-4d83-9356-64911ca38854
---

# 2026-05-17 세션 — Phase 1-C 시도 실패 후 revert, 1.3.2 production 빌드

## 트리거 / 시작

사용자 질문: "iOS에서 first_open 이벤트가 잘 감지 되고 있는지 확인해 줄 수 있어?"

진단 결과 — iOS SPM 의존성에 `@capacitor-firebase/analytics` 부재 확인 ([ios/App/CapApp-SPM/Package.swift](ios/App/CapApp-SPM/Package.swift) 검토). Android는 이미 [android/app/build.gradle:55](android/app/build.gradle#L55)에 `firebase-analytics` 직접 dep으로 동작 중 (changes-0415.md). 동일 작업이 iOS에는 안 됐었음.

→ 이걸 fix 김에 pending native 변경 모두 묶어서 1.3.x 빌드 진행하기로 결정.

## 커밋 흐름 (3개)

### commit 1774169 — 1.3.0 native 빌드 준비 (오전)

`feat(native): 1.3.0 native 빌드 — iOS Analytics + Phase 1-C persistence + Share native + FB SDK pin`

변경:
- iOS: `@capacitor-firebase/analytics@8.2.0` 추가 → SPM Package.swift 등록 → first_open 자동 수집
- Android+iOS: `@capacitor/share@8.0.1` 재추가 (1.5.35에서 임시 제거됐던 것) + [ReferralModal.jsx](src/components/ReferralModal.jsx) Capacitor.isNativePlatform() 분기 추가
- Android+iOS: Phase 1-C — [src/firebase/config.js](src/firebase/config.js) `isIOS` 가드를 `isNative` 로 확장 (Android도 browserLocalPersistence)
- Android: FB SDK `latest.release` → `17.0.2` 고정 ([android/app/build.gradle:57](android/app/build.gradle#L57))
- Android: versionCode 30→31, versionName 1.2.11→1.3.0
- iOS: CURRENT_PROJECT_VERSION 4→5 (Xcode Cloud 자동 증분으로 무관)
- pending-aab-fixes.md 항목 1 (Direct Boot guard)은 이미 적용된 상태 확인됨

### commit 3f4adb4 — 1.3.0 → 1.3.1 bump

Apple ITMS-90186 거부 대응. 1.3.0 build 91이 이미 승인/출시되어 train 닫힘 → 마케팅 버전 강제 bump:
- iOS MARKETING_VERSION 1.3.0 → 1.3.1
- Android versionCode 31→32, versionName 1.3.0→1.3.1 (플랫폼 정렬)

### commit ee618e2 — Phase 1-C revert + 1.3.2 bump (오후, 사고 발견)

테스트 단말 (실제 1.2.11 + Google 로그인 + 학습 데이터 보유) 에서 Internal Testing으로 1.3.1 업데이트 진행 → **신규 익명 UID 생성 + "무료 계정 만드세요" 화면** 확인. Firestore에 새 user 문서 (isAnonymous: true, currentNativeVersion: "1.3.1", tier: "trial", streakCurrent: 0) 생성 검증됨.

→ Phase 1-C revert 결정:
- [src/firebase/config.js](src/firebase/config.js) `isNative` → `isIOS` 가드로 되돌림
- Android는 default(IndexedDB) + Phase 1-A/1-B (AuthContext 20초 timeout) 유지로 안정 상태 복귀
- iOS, Analytics, Share, FB SDK pin, version bumps는 모두 유지 (실패 무관 + 검증 통과)
- 1.3.1 → 1.3.2 bump (1.3.1은 Internal Testing 결함 빌드로 남으므로 새 train)

상세 사고 분석 및 향후 방지 규칙: [feedback_firebase_persistence_no_migration.md](feedback_firebase_persistence_no_migration.md)

## 검증 결과 (사용자 단말 실측)

| 검증 항목 | 결과 |
|---|---|
| iOS Xcode Cloud 빌드 (1.3.1 build 93) | ✅ TestFlight 배포 |
| iOS Analytics first_open 자동 수집 | ✅ Firebase Release Monitoring "활성 사용자 1" + 6분 24초 engagement |
| Android @capacitor/share native 분기 | ✅ 사용자 단말에서 카톡/SMS/Gmail 시스템 시트 정상 노출 (autoUpdate=false APK로 검증) |
| Android Phase 1-C 마이그레이션 | ❌ **실패** — 신규 익명 UID 생성, 기존 세션 분실 |
| iOS Crash-free 100% / 비정상 종료 0 | ✅ |

## Capgo OTA 이해 정리 (사용자가 헷갈렸던 부분)

```
[중요 메커니즘]
- APK/AAB 안 dist/ = "builtin fallback" (Capgo는 이걸 별도 ID 없는 것으로 인식)
- Capgo SDK 부팅 시 → 채널 latest 다운로드 (fresh install이면 무조건)
- 다운로드한 번들이 builtin 보다 우선 → WebView가 그쪽 폴더 봄

[1.5.38 vs 1.5.38 라벨 함정]
- 우리 빌드의 dist/도 1.5.38, production OTA도 1.5.38 — 라벨은 같지만 내용 완전 다른 별개 번들
- Capgo는 bundle ID(hash)로 식별, 라벨은 무시
- 따라서 APK 설치 후 첫 부팅에 production OTA가 builtin 덮어씀

[autoUpdate=false 빌드의 의미]
- 그 빌드의 Capgo SDK는 부팅 시 채널 안 봄 → builtin만 영구 사용
- 테스트용 전용 (production 절대 금지 — 영원히 OTA 못 받음)
```

이 메커니즘 이해 후 사용자가 autoUpdate=false APK 빌드 요청 → Share native 동작 검증 가능했음.

## 다음 단계 (사용자 작업 대기)

1. **Android**: Play Console Internal Testing에 v1.3.2 AAB 업로드 (`android/app/build/outputs/bundle/release/app-release.aab` 30MB) → 1.2.11 → 1.3.2 업데이트 검증 (이번엔 로그인 유지 + Share 동작) → Production 승격
2. **iOS**: Xcode Cloud에서 commit ee618e2로 수동 빌드 → 새 train 1.3.2 build 자동 증분 → TestFlight → App Store 제출
3. **Capgo OTA push** (Play Store production 승격 후): `npx @capgo/cli bundle upload --channel production` → 모든 v1.2.x 유저도 Share native + Analytics 받음
4. **Firestore latestNativeVersion 수동 업데이트** (Play Store 공개 후): `config/app.latestNativeVersion = "1.3.2"` ([feedback_manual_native_version_update.md](feedback_manual_native_version_update.md))

## 학습 / 후속 개선 메모

- Phase 1-C 근본 해결 방안 보류 — Phase 1-B (20초 timeout)으로 rare 케이스 흡수 계속, 심각 재발 시 수동 마이그레이션 코드 또는 multi-persistence 배열 재검토
- pending-aab-fixes.md 대부분 항목 오늘 처리됨 (Direct Boot 이미 완료, FB SDK pin 완료, Share 부활 완료, Phase 1-C 시도/revert)
- 향후 같은 Firebase persistence 변경 시도하기 전 [feedback_firebase_persistence_no_migration.md](feedback_firebase_persistence_no_migration.md) 반드시 확인
