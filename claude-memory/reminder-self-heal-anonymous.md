---
name: reminder-self-heal-anonymous
description: 보류 — 익명 사용자 앱 업데이트 후 onboarding 재발화 결함. self-heal effect (App.jsx:1857) 의 user.isAnonymous SKIP 가드 때문에 익명 유저 백필 안 됨. 사용자 추가 확인 후 재논의 예정.
metadata: 
  node_type: memory
  type: project
  originSessionId: 8035627e-d5c4-453b-af67-eb711ccec64c
---

# 보류: 익명 사용자 앱 업데이트 후 onboarding 재발화 결함

## 발견 시점
2026-05-23 사용자 질문 ("앱업데이트 후 모든게 초기화 되나? onboarding 모달이 다시 떠서 처음부터 다시 설정해야 하는지?").

## 결함 정리

### showOnboarding 트리거 게이트 ([src/App.jsx:1692-1701](src/App.jsx#L1692-L1701))
```jsx
useEffect(() => {
  if (!user || !profile) return;
  if (profile.hasCompletedOnboarding === true) return;          // ① Firestore
  if (localStorage.getItem('deviceOnboardingDone') === '1') return;  // ② localStorage
  if (profile.sourceLang && targetLangs.length > 0) return;     // ③ profile 데이터
  setShowOnboarding(true);
});
```

### 가입 사용자 vs 익명 사용자

| 시나리오 | 가입 사용자 | 익명 사용자 |
|---------|-----------|------------|
| 앱 업데이트 후 같은 UID 유지 | ✅ Firestore profile 보존 → onboarding 안 뜸 | ✅ Firestore profile 보존 → onboarding 안 뜸 |
| 앱 업데이트 후 localStorage 손실 | ✅ self-heal effect (L1883-1894) 가 LS 자동 백필 | 🔴 **self-heal 이 익명 SKIP** (L1857) → LS 백필 안 됨 |
| 앱 업데이트 후 **익명 UID 새로 발급** (IndexedDB 손실) | N/A | 🔴 **새 profile (빈 상태) → onboarding 발화** |

### 핵심 결함 위치
[src/App.jsx:1857](src/App.jsx#L1857):
```jsx
useEffect(() => {
  if (!user || !profile || user.isAnonymous) return;  // ← 익명 SKIP
  // self-heal 백필 로직 ...
});
```

새 익명 UID 발급되어도 localStorage 가 살아남았다면 백필로 복원 가능한데, 게이트 때문에 SKIP. 이게 결정적 결함.

## 알려진 한계 ([[changes-0517]])
> "Internal Testing 으로 1.2.11 → 1.3.1 업데이트 시 신규 익명 UID 생성 + '무료 계정 만드세요' 사고 재현 → IndexedDB → localStorage 자동 마이그레이션 불가 확인"

iOS Capgo OTA 미반영. Phase 1-C (Android localStorage persistence) 시도 → 실패 → REVERT 이력 ([[pending-aab-fixes]]).

## 제안된 개선안 (보류)

### Fix — self-heal 익명 게이트 완화 (1줄 수정)
```jsx
useEffect(() => {
  if (!user || !profile) return;  // user.isAnonymous SKIP 제거
  const missing = {};
  // localStorage 보존된 경우 missing 객체 채워짐 → 새 익명 UID profile 자동 복원
  if (!profile.sourceLang && sourceLang) missing.sourceLang = sourceLang;
  // ... 기존 백필 로직 ...
});
```

### 효과
| 시나리오 | After |
|---------|-------|
| 익명 + 앱 업데이트 + IndexedDB 보존 (같은 UID) | ✅ 정상 |
| **익명 + 앱 업데이트 + IndexedDB 손실 + localStorage 보존** | ✅ **새 익명 UID profile 자동 백필** |
| 익명 + 앱 업데이트 + 모든 storage 손실 | 🔴 동일 (진짜 초기 상태, 어쩔 수 없음) |

### 사이드 이펙트
- 익명 사용자 새 UID 케이스: Firestore write 1회 증가 (백필)
- 익명 + 빈 localStorage: missing 객체 비어 self-heal no-op → 정상 신규 사용자 동선
- 가입 사용자: 변화 없음

## 재논의 조건
- 사용자가 추가 검증 후 결함 패턴 재확인 시
- 사용자 보고가 들어오거나 진단 스크립트로 익명 UID 손실 케이스 발견 시
- 다음 AAB / IPA 빌드 전에 적용 결정

## Why
- 보류 이유: 사용자가 "더 확인하고 추가 수정 필요 시 다시 논의" 로 결정. 즉시 적용보다 영향 범위 추가 검토 우선.

## How to apply
- 재논의 시 `git diff` 로 1줄 수정 → main push → Vercel + Capgo OTA
- 적용 후 다음 AAB 빌드 / iOS 빌드 시 진단 스크립트 (server/check-user-tier.js) 로 익명 사용자 케이스 모니터링
- 보고 들어오면 이 reminder 와 [[changes-0517]] 함께 참조
