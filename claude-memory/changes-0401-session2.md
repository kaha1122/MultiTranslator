---
name: changes-0401-session2
description: 2026-04-01 2차 — 단어장 듣기소스, 언어i18n, BT마이크 전면개선, iOS Xcode Cloud CI/CD 구축, Gemini키 재유출대응
type: project
---

# 2026-04-01 2차 세션 변경 사항

## 1. 단어장(Library) 소스 필터 개선

### 1-1. 듣기(Listening) 소스 추가
- `Library.jsx`: SOURCE_OPTIONS에 `{ value: 'listening', label: t('library.srcListening') }` 추가
- `App.jsx`: `saveVocabCard`에 `sourceType` 파라미터 추가 (기본값 `'vocab'`)
- ListeningTab 호출 시 `sourceType: 'listening'` 전달 → 중복 체크/저장 모두 동적 sourceType 사용
- 기존 Listening 카드는 `vocab`으로 저장됨 → 새 카드부터 `listening`으로 분리

### 1-2. 보이스 사전 → 번역기 라벨 변경
- `srcTranslation` i18n 키를 10개 언어 모두 변경:
  - ko: 보이스 사전 → 번역기
  - en: Voice Dictionary → Translator
  - ja: ボイス辞書 → 翻訳機
  - 등 10개 언어

### 1-3. 전 탭 언어 pill i18n 통일
- Translation, Scene, Vocab, Listening, Video 5개 탭 모두
- `getLangName(code)` 또는 `lang.name` → `getT(sourceLang, 'langNames.${code}') || fallback`
- 설정 탭과 동일하게 사용자 모국어로 언어명 표시

---

## 2. 블루투스 마이크 전면 개선 (7개 항목)

### 2-1. iOS AppDelegate 초기 오디오 세션 (`AppDelegate.swift`)
- `didFinishLaunchingWithOptions`에서 `.playAndRecord` + `.allowBluetoothHFP` + `.allowBluetoothA2DP` + `.defaultToSpeaker` 설정
- `setActive(true)`는 호출하지 않음 (실제 녹음 시점에 활성화)

### 2-2. iOS BT 입력 강제 선택 (`BluetoothAudioPlugin.swift`)
- `startBluetoothSco()`에서 `session.setPreferredInput(btInput)` 추가
- `.bluetoothHFP` / `.bluetoothA2DP` / `.bluetoothLE` 포트 우선 탐색

### 2-3. iOS 녹음 후 TTS 라우트 복원 (`BluetoothAudioPlugin.swift`)
- `stopBluetoothSco()`를 `setActive(false)` → `.playback` + `.allowBluetoothA2DP` 카테고리 전환으로 변경
- BT 출력(에어팟 스피커) 유지하면서 녹음 종료

### 2-4. Android SCO 연결 대기 (`BluetoothAudioPlugin.java`)
- `startBluetoothSco()`에서 `SCO_AUDIO_STATE_CONNECTED` 콜백 수신 후 resolve
- 3초 타임아웃 → 내장 마이크로 폴백 resolve

### 2-5. 샘플레이트 동기화 (`useAudioRecorder.js`)
- BT HFP 마이크 16kHz 고정 대응
- `stream.getAudioTracks()[0]?.getSettings()?.sampleRate` 감지 → AudioContext에 전달
- 폴백: BT 시 16kHz, 비BT 시 브라우저 기본

### 2-6. Web BT 디바이스 감지 개선 (`useAudioRecorder.js`)
- 기존: `getUserMedia` → `enumerateDevices` → `stop` → `getUserMedia` (2회 호출, ~2초 지연)
- 변경: `getUserMedia` 1회 → `enumerateDevices` → BT 있으면만 재연결, 없으면 stream 재사용
- 내장 마이크 사이드이펙트(iOS Safari 두 번째 getUserMedia 실패) 방지

### 2-7. 침묵 감지 유예 기간 (`useAudioRecorder.js`)
- BT 연결 시 3초, 비BT 시 1.5초 GRACE_PERIOD
- **핵심 버그 수정**: 유예 기간 중 음성 감지(hasDetectedVoice)가 스킵되어 첫 발음 80% 미인식
  - 수정: 음성 감지는 항상 수행, 자동 종료(침묵 타이머)만 유예

### 2-8. iOS deprecated API 수정
- `.allowBluetooth` → `.allowBluetoothHFP` (iOS 8.0 deprecated 경고 해결)
- `AppDelegate.swift`, `BluetoothAudioPlugin.swift` 두 곳

---

## 3. Capgo 배포

- v1.4.1 → staging 업로드
- v1.4.2 → staging 업로드 (음성 감지 버그 수정 포함)
- v1.4.2 → **production** 채널 배포

---

## 4. iOS Xcode Cloud CI/CD 구축

### 4-1. Xcode 수동 빌드 성공
- `npm install` → `npm run build` → `npx cap sync ios` → Xcode Archive → TestFlight 업로드
- Bundle ID 오타 수정: `com.argmes.pronunfit` → `com.arigems.pronunfit`
- Apple Developer에 iPhone UDID 등록 (프로비저닝 프로파일 생성용)
- Signing & Capabilities: Sign in with Apple, Push Notifications, In-App Purchase 추가

### 4-2. Xcode Cloud 워크플로우 설정
- App Store Connect → Xcode Cloud → GitHub 연결 (SSH key 방식)
- 워크플로우: `PronunFit_iOS` — main 브랜치 push 시 자동 Archive
- `ci_post_clone.sh` 스크립트: Node.js 설치 → 환경변수→.env 생성 → npm install → npm run build → cap sync ios
- **환경변수**: App Store Connect → Xcode Cloud → 워크플로 관리 → Environment Variables (Secret)에 12개 등록
  - VITE_API_URL, VITE_GEMINI_API_KEY, VITE_TOSS_CLIENT_KEY, VITE_FIREBASE_API_KEY 등
- Post-Action: TestFlight 내부 테스트 배포 (PronunFit_iOS 그룹)
- 배포 준비: TestFlight(내부 테스트 전용) 선택
- **xcodeproj로 열기** (SPM 기반, Capacitor 8부터 workspace 불필요)

### 4-3. Package.resolved
- Xcode Cloud에서 SPM 의존성 해결을 위해 `Package.resolved` 파일 Git에 추가 필수
- 경로: `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`

### 4-4. Mac에서 Git push 설정
- GitHub Personal Access Token 대신 SSH key 사용 (`ed25519`)
- `git remote set-url origin git@github.com:kaha1122/MultiTranslator.git`

---

## 5. iOS 앱 아이콘 교체
- 기본 Capacitor 아이콘 → PronunFit 로고 (1024x1024 PNG)
- `public/icon-512.png`를 sharp로 1024x1024 리사이즈 + 투명배경 제거(흰색 flatten)
- 경로: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`

---

## 6. Gemini API 키 재유출 사고 및 대응 (2차)

### 사고 경위
- Xcode Cloud 빌드에서 `.env` 누락 → 앱 크래시
- `ci_post_clone.sh`에 API 키를 하드코딩하여 Git 커밋 → **Google 봇 즉시 감지 → Gemini 키 비활성화**
- `git revert`로 되돌렸으나 히스토리에 키 잔존
- `git rebase`로 히스토리에서 커밋 완전 삭제 + force push

### 대응
- Gemini API 키 재발급 (Google AI Studio에서 새 키 생성)
- Firebase API 키는 무사 (Translator 프로젝트, 활성 상태 유지)
- `.env`, `server/.env`, Render, Vercel 모두 새 Gemini 키 반영
- `feedback_no_secrets_in_git.md` 메모리 등록 — **절대 API키를 Git에 커밋하지 말 것**
- CI/CD 환경변수는 App Store Connect/Vercel/Render의 Environment Variables(Secret)에서만 설정

---

## 7. TestFlight 설정
- 내부 테스팅 그룹: PronunFit_iOS (테스터: sw.haka@gmail.com)
- 수출 규정 관련 문서: "암호화 사용합니까?" → 아니오 선택 필요
- TestFlight 앱 설치 → 초대 메일 링크 → 앱 설치

---

## 버전 이력
- v1.4.0 → v1.4.1 (Capgo staging) → v1.4.2 (Capgo staging+production)
- Xcode Cloud 빌드: 1~11 (빌드 10부터 환경변수 포함, 빌드 11 allowBluetoothHFP 수정)
