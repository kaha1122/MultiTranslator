---
name: changes-0612-thermal
description: 2026-06-12 iOS 발열 재발 근본원인 확정(v2.0.x users write→render storm) + P0 2건 fix + ios-heat-guard 의무화 체계
metadata: 
  node_type: memory
  type: project
  originSessionId: a045751f-9719-43a9-9236-c3c325b61ae3
---

# 2026-06-12: iOS 발열 재발 근본원인 + P0 fix + 검토 의무화

## 근본원인 확정 (heat-issue-analyzer 130 tool-use + 직접 교차검증)
- v1.5.65~86 thermal fix는 **전부 생존** (lazy-mount visitedTabsRef / AuthContext useMemo / CSS 가드 / AVAudioSession). 원복 2건(25e5f47 idle 제거, 68c4d22 AdMob bg hide 제거)은 **무죄 — 복원 불요**.
- 재발 원인 = v2.0.x 신규 코드가 연 **users/{uid} write → onSnapshot 무조건 setProfile → contextValue 재생성 → App.jsx ~6,000줄 전체 재렌더** 경로:
  - C1: server/utils/ttsUsage.js 60초 flush가 users 본문 직접 write (6/6 신설)
  - C2: launch 직후 cascade — updatedAt + daily-topup(Trial 매일 첫 실행) + check-subscription ("켜는 즉시 발열" 시점 일치)
  - C3: consumeBonusPoints 등 매 액션 write
- "음성재생 차단/마이크 실패"는 thermal throttling의 **2차 증상** (오디오 세션 회귀 없음 확인).

## P0 fix (배포완료 — 서버: 438ad9c origin/main push로 Render / 클라: Capgo OTA **2.0.29** production+staging 양채널, currentBundle 검증. main 로컬에 ecff0c8 버전bump 커밋만 미push 잔존)
1. ttsUsage → `users/{uid}/analytics/ttsUsage` 서브컬렉션 (server/utils/ttsUsage.js:53). 소비처 0건 grep 확인. 누적 통계는 레거시 본문 필드+신규 양쪽 합산 필요.
2. AuthContext onSnapshot `profileEssence` 가드 — updatedAt/ttsUsage만 바뀐 snapshot은 prev 레퍼런스 유지(React bail-out). Timestamp는 toMillis 정규화. fail-open(직렬화 실패 시 기존 동작).

## ios-heat-guard 의무화 체계 (신설)
- [.claude/agents/ios-heat-guard.md] — 발열 메커니즘 5종 체크리스트 내장, `HEAT-GUARD: PASS/FAIL` 판정.
- CLAUDE.md 절대규칙 6: 모든 commit 전 호출 → PASS → `.claude/.heat-guard-pass` touch → commit.
- [.claude/hooks/heat-guard-gate.cjs] + .claude/settings.json PreToolUse(Bash, if Bash(git *)): 플래그 없으면 git commit deny. 플래그는 commit 1회당 소모, 30분 유효. **주의: 루트 package.json이 ESM이라 훅은 .cjs 필수**. touch와 commit을 한 명령에 묶으면 훅 평가 시점에 플래그 부재로 차단됨 — 별도 명령으로.

## ⚠️ 커밋 사고 기록
- 내 staged 7파일이 **동시 작업 중이던 다른 세션의 커밋 438ad9c**(firestore.rules legacy top-up exception)에 쓸려 들어감(공유 index). 내용 무결성은 확인됨. 히스토리 미수정(동시 세션 위험) — 사용자 판단 대기.
- 교훈: 같은 repo 다중 Claude 세션 동시 커밋 시 index 공유로 커밋 혼입 가능.

## 잔여 (P1/P2)
- P1: bonusPoints 분리 구독 / CapacitorUpdater 리스너 4개 cleanup / AccountUpgradeModal.jsx:287 인라인 backdropFilter 가드 / launch console.log 정리.
- P2: 탭 컴포넌트 React.memo(0531 "발견 1번" 미적용 잔존).
- 검증: AppDelegate thermalState 로그 + 배너OFF/현행 비교 실측 제안됨.
- 배포 순서 주의: 438ad9c에 타 세션 rules 변경 동봉 — changes-0611의 OTA→서버→rules 순서 제약 확인 필요. [[changes-0611-security]] [[changes-0531]]
