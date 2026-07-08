---
name: ui-changes-0317
description: 2026-03-17 UI 변경사항 — 랜딩페이지 계정삭제 스타일, 결제팝업 축소, 사이드바 축소, Voice Dictionary 리네이밍 등
type: project
---

## UI 변경사항 (2026-03-17)

### 랜딩페이지 계정삭제 섹션 다크 테마
- 기존: 흰 배경(`#f9f9f9`) — 랜딩페이지 어두운 톤과 불일치
- 변경: 투명 배경 + `rgba(255,255,255,0.3~0.4)` 텍스트 — footer와 동일 톤
- `#delete-info` 앵커 유지 (Google Play 심사용)
- CSS: `.lp-delete-info`, `.lp-delete-info-title`, `.lp-delete-info-desc`

### UpgradeModal (결제 팝업) 컴팩트화
- 전체 padding, 폰트, 간격 축소 → 한 페이지에 들어오도록
- 토스페이먼츠 문구 제거: 10개 locale의 `footerNote`에서 TossPayments/토스페이먼츠 삭제
- 사이드바 "Subscription (USD)" 테스트 버튼 삭제
- `forceUSD` prop/state 완전 제거 — IP 기반 자동 감지만 사용

### 사이드바 컴팩트화
- 헤더, 유저정보, 네비 아이템, 서브메뉴, 구분선, 법률 링크, 푸터 전체 간격/폰트 축소

### Voice Dictionary 리네이밍
- "사전" → "보이스 사전" (Voice Dictionary)으로 변경
- 변경된 i18n 키 (10개 언어): `nav.translation`, `home.translationTitle/Desc/SubDesc`, `library.srcTranslation`, `nav.backTo_translation`
- USP: 발음 연습 + 저장 기능 강조

### 홈 화면 통계보기 링크
- "이번 주 학습 통계" 제목 옆 오른쪽에 "통계보기" 밑줄 링크 추가
- `onNavigate('stats')` → Stats 탭 이동
- i18n: `home.viewStats` 10개 언어 추가

### Home 아이콘 strokeWidth
- `strokeWidth` 2.2 → 1.5 (가는 선)

### 번역 입력창
- `input` → `textarea rows={2}` 변경 — placeholder 2줄 표시
- 번역 기능 영향 없음 (inputText 문자열 동일)

### Vocab 난이도 버튼
- padding 4px → 7px, 폰트 0.68rem → 0.75rem
- 좌우 margin 12px, gap 8px — 버튼 간격 확보

### API 설정 Tip 사이드바 제거
- 앱 공개 시 노출 안되도록 제거
- Admin 전용 API 키 설정은 Settings에서만 접근 가능

### Vocab 프롬프트 일본어 수정
- Rule 9 Bad 예시에 `おんがく (音楽)` 추가
- 일본어 word 필드: 표준 표기(한자) 사용, 히라가나는 pronunciation 필드에만
