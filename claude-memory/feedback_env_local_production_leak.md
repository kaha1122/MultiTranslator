---
name: .env.local 은 production 빌드도 오염시킴 — Capgo OTA 사고 룰
description: .env.local 사용 금지, 대신 .env.development.local. Capgo는 로컬 dist를 업로드하므로 직격탄.
type: feedback
---

**룰**: Vite 환경변수 override 시 **`.env.local` 파일명 사용 금지**. 반드시 `.env.development.local` 또는 `.env.production.local` 같이 mode 명시 파일 사용.

**Why:**
2026-05-04 Capgo OTA v1.4.90 production 사고:
- `.env.local` 에 `VITE_API_URL=http://localhost:5000` 적어 dev 편의용으로 사용 중
- 파일 주석에 "빌드/배포 산출물에는 영향 없음" 잘못 적혀있었음
- 실제로는 Vite 우선순위에서 **`.env.local` > `.env`** (모든 mode 포함)
- `npm run build` (production) 도 `.env.local` 의 localhost 가 inline
- Capgo OTA 는 로컬 PC 의 `dist/` 를 그대로 업로드 → **모바일 사용자 모두 API 호출 'Failed to fetch'**
- Vercel 은 `.gitignore` 로 `.env.local` 이 push 안 되어 운 좋게 영향 없었음. **Capgo 만 직격탄**.

Vite 환경변수 우선순위 (높은 → 낮은):
1. `.env.[mode].local`  ← 특정 mode 만 + git ignore
2. `.env.[mode]`        ← 특정 mode 만
3. `.env.local`         ← 모든 mode + git ignore  ⚠️ production 도 적용
4. `.env`               ← 모든 mode

**How to apply:**
- dev 모드 override: 파일명 `.env.development.local` 사용 (Vite 가 `npm run dev` 일 때만 로드)
- production 빌드 override (드물게 필요): `.env.production.local` 사용
- `.env.local` 파일명 절대 사용 금지 — production 오염 위험
- Capgo upload 전 검증 필수:
  ```
  grep -oE "https://[a-z]+\.onrender\.com|http://localhost:5000" dist/assets/index-*.js
  ```
  production URL 만 있어야 정상 (localhost 발견 시 즉시 빌드 환경 점검)
- 메모리 `feedback_capgo_verify.md` 의 channel currentBundle 검증과 함께 dist URL 검증도 routine 화
