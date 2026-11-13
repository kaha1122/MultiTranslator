#!/bin/bash
# Vercel Ignored Build Step (vercel.json ignoreCommand) — exit 1 = 빌드, exit 0 = 스킵.
#
# 웹 번들(vite build)과 무관한 경로만 바뀐 푸시는 빌드를 건너뛴다.
#   server/         Render 백엔드(별도 package.json, Vercel과 무관)
#   android/ ios/   네이티브 프로젝트
#   promo_images/ LandingPageImage*/ claude-memory/ docs/ .claude/ .github/ .devcontainer/
#   루트의 *.md, generate_ppt.py
# 그 외(src·public·api·index.html·package.json·vite.config.js·vercel.json·scripts 등)는 빌드.
#
# 비교 구간: 마지막으로 배포에 성공한 커밋(VERCEL_GIT_PREVIOUS_SHA) ~ HEAD.
#   staging 머지처럼 여러 커밋이 한 번에 올라와도 앞쪽 커밋의 변경을 놓치지 않는다.
#   그 커밋이 얕은 클론에 없으면 HEAD^ 로 폴백. 빈 커밋(재트리거)·판단 불가는 빌드.

last=$(git diff --name-only HEAD^ HEAD 2>/dev/null)
if [ -z "$last" ]; then exit 1; fi

base="HEAD^"
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  base="$VERCEL_GIT_PREVIOUS_SHA"
fi
f=$(git diff --name-only "$base" HEAD 2>/dev/null)
if [ -z "$f" ]; then f="$last"; fi

if echo "$f" | grep -qvE '^(server|android|ios|promo_images|LandingPageImage1?|claude-memory|docs|\.claude|\.github|\.devcontainer)/|^[^/]+\.md$|^generate_ppt\.py$'; then exit 1; fi
exit 0
