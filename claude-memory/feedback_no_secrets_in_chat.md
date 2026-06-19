---
name: feedback-no-secrets-in-chat
description: 🚨 chat·AI·스크린샷에 API 키/시크릿 평문 공유 금지, 스크린샷 값 컬럼은 마스킹 필수
type: feedback
originSessionId: 329463f9-6b9b-4ac7-ae2f-509cc9a8d050
---
# 🚨 chat·AI·스크린샷에도 비밀 키 평문 공유 금지

API 키, 시크릿, 토큰, 서비스 계정 등 모든 비밀 정보를 **chat 메시지 / AI 도구 / 스크린샷**에 평문으로 보내지 말 것.

## Why — 2026-04-24 사고 중 반복 노출

GCP 정지 사고 복구 작업 중 사용자가 다음을 chat에 노출:
1. 새로 발급한 Gemini API 키 (즉시 폐기 후 재발급으로 대응)
2. Xcode Cloud 환경변수 스크린샷 (값 컬럼 미마스킹) — 옛 폐기 Gemini 키, Firebase Web SDK, RevenueCat `appl_` 키, Toss `live_ck_` 키 노출
3. Vercel 환경변수 스크린샷 (값 컬럼 미마스킹)

→ **chat 로그는 회수 불가능**. Anthropic 서버 / 사용자 디스크 캐시 / 화면 공유 시 추가 노출 위험. "공개 OK 카테고리" 키더라도 노출 누적 시 abuse 표적이 됨.

## How to apply

### 절대 금지
- 채팅창에 키 값 붙여넣기 (`AIzaSy...`, `sk-...`, `appl_...`, `goog_...`, `live_ck_...`, `pk_...`, JWT 토큰 등)
- 스크린샷 캡처 시 값 컬럼 마스킹 안 함 (Vercel/Xcode Cloud/Render/AWS/GitHub Actions 어디든)
- Slack/Discord/이메일 등 어떤 통신 채널에도 평문 비밀 공유 금지

### 허용
- **변수명만** 공유 OK (예: "Vercel에 `VITE_GEMINI_API_KEY` 있다" — 값 X)
- 키의 **앞 4~6자** 정도 식별용 부분 공유 OK (예: "키가 `AIzaSyDm`로 시작하는데 맞나요?")
- 스크린샷 시 **눈 모양 아이콘(👁️) 클릭하여 마스킹** 후 캡처 (Vercel/Xcode Cloud 모두 지원)
- AI에 점검 요청 시 **변수명 목록만** 전달 → AI가 서버 파일에서 실제 사용처 grep으로 점검

### 위반 시 즉시 대응
- 노출된 키가 **활성 비밀**이면: 즉시 폐기 + 재발급 + Render/Vercel/Xcode Cloud env 교체 + (Git이라면) history rewrite + force push
- 노출된 키가 **공개 설계 키** (Firebase Web SDK, Toss Client, RevenueCat appl_/goog_, PayPal Client)이면: 즉시 회전은 불필요하지만, 채팅 기록 정리 권장
- 노출된 키가 **이미 폐기된 옛 키**면: 위생 차원에서 환경변수 청소 (이번 사고가 정확히 이 케이스)

## 관련 메모리
- [feedback_no_secrets_in_git.md](feedback_no_secrets_in_git.md) — 절대 금지 4종 (Git/클라이언트빌드/chat/하드코딩)
- [feedback_env_var_hygiene.md](feedback_env_var_hygiene.md) — VITE_ 접두사와 환경변수 위생
