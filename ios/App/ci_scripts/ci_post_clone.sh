#!/bin/bash
# Xcode Cloud: 클론 직후 실행되는 스크립트
# 환경변수는 App Store Connect → Xcode Cloud → 워크플로 관리 → Environment Variables에서 설정
# ⚠️ 절대 이 스크립트에 API 키를 하드코딩하지 말 것!

set -e

echo "=== [1/5] Node.js 설치 ==="
brew install node

echo "=== [2/5] 환경변수 → .env 파일 생성 ==="
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

echo "=== [3/5] npm install ==="
npm install

echo "=== [4/5] npm run build ==="
npm run build

echo "=== [5/5] cap sync ios ==="
npx cap sync ios

echo "=== 빌드 준비 완료 ==="
