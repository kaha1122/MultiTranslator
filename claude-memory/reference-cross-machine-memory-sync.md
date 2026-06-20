---
name: reference-cross-machine-memory-sync
description: 두 PC(C/D 드라이브)가 GitHub claude-memory/ 로 auto-memory를 상호 공유하는 워크플로 + 라이브 메모리 슬러그 규칙
metadata: 
  node_type: memory
  type: reference
  originSessionId: b1942947-cb9c-4e9a-8a51-3e6f7c4909b0
---

PC 2대(이 PC=**D드라이브** `D:/Projects/multiTranslator`, 다른 PC=**C드라이브**)가 동일 GitHub repo를 통해 Claude Code auto-memory를 상호 공유한다.

**구성**
- 라이브 메모리: `~/.claude/projects/<repo-slug>/memory/` (각 PC 로컬, 비밀 포함)
- repo 공유본: `<repo>/claude-memory/` (GitHub로 push되는 정제본, 비밀 자동 제외)
- 스크립트: [scripts/sync-memory.sh](scripts/sync-memory.sh) — npm: `sync-memory`(export 스테이징만) / `sync-memory:push`(commit→pull --rebase→push) / `sync-memory:restore`(공유본→라이브 복원)

**핵심: 라이브 메모리 경로는 하드코딩 금지 — 슬러그 동적 계산**
- Claude Code projects 슬러그 규칙: 프로젝트 절대경로의 `:` `\` `/` 를 **각각**(연속 보존, collapse X) `-` 로 치환 + **드라이브 문자 소문자화**.
  - `D:/Projects/multiTranslator` → `d--Projects-multiTranslator`
  - `C:/work/multiTranslator` → `c--work-multiTranslator`
- 2026-06-20 수정(ae11e66 이후): 기존 `c--Projects-multi-translator` 하드코딩 제거 → `pwd -W`(Git Bash) 기반 슬러그 자동 계산. 우선순위: ① `CLAUDE_MEMORY_DIR` env override → ② 슬러그 경로 → ③ `~/.claude/projects/*-<basename>` + `memory/` 글롭 폴백. restore는 새 기기(라이브 미존재) 대비 슬러그로 mkdir.
- 덕분에 **GitHub에 올라가는 스크립트 한 벌이 두 PC 모두에서 무수정 동작**.

**Why:** 드라이브 문자가 PC마다 다르면 단일 공유 스크립트가 깨진다. 슬러그를 실행 시점에 자기 repo 경로로부터 계산해야 양방향 공유가 성립.

**How to apply:** 라이브 메모리 경로를 다루는 스크립트는 절대경로 하드코딩 대신 위 슬러그 규칙으로 도출. 자동 탐지 실패 시 `CLAUDE_MEMORY_DIR=/c/.../memory` 로 수동 지정. 비밀 차단 로직(`SECRET_RE` fail-closed, MEMORY.md 자격증명 블록 제거)은 유지. [[feedback_no_secrets_in_git]]
