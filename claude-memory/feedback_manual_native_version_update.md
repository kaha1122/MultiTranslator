---
name: feedback_manual_native_version_update
description: Firestore config/app.latestNativeVersion은 AAB 빌드 시 자동 업데이트 금지 — Play Store 프로덕션 공개 완료 후 수동 업데이트
type: feedback
originSessionId: 07851fc1-3875-4c2a-9281-3810da3195ac
---
**규칙**: Firestore `config/app.latestNativeVersion` 필드는 **AAB 빌드 스크립트에서 자동 업데이트하지 말 것**. Play Store 프로덕션 트랙에 실제로 공개된 후 수동으로 업데이트.

**Why:** AAB 빌드 완료 시점과 Play Store 프로덕션 공개 시점 사이에 수시간~수일의 괴리가 있음. 자동 업데이트하면:
- 앱 열 때 `installedVersion < latestNativeVersion` 비교로 업데이트 팝업이 뜨는데,
- 실제 Play Store에는 아직 새 버전이 없어서 사용자가 업데이트 버튼을 눌러도 받을 수 없음 → **사용자 혼란**.
- 2026-04-19 AAB v1.2.7 배포 시 이 문제 발생 → 자동 업데이트 로직을 `scripts/build-aab.sh`에서 의도적으로 제거함.

**How to apply:**
- `scripts/build-aab.sh`는 AAB 빌드만 하고, Firestore 업데이트는 수행하지 않음 (제거됨)
- AAB 배포 순서:
  1. `bash scripts/build-aab.sh` → AAB 파일 생성
  2. Play Console → 내부 테스트 업로드 → 프로덕션 승격
  3. Google Play 심사 통과 + 프로덕션 트랙에 실제 공개 확인
  4. **그 후에만** Firebase Console → Firestore → `config/app` 문서의 `latestNativeVersion`을 새 버전으로 수동 업데이트
- 이 업데이트 팝업 관련 변경 시 이 순서를 깨지 않도록 주의
- 서버 엔드포인트 `POST /api/config/app`는 여전히 살아있으므로 긴급 시 curl로 업데이트 가능하지만 빌드 스크립트에서는 호출 X
