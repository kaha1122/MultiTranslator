---
name: changes-0416
description: 2026-04-16 변경 — 전면광고 점수시스템 + Listening race 해결 + 커스텀입력 + Vocab 스크롤 + dailyProgress 로컬타임존 (v1.2.5 code 24, web v1.4.18)
type: project
originSessionId: 44807d57-bfaa-4cd2-a79f-9e537e932fd7
---
# 2026-04-16 변경사항 (AAB v1.2.5 code 24, web v1.4.18)

## 1. 전면광고 점수 시스템 (수익 개선)

**배경**: 카드 저장 5회 누적 시 전면광고 → 카드 생성 빈도가 낮아 광고 수익 부족.

**변경**:
- **저장소**: `localStorage['interstitialPoints']` 영속 누적 (3 플랫폼 동일 동작)
- **점수 규칙**:
  - 카드 저장 (Translation/Video/Scene/Vocab 4탭 공통) = **2점**
  - Generate (Vocab/Listening/Scene `onGenerate`) = **1점**
  - TTS 재생 = **0점 (제외)** — Listening Generate 가 이미 듣기 과금단위
- **임계**: 15점 누적 시 전면광고 1회 표시 후 0 리셋
- **쿨다운**: 60초 (임계 도달해도 쿨다운 중이면 점수 유지, 다음 액션에서 발사)
- **실패 시 롤백**: showInterstitial 반환값 false 면 점수·쿨다운 복구
- **tier 가드**: `tier !== 'trial'` 조기 반환 (Pro/Premium 영향 없음)

**웹 광고 확장 대비 어댑터 분리** — `src/lib/adProvider.js`
- `adsReady()`: 네이티브=true, 웹은 `window.__webAdProvider?.ready`
- `showInterstitial()`: 플랫폼별 디스패치, boolean 반환
- 추후 웹 광고 업체(AdSense/SSP) 연동 시 `window.__webAdProvider = { ready: true, showInterstitial: async () => boolean }` 1곳만 구현하면 자동 활성화

**useAdMob.showInterstitialAd 시그니처 변경**: void → boolean (성공/실패)

**구 키 정리**: 마운트 시 `localStorage.removeItem('interstitialSaveCount')` 1회

## 2. Listening 탭 TTS Race Condition 근본 해결

**증상**: essay→dialogue 토글 후 재생, 혹은 탭 이동 후 다른 Generate 클릭 시 이전 TTS 가 계속 재생 (orphan audio).

**근본 원인**: `handlePassagePlay` 의 Azure TTS fetch 가 async 진행 중일 때 `stopPassageAudio()` 가 호출돼도 ref 가 null 이라 아무것도 정지 안 됨. fetch 완료 후 `passageAudioRef.current = audio; audio.play()` 로 뒤늦게 orphan 재생.

**수정** (`src/components/ListeningTab.jsx`):
- `playGenRef` 세대 토큰 — fetch 응답 각 단계에서 `myGen !== playGenRef.current` 체크로 stale 폐기
- `ttsAbortRef` AbortController — `stopPassageAudio` 에서 in-flight fetch abort (authFetch 가 signal 을 fetch 에 그대로 spread 해 지원)
- `passageAudioUrlRef` — blob URL 누수 방지 (onended/stop/stale 모두 revoke)
- `audio.src = ''` 로 디코더 버퍼 명시적 해제
- **언마운트 + isActive prop false** 시 자동 정지:
  - App.jsx 에서 `<ListeningTab isActive={viewMode === 'listening'} />` 전달
  - 다른 탭으로 이동 시 자동 stopPassageAudio

## 3. Listening 탭 커스텀 주제 입력

Vocab 탭과 동일 UX 패턴으로 사용자 직접 주제 입력 필드 추가.
- `customInput` state, `.vocab-custom-input` 스타일 재사용
- 토픽 선택 시 custom 클리어, custom 입력 시 토픽 해제 (상호 배타)
- `handleGenerate` 가 `hasCustom` 분기로 topicLabel/categoryLabel 구성
- 서버 `/api/listening-passage` 는 텍스트를 프롬프트에 그대로 주입하므로 서버 변경 없음
- i18n 키 `scene.customPlaceholder` 재사용

## 4. Vocab 탭 최초 진입 Generate 버튼 스크롤

**증상**: 첫 진입 시 랜덤 카테고리가 자동으로 펼쳐져 Generate 버튼이 화면 밖으로 밀려 사용자가 인지 못함.

**수정**: `generateBtnRef` 추가, 마운트 시 `setTimeout(100ms)` 후 `scrollIntoView({ block: 'center', behavior: 'smooth' })` **1회** 실행 (`[]` deps).
- 100ms 지연은 펼쳐진 카테고리 DOM 렌더 완료 대기용
- 탭 복귀 시 재마운트 안 되므로 재실행되지 않음 — 의도된 UX

## 5. dailyProgress 로컬 타임존 통일 (중요 버그 수정)

**증상**: 한국 유저가 오늘 접속·Generate 했는데 Firestore `dailyProgress/2026-04-16` 문서가 생성 안 됨. 대신 `2026-04-15` 등 UTC 기준 문서에 기록됨.

**근본 원인**: `new Date().toISOString().slice(0, 10)` 은 UTC 기준. 한국(UTC+9) 로컬 오전 9시 이전 활동은 UTC 상 아직 전날이라 전날 문서로 기록됨.

**수정 3곳** (같은 커밋에 번들링):
- `src/hooks/useDailyProgress.js` — `toLocalDateStr(d)` 헬퍼, `getToday()` / `getWeekDates()` 로컬 기준
- `src/components/StatsPage.jsx:18` — `formatDate` 로컬 기준. **Critical**: 안 고쳤으면 Firestore 로컬 키와 UTC 조회키가 불일치해 월간 달력이 전부 빈 칸이 됐을 것
- `src/context/AuthContext.jsx:294` — Pro 월간 발음 리셋 키 `YYYY-MM` 로컬 기준

**iOS/Android/Web 차이 없음**: JS Date 는 모든 플랫폼에서 동일 동작.

**영향**:
- 🟢 앞으로 활동은 사용자 로컬 자정 기준으로 정확 기록
- 🟡 기존 UTC 기반 문서는 그대로 남음 (데이터 손실 없음, 자동 이관은 리스크라 방치)
- 🟢 Trial daily 카드/발음 리셋, 주간 그래프, 보상광고 보너스(`rewardBonus_${today}`) 모두 자동 교정

## 6. 배포

- **Git main**: [f6a235c](https://github.com/kaha1122/MultiTranslator/commit/f6a235c) (feat) + [37a4274](https://github.com/kaha1122/MultiTranslator/commit/37a4274) (timezone fix)
- **Vercel**: v1.4.18 자동 배포
- **AAB**: v1.2.5 (code 24) — Play Console 수동 업로드 대기
- **Firestore** `config/app.latestNativeVersion → 1.2.5` 갱신

**Capgo OTA 미수행** — AAB 승인 후 일괄 배포할 계획이라 OTA 불필요. AAB 내부에 이미 최신 웹 번들(dist/) 포함됨.

## 커밋 메시지
- `feat: 광고 점수 시스템 + Listening UX 개선 — v1.2.5 (code 24)`
- `fix: dailyProgress 날짜 키를 로컬 타임존 기준으로 통일`
