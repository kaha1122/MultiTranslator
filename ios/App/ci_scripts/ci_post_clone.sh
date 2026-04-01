#!/bin/bash
# Xcode Cloud: 클론 직후 실행되는 스크립트
# Capacitor 프로젝트는 웹 빌드 → cap sync가 필요합니다.

set -e  # 에러 발생 시 즉시 중단

echo "=== [1/4] Node.js 설치 ==="
# Xcode Cloud에는 Node.js가 없으므로 brew로 설치
brew install node

echo "=== [2/4] npm install ==="
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "=== [3/4] npm run build ==="
npm run build

echo "=== [4/4] cap sync ios ==="
npx cap sync ios

echo "=== 빌드 준비 완료 ==="
