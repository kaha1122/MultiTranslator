# PronunFit 모달 디자인 토큰 & 규칙 (Phase 1 — 2026-06-09)

37개로 흩어져 있던 팝업/모달 디자인을 단일 토큰 체계로 수렴시키기 위한 기준 문서.
토큰 정의 위치: [`src/App.css`](../src/App.css) `:root` (모달 통일 디자인 토큰 블록).

> **진행 단계**: Phase 1 = 토큰 정의 + 공통 클래스 + 파일럿 2개(ConfirmModal, PushOptInModal).
> Phase 2 = 나머지 35개 모달을 이 토큰/클래스로 치환 (사용자 확인 후).

---

## 1. 색상 규칙

| 의미 | 토큰 | 값 | 사용처 |
|------|------|-----|--------|
| **1차 액션 (CTA)** | `--brand-primary` | `#00a884` (teal) | 주요 버튼, 로고, 토글 ON, 활성 칩, 성공 표시 |
| 〃 hover | `--brand-primary-hover` | `#00997a` | 1차 버튼 hover |
| 〃 pressed | `--brand-primary-pressed` | `#008264` | 1차 버튼 active |
| **선택 / 강조** | `--brand-accent` | `#6366f1` (인디고) | 선택 상태, 진행·streak·통계 강조, 페이지 인디케이터, 하단 nav 활성, 정보성 모달 헤더 아이콘 |
| 〃 hover | `--brand-accent-hover` | `#4f52e8` | |
| 〃 pressed | `--brand-accent-pressed` | `#4338ca` | |
| **파괴적** | `--danger` | `#ef4444` | 삭제·취소 등 되돌릴 수 없는 액션 |
| 〃 hover | `--danger-hover` | `#dc2626` | |
| **브랜드 위 텍스트** | `--text-on-brand` | `#ffffff` | brand/danger 배경 위 글자 |
| **셀러브레이션 그라데이션** | `--brand-celebration-grad` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | **streak / 축하 "특별한 순간" 전용** — 일반 CTA에 사용 금지 |

### 핵심 원칙
- **1차 액션 = teal**, **선택/하이라이트 = 인디고**, **파괴적 = danger**.
- 보라 그라데이션(`#6366f1→#8b5cf6`)은 **streak·celebration에만** 격리. 일반 모달 버튼에 쓰지 않는다.
- 기존에 난립하던 `#7B2D8E`, `#7c3aed`, `#4338ca`(버튼 단독) 등은 위 토큰으로 흡수한다.

---

## 2. 모달 표준 형태

| 항목 | 토큰 | 표준값 |
|------|------|--------|
| 오버레이 배경 | `--modal-overlay-bg` | `rgba(15, 23, 42, 0.55)` (슬레이트) |
| 카드 radius | `--modal-radius` | `20px` |
| 카드 그림자 | `--modal-shadow` | `0 20px 60px rgba(0, 0, 0, 0.2)` |
| 오버레이 padding | `--modal-overlay-padding` | `20px 20px calc(20px + safe-area/admob)` |
| 카드 배경 | `--modal-card-bg` | `#ffffff` |
| 버튼 radius | `--modal-btn-radius` | `12px` |

- **닫기 버튼 표준**: 카드 우상단 lucide `<X>` 아이콘 (`.modal-close` 클래스). `×` 문자·원형 커스텀 버튼·백드롭 전용 닫기는 표준에서 제외.
- 진입/이탈 애니메이션: framer-motion 오버레이 `opacity` + 카드 `scale 0.9→1, y 20→0` 권장 (ConfirmModal 패턴).

---

## 3. z-index 레이어 체계

신규/리팩토링 코드는 **반드시 토큰만** 사용 (raw 숫자 금지).

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--z-base` | 0 | 기본 흐름 |
| `--z-sticky` | 100 | sticky 헤더/바 |
| `--z-dropdown` | 1000 | 드롭다운·팝오버 |
| `--z-modal-backdrop` | 2000 | 모달 백드롭 |
| `--z-modal` | 2010 | 일반 모달 본체 |
| `--z-toast` | 3000 | 토스트/스낵바 |
| `--z-critical` | 9000 | 시스템 권한 프롬프트 등 최상위 (예: PushOptInModal) |

> Phase 2 완료 전까지는 일부 모달이 아직 raw z-index(9998/9999/10000 등)를 들고 있어
> 일시적으로 레이어 순서가 완벽하지 않을 수 있다. Phase 2에서 전부 토큰으로 치환되면 해소.

---

## 4. 공통 클래스 (`src/App.css`)

| 클래스 | 역할 |
|--------|------|
| `.modal-overlay` | 전체 화면 백드롭 + 중앙 정렬 + 표준 z/padding |
| `.modal-card` | 흰 카드 (radius/shadow/padding/max-width 360px) |
| `.modal-close` | 우상단 닫기 버튼 (lucide `<X>` 래퍼) |
| `.modal-btn-primary` | 1차 액션 버튼 (teal) |
| `.modal-btn-secondary` | 보조 버튼 (회색 테두리) |
| `.modal-btn-danger` | 파괴적 버튼 (danger) |

> 기존에 `className="modal-overlay"` + 인라인 style을 같이 쓰던 곳(App.jsx 프로필 모달, Library)은
> 인라인 style이 CSS 클래스를 덮으므로 이 정의 추가만으로는 렌더링이 바뀌지 않는다.
> Phase 2에서 인라인 style을 제거하며 클래스로 일원화한다.
