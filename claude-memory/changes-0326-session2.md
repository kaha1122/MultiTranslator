---
name: changes-0326-session2
description: 2026-03-26 2차 — Facebook 앱 교체, Listening 탭 신규 구현, AdMob 동적 높이, html/body CSS 근본수정, TTS 캐싱, 닉네임 보존, 러시아어 강세 letter-spacing 수정
type: project
---

# 2026-03-26 Session 2 변경 이력

## 1. Facebook 앱 교체 (새 App ID)
- **문제**: 기존 Meta Business 계정 인증 차단으로 email 고급 액세스 불가
- **해결**: 새 Facebook 앱 생성 (App ID: `2187242868692310`)
- **수정 파일**: `android/app/src/main/res/values/strings.xml` — facebook_app_id, facebook_client_token, fb_login_protocol_scheme 교체
- Firebase Console에 새 App ID/Secret 등록 완료
- **웹 테스트 성공**: email 정상 반환 (pronunfit@yahoo.com)
- **네이티브**: Meta 앱 검수 대기 → **email + public_profile 모두 Approved** (같은 날 승인)
- 라이브 전환: 테스트 지침 입력 후 시도 중 (네임스페이스: pronunfit, 앱 도메인: pronunfit.com 등록)

## 2. Listening 탭 신규 구현 (핵심 기능)

### 서버
- **`server/config/langGuide.js`** (신규): LANG_NAMES, LANG_SPECIFIC_GUIDE, getDifficultyDesc를 vocab.js/scene.js에서 추출하여 공유 모듈화
- **`server/routes/listening.js`** (신규): `POST /api/listening-passage` — 에세이/대화 지문 생성 + 핵심 단어 5개
- `server/routes/vocab.js`: LANG_NAMES/GUIDE → langGuide.js에서 import
- `server/routes/scene.js`: LANG_NAMES/GUIDE/getDifficultyDesc → langGuide.js에서 import
- `server/index.js`: listening 라우트 등록

### 클라이언트
- **`src/components/ListeningTab.jsx`** (신규): 메인 컴포넌트
  - 카테고리 선택: Library 스타일 Bottom Sheet (VocabTab 아코디언 X)
  - 에세이/대화 토글: 슬라이드 토글 (초록=에세이, 보라=대화)
  - 지문 카드: 제목+번역, TTS 듣기 버튼, 발음/번역 접기/펼치기
  - 핵심 단어 5개: VocabWordCard 재사용 (TTS + 발음연습 + 저장)
  - 대화형 TTS: A:/B: 레이블 제거 (cleanDialogueForTTS 함수)
- **`src/components/ListeningTab.css`** (신규): 스타일
- `src/components/VocabTab.jsx`: VocabWordCard를 named export로 변경
- `src/App.jsx`: TAB_ORDER에 listening 추가, 사이드바 Headphones 아이콘, ListeningTab 렌더링
- `src/components/HomePage.jsx`: 홈 화면에 🎧 듣기 연습 폴더 추가 (보라색 #7c3aed 테마)
- `src/locales/*.json` (10개): nav.listening, listening.* (12키), library.srcListening, home.listeningTitle/Desc/SubDesc

### TAB 순서
```
['home', 'scene', 'translation', 'vocab', 'listening', 'library', 'video', 'stats']
```

### Firestore
- `users/{uid}/listeningHistory/{topicId--type--level--lang}`: 생성 이력 (titles 배열)

### 프롬프트 설계
- 에세이: 5~10문장 coherent essay, 난이도별 길이 (basic 30-50 / inter 50-80 / adv 80-120 단어)
- 대화: 6~10턴 A/B 대화, 자연스러운 turn-taking
- 핵심 단어 5개: 지문에서 추출, 별도 예문 제공
- LANG_SPECIFIC_GUIDE 재사용, 러시아어 강세 규칙 포함
- temperature: 1.3 (Scene과 동일)
- sourceLang 번역 강제: CRITICAL 규칙 추가 (Gemini가 targetLang으로 번역하는 문제 방지)

## 3. AdMob 배너 높이 동적 반영
- **문제**: BANNER_HEIGHT=50px 하드코딩 → ADAPTIVE_BANNER가 더 높아서 콘텐츠 가림
- **수정** (`src/hooks/useAdMob.js`):
  - DEFAULT_BANNER_HEIGHT: 50→60px
  - `BannerAdPluginEvents.SizeChanged` 리스너 추가 → 실제 배너 높이로 `--admob-bottom` 동적 설정
  - `Loaded` 이벤트는 SizeChanged 미도착 시 폴백

## 4. 사이드바 CSS 복원
- **문제**: 오늘 아침 `sidebar { bottom: var(--admob-bottom) }` 변경 → 사이드바 콘텐츠 잘림
- **수정**: `bottom: 0` + `padding-bottom: var(--admob-bottom)` 원복 (스크롤 가능하면서 광고 위 여백 확보)

## 5. html/body CSS 근본 수정 (레이아웃 폭 깨짐)
- **근본 원인**: 오늘 아침 `body` → `html, body`로 변경 → `html`에 `display: flex; justify-content: center`가 적용 → viewport 계산 깨짐 → Scene/Translation/Listening/Stats 탭에서 콘텐츠 폭 축소 + 회색 바 발생
- **영향**: 웹 + 네이티브(OTA 1.3.87) 모두 동일 증상
- **수정**: `html, body` → `body`로 원복. `overflow-x: hidden`은 `body`에만 적용
- **교훈**: `html` 태그에 `display: flex` 등 레이아웃 속성 절대 적용 금지

## 6. box-sizing: border-box 추가
- 그린 테두리(2px) 추가된 요소 중 box-sizing 누락 3곳:
  - `.library-card-wrapper` (App.css)
  - `.vocab-word-card` (VocabTab.css)
  - `.listening-passage-card` (ListeningTab.css)
- 전역 `* { box-sizing: border-box }` 존재하므로 실제 영향 미미 (방어적 추가)

## 7. TTS 음성 캐싱 (비용 절감)
- **목적**: Listening 지문 반복 듣기 시 Azure TTS 비용 절감
- **구현** (`src/App.jsx` handleSpeak):
  - `ttsCacheRef` (Map): `langCode:emotion:text` 키로 Blob URL 캐시
  - 캐시 히트 → 서버 호출 없이 즉시 재생
  - LRU 방식 최대 30항목, 초과 시 가장 오래된 항목 revokeObjectURL
  - 모든 탭에 자동 적용 (Listening뿐 아니라 단어/예문 TTS도)
  - 페이지 새로고침 시 캐시 초기화

### 비용 분석
- 고급 지문(~700자) 1회: $0.011
- 캐싱 적용 시 10번 반복 → 비용 1회분만 ($0.011)

## 8. 익명→실계정 전환 시 닉네임 보존
- **문제**: 익명 유저가 설정한 닉네임이 Google/Facebook 전환 시 "Google User"로 덮어씌워짐
- **수정 5곳**:
  - `AuthContext.jsx` upgradeAnonymous: `profile?.displayName` 우선
  - `AuthContext.jsx` onSnapshot 자동생성: 'Google User' → 'User'
  - `AccountUpgradeModal.jsx` migrateAndSignIn: `profile?.displayName` 우선
  - `AccountUpgradeModal.jsx` Google linkWithPopup: `profile?.displayName` 우선
  - `AccountUpgradeModal.jsx` Facebook linkWithPopup: `profile?.displayName` 우선
- **우선순위**: 기존 닉네임 → provider 이름 → 이메일 앞부분 → 'User'

## 9. 러시아어 강세 letter-spacing 수정
- **문제**: Scene 탭 발음 텍스트의 강세 마크(U+0301)가 모음 오른쪽으로 치우침
- **원인**: `.scene-card-pronunciation { letter-spacing: 0.03em }` — combining accent가 글자 간격에 밀려남
- **수정**: letter-spacing 제거 → 강세가 정확히 모음 위에 표시
- 다른 탭(Vocab, Listening, Translation)은 letter-spacing 없어 정상이었음

## 버전 이력
| 버전 | 내용 |
|------|------|
| v1.3.87 | 카드 그린 테두리 + html,body 변경 (문제 발생) |
| v1.3.88 | Listening 탭 + AdMob 동적 높이 + 사이드바 복원 |
| v1.3.89 | html→body CSS 근본 수정 + Capgo production 배포 |
| v1.3.89+ | TTS 캐싱, 닉네임 보존, 러시아어 강세, 홈 듣기폴더 |
| AAB v1.1.11 (code 15) | Facebook 새 App ID (strings.xml) |

## 배포 현황
| 플랫폼 | 상태 |
|--------|------|
| Vercel staging | ✅ |
| Vercel production | ✅ |
| Render 서버 | ✅ (listening.js 포함) |
| Capgo production | ✅ v1.3.89 |
| AAB v1.1.11 | ✅ 빌드 완료 (Play Console 업로드 대기) |
