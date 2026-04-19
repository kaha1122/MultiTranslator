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
SERVER_URL="${SERVER_URL:-https://multitranslator.onrender.com}"
BUILD_SECRET="${BUILD_SECRET:-pronunfit-build-2026-secret}"

# 1. build.gradle에서 버전 읽기 (awk 기반, Windows Git Bash/macOS/Linux 호환)
VERSION_NAME=$(grep 'versionName' "$GRADLE_FILE" | head -1 | awk -F'"' '{print $2}')
VERSION_CODE=$(grep 'versionCode' "$GRADLE_FILE" | head -1 | awk '{print $2}')

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

# ⚠️ Firestore latestNativeVersion 자동 업데이트는 의도적으로 제거됨 (2026-04-19)
# 이유: AAB 빌드와 Play Store 공개 시점 사이에 수시간~수일 괴리가 있는데,
# 자동 업데이트하면 기존 사용자에게 "아직 받을 수 없는 버전" 업데이트 팝업이 뜸.
# Play Store에 프로덕션 승격이 실제로 완료된 후 Firestore에서 수동으로 업데이트할 것:
#   Firebase Console → Firestore → config/app → latestNativeVersion = "$VERSION_NAME"

echo "🎉 빌드 완료!"
echo "   AAB: $AAB_PATH"
echo "   네이티브: v${VERSION_NAME} (code ${VERSION_CODE})"
echo ""
echo "👉 다음 단계:"
echo "   1. Google Play Console에 AAB 업로드"
echo "   2. 내부 테스트 → 프로덕션 승격 완료 확인"
echo "   3. Firebase Console에서 config/app.latestNativeVersion을 \"${VERSION_NAME}\"로 수동 업데이트"
echo "      (이 순서를 지켜야 기존 사용자에게 '없는 버전' 업데이트 팝업이 안 뜸)"
