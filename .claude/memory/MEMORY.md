# PronunFit (multi-translator) 프로젝트 메모리

## 앱 개요
- **앱명**: PronunFit (구 MultiTranslator)
- **배포**: https://multi-translator-seven.vercel.app
- **GitHub**: https://github.com/kaha1122/MultiTranslator
- **기술스택**: React 19 + Vite, Firebase (Auth/Firestore/Storage), Framer Motion
- **백엔드**: Node.js + Express (`server/index.js`), Render 배포
- **번역엔진**: Gemini 2.0 Flash (App.jsx에서 직접 호출)

## 메모리 파일 인덱스
- [architecture.md](architecture.md) — 아키텍처, 탭 구성, 서버 엔드포인트, Gemini 설정, TTS 감정매핑, 컴포넌트/훅 목록
- [subscription.md](subscription.md) — 구독/결제 시스템 (TossPayments, RevenueCat, USD 결제, 자동갱신 cron, 취소/만료)
- [tier-system.md](tier-system.md) — 등급 체계 및 비즈니스 모델 (Trial/Admin/Pro/Premium)
- [completed-work.md](completed-work.md) — 완료된 주요 작업 목록
- [design-decisions.md](design-decisions.md) — 주요 설계 결정 (번역엔진, TTS감정매핑, Scene 3Phase, soft delete 등)
- [bug-patterns.md](bug-patterns.md) — 재발 방지용 버그 패턴 (TDZ, padding, 스크롤, i18n fallback, onSnapshot 재생성 등)
- [lang-specific-guide.md](lang-specific-guide.md) — 10개 언어별 문법/어휘 특성 가이드 (LANG_SPECIFIC_GUIDE)
- [firestore-schema.md](firestore-schema.md) — Firestore 스키마 확정 (users, savedCards, verifiedPhones, 서브컬렉션)
- [appstore-readiness.md](appstore-readiness.md) — 앱스토어 출시 요건 체크리스트
- [language-expansion.md](language-expansion.md) — 러시아어(ru)/브라질 포르투갈어(pt-BR) 추가 작업 상세
- [capacitor-android.md](capacitor-android.md) — Capacitor + Capgo 안드로이드 앱 확장, 네이티브 Google Sign-In, TTS 호환, AAB 빌드, 트러블슈팅
- [ui-changes-0317.md](ui-changes-0317.md) — 2026-03-17 UI 변경 (계정삭제 다크테마, 결제팝업 축소, Voice Dictionary, 사이드바 축소 등)
