#!/bin/bash
# Xcode Cloud: 클론 직후 실행되는 스크립트
#
# 환경변수 처리: 모든 VITE_* 환경변수는 git에 commit된 .env.production 에서 자동 로드.
#   (이전에는 이 스크립트가 .env 파일을 expand로 만들었으나, .env.production이 cover하므로 제거.)
#   Xcode Cloud Workflow에 등록된 환경변수는 Vite의 process.env 우선순위로 자동 적용됨.
#
# Capgo OTA: autoUpdate=true (capacitor.config.json) — iOS에도 활성화됨.
#   (이전 patch 로직은 build-ios.sh / project.pbxproj Run Script와 함께 제거됨.)

set -e

echo "=== [1/3] Node.js 설치 ==="
# brew install은 느리므로 이미 설치되어 있으면 스킵
if ! command -v node &> /dev/null; then
  brew install node
else
  echo "Node.js already installed: $(node -v)"
fi

echo "=== [2/3] npm ci (clean install) ==="
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci --prefer-offline

echo "=== [3/3] npm run build + cap sync ios ==="
NODE_OPTIONS="--max-old-space-size=4096" npm run build
npx cap sync ios

echo "=== Build ready ==="
