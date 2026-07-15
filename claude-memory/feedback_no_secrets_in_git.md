---
name: feedback-no-secrets-in-git-or-client
description: 🚨 절대 금지 — API 키/비밀을 Git 커밋, 클라이언트 빌드(VITE_), chat/스크린샷 어디에도 노출 금지. 오늘까지 4차 사고 발생
type: feedback
originSessionId: 329463f9-6b9b-4ac7-ae2f-509cc9a8d050
---
# 🚨 최상위 보안 규칙 — 절대 금지 4종

다음 4가지 어디에도 API 키, 비밀번호, 시크릿, 서비스 계정 키, Webhook Secret 등을 노출하지 말 것:

1. **Git 커밋 / GitHub 히스토리** — Google 봇이 실시간 스캔, revert해도 히스토리에 남음
2. **클라이언트 빌드 산출물(`dist/`)** — `VITE_` 접두사 변수에 비밀 넣으면 빌드 시 평문으로 inline됨 → App Store/Play Store/Vercel에 배포되어 누구나 디스어셈블 가능
3. **chat / AI 도구 / 스크린샷** — 평문으로 보내지 말 것. 스크린샷은 값 컬럼 반드시 마스킹(👁️ 아이콘 클릭). 변수명만 공유 OK
4. **하드코딩(소스/스크립트 fallback 값 포함)** — 코드에 박아두면 Git 히스토리 + 클라이언트 빌드 둘 다에 노출

## Why — 실제 사고 기록 (4차 누적)

| 일자 | 사고 | 원인 |
|------|------|------|
| 2026-03-31 | Gemini 키 1차 유출 | GCP 키 노출 |
| 2026-04-01 | Gemini 키 2차 유출 | 재유출 |
| 2026-04-06 | Gemini 키 3차 유출 | Xcode Build Phase 스크립트 |
| **2026-04-24** | **GCP 프로젝트 통째 정지** | **클라이언트 빌드(`VITE_GEMINI_API_KEY`)에 키가 inline되어 App Store/Play Store/Vercel 배포본에 평문 박힘 → 누군가 디스어셈블/Inspector로 추출 → abuse 누적 → Google이 "hijacked resources" 판정으로 프로젝트 통째 정지 → 전체 AI 기능 다운** |

→ 한 번 유출되면 **Production 다운 + 키 재발급 + 빌드 재배포 + appeal 등 수 시간~며칠** 손실. 실수로라도 절대 금지.

## How to apply — 컨텍스트별 규칙

### Vite 프로젝트의 환경변수 명명 규칙 (가장 중요)
- `VITE_*` 접두사 = **클라이언트 빌드에 inline됨** = **공개됨** (사용자 디바이스에서 추출 가능)
  - ✅ 안전한 `VITE_*` 변수: 공개 설계된 키만 (`VITE_FIREBASE_API_KEY`, `VITE_TOSS_CLIENT_KEY`, `VITE_REVENUECAT_*_KEY` (`appl_`/`goog_` prefix), `VITE_PAYPAL_CLIENT_ID`, `VITE_API_URL`)
  - ❌ 절대 금지 `VITE_*` 변수: 서버 비밀 (`VITE_GEMINI_API_KEY`, `VITE_AZURE_*_KEY`, `VITE_OPENAI_*`, `VITE_*_SECRET`, `VITE_YOUTUBE_API_KEY`, `VITE_TOSS_SECRET_KEY`)
- 비밀은 **반드시 `VITE_` 접두사 없이** 서버 환경변수로만 (`GEMINI_API_KEY`, `AZURE_SPEECH_KEY` 등) → Render에만 등록, 서버 코드에서 `process.env.X`로 읽고 클라이언트는 서버 거쳐 호출

### 환경변수 등록 위치 (역할 분리)
- **Render** (Express 서버) — 모든 비밀의 유일한 거처
- **Vercel** (정적 호스팅) — `VITE_*` 공개 변수만
- **Xcode Cloud / Android 빌드 스크립트** — `VITE_*` 공개 변수만 (iOS는 `ios/App/ci_scripts/ci_post_clone.sh`)
- **`.env` 파일** — `.gitignore` 처리 필수 (이미 됨), 로컬 개발용

### 빌드 검증 절차 (배포 전 필수)
```bash
# 1. 클라이언트 빌드 후 dist에서 위험 패턴 grep — 0건 확인
grep -E "AIzaSy[A-Za-z0-9_-]{30,}|generativelanguage|cognitiveservices.azure|youtube.googleapis" dist/assets/*.js
# (Firebase apiKey AIzaSy... 1개는 정상, 그 외 AIzaSy 매치 = 사고)

# 2. 의심 시 dead variable 점검
grep -rn "import.meta.env.VITE_" src/ | grep -iE "GEMINI|AZURE|OPENAI|SECRET|YOUTUBE"
# 매치 0건 = 안전
```

### 위반 시 즉시 대응
- **Git 노출**: revert만으로는 부족 → `git rebase`로 히스토리 완전 삭제 + force push + 키 즉시 재발급 + Render env 교체
- **클라이언트 빌드 노출**: 키 폐기 + 새 키 발급 + Vercel/Xcode Cloud env에서 `VITE_*` 비밀 변수 삭제 + `ci_post_clone.sh` 등 빌드 스크립트 정리 + 새 빌드 배포 + dist 검증 grep
- **chat 노출**: 즉시 폐기 + 새 키 발급 (chat 로그는 회수 불가)

### Dead variable 정리 원칙
사용 안 하는 환경변수는 즉시 삭제. **dead variable이 미래 유출 경로** (예: 2026-04-24 사고는 0401에 서버 경유로 전환했지만 `VITE_GEMINI_API_KEY` 변수와 `ci_post_clone.sh:19` 라인을 정리 안 해서, 옛 빌드들이 그 채로 스토어에 배포되어 abuse 받음).
