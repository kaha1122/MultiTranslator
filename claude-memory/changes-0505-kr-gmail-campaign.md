---
name: 2026-05-05 KR Free-Talking 이메일 캠페인 (Gmail Send-as 39명)
description: 본인 Gmail Send-as alias로 KR lapsed 39명에게 발송 — Primary Inbox 도달 확인된 채널 신규 도입
type: project
originSessionId: c6698add-4a6d-4a17-9a62-7d4c04af08b6
---
# KR Free-Talking Email Campaign — Gmail Send-as 방식

## 배경 — Resend Promotions 회피 문제

VN 캠페인(2026-05-04, [changes-0504-email-campaign.md](changes-0504-email-campaign.md))은 Resend로 106명 발송 성공했지만 본인 테스트에서 **Promotions 탭 도착 확인**. 베트남 유저는 Promotions 탭 익숙해서 OK였지만, 한국 유저에겐 약점.

KR 캠페인은 **본인 Gmail Send-as alias**로 발송하여 Primary Inbox 도달 확인 후 진행.

## 결과: Primary Inbox 도달 확인 ✅

본인 Gmail에서 Send-as 테스트 메일 도착 → **Primary 받은편지함** (Promotions 아님). Resend 대비 명확한 개선.

## 도달 채널 inventory (KR)

진단 endpoint `/api/cron/lapsed-reach-inventory?country=KR&lapsedDays=3`:

| 항목 | 수 | % |
|---|---:|---:|
| KR 전체 | 242 | 100% |
| **lapsed (3+일)** | **214** | **88.4%** |
| 그 중 email 보유 | 41 | 19.2% |
| phone | 4 | 1.9% |
| fcmTokens | 44 | 20.6% |
| **unreachable** | 140 | 65.4% |

→ KR lapsed 88.4% (VN 85.3% 보다 약간 높음)
→ email 41명이 도달 가능 모수

## 신규 인프라

### Gmail Send-as 셋업 (사용자 측 일회성)
- `sw.haka@gmail.com` Gmail 계정에 "Send as" alias = `systemadmin@pronunfit.com` 등록
- 2단계 인증 활성 + **App Password** 발급 (앱 이름: "메일발송전용")
- Firebase Service Account JSON 다운로드 → `C:\private\firebase-key.json`
- App Password 저장 → `C:\private\pw.txt`

### Python 스크립트 (`scripts/send_kr_email_via_gmail.py`)
- Firestore 직접 query (firebase-admin Python SDK)
- KR + lapsed(3+일) + email 보유 + 미발송 + opt-out 아님 + admin 아님 + D0 아님 필터
- Gmail SMTP via App Password (smtp.gmail.com:465 SSL)
- multipart/related → multipart/alternative(text+html) → image
- Inline cid attachment (free-talk-ko.jpg, 278KB)
- 3초 throttle (Gmail rate limit ~100건/분 회피)
- Firestore 마킹: `freeTalkEmailSentAt` + `freeTalkEmailVia: gmail-sendas` + `freeTalkEmailCampaign: free-talk-kr-2026-05-05-gmail`

### 환경변수 사용 (보안)
```bash
export GMAIL_APP_PASSWORD="$(cat 'C:/private/pw.txt' | tr -d '[:space:]')"
export FIREBASE_SERVICE_ACCOUNT="C:/private/firebase-key.json"
```
스크립트 자체는 비밀 정보 미포함 → git commit 안전.

### Windows cp949 console UTF-8 fix
스크립트 시작 시 `sys.stdout.reconfigure(encoding='utf-8', errors='replace')` 추가 — 한글/이모지 print 가능.

## 카피 (한국어, 3차 수정 후 확정)

**Subject**: `🎙️ Free-Talking: AI와 진짜 대화하기 — PronunFit 신기능`

**Hero title**: `🎙️ Free-Talking기능이 출시됐어요!`

**Subtitle**: `신기능 — AI와 실시간 Free Talking하면서 실전대화 연습`

**Body 핵심**:
- "한 번쯤 시도해보실 만한 Free-Talking 기능이 출시됐습니다"
- "🌟 Free-Talking 기능이 뭔가요?"
- 4가지 특징: AI 자연 대화 / 실제 상황 / 8턴/대화 / 즉각 발음 피드백
- 시나리오 5개: 신칸센 / 카페 / 공항 / 호텔 / 쇼핑
- 가이드: "사이드바 'Free-Talking' 탭 → 상황/장소 설정 → 'Free Talking' 버튼"
- CTA: Play Store URL `https://play.google.com/store/apps/details?id=com.arigems.pronunfit`

## 발송 결과

```
대상자: 41명 → 본인 메일 2개 제외 → 39명 발송
성공: 39/39
실패: 0
소요: 약 2분 (3초 throttle × 39 = 117초)
제외 본인 메일:
  - pgz9qtwtpr@privaterelay.appleid.com (Apple Hide-My-Email)
  - s_w_ha@naver.com (Naver 별도 계정)
```

## 검증된 사실

- ✅ Gmail SMTP "Send as" → Primary Inbox 도달 (Resend Promotions 대비 명확한 개선)
- ✅ Send-as alias `systemadmin@pronunfit.com` 정상 표시
- ✅ Reply-To 정상 (수신자가 답장 시 systemadmin@pronunfit.com)
- ✅ Inline cid 이미지 (free-talk-ko.jpg) 정상 렌더링
- ✅ 한국어 본문 + 이모지 정상 표시
- ✅ Gmail rate limit 안에 듬 (39통, 일일 한도 500/하 위)
- ✅ Firestore freeTalkEmailSentAt 마킹 정상

## 운영 시간 / commit 이력

| Commit | 내용 |
|---|---|
| `f90d082` | feat(email): 한국어 Free Talk 캠페인 템플릿 추가 + country 분기 |
| `faa7cae` | chore(email): 'Free Talk' → 'Free-Talking 기능' 통일 + dryRun 전체 리스트 |
| `88793aa` | feat(email): Python + Gmail Send-as 발송 스크립트 (KR 41명 캠페인) |
| `3216b48` | feat(email): KR Free-Talking 캠페인 카피 3고 수정 (subject+hero+subtitle) |

## 채널 비교 — VN vs KR

| 항목 | VN (Resend) | KR (Gmail Send-as) |
|---|---|---|
| 발송 인프라 | Resend SaaS | 본인 Gmail SMTP |
| 발송 인구 | 106명 | 39명 |
| 도달 위치 | Promotions 탭 (대다수) | **Primary Inbox** ✅ |
| 비용 | 무료 (3K/월 한도 내) | 무료 (Gmail 500/일 한도 내) |
| 자동화 | 100% 서버 endpoint | Python 스크립트 (수동 실행) |
| 확장성 | 전 세계 / 대량 | 500/일 제한 (KR 정도엔 충분) |
| 추적 | Resend Dashboard (open/click/bounce) | Gmail 보낸편지함만 |

## 인사이트

### 1. Gmail Send-as가 Primary Inbox 도달율 압도적 ↑
이유 추정:
- 본인 Gmail 계정의 sender reputation (수년간 정상 사용)
- Gmail outbound infrastructure → 다른 Gmail 사용자에 부드럽게 분류
- Gmail-to-Gmail의 자체 trust score
- Send-as alias는 Gmail 정식 지원이라 stuffed 아님

### 2. Resend 대신 Gmail 적용 조건
- 발송 모수 < 500/일 (Gmail 한도)
- KR / JP 등 Inbox 분류가 중요한 시장
- 개인 Gmail 계정 reputation 높음 (수년 사용)
- 스크립트 수동 실행 OK (cron 자동화 어려움)

### 3. Resend는 다음 케이스에 유리
- 대량 발송 (3K+/월)
- 자동화 cron (Render/AWS)
- 글로벌 (각 국가 SPF/DKIM 신뢰)
- Open/click/bounce 추적 필수

## 후속 측정 (24~72h)

- KR 39명 중 `lastActiveAt > freeTalkEmailSentAt` = 실제 복귀
- Resend VN 106명 vs Gmail KR 39명 채널 효과 비교
- Inbox 도달이 retention 효과로 이어지는지 (Promotions에 가도 효과 있을 수도, 데이터 측정 필요)

## 다음 캠페인 후보

- **iOS Apple ID 유저** (Hide-My-Email 별도 처리)
- ~~**러시아어/우즈벡어** lapsed~~ → **2026-05-05 Option A로 발송 완료** (RU 19명)
- **subscriber/engaged** 한정 (KR 12명 engaged + 3 subscriber)
- **Free Talking 기능을 안 써본 active 유저**에게도 발송 검토 (lapsed 아니지만 미사용)
- **unknown sourceLang 34명** (sourceLang null) — deviceLang/geoCountry 추정으로 분류 후 발송

## 🌍 Option A — EN/RU/ES 멀티언어 캠페인 (2026-05-05 추가 발송)

VN/KR 캠페인 이후 sourceLang 기준 다음 시장 발송. ko/vi 제외 캠페인 가능 모수 87명 중 다음 진행:

### 신규 인프라 — 멀티언어 지원 리팩터링 (commit 4ef7018)

기존 KR-only Python 스크립트 → ko/en/ru/es 4개 언어 동시 지원:
- `--lang` 파라미터 (default: ko, 후방호환)
- 필터: `geoCountry` → **`sourceLang`** 기반 (다국가 동일 언어 유저 모두 매칭)
- 이미지: 모든 언어 **free-talk-ko.jpg** 동일 사용 (사용자 결정 — UI 컨셉 전달엔 충분)
- `LANG_CONFIGS` dict 패턴 — 새 언어 추가 시 dict 한 줄 + render 함수 2개로 확장 가능
- only-email 모드 시 sourceLang 필터 우회 (본인 카피 검증용)

### 발송 결과 (52명 전체, failed 0)

| Lang | Subject | 대상 | 분포 |
|---|---|---:|---|
| **en** | 🎙️ Free-Talking: real conversations with AI — PronunFit new feature | **19** | Gmail 17 + Apple Hide-My-Email 2. 다양한 국가 (US/VN/UZ/IN 등) |
| **ru** | 🎙️ Free-Talking: настоящие разговоры с ИИ — новая функция PronunFit | **19** | Gmail 17 + ukr.net 1. CIS 권역 (KZ/KG/UZ/AZ/UA/TJ) — 우즈벡 이름 다수 |
| **es** | 🎙️ Free-Talking: conversaciones reales con IA — nueva función de PronunFit | **14** | Gmail 13 + 1 기타. 중남미 (UY/CL/AR/CO 등) |
| **합계** | | **52** | |

### 캠페인 태그
- `free-talk-en-2026-05-05-gmail`
- `free-talk-ru-2026-05-05-gmail`
- `free-talk-es-2026-05-05-gmail`

### 인사이트

**RU 발송 시 우즈벡 이름 다수 발견** — 이전 진단(unmapped geoCountry 갭)에서 UZ가 가장 큰 unreachable 시장이었던 점과 일치. CIS 권역 (KZ 34, KG 68, TJ 32, UZ 141 등)에서 러시아어가 lingua franca.

**EN 발송 시 인도 영어 학습자 다수** — `*ravikantdubey*`, `*kalramanan*`, `*smitajunnarkar*` 등 인도계 이름 — 인도 영어 학습 시장 잠재력.

**ES 발송 — 중남미** 중심. UY(우루과이), CL(칠레), AR(아르헨티나) 등.

## 누적 캠페인 현황 (2026-05-04 ~ 05)

| 일자 | Lang | 채널 | 발송 | 도달 |
|---|---|---|---:|---|
| 5/4 | VN (vi) | Resend | 106 | Promotions 탭 |
| 5/5 | KR (ko) | Gmail Send-as | 39 | **Primary Inbox** |
| 5/5 | EN | Gmail Send-as | 19 | Primary Inbox 예상 |
| 5/5 | RU | Gmail Send-as | 19 | Primary Inbox 예상 |
| 5/5 | ES | Gmail Send-as | 14 | Primary Inbox 예상 |
| **누적** | | | **197** | |

## 알려진 한계

- **본인 메일 2개 (Apple ID + Naver)** 매번 exclude 필요
- Apple Hide-My-Email 주소는 사실상 본인 1개 계정에 묶임
- iOS 유저 다수가 Apple Hide-My-Email 사용 → 향후 캠페인 시 처리 검토
- Gmail rate limit 보수적 적용 (3초 throttle) — 39명도 2분 소요
- Python 스크립트 수동 실행 — Render cron으로 자동화 어려움 (Gmail App Password 필요)
