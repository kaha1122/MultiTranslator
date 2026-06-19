---
name: changes-0328-session2
description: 2026-03-28 2차 세션 — UI개선, 가격인하, 동영상Back, TossWebhook, 결제팝업, 메타태그
type: project
---

# 2026-03-28 2차 세션 변경사항 (v1.3.91 → v1.3.93)

## 1. 사이드바 Pro/Premium 버튼 레이아웃 개선
- 기존: 2열(이모지 | 텍스트+뱃지) → 뱃지가 별도 열로 보기 불편
- 변경: 1열 2행 구조
  - 1행: `🌟 Pro` 좌측 + `광고 없음` 뱃지 우측 정렬
  - 2행: 설명 텍스트 (자연스럽게 줄바꿈)
- Premium 버튼의 `광고 없음` 하드코딩 → `getT(sourceLang, 'subscription.noAds')` i18n 적용
- **파일**: `src/App.jsx`

## 2. 헤더 홈 아이콘 변경
- lucide `<Home>` 아이콘 → 커스텀 SVG (심플한 집 모양: 지붕+벽체, 굴뚝/문 없음)
- 색상: `#1e293b` → `#000000` (완전 검정)
- **파일**: `src/App.jsx`, `src/App.css`

## 3. 동영상 상세뷰 Back 버튼 + 영상 자동정지
- **웹앱 상단 Back 버튼**: 동영상 상세뷰(selected) 열려있을 때 헤더에 "Back" 버튼 표시
- **네이티브 back 키**: 동영상 상세뷰 → 목록 복귀 우선 처리 (기존: viewModeHistory 기반으로 이전 탭 이동 → 잘못된 동작)
- **영상 자동정지**: Back 시 `setSelected(null)` → iframe DOM 제거로 영상 자동 중지
- VideoReader를 `forwardRef` + `useImperativeHandle`로 외부 제어 가능하게 변경
- `onDetailChange` 콜백으로 App.jsx에 상세뷰 열림 상태 전달
- **파일**: `src/components/VideoReader.jsx`, `src/App.jsx`

## 4. 동영상 메모 textarea 크기 축소
- `min-height: 140px` → `112px` (20% 축소)
- **파일**: `src/components/VideoReader.css`

## 5. 구독 가격 대폭 인하
### 클라이언트 (UpgradeModal.jsx)
| 플랜 | 기간 | KRW (변경전→후) | USD (변경전→후) |
|------|------|----------------|----------------|
| Pro | 1개월 | ₩9,900→₩4,990 | $9.99→$3.49 |
| Pro | 3개월 | ₩16,500→₩11,990 | $16.99→$7.99 |
| Premium | 1개월 | ₩19,900→₩14,990 | $18.99→$9.99 |
| Premium | 3개월 | ₩55,000→₩35,000 | $49.99→$24.99 |

### 서버 (subscription.js) — 실제 결제 금액
- `/api/toss-confirm-billing` 내 AMOUNTS 테이블 동기화
- `/api/cron/renew-subscriptions` 내 AMOUNTS 테이블 동기화
- **주의**: 클라이언트만 수정하면 표시 가격과 실제 청구 금액 불일치 발생 (실제 버그 발생 후 수정)

## 6. Facebook 로그인 버튼 디자인 변경
- 기존: 파란 배경(`#1877F2`) + 흰 글씨 + 흰 로고 → Facebook으로만 유도하는 느낌
- 변경: 흰 배경 + 테두리(`#e2e8f0`) + 검정 글씨 + 파란 로고만(`fill="#1877F2"`)
- Google 버튼과 동일한 톤으로 통일
- **3곳 수정**: `Login.jsx`, `Signup.jsx`, `AccountUpgradeModal.jsx`

## 7. TossPayments Webhook 구현
- **엔드포인트**: `POST /api/toss-webhook`
- 토스 대시보드 실제 이벤트 타입 기준:
  - `PAYMENT_STATUS_CHANGED`: status별 분기
    - `CANCELED` → 전액 환불: tier→trial, 빌링키 폐기, 구독 필드 초기화
    - `PARTIAL_CANCELED` → 부분 환불: tier 유지, 사유/금액 로그
    - `DONE` → 로그만 (confirm-billing에서 이미 처리)
    - `ABORTED`/`EXPIRED` → 로그
  - `CANCEL_STATUS_CHANGED`: 취소 상태 로그
  - `BILLING_DELETED`: autoRenew=false, tossBillingKey 제거
- HMAC-SHA256 서명 검증 (TOSS_WEBHOOK_SECRET 환경변수, 미설정 시 skip)
- 토스 대시보드 등록: `https://multitranslator.onrender.com/api/toss-webhook`
  - 이벤트: PAYMENT_STATUS_CHANGED, CANCEL_STATUS_CHANGED, BILLING_DELETED
- **파일**: `server/routes/webhook.js`

## 8. 토스 결제 성공 팝업 모달
- 기존: 하단 토스트 4초 자동 사라짐
- 변경: 팝업 모달 (Pro🌟/Premium👑 아이콘 + "결제가 완료되었습니다!" + "구독해 주셔서 감사합니다.")
- 확인 버튼 클릭 → `window.location.reload()` (새로고침 후 tier 반영)
- 실패 시에만 기존 하단 토스트 유지
- `upgrade.thankYou` i18n 10개 언어 추가
- **파일**: `src/App.jsx`, `src/locales/*.json`

## 9. 메타태그 업데이트
- `name="description"` + `og:description`: "10개국어 발음 코치 스마트 단어장"으로 변경
- `<title>` + `og:title`: "PronunFit - AI 발음 코치 스마트 단어장 | Smart Pronunciation Learning App with AI"
- **파일**: `index.html`

## 버전
- 웹: v1.3.91 → **v1.3.93**
- 배포: Vercel(main+staging), Capgo(production), Render(서버 자동배포)
