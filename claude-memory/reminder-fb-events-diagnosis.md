---
name: Facebook App Events 장애 → APronunFit 전환으로 해결 (2026-04-23 완료)
description: "Dead App ID" 문제로 광고 어트리뷰션 전면 장애. 백업 앱으로 완전 전환 성공. 다음 세션 재사용 참고용.
type: project
originSessionId: 27615e93-4581-4173-b40f-7a98cb11d468
---
## ✅ 최종 해결 (2026-04-23)

**근본 원인**: 과거 FB App (`1549474396756439`, PronunFit)이 Meta 백엔드에서 **사실상 "죽은 상태"**. 도용 사건(2026-04-19) 이후 Meta 내부 플래그가 걸려 다음 증상 지속:
- FB SDK 호출 시 `OAuthException errorCode 200: "API access deactivated — complete developer registration"`
- Facebook OAuth 로그인 시 "사용할 수 없는 기능" 에러
- 광고 집행 중이나 **App Events 어트리뷰션 전면 차단** → 설치수 0 집계
- 광고는 정상 송출/과금되나 **효과 지표 없음** → CPI/CPA 최적화 불가

**해결 경로**: 백업으로 만들어둔 **APronunFit 앱**(`822618547094999`)으로 전면 이전.

**검증 성공**: 2026-04-23 오후 2:03 Events Manager에 "**최근 수신 12분 전** / **활성 🟢**" 확인됨. 오류 0건, FB SDK 정상 초기화.

## Why (반드시 기억할 것):
**"광고를 계속 집행해도 설치 귀인이 안 잡히는 상황"**의 진짜 원인은 **Meta가 내부 플래그로 해당 FB App을 사실상 deactivate**시킨 것. 대시보드에는 "Live" / "인증됨" / "필수 조치 없음"으로 표시되지만 실제 Graph API는 모든 요청 거부. 관리자 권한으로 해제 불가능, Meta Trust & Safety 팀만 해제 가능.

**Client Token 재생성, DUC, App Review, Business Verification 등 모든 compliance 조치로도 해제 안 됨.** 유일한 해결책은 **새 FB App으로 완전 이전**.

## How to apply:
### 만약 미래에 비슷한 증상 발생 시:
1. adb logcat에서 `API access deactivated` 또는 `OAuthException errorCode 200` 확인
2. Meta 대시보드 모든 항목 정상(Live, Verified, no action needed)인데도 에러 지속
3. Facebook OAuth 테스트(브라우저에서 직접 URL) → "사용할 수 없는 기능" 에러
4. 위 3가지가 모두 해당 → **"Dead App ID" 확정**. 재생성/재요청으로 해결 불가
5. 즉시 **백업 FB App 생성 또는 활용**하여 전체 이전 실행

### 대응 시 핵심 작업:
1. 새 FB App 대시보드 설정 완료 (App Review, DUC, Business Verification)
2. Firebase Console Facebook Provider → 새 App ID + App Secret 교체
3. 코드 9개 파일(strings.xml, Info.plist, index.html, privacy/terms/delete-info html, AndroidManifest FacebookContentProvider, iOS Info.plist URL scheme) App ID + Client Token 교체
4. 네이티브 버전 bump + AAB 빌드 + Play Console 배포
5. 웹 버전 bump + Capgo 배포
6. Meta 광고 캠페인 앱 연결 변경 (구 App ID → 신 App ID, 구 Ad Account → 신 Ad Account)

### 평시 예방책 (중요):
- **백업 FB App을 항상 미리 만들어두기** (이번 건은 사용자님이 2026-03경 백업용 APronunFit을 만들어놨던 것이 결정적 도움)
- 도용/인증 이슈 발생 시 **Meta 자산 변경을 최소화** (움직일수록 더 많은 플래그 걸림)
- Instagram 비즈니스 계정 이동은 특히 주의 (90일 쿨다운 유발)

## 관련 커밋 및 변경:
- `ef4812c` — FB App ID 1차 교체 (2187242868692310 → 1549474396756439, 이후 이것도 죽은 것 발견)
- `6d7be41` — Client Token 재생성 (효과 없음)
- `9348a1e` — Facebook 버튼 임시 숨김 + Apple 스타일 통일
- `59b11d8` — **APronunFit 완전 전환** (1549474396756439 → 822618547094999) ⭐
- AAB v1.2.8, v1.2.9, v1.2.10 (각 단계별 배포)

## 현재 상태 요약:
- ✅ Facebook App Events 정상 작동 (Events Manager에서 확인)
- ✅ Facebook SDK 정상 초기화 (adb logcat 검증)
- ✅ Firebase Console에 APronunFit App Secret 등록 완료
- ⏳ Facebook 로그인 버튼 복원 대기 (SHOW_FACEBOOK_LOGIN=false 유지 중, Capgo로 재활성화 가능)
- ⏳ Meta 광고 캠페인 APronunFit + Facebook 전용 게재 전환 필요
- ⏳ Instagram pronunfit 1 90일 쿨다운 (별개 이슈, 2026-07-22경 해제 가능)
