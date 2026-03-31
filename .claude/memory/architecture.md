---
name: architecture
description: PronunFit 앱 아키텍처 — 프론트/백엔드 구조, 인증, API 파이프라인, 탭 구성, 서버 엔드포인트
type: project
---

## 아키텍처
- **프론트**: `src/` — React 19 SPA (Vite), Framer Motion 애니메이션, Lucide React 아이콘
- **백엔드**: `server/` — Express, 모듈화 구조 (2026-03-15 리팩토링)
  - `index.js` — 슬림 엔트리포인트 (40줄)
  - `config/firebase.js` — Firebase Admin 초기화
  - `middleware/auth.js` — requireAuth, optionalAuth, requireCronAuth
  - `routes/analyze.js` — 발음 분석 + Gemini 코칭
  - `routes/video.js` — YouTube 비디오 피드
  - `routes/tts.js` — Azure Neural TTS
  - `routes/scene.js` — Scene 문장/응답 생성
  - `routes/subscription.js` — TossPayments 결제/취소/cron
  - `routes/account.js` — 회원탈퇴 + 전화번호 체크
  - `routes/vocab.js` — 단어장 생성
- **인증**: Firebase Auth + Firestore `users/{uid}` 문서 실시간 구독 (AuthContext)
- **서버 인증**: Firebase ID Token 기반 (requireAuth/optionalAuth 미들웨어)
- **번역**: Gemini 2.0 Flash 직접 호출 (App.jsx `handleTranslate`) — 번역 + 학습팁 + 발음가이드 + 난이도 분류 일괄 처리
- **발음평가 파이프라인**: 브라우저 녹음(useAudioRecorder) → ffmpeg WAV변환(서버) → Azure SDK → Gemini 코칭팁
- **TTS**: Azure Neural TTS (`/api/azure-tts`), EMOTION_TO_STYLE 매핑(33감정→Azure스타일) + prosody SSML, 48khz-192kbps
- **전화번호**: `src/utils/phoneFormat.js` — 12개국 포맷/파싱 (RU, BR 추가), Signup + Edit Profile에서 사용
- **효과음**: `src/utils/soundEffects.js` — 성공/별/스와이프/경고 4종

## 탭 구성 (2026-03-15 기준)
- TAB_ORDER: `['home', 'scene', 'vocab', 'translation', 'library', 'video', 'stats']`
- **home**: 주간 목표 별, 오늘 진행률 게이지, 학습 메뉴 5폴더(단어학습/대화연습/사전/동영상/단어장) CTA, 주간/월간 통계
- Settings는 사이드바에서만 접근 (메인 탭 아님)

## 서버 엔드포인트 (12개, 모듈별 분리)
| 엔드포인트 | 메서드 | 용도 |
|------------|--------|------|
| `/analyze` | POST | 발음 평가 (오디오→WAV→Azure→Gemini 코칭팁) |
| `/api/azure-tts` | POST | TTS (SSML + 감정 스타일 + prosody) |
| `/api/scene-sentence` | POST | Scene 시작 문장 생성 (3 Phase 프롬프트) |
| `/api/scene-answer` | POST | Scene 응답 문장 생성 (상대방 대사) |
| `/api/vocab-words` | POST | Vocab 단어 5개 생성 (learningTip 배열 포함) |
| `/api/video-feed` | GET | 언어+카테고리별 YouTube 피드 (일일 캐시) |
| `/api/toss-confirm-billing` | POST | TossPayments 빌링키 발급 + 첫 결제 |
| `/api/cancel-subscription` | POST | 자동갱신 중지 (autoRenew: false) |
| `/api/check-phone` | POST | 전화번호 중복 확인 |
| `/api/cron/renew-subscriptions` | POST | 구독 자동갱신 cron |
| `/api/delete-account` | POST | 회원탈퇴 (Toss빌링키폐기+RevenueCat삭제+Firestore서브컬렉션재귀삭제+Auth삭제) |
| `/ping` | GET | 서버 warm-up (Render cold start 대비) |

## Gemini 설정
- 모델: `gemini-2.0-flash` (전 엔드포인트 동일)
- Scene: temperature 1.3, topK 64, topP 0.95
- Vocab: temperature 1.5, topK 64, topP 0.95
- 코칭팁: 기본 설정

## TTS 감정 매핑 (EMOTION_TO_STYLE, 33감정)
- AZURE_TTS_VOICE_MAP: `{ voice, styles[] }` 구조 (배열)
- en: 8스타일, ko: 5스타일, zh-CN: 10스타일, ja: 1스타일(chat), vi/fr/de/es/ru/pt-BR: 스타일 없음(prosody만)
- Scene 카드의 emotion → EMOTION_TO_STYLE로 Azure 스타일 자동 변환

## 발음평가 Prosody Fallback
- Azure prosody 미지원 언어: `displayProsody = (fluency + accuracy) / 2`
- 재계산: `accuracy*0.4 + completeness*0.2 + fluency*0.2 + displayProsody*0.2`
- `azureLangMap`에 vi 없음 — 베트남어 발음평가 미지원

## 주요 컴포넌트
- **HomePage.jsx**: 홈 대시보드 (주간별, 진행률, 폴더, 통계)
- **BookmarkPromptModal.jsx**: 발음 목표 달성 시 저장 제안 ("다시 알리지 않음" 체크 → localStorage)
- **TabTutorial.jsx**: 각 탭 첫 방문 튜토리얼 오버레이
- **SplashScreen.jsx**: 앱 시작 2.3초 로딩
- **LearningGauge.jsx**: 진행률 게이지 시각화
- **LegalPages.jsx**: 개인정보처리방침, 이용약관, 문의

## Custom Hooks
- `useAudioRecorder.js` — 마이크 녹음 관리
- `useDailyProgress.js` — 일일/주간 진행률, `incrementAchievement(key)`
- `useWeeklyCardStats.js` — 주간 카드 통계

## VocabTab 구조 (2026-03-15)
- VocabWordCard 서브 컴포넌트: 각 단어별 독립 `useAudioRecorder`
- 단어↔예문 발음 연습: LearningGauge 슬라이드 토글 (`practiceMode: 'word' | 'example'`)
- `activeRecIdx`로 동시 녹음 1개 제한
- 녹음 버튼: `record-button circle` 클래스 (TranslationCard/Scene과 동일)
- Gemini 생성 `learningTip` 배열 + `examplePronunciation`(예문 병음/히라가나) 표시
- Firestore 저장: `learningTip`(팁배열) + `example`/`exampleTranslation`(별도 필드)
- 서버 프롬프트: word/example 필드 순수 텍스트 강제 (Rules 9 & 10)

## Library 패턴
- Firestore `savedCards` 컬렉션, `onSnapshot` 실시간 동기화
- Soft delete: `isDeleted: true` 플래그 (히스토리 보존)
- 필터: 언어, W/S, 소스(translation/scene/vocab), 난이도, 별표, 이번주, 텍스트 검색
- Vocab 카드: EXAMPLE 섹션(예문+번역) → Learning Tip 위에 별도 표시 (`card.example`, `card.exampleTranslation`)

## i18n
- `src/locales/` — 10개 언어 JSON (ko/en/ja/zh-CN/vi/fr/de/es/ru/pt-BR)
- `src/utils/i18n.js` — `useT(sourceLang)` 훅 + `getT(langCode, key)` 함수 + `tTag()` 헬퍼
- `pt` → `pt-BR` 자동 매핑 (zh → zh-CN과 동일 패턴)
- UI 언어 결정: `sourceLang` 상태값 기준
