---
name: tier-system
description: PronunFit 등급 체계 — 4개 상품, 가격, 한도, admin/BYOK 매핑
type: project
---

## 등급 체계 (2026-03-12 확정)

| 등급 | 가격 | API | 광고 | 한도 |
|---|---|---|---|---|
| Free Trial | 무료 | 개발자 | O | 카드저장 10개 + 발음 30회 |
| Admin (BYOK) | 무료 | 본인 키 | O | 무제한 (개발자 전용) |
| Pro 1개월 | ₩9,900/월 | 개발자 | O | 발음 500회/월 |
| Pro 3개월 | ₩16,500 (₩5,500/월, 44%↓) | 개발자 | O | 발음 500회/월 |
| Premium 1개월 | ₩19,900/월 | 개발자 | O | 무제한 |
| Premium 3개월 | ₩55,000 (~₩18,333/월, 8%↓) | 개발자 | O | 무제한 |

### 주요 변경 사항
- `byok_free` tier → `admin`으로 리네임 (AuthContext에서 하위호환 매핑: `rawTier === 'byok_free' ? 'admin' : rawTier`)
- Premium 광고 제거 미구현 (모든 tier 광고 유지 결정)
- 3개월 플랜도 자동 갱신 (같은 가격으로 3개월 추가 연장)
- TrialLimitModal: BYOK 선택지 제거, "업그레이드" 버튼만 → UpgradeModal로 연결

### Pro 발음 카운터
- `proPronCount`: 월별 사용 횟수
- `proPronResetMonth`: "2026-03" 형식, 월이 바뀌면 AuthContext에서 자동 리셋
- `PRO_PRON_LIMIT`: 500회/월
