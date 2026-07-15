#!/usr/bin/env bash
#
# sync-memory.sh — Claude Code 로컬 auto-memory <-> repo 공유본 동기화
#
#   라이브 메모리: ~/.claude/projects/<repo-slug>/memory/  (드라이브·위치 자동 해석)
#                  예) D PC: d--Projects-multiTranslator / C PC: c--...-multiTranslator
#   repo 공유본  : <repo>/claude-memory/
#
# 두 대 이상의 PC가 동일 스크립트(GitHub 공유본)로 상호 동작한다. 각 PC는 실행 시점에
# 자기 repo 절대경로로부터 라이브 메모리 슬러그를 스스로 계산하므로 하드코딩이 없다.
# 자동 탐지 실패 시 CLAUDE_MEMORY_DIR 환경변수로 라이브 메모리 경로를 직접 지정 가능.
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
SHARE="$REPO_ROOT/claude-memory"
PROJECTS="$HOME/.claude/projects"

# 라이브 메모리 경로는 repo 위치(드라이브·폴더)에 따라 달라지므로 하드코딩하지 않고
# 동적으로 해석한다. Claude Code 슬러그 규칙: 프로젝트 절대경로의 ':' '\' '/' 를
# 각각 '-' 로 치환하고 드라이브 문자를 소문자화.
#   예) D:/Projects/multiTranslator -> d--Projects-multiTranslator
#       C:/work/multiTranslator     -> c--work-multiTranslator
_win="$(cd "$REPO_ROOT" && pwd -W 2>/dev/null || true)"   # Git Bash 전용; 없으면 빈값
SLUG_PATH=""
if [[ -n "$_win" ]]; then
  _slug="$(printf '%s' "$_win" | sed -E 's#[:/\\]#-#g')"
  _slug="$(printf '%s' "${_slug:0:1}" | tr 'A-Z' 'a-z')${_slug:1}"
  SLUG_PATH="$PROJECTS/$_slug/memory"
fi

# 존재하는 라이브 메모리 디렉터리 탐지: env override > 슬러그 경로 > basename 글롭
resolve_live() {
  if [[ -n "${CLAUDE_MEMORY_DIR:-}" && -d "${CLAUDE_MEMORY_DIR}" ]]; then
    printf '%s' "$CLAUDE_MEMORY_DIR"; return 0
  fi
  if [[ -n "$SLUG_PATH" && -d "$SLUG_PATH" ]]; then
    printf '%s' "$SLUG_PATH"; return 0
  fi
  # 폴백: ~/.claude/projects/ 에서 repo basename 으로 끝나고 memory/ 를 가진 폴더
  local base match
  base="$(basename "$REPO_ROOT")"
  match="$(find "$PROJECTS" -maxdepth 1 -type d -iname "*-${base}" 2>/dev/null \
            | while read -r d; do [[ -d "$d/memory" ]] && echo "$d/memory"; done \
            | head -1)"
  [[ -n "$match" ]] && { printf '%s' "$match"; return 0; }
  return 1
}

LIVE="$(resolve_live || true)"

# 공유본에서 비밀로 간주하는 패턴 (이게 들어간 파일은 통째로 제외)
SECRET_RE='PronunFit2026|AIzaSy[0-9A-Za-z_-]{30}|[0-9a-f]{32,}|Bearer [A-Za-z0-9]{8,}'

# --- restore 모드: repo -> 라이브 ---
if [[ "${1:-}" == "--restore" ]]; then
  if [[ ! -d "$SHARE" ]]; then echo "❌ $SHARE 없음. repo clone 먼저."; exit 1; fi
  # 새 기기는 라이브 폴더가 아직 없을 수 있음 → 슬러그/override 로 생성
  if [[ -z "$LIVE" ]]; then LIVE="${CLAUDE_MEMORY_DIR:-$SLUG_PATH}"; fi
  if [[ -z "$LIVE" ]]; then
    echo "❌ 라이브 메모리 경로를 결정할 수 없음. CLAUDE_MEMORY_DIR 로 지정하세요."; exit 1
  fi
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
if [[ -z "$LIVE" || ! -d "$LIVE" ]]; then
  echo "❌ 라이브 메모리 디렉터리를 찾지 못함."
  echo "   탐지 시도: ${SLUG_PATH:-(슬러그 계산 실패)}"
  echo "   수동 지정: CLAUDE_MEMORY_DIR=/c/Users/<you>/.claude/projects/<slug>/memory npm run sync-memory"
  echo "   확인:     ls \"$PROJECTS\""
  exit 1
fi
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
