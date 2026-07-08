---
name: Render는 server/package.json을 사용 (root 아님)
description: Render Web Service의 빌드 root는 /server, dependencies는 server/package.json에 추가해야 함
type: feedback
originSessionId: c6698add-4a6d-4a17-9a62-7d4c04af08b6
---
# Render 배포 — server/package.json 이 root

## 규칙

PronunFit Render Web Service의 빌드/실행 root는 **`/server` 디렉토리**.
새 npm 패키지 설치 시 **반드시 `server/package.json`** 에 추가할 것. 루트 `/package.json` 은 클라이언트(React + Capacitor) 전용.

**Why**: Monorepo 구조 — `/package.json` = 클라이언트, `/server/package.json` = 서버.
**How to apply**: 서버 코드(`server/**/*.js`)에서 사용할 npm 패키지는 `server/package.json` 에만 추가. `cd server && npm install <pkg>` 사용. `server/package-lock.json` 도 함께 commit.

## 사고 사례 (2026-05-04)

이메일 캠페인용 `resend` 패키지를 루트 `/package.json` 에 잘못 추가 → Render 재배포 → `Cannot find module 'resend'` 에러. 코드는 deploy 됐지만 server/node_modules에 resend 미설치. 30분 디버깅 후 발견.

해결: `server/package.json` 으로 이전 (commit `0dc9afa`).

## 검증 방법

배포 전 확인:
- 서버 require 추가 시 → `cd server && npm ls <pkg>` 로 실제 설치 여부 확인
- 또는 `git diff server/package.json server/package-lock.json` 으로 변경 확인
- Render 빌드 로그에서 npm install 출력 — `49 packages` 같은 funding 메시지가 server scope 인지 확인

## 관련 파일

- `/package.json` — React/Capacitor 클라이언트 deps (vite, react, lucide-react, etc.)
- `/server/package.json` — Node 서버 deps (express, firebase-admin, resend, microsoft-cognitiveservices-speech-sdk, etc.)
