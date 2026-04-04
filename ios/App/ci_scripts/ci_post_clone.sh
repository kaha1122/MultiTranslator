#!/bin/bash
# Xcode Cloud: 클론 직후 실행되는 스크립트
# 환경변수는 App Store Connect → Xcode Cloud → 워크플로 관리 → Environment Variables에서 설정

set -e

echo "=== [1/6] Node.js 설치 ==="
# brew install은 느리므로 이미 설치되어 있으면 스킵
if ! command -v node &> /dev/null; then
  brew install node
else
  echo "Node.js already installed: $(node -v)"
fi

echo "=== [2/6] .env 파일 생성 ==="
cd "$CI_PRIMARY_REPOSITORY_PATH"
cat > .env << EOF
VITE_API_URL=${VITE_API_URL}
VITE_GEMINI_API_KEY=${VITE_GEMINI_API_KEY}
VITE_TOSS_CLIENT_KEY=${VITE_TOSS_CLIENT_KEY}
VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}
VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET}
VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}
VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}
VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID}
VITE_REVENUECAT_ANDROID_KEY=${VITE_REVENUECAT_ANDROID_KEY}
VITE_REVENUECAT_IOS_KEY=${VITE_REVENUECAT_IOS_KEY}
EOF

echo "=== [3/6] npm ci (clean install) ==="
npm ci --prefer-offline

echo "=== [4/6] npm run build ==="
NODE_OPTIONS="--max-old-space-size=4096" npm run build

echo "=== [5/6] cap sync ios ==="
npx cap sync ios

echo "=== [6/6] iOS Capgo autoUpdate 비활성화 ==="
IOS_CAP_CONFIG="$CI_PRIMARY_REPOSITORY_PATH/ios/App/App/capacitor.config.json"
if [ -f "$IOS_CAP_CONFIG" ]; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$IOS_CAP_CONFIG', 'utf8'));
    if (!cfg.plugins) cfg.plugins = {};
    cfg.plugins.CapacitorUpdater = { autoUpdate: false };
    fs.writeFileSync('$IOS_CAP_CONFIG', JSON.stringify(cfg, null, '\t') + '\n');
    console.log('iOS capacitor.config.json: autoUpdate -> false');
  "
fi

echo "=== Build ready ==="
