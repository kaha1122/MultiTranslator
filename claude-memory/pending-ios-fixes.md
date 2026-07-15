---
name: 다음 iOS 빌드 시 반영할 수정 대기열
description: iOS 네이티브 빌드(TestFlight/App Store) 작업 시작 시 함께 검증할 누적 수정 항목
type: project
originSessionId: 553f58bc-111d-42c0-af23-914db9323c7c
---
# 다음 iOS 빌드 시 반영할 수정 대기열

## 트리거 (이 메모리를 상기시키는 신호)

사용자가 다음 중 하나를 언급/실행하면 **이 메모리를 읽고 "지금 다음 수정도 함께 반영/검증할지" 재확인 요청**하세요:

- "iOS 빌드", "iOS 배포", "TestFlight 업로드", "App Store 출시"
- `npm run cap:ios`, `npm run cap:sync:ios`, Xcode 관련 작업
- `ios/App/**` 경로 편집
- iOS 관련 다음 릴리스 논의 시작

## 함께 상기할 것

iOS 빌드 논의 시 [reminder-ios-push-post-approval.md](reminder-ios-push-post-approval.md)도 함께 확인 — 심사 통과 후 Push Notifications Xcode 통합 + Meta Store ID 등록은 별개 트랙.

---

## 대기 항목

### 1. iOS WKWebView 첫 부팅 시 5초 sync 폴백 검증 (우선순위: 중)

**위치**: [src/context/AuthContext.jsx:156-185](src/context/AuthContext.jsx#L156-L185)

**배경**: 네이티브 Firebase Auth(Capacitor 플러그인)에 이미 로그인된 유저가 있으면, 웹 SDK가 IndexedDB로 동기화될 때까지 5초 setTimeout 폴백을 둠. 이 5초는 setTimeout(논블로킹)이라 메인스레드를 막지는 않지만, 그동안 `auth.currentUser`가 비어 있어 UI 렌더 경로가 영향받음.

**2026-05-01 변경**: 백그라운드 익명 사인인 전환(Strategy A) 작업 시, 이 5초 구간에서도 `setLoading(false)` + `setUser(null)`을 즉시 호출하도록 수정 — home이 user=null 상태로 즉시 렌더되고, 웹 SDK가 동기화되면 onAuthStateChanged 재발화로 user/profile 자동 채워짐.

**검증 필수 (다음 iOS 빌드 시)**:
- [ ] 네이티브 Firebase에 Google/Facebook/Apple 로그인된 상태로 앱 콜드 스타트 → home이 1초 이내 즉시 뜨는지
- [ ] 웹 SDK 동기화 완료 (1-3초) 후 user/profile 자연스럽게 채워지는지 (시각적 flicker 허용 범위 확인)
- [ ] 5초 폴백 시점에 익명 사인인이 잘못 발화하지 않는지 (이미 `auth.currentUser` 체크로 가드되어 있음)
- [ ] iOS WKWebView IndexedDB persistence 정상 (`browserLocalPersistence` 적용됨)

### 2. iOS 네이티브 Firebase 미동기화 시 tier 초기 표시 (우선순위: 낮)

**위치**: [src/context/AuthContext.jsx](src/context/AuthContext.jsx) tier 결정 로직 (`profile?.tier || 'trial'`)

**배경**: 위 5초 sync 구간 동안 `profile=null` → `tier='trial'`로 폴백. Pro/Premium 유저가 첫 페인트에서 1-3초간 광고가 노출되거나 trial 한도 메시지가 뜰 수 있음.

**검증 필수**: Pro 구독자 iOS 실기기에서 콜드 스타트 → 첫 페인트의 광고/한도 표시가 1-3초 후 사라지는지. 시각적 flicker가 거슬리는 수준이면 별도 처리 (예: 첫 N초간 광고 mount 보류).

**대안**: 만약 flicker가 문제라면 [src/firebase/config.js](src/firebase/config.js)의 iOS persistence 동작을 점검하거나, AuthProvider에서 "네이티브 Firebase에 유저 있음" 신호를 받은 시점부터 광고 mount를 1-2초 보류하는 가드 추가 검토.

---

## 반영 시 주의

- iOS는 **OTA 영향 미적용** (Capgo OTA iOS 비활성화 — [changes-0403.md](changes-0403.md)). 이 항목들은 IPA 재빌드 + Xcode Cloud 또는 수동 빌드 + TestFlight 업로드가 있어야 검증/배포 가능.
- **배포 원칙 준수**: staging 먼저 — TestFlight 내부 테스터로 검증 후 App Store 제출. [feedback_deploy.md](feedback_deploy.md) 참고.
- **사이드 이펙트 점검 섹션 필수**: [feedback_side_effect_check.md](feedback_side_effect_check.md) 규칙에 따라 Android 회귀 함께 확인.

## 항목 추가 규칙

새 수정을 여기 추가할 때:
1. 우선순위 태그 (낮음/중/높음)
2. 파일 경로는 클릭 가능한 마크다운 링크
3. "배경" + "검증 필수" 체크리스트
4. MEMORY.md 활성 알림 hook 업데이트 (항목 수 변경 시)
