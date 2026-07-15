---
name: tier-system
description: PronunFit 등급 체계 — 4개 상품, 가격, 한도, admin/BYOK 매핑, 일간/월간 제한
type: project
---

## 등급 체계 (2026-03-18 업데이트)

| 등급 | 가격 | API | 광고 | 발음 한도 | 카드 한도 |
|---|---|---|---|---|---|
| Free Trial | 무료 | 개발자 | O | **20회/일** (매일 리셋) | **10개/일** (매일 리셋) |
| Admin (BYOK) | 무료 | 본인 키 | O | 무제한 | 무제한 |
| Pro 1개월 | ₩9,900/월 | 개발자 | O | **1,500회/월** | 무제한 |
| Pro 3개월 | ₩16,500 (₩5,500/월, 44%↓) | 개발자 | O | **1,500회/월** | 무제한 |
| Premium 1개월 | ₩19,900/월 | 개발자 | O | 무제한 | 무제한 |
| Premium 3개월 | ₩55,000 (~₩18,333/월, 8%↓) | 개발자 | O | 무제한 | 무제한 |

### 2026-03-18 변경 사항
- **Trial 제한 방식 변경**: 누적 → **일간 리셋**
  - 기존: 카드 10개 + 발음 30회 (누적, 평생)
  - 변경: 카드 10개/일 + 발음 20회/일 (매일 리셋)
- **PRO_PRON_LIMIT**: 1,000 → **1,500회/월**
- **일간 발음 추적 DB**: `users/{uid}/dailyProgress/{date}.pronCount` 필드 추가
- **목표 설정**: Trial 사용자는 10으로 고정 (슬라이더 disabled)

### 헤더 게이지바
| Tier | 카드 게이지 | 발음 게이지 |
|------|------------|------------|
| Trial | 🎯 X/10 (보라색) | 🎙️ X/20 (amber) |
| Pro | 🎯 X/목표 (보라색) | 🎙️ X (green, 숫자만) |
| Premium/Admin | 🎯 X/목표 (보라색) | 숨김 |

### 주요 상수 (AuthContext.jsx)
- `TRIAL_DAILY_CARD_LIMIT = 10`
- `TRIAL_DAILY_PRON_LIMIT = 20`
- `PRO_PRON_LIMIT = 1500`

### 기존 유지 사항
- `byok_free` tier → `admin`으로 리네임 (하위호환 매핑)
- Premium 광고 제거 미구현 (모든 tier 광고 유지)
- 3개월 플랜도 자동 갱신
- Pro 월별 리셋: `proPronResetMonth` 기반

### Pro 발음 카운터
- `proPronCount`: 월별 사용 횟수
- `proPronResetMonth`: "2026-03" 형식, 월이 바뀌면 AuthContext에서 자동 리셋
