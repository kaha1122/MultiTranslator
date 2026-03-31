---
name: design-decisions
description: 주요 설계 결정 — 번역엔진, 음성저장, BYOK, TossPayments, TTS감정매핑, Library soft delete 등
type: project
---

## 주요 설계 결정

- **번역 엔진**: MyMemory API → Gemini 2.0 Flash로 전환. 번역 + 학습팁 + 발음가이드 + 난이도 분류를 한 번의 API 호출로 처리 (App.jsx `handleTranslate`)
- **음성 저장**: OPFS/Firebase Storage 없이 메모리(Blob URL)만 사용
- **BYOK**: Azure + Gemini 2개 키 동시 등록 시 전환 (tier를 'admin'으로 설정, 개발자 전용)
- **ElevenLabs**: 실질 미작동으로 제거
- **Free Trial 만료 모달**: UpgradeModal로만 연결 (BYOK 선택지 제거)
- **BYOK 사용자**: 서버 불필요 (브라우저 직접 Azure SDK 호출)
- **VOA 제거**: 더 이상 업데이트되지 않음
- **TED 제거**: 저작권 문제로 스크립트 활용 불가
- **YouTube 자막 포기**: 클라우드 IP 봇 감지 차단 + 저작권 → 메모+번역으로 대체
- **YouTube 피드**: 8언어 × 4카테고리(news/culture/entertainment/sports) 큐레이션 채널, 일일 캐시
- **TossPayments 선택 이유**: Stripe과 달리 자동 구독 스케줄링 없음 → 개발자가 cron으로 관리해야 함
- **구독 결제 전 이메일+전화번호 인증 필수**: 이메일(`emailVerified` from Firebase Auth) + 전화번호(`phoneVerified` from Firestore) 두 가지 모두 체크. 프론트+서버 이중 검증
- **이메일 인증 상태 갱신**: `user.reload()`로 Firebase Auth 토큰 갱신 → React state 반영 (onAuthStateChanged는 reload로 트리거 안됨)
- **TossPayments SDK v2**: `tossPayments.payment({customerKey})` 사용 (`billing()`은 v1 API, v2에서 동작 안함)
- **구독 취소 정책**: 즉시 다운그레이드 아님, 만료일까지 서비스 유지 후 trial 전환
- **3개월 플랜**: 일시불이 아닌 자동 갱신 (같은 가격에 3개월 추가 연장)
- **Premium 광고**: 광고 제거 미구현, 모든 tier에서 광고 유지
- **전화번호 저장 형식**: `+{dialCode}{rawDigits}` (예: +821012345678), `phoneCountry` 코드 별도 저장 — 향후 SMS 인증 대비
- **Azure TTS 감정 매핑**: EMOTION_TO_STYLE (33감정→Azure스타일), AZURE_TTS_VOICE_MAP `{ voice, styles[] }` 배열 구조. en/ja/zh-CN/ko만 스타일 지원, vi/fr/de/es는 prosody만 적용
- **Scene 태그 i18n 방식**: 서버(Gemini)는 영문 키 반환 → 클라이언트에서 locale 파일로 번역. `tTag()` 헬퍼로 locale에 키가 없으면 영문 값 그대로 fallback
- **Action Type 8분류**: Inquiry, Request, Observation, Opinion, Problem, Complaint, Social, Greeting
- **Scene 3 Phase 프롬프트**: Phase1(감정12종 선택) → Phase2(micro-situation + action type 설계) → Phase3(난이도+스타일 적용). anti-duplication: 최근10개 명시 회피
- **Library soft delete**: 카드 삭제 시 `isDeleted: true` 플래그 (히스토리 추적용, 실제 삭제 아님)
- **BookmarkPromptModal**: 발음 목표 점수 달성 + 미저장 카드일 때 자동 저장 제안
- **발음평가 prosody fallback**: Azure prosody 미지원 시 `(fluency+accuracy)/2`로 대체, 가중 재계산
- **결제 통화 결정**: `sourceLang`이 아닌 IP 기반 국가 감지 (`ipapi.co`) — sourceLang은 학습 언어 설정이지 국적/거주지가 아님. 한국 IP → KRW, 그 외 → USD
- **RevenueCat 역할**: 결제 PG가 아닌 구독 권한(entitlement) 관리 계층. TossPayments가 결제 처리, RevenueCat이 Pro/Premium 권한 관리. 향후 Android(Google Play) + Web 통합 관리 목적
- **USD 전화인증 면제**: 전화번호 인증은 한국 규제 사항이므로 USD 결제(해외 사용자)에는 불필요. 이메일 인증만 요구
- **서버 인증 3단계**: requireAuth(필수), optionalAuth(데모 허용), requireCronAuth(cron 전용). 로컬 개발 시 Firebase Admin 미초기화 → `dev-user` fallback
- **회원탈퇴 6단계 순서**: Firestore조회 → Toss빌링키폐기 → RevenueCat삭제 → verifiedPhones삭제 → Firestore재귀삭제(서브컬렉션+savedCards+메인) → Auth삭제. 부분 실패 허용(errors 배열 반환)
- **ConfirmModal**: 브라우저 confirm()은 도메인명을 표시하여 브랜딩 불가 → 커스텀 모달로 교체. danger prop으로 빨간/초록 테마 전환
- **서버 모듈화**: 1355줄 monolith → config/middleware/routes 분리. Firebase Admin 초기화는 `config/firebase.js`에서 한 번만 실행, 다른 모듈에서 `{ admin, adminDb }` import
- **Apple Sign In**: iOS 앱스토어 출시 시 필수 (Google OAuth 있으므로). Apple Developer 계정($99/년) 등록 후 구현 예정. 코드 작업은 간단(firebase OAuthProvider)
- **앱 배포 형태**: 현재 PWA, 앱스토어 출시 시 Capacitor 래핑 예정
