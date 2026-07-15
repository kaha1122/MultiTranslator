---
name: changes-0326
description: 2026-03-26 변경사항 — 카드 그린 테두리, 구독현황 상세표시, 다운그레이드 planId 클리어, Trial 사용량 수정
type: project
---

# 2026-03-26 변경사항

## 1. 카드 그린 테두리 통일 (v1.3.85)
- 모든 카드(Scene/Vocab/Translation/Library) 테두리를 `2px solid #2ec4b6`으로 통일
- 수정 파일: ScenePractice.css, VocabTab.css, TranslationCard.css, App.css

## 2. 구독현황 상세표시
- Tier명 초록색(`#16a34a`)으로 표시
- Pro/Premium 구독자: 상품명(Pro 1개월, Pro 3개월 등) + 만기예정일(YYYY/MM/DD) 표시
- Trial: `todaySaveCount`(카드 저장 횟수) + `todayPronCount`(발음 횟수) + 보너스 반영 limit 표시
- i18n 10개 언어: `expiryDate`, `planPro1/3`, `planPremium1/3` 추가

## 3. Trial 사용량 표시 버그 수정
- **문제**: 상단 게이지(`todaySaveCount`)와 하단 요금제 현황(`todayCount`)이 서로 다른 변수 사용 → 숫자 불일치
  - `todaySaveCount`: 카드 **저장** 횟수 (올바른 값)
  - `todayCount`: 목표점수 **달성** 횟수 (잘못된 값)
- **해결**: 하단 중복 표시 제거 후, 올바른 `todaySaveCount` 변수로 재추가

## 4. 다운그레이드 시 planId 클리어
- **문제**: 다운그레이드 후에도 `planId`가 잔존 → UpgradeModal에서 이전 플랜이 "현재 플랜"으로 disable 표시
- **해결**:
  - AuthContext 만료 다운그레이드: `planId: null` 추가
  - RevenueCat 다운그레이드: `planId: null` 추가
  - UpgradeModal: tier가 trial이면 `currentPlanId`를 null로 강제 (잔존 데이터 방어)
  - `subscriptionExpiresAt`/`subscriptionMonths`는 이력 보존을 위해 **유지** (null 설정 시 Firestore 필드 삭제됨)

## 배포
- Capgo: v1.3.86
- Git: commit `556e96c`, main push 완료
- Vercel: main push로 자동 배포 트리거
