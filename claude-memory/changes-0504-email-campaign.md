---
name: 2026-05-04 첫 이메일 캠페인 (VN lapsed, Free Talk 출시)
description: 푸시 retention 0% 발견 → 이메일 채널 분석 → Resend 도입 → 베트남어 Free Talk 캠페인 106명 발송
type: project
originSessionId: c6698add-4a6d-4a17-9a62-7d4c04af08b6
---
# Free Talk Email Campaign (2026-05-04)

## 배경 — 푸시 retention 0%가 이메일 채널로 이끔

5/4 12시(KST) D3 cron VN/TH/ID/KH/LA 142명 발송 후 **`returnedActive: 0/231` (실제 복귀 0명)** 진단 결과.
- `noResponse: 229명` 이 마지막 활동(`updatedAt`)이 4/15~4/30 — **백필 이전부터 앱 안 들어옴**
- 즉 발송 대상이 audience 문제 (delivery는 부분 작동, audience는 lapsed phantom)
- **결론**: 푸시 채널 한계 명확. 다른 채널(이메일/SMS) 필요.

## 도달 채널 inventory (VN 기준)

진단 endpoint `/api/cron/lapsed-reach-inventory` 결과:

| 카테고리 | 수 | % |
|---|---:|---:|
| VN 전체 | 607 | 100% |
| **lapsed (3+일 미접속)** | **518** | **85.3%** ⚠️ |
| 그 중 email 보유 | 106 | 20.5% (lapsed 기준) |
| 그 중 phone 보유 | 2 | 0.4% (무의미) |
| 그 중 fcmTokens 보유 | 158 | 30.5% (푸시 시도 가능, 1.5% 효과) |
| **어떤 채널도 없음 (unreachable)** | **296** | **57.1%** |

→ **이메일이 사실상 푸시보다 더 큰 reachable 채널**. 베트남 시장 85%가 lapsed라는 사실 자체가 충격적.

## 결정사항

| 항목 | 결정 |
|---|---|
| 채널 | **Resend** (개발자 친화 + 무료 3K/월 + 베트남어 SPF/DKIM OK) |
| Region | Tokyo (`ap-northeast-1`) — 베트남 발송 latency 최소 |
| 도메인 | `pronunfit.com` (Verified) |
| From | `PronunFit System Administrator <systemadmin@pronunfit.com>` |
| Reply-To | `systemadmin@pronunfit.com` (실 수신 가능, 사용자 피드백 채널) |
| CTA | **Play Store URL 단일** — `https://play.google.com/store/apps/details?id=com.arigems.pronunfit` |
| Hook | **Free Talk 출시** (이전 retention push와 차별화된 새 콘텐츠 promotion) |
| Privacy compliance | Privacy Policy 기존 covers + unsubscribe link 포함 + service announcement framing |
| 1차 타겟 | **VN lapsed + email 보유 = 106명** |

## 신규 코드

### 파일
- 추가: `server/utils/sendEmail.js` (Resend 래퍼 + 베트남어 HTML/text 템플릿 + HMAC unsub 토큰)
- 수정: `server/routes/reengagement.js` — 신규 endpoint 2개 추가
- 추가: `public/email-assets/free-talk-vn.jpg` (303KB — 베트남어 Shinkansen Free Talk UI 스크린샷)

### Endpoints
| Endpoint | 용도 | 모드 |
|---|---|---|
| `POST /api/cron/send-free-talk-email` | VN lapsed 캠페인 발송 | dryRun / onlyEmail / lapsedDays / limit / country |
| `GET /api/unsubscribe-email?uid=X&t=Y` | HMAC 검증 후 emailOptOut 마킹 + 베트남어 사과 페이지 | - |

### Firestore 신규 필드
- `users/{uid}.freeTalkEmailSentAt: Timestamp` — idempotency
- `users/{uid}.freeTalkEmailMessageId: string` — Resend message ID
- `users/{uid}.emailOptOut: boolean` — 수신거부 플래그
- `users/{uid}.emailOptOutAt: Timestamp` — 수신거부 시각

### 환경변수 (Render)
- `RESEND_API_KEY` — Resend API 키 (server-side only)
- `UNSUBSCRIBE_SECRET` — (선택) HMAC 토큰 검증용. 미설정 시 token 검증 우회

## 베트남어 카피 (A1)

**Subject**: `🎙️ Free Talk: trò chuyện thật với AI ngay trong PronunFit`

**Body 핵심**:
- "Free Talk đã ra mắt!" + "Tính năng mới — luyện nói tự do với AI trong tình huống thực tế"
- 4가지 특징: 자연 대화 / 실제 상황 / 8턴/대화 / 즉각 피드백
- 시나리오 5개: Shinkansen / 카페 / 공항 / 호텔 / 쇼핑
- "💛 Hoàn toàn miễn phí — 10 thẻ học mỗi ngày"
- CTA 버튼: `🚀 THỬ FREE TALK NGAY` → Play Store URL
- 가이드 텍스트: "Mở ứng dụng → vào tab \"Hội thoại\" 💬 → chọn Free Talk"
- 개인화: `Xin chào ${displayName}!` (Google sign-in name)

**RFC 8058 List-Unsubscribe header** 포함 (Gmail/Outlook unsubscribe 버튼 활성화).

## 발송 결과

```
Mode: live
Country: VN
Lapsed days: 3+
Total scanned: 2,254
Total candidates: 106
✅ Total sent: 106
Failed: 0
Time: 97.5초 (~0.92초/메일)
Skip — no-email: 473
Skip — not-lapsed: 28
```

각 메일에 unique Resend message ID (예: `b2f25ceb-830b-48cd-b1a6-6e1458bbd344`).

## 🔧 발송 과정에서 학습한 핵심 인사이트 3개

### 1. 이미지 inline cid attachment 필수 (Gmail 외부 이미지 차단)

**문제**: 첫 발송 시 외부 URL `https://pronunfit.com/email-assets/free-talk-vn.jpg` 사용 → Gmail에서 깨진 placeholder 표시.

**원인**: Gmail은 신규 발신자 도메인의 외부 이미지를 기본 차단. 사용자가 "이미지 표시" 직접 클릭해야 로드.

**해결**: Resend `attachments` + `cid:` 참조로 inline 첨부:
```js
attachments: [{
    filename: 'free-talk-vn.jpg',
    content: imgBuffer,        // fs.readFileSync로 캐시
    contentType: 'image/jpeg',
    contentId: 'free-talk-screenshot',
}]
```
HTML: `<img src="cid:free-talk-screenshot">`

→ 모든 메일 클라이언트에서 외부 차단 무관 정상 표시.

### 2. Render 배포 root는 `server/package.json` (루트 아님)

**문제**: 루트 `package.json`에 `resend` 추가 + push → Render 재배포 → `Cannot find module 'resend'`.

**원인**: PronunFit은 monorepo 구조 (`/package.json` = React 클라이언트, `/server/package.json` = Node 서버). Render Web Service는 `server/package.json` 을 root로 인식 + 그 안의 dependencies만 설치.

**확인 방법**: `server/package.json` 의 dependencies가 Render에 설치되는 진짜 목록.

**해결**: `resend`를 `server/package.json` 에 추가 + `server/package-lock.json` 갱신 + 루트 package.json에서 제거.

→ **별도 메모리 [feedback_render_server_pkg.md](feedback_render_server_pkg.md) 생성 권장**.

### 3. Promotions 탭은 첫 발송에 정상 (베트남 user는 익숙)

본인 Gmail에서 첫 발송 메일은 `Promotions` 탭에 도착. 일반적으로 발송자 신뢰도 쌓이기 전 Gmail의 보수적 분류. 베트남 유저는 Promotions 탭 익숙 (Shopee/Tiki/Lazada 등 마케팅 메일) → 큰 문제 아님.

Primary inbox로 옮기려면: 이모지 제거, HTML 단순화, 텍스트 비율 ↑, 발신자 이름 personal — 효과 작아서 1차에선 Promotions 그대로 둠.

## 배포 이력 (commits)

| Commit | 내용 |
|---|---|
| `d8f362f` | feat(email): VN lapsed 유저 Free Talk 캠페인 이메일 (Resend) 도입 |
| `4372a73` | chore: trigger Render redeploy for resend npm package install |
| `0dc9afa` | fix(deps): resend를 루트 package.json에서 server/package.json으로 이동 |
| `7e8226a` | chore(email): VN Free Talk 캠페인 이미지 호스팅 + URL .png→.jpg |
| `b8d4838` | fix(email): 이미지 inline cid attachment — Gmail 외부 이미지 차단 우회 |

## 검증된 사실

- ✅ Resend domain `pronunfit.com` Verified (Tokyo region)
- ✅ `RESEND_API_KEY` Render env에 안전 등록 (chat 노출 없음)
- ✅ 본인 메일(sw.haka@gmail.com) 3회 테스트 발송 성공
- ✅ 이미지 inline cid 정상 표시 (Gmail Promotions 탭)
- ✅ 106명 발송 100% 성공 (failed 0)
- ✅ Resend Dashboard에서 발송 결과 모니터링 가능

## 후속 측정 작업 (제안)

### 24~72h 후
- VN lapsed 106명 중 `lastActiveAt > freeTalkEmailSentAt` 인 유저 수 = **이메일 → 실제 복귀 case**
- 진단 endpoint `/api/cron/post-push-activity?window=...` 패턴 재사용 가능 (이메일 버전 추가 필요)
- 비교: 푸시 D3 (0/231 returnedActive) vs 이메일 (?/106)
- Resend Dashboard: open rate, click rate, bounce rate, complaint rate

### 다음 캠페인 후보
- 한국 lapsed engaged/subscriber + email 보유 — 추정 ~20-50명 (별도 진단 필요)
- 다른 시장 lapsed (RU/UZ/KZ) — 동일 패턴, 영어 카피로
- Free Talk 외 다른 hook으로 reactivation series

## 알려진 한계 / 미완료

- 296명 unreachable VN lapsed (channel 없음) — phantom anonymous users, 복귀 방법 없음
- 473명 no-email (VN lapsed지만 이메일 미보유, 익명 가입 다수)
- 1.4.10 / 1.2.10 OS 충돌설은 추측이었음. 실제 진단 결과는 audience 문제로 판명
- iOS 전용 Capgo OTA 비활성 정책 그대로 (이번 캠페인 무관)

## 메모리 인덱스 변경

[MEMORY.md](MEMORY.md) 신규 항목으로 이 파일 추가.
