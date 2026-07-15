---
name: completed-work
description: 완료된 주요 작업 목록 — i18n, Video탭, Vocab탭, 구독시스템, UI개선, TTS개선, 전화번호 국제화, Scene태그시스템 등
type: project
---

## 완료된 작업

### i18n 다국어 지원 (2026-03-03)
- 8개 언어 locale 파일, `useT(sourceLang)` 훅, 점표기법 키

### i18n 리팩토링 — Scene + Vocab 라벨 (2026-03-10)
- 인라인 label 객체 → i18n locale 키로 이관

### Video 탭 구현 (2026-03-09)
- VOA/TED 제거 → YouTube 동영상 학습 탭
- YouTube 자막 크롤링 불가 → 메모+번역 대체

### Vocabulary 탭 구현 (2026-03-10)
- 7 카테고리 × 2 소분류 × 5 토픽, Gemini로 단어 생성

### 구독 시스템 전면 개편 (2026-03-12)
- 4개 상품: Pro 1mo/3mo, Premium 1mo/3mo
- TossPayments 빌링키 결제 + 자동갱신 cron
- 취소 = autoRenew: false (만료일까지 유지)
- 만료 리마인더 팝업 (10일/7일/2일 전)
- UpgradeModal 4카드 UI (tier 그룹별 1mo/3mo 나란히)
- AuthContext: Pro 월별 카운터 리셋, 만료 체크 로직

### i18n 완료 — Auth 모달 (2026-03-13)
- Edit Profile 모달의 모든 하드코딩 문자열 → `getT(sourceLang, 'auth.*')` 적용
- 이메일 인증, 비밀번호 변경 알림 메시지 포함

### 목표 설정 입력 UX 수정 (2026-03-13)
- 목표점수/하루목표 숫자 입력 시 지우면 즉시 기본값(80/10)으로 리셋되는 버그 수정
- `rawGoal` 상태 분리로 빈 문자열 허용, onBlur 시 기본값 복원

### 전화번호 국제화 (2026-03-13)
- `src/utils/phoneFormat.js` 신규: 10개국 포맷 (KR/US/JP/CN/VN/FR/DE/ES/GB/CA)
- 국가 선택 드롭다운 + 자동 하이픈 포맷 (Signup, Edit Profile 모달)
- Firestore 저장: `+{dialCode}{digits}` 형식, `phoneCountry` 필드 추가
- 향후 SMS 인증(Firebase Phone Auth) 대비 설계

### Azure TTS 자연스러움 개선 (2026-03-13)
- EMOTION_TO_STYLE 매핑 (33감정→Azure스타일) + AZURE_TTS_VOICE_MAP `{ voice, styles[] }` 배열 구조
- `mstts:express-as style` 적용 (en/ja/zh-CN/ko — 지원 음성만)
- `<prosody>` 태그로 문장 리듬 개선
- 오디오 품질 향상: 24khz-48kbps → 48khz-192kbps

### Scene 탭 감정/행동 태그 시스템 (2026-03-13)
- Gemini 프롬프트에 감정(Emotion) + 행동타입(Action Type) 자동 선택 설계
- 감정: Grateful, Frustrated, Confused 등 17종 / 행동: Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting 8종
- 카드 좌상단에 Action 태그(파란) + Emotion 태그(보라) 표시
- i18n: 8개 locale에 태그 번역 추가, `tTag()` 헬퍼로 locale 미등록 키 graceful fallback
- Firestore에 `selectedEmotion`, `interactionType` 필드 저장
- Library(TranslationCard)에도 태그 표시

### Scene 카드 스크롤 안정화 (2026-03-13)
- `setTimeout(150ms)` → `useEffect` + `requestAnimationFrame`으로 교체
- 카드 생성 후 DOM 렌더 완료 시점에 스크롤 실행 (간헐적 스크롤 실패 해결)
- 스크롤 위치: `block: 'start'` (카드 상단이 화면 상단에 정렬)

### Scene 프롬프트 간소화 (2026-03-13)
- Casual/Formal 스타일 가이드라인을 상세 규칙에서 간결한 방향성으로 변경
- Casual: Natural Fluency 중심 / Formal: Social Distance & Respect 중심
- scene_hint에서 인라인 감정 태그(`[😰 Hesitant]`) 제거

### Vocab 탭 발음 연습 + Learning Tip + 예문 표시 (2026-03-15)
- 서버 `/api/vocab-words` 프롬프트에 `learningTip` 배열 필드 추가 (2-3개 팁, sourceLang으로)
- VocabWordCard 서브 컴포넌트 추출 — 각 단어별 독립적 `useAudioRecorder` 사용
- 단어↔예문 발음 연습 토글 (Stats 캘린더 `‹ Label ›` 네비 스타일), `practiceMode: 'word' | 'example'`
- `activeRecIdx` 상태로 5개 카드 중 동시 녹음 1개만 허용
- 점수 ≥ targetGoal 시 BookmarkPromptModal 트리거
- `saveVocabCard` 변경: `learningTip`은 Gemini 팁 배열, `example`/`exampleTranslation`은 별도 Firestore 필드
- TranslationCard에 `example`/`exampleTranslation` prop 추가 → Library에서 vocab 카드의 EXAMPLE 섹션 표시 (Learning Tip 위)
- Library.jsx에서 TranslationCard에 `example`, `exampleTranslation` 전달
- i18n: `vocab.practiceWord`, `vocab.practiceExample` 8개 언어 추가

### Vocab 서버 프롬프트 강화 + UI 통일 (2026-03-15)
- `/api/vocab-words` 프롬프트에 Rules 9 & 10 추가: word/example 필드에 발음 표기 혼입 금지
- `examplePronunciation` 필드 추가 — 예문에도 병음/히라가나 표시
- 녹음 버튼 UI: `vocab-rec-btn` → `record-button circle` (TranslationCard/Scene 통일)
- 단어↔예문 토글: `‹ Label ›` 화살표 → LearningGauge 슬라이드 토글 (인디고 #6366f1 테마)

### BookmarkPromptModal "다시 알리지 않음" (2026-03-15)
- 체크박스 추가, localStorage `hideBookmarkPrompt` 키로 저장
- `handleBookmarkPrompt`에서 localStorage 체크 후 팝업 스킵
- i18n `daily.dontShowAgain` 8개 언어 추가

### 홈 학습 메뉴 확장 (2026-03-15)
- 동영상 학습(🎬, 빨간 #e11d48) + 단어장(📚, 시안 #0891b2) 폴더 추가
- 기존 3개(단어학습→대화연습→사전) 뒤에 배치
- 대화 연습 이모지: 🎭 → 💬 변경 (부정적 인상 제거)
- i18n: videoTitle/Desc/SubDesc, libraryTitle/Desc/SubDesc 8개 언어 추가

### 모바일 종료 토스트 크기 수정 (2026-03-15)
- `width: max-content` + `maxWidth: 85vw` 추가로 텍스트 줄바꿈 방지

### TossPayments 결제 연동 테스트 완료 (2026-03-15)
- SDK v2 API 수정: `tossPayments.billing()` → `tossPayments.payment()` (v2 breaking change)
- 테스트 API 키 설정 (.env, Vercel, Render)
- 결제 테스트 성공 확인 (응답 200, type: BILLING)

### 결제 전 이메일 인증 필수화 (2026-03-15)
- UpgradeModal: 이메일 + 핸드폰 인증 동시 체크, 한 화면에 표시
- 이메일 경고(파란색): 인증 메일 발송 버튼 + 완료 안내
- 핸드폰 경고(노란색): 기존 인증 플로우 연결
- `user.reload()`로 메일 인증 완료 후 구독 버튼 재클릭 시 자동 반영
- 서버: `admin.auth().getUser()` 이메일 인증 이중 체크
- i18n: emailRequired/emailSent 등 6개 키 × 8개 언어 추가

### Scene Phase 1 난이도 반영 프롬프트 (2026-03-15)
- Basic: 단순 감정(Grateful, Curious 등), 일상 상황, Greeting/Inquiry 선호
- Intermediate: 전체 감정, 약간의 돌발 상황, 전체 action type
- Advanced: 복잡 감정(Hesitant, Frustrated 등), 사회적 긴장/협상, Problem/Complaint 선호

### Stats/LearningGauge 실시간 갱신 (2026-03-15)
- `getDocs` → `getDocsFromServer`로 Firestore 캐시 우회
- `isActive` prop으로 탭 진입 시마다 데이터 리로드
- LearningGauge vocab 카테고리 펼치기(accordion) — 토픽별 카드 수 표시

### Settings/Sidebar 수정 (2026-03-15)
- Settings tier 표시: admin → 'Admin' 매핑 추가
- Sidebar: 이메일 주소 표시 추가

### Vocab 발음 점수 → 일일 진행률 연동 (2026-03-15)
- VocabWordCard → handleSave → saveVocabCard에 pronunciationScore 전달
- 목표 이상 점수 시 `incrementAchievement` 호출

### VocabTab activeRecIdx 버그 수정 (2026-03-15)
- 녹음/분석 완료 후 `activeRecIdx`가 null로 초기화되지 않아 다른 카드 마이크 비활성화
- useEffect로 `isRecording && isAnalyzing` 둘 다 false일 때 자동 해제

### RevenueCat REST API 연동 (2026-03-15)
- server/index.js: TossPayments 결제 성공 후 RevenueCat entitlement 자동 부여
- GET subscriber + POST promotional entitlement (Pro/Premium, monthly/three_month)
- REVENUECAT_SECRET_KEY Render 환경변수 설정 완료

### USD 결제 화면 추가 (2026-03-15)
- IP 기반 국가 감지 (`src/utils/detectCountry.js`, ipapi.co API)
- UpgradeModal: PLAN_CONFIGS_KRW / PLAN_CONFIGS_USD 분리
- USD 가격: Pro $9.99/$16.99, Premium $18.99/$49.99
- 서버: USD 금액 + currency 파라미터 처리, Firestore에 subscriptionCurrency 저장
- 인증 정책 분리: KRW → 이메일+전화 / USD → 이메일만

### Firebase ID Token 서버 인증 (2026-03-15)
- `requireAuth` 미들웨어: Bearer 토큰 → `admin.auth().verifyIdToken()` → `req.uid`
- `optionalAuth` 미들웨어: 토큰 있으면 검증, 없으면 통과 (데모/랜딩페이지용)
- `requireCronAuth` 미들웨어: X-Cron-Secret 헤더 검증
- 클라이언트: `authFetch()` 래퍼 + `getAuthHeaders()` (src/utils/authFetch.js)
- 보호 엔드포인트: azure-tts, scene-answer, toss-confirm-billing, cancel-subscription, check-phone, vocab-words, delete-account
- 비보호 엔드포인트: /analyze, /api/scene-sentence (optionalAuth — 데모용)

### 회원탈퇴 기능 (2026-03-15)
- 서버 `/api/delete-account`: 6단계 순서 삭제
  1. Firestore 사용자 정보 조회
  2. TossPayments 빌링키 폐기
  3. RevenueCat subscriber 삭제
  4. verifiedPhones 문서 삭제
  5. Firestore users 문서 + 서브컬렉션 재귀 삭제 (listCollections → batch delete) + savedCards 삭제
  6. Firebase Auth 계정 삭제
- 클라이언트: 2단계 ConfirmModal 확인 후 실행
- `accountDeletionInProgress` 플래그: onSnapshot이 삭제된 문서를 재생성하는 것 방지
- ConfirmModal 컴포넌트: 브라우저 confirm() 대체, PronunFit 브랜드 모달

### Firebase Admin SDK Render 배포 (2026-03-15)
- `FIREBASE_SERVICE_ACCOUNT_BASE64` 환경변수로 서비스 계정 JSON Base64 인코딩 전달
- Render 환경변수 설정 완료, Admin SDK 정상 초기화 확인

### 서버 모듈화 리팩토링 (2026-03-15)
- `server/index.js` 1355줄 → 40줄 엔트리포인트
- config/firebase.js, middleware/auth.js, routes/ 7개 모듈로 분리
- 기능 변경 없이 구조만 정리

### Firestore 스키마 정리 (2026-03-15)
- 레거시 `membership` 필드 제거 (5곳: App.jsx, AuthContext, Login, Signup)
- `tier` 필드로 완전 통일

### 러시아어(ru) + 브라질 포르투갈어(pt-BR) 추가 (2026-03-15)
- 8개 → 10개 언어 확장: 17개 파일 수정
- ru.json, pt-BR.json locale 파일 생성 (각 793키 전체 번역)
- 클라이언트: i18n, phoneFormat, Onboarding, Video, Vocab, Scene, TranslationCard, Landing, Legal
- 서버: analyze(Azure langMap + fallbacks), tts(SvetlanaNeural, FranciscaNeural), scene/vocab(LANG_SPECIFIC_GUIDE), video(pt-BR 채널)
- 러시아 YouTube 채널 차단(2022~) → Video 탭에서 ru 제외
- 브라질 YouTube 채널 검증 완료: Jornal O Globo, Manual do Mundo, Porta dos Fundos, CazéTV
- VocabTab visibleLanguages 필터 누락 버그 수정

### UI 개선 (2026-03-12)
- Statistics → 메인 탭으로 이동, Settings → 사이드바 전용
- 카드 스크롤: `scrollIntoView({ block: 'start' })` + `scroll-margin-top` (sticky header 아래 정렬)
- Library 스크롤: progressPopup 닫힌 후 실행되도록 수정
- PWA 아이콘: Logo_circle.png로 교체

### Capacitor 안드로이드 앱 확장 (2026-03-17)
- Capacitor 8.2.0 + Android 플랫폼 추가 (`com.arigems.pronunfit`)
- Capgo OTA 라이브 업데이트 연동 (SOLO $12/월, 첫 번들 업로드 완료)
- `@capacitor-firebase/authentication` — 네이티브 Google Sign-In (signInWithCredential)
- TTS: `requireAuth` → `optionalAuth` 변경 (랜딩 데모 지원)
- Android safe-area-inset 적용 (상단 헤더, 사이드바, 랜딩 nav)
- 앱 아이콘 + 스플래시 PronunFit 로고로 교체
- Release keystore 생성 + Firebase SHA-1 등록 (디버그 + 릴리스)
- AAB 빌드 완료 (`app-release.aab`, 12MB)
- AndroidManifest: RECORD_AUDIO, MODIFY_AUDIO_SETTINGS 권한 추가
- Service Worker: 네이티브에서 비활성화 분기

### UI 변경 (2026-03-17)
- 랜딩페이지 계정삭제 섹션: 흰 배경 → 다크 테마 통일
- UpgradeModal 결제 팝업: 전체 간격 축소, 토스페이먼츠 문구 제거
- 사이드바: 간격/폰트 축소 + Subscription USD 테스트 버튼 삭제
- "사전" → "보이스 사전" (Voice Dictionary) 리네이밍 (10개 언어)
- 홈 화면: "통계보기" 링크 추가
- Home 아이콘 strokeWidth 2.2 → 1.5
- 번역 입력창: input → textarea rows={2}
- Vocab 난이도 버튼: padding/gap 확대
- 사이드바 API 설정 Tip 제거 (Admin Settings에서만 접근)
- Vocab 프롬프트: 일본어 `おんがく (音楽)` 패턴 금지 룰 추가

### Scene 카테고리 레이블 단축 + Capgo OTA 배포 (2026-03-17)
- Android 4열 그리드(셀 폭 ~68px)에서 러시아어 등 긴 번역이 `-webkit-line-clamp: 2`에 잘리는 문제 수정
- 6개 locale 파일(ru/de/pt-BR/en/fr/es) sceneLoc·sceneSit 키 단축:
  - `X и/e/&/et Y` 패턴 → 앞 장소 하나만 유지
  - ru: transport→Транспорт, tourist→Туризм, reservation→Бронирование 등 8개
  - de: hospital→Krankenhaus, hotel→Hotel, office→Büro
  - pt-BR: problem→Problemas, reservation→Reserva, intro→Apresentação, decline→Recusar 등 8개
  - en: airport→Airport, hospital→Hospital
  - fr: hotel→Hôtel, hospital→Hôpital
  - es: hotel→Hotel, hospital→Hospital
- GitHub push (main) → Vercel 자동 배포
- Capgo OTA v0.0.1 업로드 완료 (production 채널)
  - `@capacitor-firebase/authentication` "new native plugin" 경고는 무시 가능 (AAB에 이미 포함)
  - 버전 업 필요: Capgo는 같은 버전 재업로드 불가 → package.json version bump 필수
