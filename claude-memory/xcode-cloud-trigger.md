---
name: xcode-cloud-trigger
description: Xcode Cloud는 iOS 폴더(`ios/**`) 변경이 포함된 push에만 자동 트리거됨 — 웹/공통 코드/package.json 변경만으로는 빌드 안 됨
type: project
originSessionId: 16183c41-75a5-4fc8-ac1f-2d063f4c9f17
---
**Xcode Cloud 워크플로(`PronunFit_iOS`)는 iOS 폴더 경로 필터를 가짐.**

### 동작
- `git push origin main`에 `ios/**` 경로 파일이 **포함되어야만** Xcode Cloud가 빌드를 트리거
- 변경이 웹(`src/**`), 서버(`server/**`), `package.json`, `capacitor.config.json`(루트) 등에만 있으면 **자동 빌드 안 됨**
- 웹 전용 변경은 Vercel만 트리거됨 (main push)

**Why:** Xcode Cloud 크레딧 절약 + 불필요한 TestFlight 빌드 증가 방지. 웹번들 변경은 Capgo OTA로 처리되므로 iOS 네이티브 빌드 불필요.

**How to apply:**
- iOS 심사 중에 Capgo 버전 bump 커밋(package.json만) 등을 main에 push해도 **현재 심사 빌드에 영향 없음** — Xcode Cloud 안 돎
- iOS에 새 변경을 반영하려면 명시적으로 `ios/**` 경로 파일을 편집하거나, App Store Connect → Xcode Cloud에서 **수동으로 "Start Build"** 해야 함
- 과거 "iOS 심사 중에는 main push 금지" 규칙은 완화 가능 — 단, `ios/**` 경로 수정이 포함되지 않음을 확인한 push에 한함
- 확실하지 않으면 `git diff <이전커밋>..HEAD -- ios/` 로 사전 점검

### 검증 사례
- 2026-04-18: `6cd0f65 chore: version bump 1.4.25 → 1.4.26 (Capgo production OTA)` — `package.json` 1줄만 변경, `ios/**` 없음 → Xcode Cloud 트리거 안 됨 (사용자 App Store Connect에서 직접 확인)
