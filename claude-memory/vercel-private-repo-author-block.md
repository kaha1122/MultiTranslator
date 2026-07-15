---
name: vercel-private-repo-author-block
description: Vercel이 private repo 전환 후 commit author email이 GitHub 계정과 매칭 안 되면 deployment를 Blocked 처리. 가짜 이메일(kaha1122@example.com) 사고 진단/복구 절차
metadata: 
  node_type: memory
  type: project
  originSessionId: 7d259a2d-0c05-4cca-b2b6-d8cfa28a7857
---

## 사건 (2026-05-20)

GitHub repo public→private 전환 직후 Vercel deployments 2건이 **Blocked**로 표시:
- 에러 메시지: "The deployment was blocked because the commit email kaha1122@example.com could not be matched to a GitHub account"
- 원인: 로컬 `git config user.email`이 placeholder `kaha1122@example.com`으로 박혀있었음. Public repo에선 Vercel이 통과시켰지만 private 전환 후 엄격 검증 시작.

**Why:** Vercel은 private repo에서 "이 커밋 author가 정말 프로젝트 접근 권한 있는 GitHub 사용자인가?"를 commit email로 검증. Placeholder/매칭 안 되는 이메일은 차단.

**How to apply:**
- private repo로 전환한 후 갑자기 Vercel 배포가 Blocked되면 commit author email 의심
- 진단: `git log -1 --pretty=format:"%h %an <%ae>"` — author email이 GitHub 계정 verified email과 일치하는지 확인
- 복구: `git config user.email "<GitHub-no-reply-or-verified>"` → 새 커밋 push (이미 푸시된 커밋의 author는 못 바꿈, amend+force는 main에서 위험)
- 이번 사고에서 사용한 이메일: `206375105+kaha1122@users.noreply.github.com` (GitHub Settings > Emails에서 확인 가능)

## 복구 절차 (재발 시 그대로 적용 가능)

1. `git config user.email "206375105+kaha1122@users.noreply.github.com"` (이 repo 한정)
2. Blocked된 브랜치마다 `git commit --allow-empty -m "chore: re-trigger Vercel deploy with verified author email" && git push origin <branch>`
3. Vercel Deployments에서 새 빌드 Ready 확인

## 예방

- GitHub Settings > Emails > **"Keep my email addresses private" ON** + **"Block command line pushes that expose my email" 체크** 해두면 placeholder/exposed email 푸시 자체가 차단됨
- 글로벌 git config는 아직 안 바꿈 (사용자 선택) — 다른 repo에서 같은 사고 가능성 있음

## 관련

- [[feedback_deploy]] — 배포 2대 원칙(staging 우선, 비밀 검증)
- [[changes-0517]] — 직전 Capgo/Native 작업 컨텍스트
