#!/usr/bin/env bash
#
# sync-memory.sh — Claude Code 로컬 auto-memory <-> repo 공유본 동기화
#
#   라이브 메모리: ~/.claude/projects/c--Projects-multi-translator/memory/
#   repo 공유본  : <repo>/claude-memory/
#
# 비밀(keystore PW / Google API 키 / 32+hex 토큰 / Bearer 토큰)이 들어있는
# 파일은 공유본에서 자동 제외한다. MEMORY.md 는 'Facebook/Meta 자격증명'
# 블록만 제거하고 공유한다. 비밀이 끝까지 남으면 즉시 중단(fail-closed).
#
# 사용법:
#   bash scripts/sync-memory.sh            # 라이브 -> repo (export), 스테이징만
#   bash scripts/sync-memory.sh --push     # export 후 commit + push (main)
#   bash scripts/sync-memory.sh --restore  # repo -> 라이브 (다른 기기 clone 후)
#
set -euo pipefail

# --- 경로 ---
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="$HOME/.claude/projects/c--Projects-multi-translator/memory"
SHARE="$REPO_ROOT/claude-memory"

# 공유본에서 비밀로 간주하는 패턴 (이게 들어간 파일은 통째로 제외)
SECRET_RE='PronunFit2026|AIzaSy[0-9A-Za-z_-]{30}|[0-9a-f]{32,}|Bearer [A-Za-z0-9]{8,}'

# --- restore 모드: repo -> 라이브 ---
if [[ "${1:-}" == "--restore" ]]; then
  if [[ ! -d "$SHARE" ]]; then echo "❌ $SHARE 없음. repo clone 먼저."; exit 1; fi
  mkdir -p "$LIVE"
  for f in "$SHARE"/*.md; do
    base="$(basename "$f")"
    [[ "$base" == "_README.md" ]] && continue
    cp "$f" "$LIVE/$base"
  done
  echo "✅ restore 완료: $SHARE -> $LIVE ( _README.md 제외 )"
  echo "ℹ️  제외됐던 비밀 포함 파일·FB 자격증명 실값은 이 공유본에 없음 — 원본 기기에서 별도 전달 필요."
  exit 0
fi

# --- export 모드: 라이브 -> repo ---
if [[ ! -d "$LIVE" ]]; then echo "❌ 라이브 메모리 없음: $LIVE"; exit 1; fi
mkdir -p "$SHARE"

# 기존 .md 정리 (단, 수기 작성한 _README.md 는 보존)
find "$SHARE" -maxdepth 1 -name '*.md' ! -name '_README.md' -delete

excluded=()
copied=0
for f in "$LIVE"/*.md; do
  [[ -e "$f" ]] || continue
  base="$(basename "$f")"

  # MEMORY.md 는 FB 자격증명 블록만 제거하고 포함
  if [[ "$base" == "MEMORY.md" ]]; then
    awk '
      /^## .*자격증명/ {
        inblk=1
        print "## 🔑 Facebook/Meta 자격증명 (현재 활성)"
        print "> ⚠️ 자격증명(App ID·Client Token·Dataset ID 등)은 공유본에서 제거됨. 로컬 라이브 메모리(~/.claude/.../memory/MEMORY.md)에서만 확인."
        next
      }
      inblk && /^## / { inblk=0 }
      !inblk { print }
    ' "$f" > "$SHARE/MEMORY.md"
    copied=$((copied+1))
    continue
  fi

  # 그 외: 비밀 포함 파일은 통째로 제외
  if grep -qIE "$SECRET_RE" "$f"; then
    excluded+=("$base")
    continue
  fi
  cp "$f" "$SHARE/$base"
  copied=$((copied+1))
done

# --- fail-closed: 공유본에 비밀 잔존 시 중단 ---
echo "🔎 공유본 비밀 검증..."
if grep -rIlE "$SECRET_RE" "$SHARE" >/dev/null 2>&1; then
  echo "❌ 공유본에 비밀 잔존! 아래 파일 수동 점검 후 재실행:"
  grep -rIlE "$SECRET_RE" "$SHARE"
  exit 1
fi
echo "✅ 비밀 0건"

echo "📄 공유 $copied 개 / 제외 ${#excluded[@]} 개"
if (( ${#excluded[@]} > 0 )); then
  printf '   제외: %s\n' "${excluded[*]}"
fi

# --- 스테이징 ---
cd "$REPO_ROOT"
git add claude-memory

# 최종 가드: 스테이징된 diff 에 비밀 패턴 있으면 중단
if git diff --cached -- claude-memory | grep -nE "$SECRET_RE" >/dev/null 2>&1; then
  echo "❌ staged diff 에 비밀 패턴 감지 — commit 중단"
  git diff --cached -- claude-memory | grep -nE "$SECRET_RE" | head
  exit 1
fi

if git diff --cached --quiet -- claude-memory; then
  echo "ℹ️  변경 없음 (이미 최신)"
  exit 0
fi

echo "📋 스테이징된 변경:"
git diff --cached --stat -- claude-memory | tail -5

if [[ "${1:-}" == "--push" ]]; then
  git commit -F - <<'MSG'
docs(memory): sync claude-memory shared copy

라이브 auto-memory -> 공유본 동기화. 비밀 포함 파일 자동 제외 + MEMORY.md
자격증명 블록 제거. 검증: 비밀 0건.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG
  git pull --rebase origin main
  git push origin main
  echo "🚀 push 완료"
else
  echo "✅ 스테이징 완료. 커밋하려면:  git commit  또는  bash scripts/sync-memory.sh --push"
fi
