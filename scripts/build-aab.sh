#!/bin/bash
# ─── AAB 빌드 + Firestore latestNativeVersion 자동 업데이트 ───
# 사용법: bash scripts/build-aab.sh
#
# 이 스크립트는:
# 1. build.gradle에서 versionName 읽기
# 2. 웹 번들 빌드 (npm run build)
# 3. Capacitor sync
# 4. AAB 빌드 (gradlew bundleRelease)
# 5. 서버 API를 통해 Firestore config/app.latestNativeVersion 업데이트
#
# 앱 실행 시 Firestore의 latestNativeVersion > 설치된 버전이면 업데이트 팝업 표시

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$PROJECT_DIR/android"
GRADLE_FILE="$ANDROID_DIR/app/build.gradle"

# ── 설정 ──
SERVER_URL="${SERVER_URL:-https://pronunfit-server.onrender.com}"
BUILD_SECRET="${BUILD_SECRET:-pronunfit-build-2026-secret}"

# 1. build.gradle에서 버전 읽기
VERSION_NAME=$(grep -oP 'versionName\s+"\K[^"]+' "$GRADLE_FILE")
VERSION_CODE=$(grep -oP 'versionCode\s+\K[0-9]+' "$GRADLE_FILE")

if [ -z "$VERSION_NAME" ]; then
  echo "❌ versionName을 찾을 수 없습니다."
  exit 1
fi

echo "📦 네이티브 버전: v${VERSION_NAME} (code: ${VERSION_CODE})"
echo ""

# 2. 웹 빌드
echo "🔨 웹 번들 빌드 중..."
cd "$PROJECT_DIR"
npm run build
echo ""

# 3. Capacitor sync
echo "🔄 Capacitor sync..."
npx cap sync android
echo ""

# 4. AAB 빌드
echo "🏗️  AAB 빌드 중..."
cd "$ANDROID_DIR"
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew bundleRelease

AAB_PATH="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
echo ""
echo "✅ AAB 빌드 완료: $AAB_PATH"
echo ""

# 5. 서버 API로 Firestore 업데이트
echo "☁️  Firestore 업데이트 중... (latestNativeVersion → $VERSION_NAME)"
HTTP_CODE=$(curl -s -o /tmp/config_response.txt -w "%{http_code}" \
  -X POST "${SERVER_URL}/api/config/app" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BUILD_SECRET}" \
  -d "{\"latestNativeVersion\": \"${VERSION_NAME}\"}")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Firestore 업데이트 완료"
else
  echo "⚠️  Firestore 업데이트 실패 (HTTP $HTTP_CODE)"
  cat /tmp/config_response.txt 2>/dev/null
  echo ""
  echo "   서버에 BUILD_SECRET 환경변수가 설정되어 있는지 확인하세요."
fi

echo ""
echo "🎉 빌드 완료!"
echo "   AAB: $AAB_PATH"
echo "   네이티브: v${VERSION_NAME} (code ${VERSION_CODE})"
echo ""
echo "👉 다음 단계: Google Play Console에 AAB를 업로드하세요."
