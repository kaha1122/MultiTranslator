---
name: changes-0403
description: 2026-04-03 — iOS Capgo OTA 무한 reload 루프 완전 해결, autoUpdate 네이티브 비활성화, 플랫폼 3분기 확립
type: project
---

## 2026-04-03: iOS 무한 reload 루프 완전 해결

### 핵심 원인 (이전 커밋들이 실패한 근본 이유)

`ios/App/App/capacitor.config.json`이 `.gitignore`에 포함되어 있어 `npx cap sync ios` 실행 시 루트 `capacitor.config.json`(`autoUpdate: true`)에서 매번 다시 생성됨.
→ 아무리 JS 레벨에서 Capgo를 막아도, **네이티브 레벨에서 Capgo가 Android 번들을 다운→적용→reload**하는 것을 막을 수 없었음.

| 커밋 | JS 레벨 수정 | 네이티브 autoUpdate | 결과 |
|------|-------------|-------------------|------|
| 48ba6a4 | App.jsx에서 Capgo 이벤트 건너뜀 | **true (그대로)** | 네이티브가 Android 번들 적용→reload |
| 503f3a0 | main.jsx에서 reset() 추가 | **true (그대로)** | reset()→reload→네이티브가 또 번들 적용→무한 루프 |
| **17721a6** | main.jsx 조건부 reset | **false (패치)** | 네이티브 Capgo 완전 비활성 |

### 수정 내용 (2단계 방어)

#### 1차 방어: 빌드 스크립트에서 네이티브 autoUpdate 비활성화
- `ios/App/ci_scripts/ci_post_clone.sh` (Xcode Cloud용)
- `scripts/build-ios.sh` (로컬 빌드용)
- 양쪽 모두 `npx cap sync ios` 직후 node 스크립트로 `autoUpdate: false` 패치

**Why:** `ios/App/App/capacitor.config.json`은 gitignore 대상이라 직접 수정해도 빌드 시 덮어씌워짐. 루트 원본은 Android와 공유하므로 변경 불가. 빌드 스크립트에서 sync 후 패치하는 것이 유일한 방법.

#### 2차 방어: main.jsx Capgo 플랫폼 분기
- iOS: `notifyAppReady()` 호출하지 않음 + `reset()`은 `current()`로 확인 후 builtin 아닐 때만 실행
- Android/Web: 기존과 동일 (`notifyAppReady()` 정상 호출)

### capacitor.config.json 동기화 구조 (중요)

```
루트 capacitor.config.json (autoUpdate: true, Git 추적 O)
    ├── cap sync android → android/.../capacitor.config.json (true)
    └── cap sync ios → ios/.../capacitor.config.json (true → 빌드스크립트가 false로 패치)
```
- iOS config는 `.gitignore` 대상 → 빌드마다 재생성
- Android config는 autoUpdate: true 필요 (Capgo OTA 사용)
- 루트 원본 변경 불가 (Android 영향)

### iOS 전용 분기 전체 목록 (플랫폼 3분기 확립)

| # | 영역 | 파일 | iOS 동작 |
|---|------|------|---------|
| 1 | Firebase Auth | config.js | `initializeAuth` + `browserLocalPersistence` |
| 2 | Firestore | config.js | `experimentalForceLongPolling: true` |
| 3 | Capgo OTA (JS) | main.jsx | `notifyAppReady()` 안 함 + 조건부 reset |
| 4 | Capgo OTA (네이티브) | capacitor.config.json | `autoUpdate: false` (빌드스크립트 패치) |
| 5 | Capgo 이벤트/채널 | App.jsx | 리스너/채널 등록 건너뜀 |
| 6 | 업데이트 팝업 | App.jsx | `latestIOSVersion` 필드 비교 |
| 7 | 스토어 이동 | App.jsx | App Store URL |
| 8 | RevenueCat 키 | App.jsx | `VITE_REVENUECAT_IOS_KEY` |
| 9 | AdMob 광고 단위 | useAdMob.js | iOS 전용 Ad Unit ID 세트 |

### 커밋/배포
- `17721a6` fix(ios): Capgo OTA 무한 reload 루프 완전 해결 — 2단계 방어
- `48bc600` chore: bump version to v1.4.3
- Vercel staging, Capgo staging/production 배포 완료
- Xcode Cloud 빌드 트리거 (main push)
