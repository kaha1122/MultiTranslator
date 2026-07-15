---
name: appstore-readiness
description: 앱스토어 출시 요건 체크리스트 — 개인정보처리방침, Apple Sign In, 앱 아이콘, Capacitor 래핑 계획
type: project
---

## 앱스토어 출시 체크리스트 (2026-03-15 기준)

| 항목 | 상태 | 비고 |
|------|------|------|
| 개인정보처리방침 | ✅ 완료 | 8개 언어, LegalPages.jsx, 랜딩+Settings 접근 |
| Apple Sign In | ❌ 미구현 | Apple Developer 계정 등록 후 구현 예정 |
| 앱 아이콘 | ✅ 완료 | 32~512px 7종, apple-touch-icon 180px |
| PWA 설정 | ✅ 완료 | manifest.json, sw.js, theme-color |
| Capacitor 래핑 | ❌ 미착수 | iOS/Android 네이티브 앱 빌드 필요 |

## Apple Sign In 구현 계획
- Apple Developer 계정 등록 ($99/년) → Service ID 생성
- Firebase Console → Authentication → Apple 활성화
- 코드: `firebase/config.js`에 `OAuthProvider('apple.com')` + Login/Signup에 버튼 추가
- 작업량: 코드 10분 수준, 설정이 메인

## 현재 배포 형태
- **PWA**: Vercel 배포, 브라우저 "홈 화면에 추가"로 설치
- **목표**: Google Play + iOS App Store 동시 출시 (Capacitor 래핑)
