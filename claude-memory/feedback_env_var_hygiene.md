---
name: feedback-env-var-hygiene
description: VITE_ 접두사 변수는 클라이언트 빌드에 평문 inline됨, 비밀은 절대 VITE_로 정의 금지, dead variable 즉시 청소
type: feedback
originSessionId: 329463f9-6b9b-4ac7-ae2f-509cc9a8d050
---
# 환경변수 위생 — VITE_ 접두사 + Dead Variable 청소 원칙

## 핵심 사실: VITE_ 접두사 = 클라이언트 평문 노출

Vite는 `VITE_`로 시작하는 환경변수를 **빌드 시점에 클라이언트 JS에 평문으로 inline**한다. 즉:

```javascript
// 소스
const k = import.meta.env.VITE_GEMINI_API_KEY;
// 빌드 후 dist/assets/*.js
const k = "AIzaSyAfEYVOasT...실제값...";  // ← 누구나 볼 수 있음
```

→ App Store/Play Store/Vercel에 배포되면 **사용자 디바이스에서 디스어셈블/네트워크 Inspector로 추출 가능**. 회수 불가능.

## 규칙 1: 비밀은 절대 VITE_ 접두사로 정의 금지

### ❌ 절대 금지 (서버 비밀에 VITE_ 붙이기)
- `VITE_GEMINI_API_KEY` ← 2026-04-24 GCP 정지 사고의 원인
- `VITE_AZURE_*_KEY`, `VITE_OPENAI_*`, `VITE_YOUTUBE_API_KEY`
- `VITE_*_SECRET` (TossSecret, RevenueCatSecret, FacebookSecret, WebhookSecret 등)
- `VITE_FIREBASE_SERVICE_ACCOUNT*` (Admin SDK)

→ 비밀은 **반드시 `VITE_` 접두사 없이** `GEMINI_API_KEY`, `AZURE_SPEECH_KEY` 식으로 명명, **Render에만** 등록, 서버 코드에서 `process.env.X`로 읽고 클라이언트는 Render API 거쳐 호출.

### ✅ 안전한 VITE_ 변수 (공개 설계된 것만)
- `VITE_FIREBASE_*` (Web SDK config, 도메인 제한이 보안)
- `VITE_TOSS_CLIENT_KEY` (`live_ck_`/`test_ck_` prefix)
- `VITE_REVENUECAT_*_KEY` (`appl_`/`goog_` prefix = 앱 키, 공개 설계)
- `VITE_PAYPAL_CLIENT_ID`, `VITE_PAYPAL_PLAN_*`
- `VITE_API_URL` (Render URL, 공개)

## 규칙 2: Dead Variable 즉시 청소

사용 안 하는 환경변수는 **모든 환경에서 즉시 삭제**:
- Vercel Dashboard → Environment Variables
- Xcode Cloud → 공유 환경 변수
- Render → Environment
- 빌드 스크립트 (`ci_post_clone.sh`, `build-aab.sh`, `build-ios.sh`)
- 로컬 `.env`, `.env.example`

### Why — 2026-04-24 사고가 정확히 이 케이스
- 0401에 Gemini를 서버 경유로 전환 → 클라이언트 코드는 더 이상 `VITE_GEMINI_API_KEY` 사용 안 함
- 그러나 환경변수 청소 안 함:
  - Vercel env에 변수 살아있음 → 빌드에 inline 가능 상태
  - Xcode Cloud env에 폐기된 옛 키 값(`AIzaSyAfEYV...`) 그대로 남음
  - `ci_post_clone.sh:19`에 `VITE_GEMINI_API_KEY=${VITE_GEMINI_API_KEY}` 라인 잔재
- 결과: 옛 빌드들이 그 채로 스토어에 배포되어 abuse 누적 → GCP 프로젝트 통째 정지

## 규칙 3: 환경변수 도입/이전 시 체크리스트

새 환경변수 추가하거나 기존 변수 옮길 때 다음 확인:

1. **분류 명시**: 이 변수가 클라이언트(`VITE_*` 공개 OK)인가, 서버(접두사 없음, 비밀)인가?
2. **위치 결정**: Render(서버) / Vercel(웹 클라) / Xcode Cloud(iOS 클라) / 빌드 스크립트(공유)
3. **사용처 확인**: 클라(`src/`)에서 `import.meta.env.X` 또는 서버(`server/`)에서 `process.env.X` 어느 쪽?
4. **기존 변수 정리**: 이 도입으로 deprecated되는 옛 변수가 있나? 있으면 즉시 모든 환경에서 삭제
5. **빌드 검증**: 클라 변수면 `npm run build` 후 `dist/assets/*.js` grep 으로 의도한 값만 들어갔는지 확인 ([secret-hygiene.md](secret-hygiene.md))

## 환경별 허용 매트릭스

| 환경 | `VITE_*` 공개 변수 | 서버 비밀 (접두사 없음) | 비고 |
|------|------------------|----------------------|------|
| Render (Express) | ❌ 잘못된 위치 | ✅ 유일한 거처 | `VITE_PAYPAL_*`는 예외 — 서버가 같은 값을 읽어야 해서 공유 |
| Vercel (정적) | ✅ | ❌ 절대 금지 | 비밀이 있으면 즉시 삭제 |
| Xcode Cloud | ✅ (iOS 빌드용) | ❌ 절대 금지 | iOS는 `appl_` RevenueCat만 |
| 빌드 스크립트 (`ci_post_clone.sh` 등) | ✅ 주입 OK | ❌ 절대 금지 | fallback 값에 추측 가능한 비밀 박지 말 것 |

## 관련 메모리
- [feedback_no_secrets_in_git.md](feedback_no_secrets_in_git.md) — 절대 금지 4종
- [feedback_no_secrets_in_chat.md](feedback_no_secrets_in_chat.md) — chat 노출 금지
- [feedback_deploy.md](feedback_deploy.md) — 배포 2대 원칙
- [secret-hygiene.md](secret-hygiene.md) — 빌드 검증 grep 절차
