---
name: feedback_side_effect_check
description: 강력 규칙 — 모든 소스 변경 시 반드시 "사이드 이펙트 점검" 섹션을 계획/설명에 포함할 것
type: feedback
originSessionId: 44807d57-bfaa-4cd2-a79f-9e537e932fd7
---
# 강력 규칙: 모든 소스 변경 시 사이드 이펙트 점검 필수

**규칙**: 코드 변경을 제안하거나 구현할 때마다 **반드시 "사이드 이펙트 점검" 섹션을 명시적으로 포함**해야 한다. 빌드가 통과했다는 것만으로 안전성을 단정하지 말 것.

**Why**: 이 앱(PronunFit)은 이미 Production 에서 실사용 중이다. Google Play / App Store / 웹(Vercel) 에 배포되어 실제 유저가 매일 사용하고 있으며, 잘못된 변경은 즉시 실유저 피해로 이어진다. 작은 변경이 예상치 못한 경로에 파급되는 사례를 이미 여러 번 겪었다:
- `toISOString()` 제거가 StatsPage 의 월간 달력을 전부 빈 칸으로 만들 뻔함
- `showInterstitialAd` 반환값 변경이 점수 롤백 로직 전제로 필요했음
- Listening TTS race 가 fetch race + blob 누수 + 탭 이탈 세 층위 문제였음

**How to apply**:

1. **계획 단계** (구현 전 설명할 때): 변경이 건드리는 함수/값/상태의 **모든 호출처**를 Grep 으로 실제 확인한 뒤, 각 호출처에서의 영향을 아래 카테고리로 분류 보고:
   - 🚨 **Critical** — 즉시 기능 파손 가능. 반드시 함께 수정
   - 🟡 **Minor** — 엣지케이스 영향. 같은 커밋에 수정 권장
   - 🟢 **영향 없음** — 이유를 1줄로 명시

2. **크로스 플랫폼 검토**: Web / Android (Capacitor WebView) / iOS (WKWebView) 각각의 동작 차이를 짚을 것. 특히:
   - `Date` / `localStorage` / `sessionStorage` 타임존·영속성
   - Capacitor 플러그인 분기 (isNativePlatform, isIOS)
   - AdMob/Facebook/Apple/Google Sign-In 플랫폼별 경로

3. **역사적 데이터 호환성**: Firestore 스키마/키 포맷 변경이면 기존 유저 문서와의 호환을 명시.

4. **빌드 + 사이드이펙트 점검 = 한 세트**: `vite build` 통과만으로 "완료" 보고 금지. 반드시 사이드 이펙트 요약이 함께 있어야 "완료".

5. **Production 규칙과 병용**: staging 배포 우선, main push 는 유저 명시 승인 후에만 (기존 deploy rule 과 결합).

**예외**: 메모 파일 수정, 스크립트 편의 기능 등 런타임에 영향이 없는 변경은 생략 가능. 그러나 판단이 애매하면 포함하는 것을 기본값으로.

**User expectation**: 사용자는 모든 변경 제안에서 "사이드 이펙트 점검" 섹션을 당연히 기대한다. 빠뜨리면 신뢰를 잃는다.
