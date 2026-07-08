---
name: feedback_commit_heredoc
description: "Bash 도구에서 git commit 시 PowerShell here-string(@'...'@) 금지 — 메시지에 @ 섞여 매번 재커밋 발생"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cf7c0308-eb18-433b-a6ca-a88a75d2b6c6
---

**커밋 메시지에 `@` 가 섞여 amend/재커밋하는 일이 반복됨** (2026-06-14 사용자 지적).

원인: **Bash 도구**(Git Bash / POSIX sh)에서 `git commit -m @'...'@` 같은 **PowerShell here-string 문법**을 사용. Bash는 `@'...'@` 를 here-string으로 해석하지 않고, 앞의 `@` 와 끝의 `'@` 를 **리터럴 문자**로 붙여버려 → 커밋 메시지 첫 줄이 `@`, 마지막 줄이 `@` 로 오염됨.

**Why:** Bash 도구와 PowerShell 도구는 서로 다른 셸이다. PowerShell 전용 `@'...'@` 힙독을 Bash에 쓰면 안 됨.

**How to apply:** 멀티라인 커밋 메시지는 셸에 맞는 방식만 사용:
- **Bash 도구**: heredoc을 파일로 쓰고 `git commit -F`. 예:
  ```bash
  cat > .git/CMSG <<'EOF'
  subject line

  - body
  EOF
  git commit -F .git/CMSG && rm -f .git/CMSG
  ```
  (또는 `git commit -m $'line1\nline2'`, 혹은 `-m` 여러 개)
- **PowerShell 도구**: `@'...'@` 힙독 사용 가능(닫는 `'@` 는 반드시 컬럼0).

커밋 후 항상 `git log -1 --format='%B' | cat -A` 로 앞뒤 `@` 오염 여부 1초 확인. 관련: [[feedback_deploy]]
