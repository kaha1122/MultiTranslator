#!/bin/bash
# ─── iOS IPA 빌드 + Firestore latestNativeVersion 자동 업데이트 ───
# 사용법: bash scripts/build-ios.sh
#
# 이 스크립트는:
# 1. Xcode 프로젝트에서 버전 읽기
# 2. 웹 번들 빌드 (npm run build)
# 3. Capacitor sync ios
# 4. Xcode archive + export IPA
# 5. 서버 API를 통해 Firestore config/app.latestNativeVersionIOS 업데이트
#
# 필수 조건: macOS + Xcode + Apple Developer 계정 (Code Signing)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$PROJECT_DIR/ios"
XCODE_PROJECT="$IOS_DIR/App/App.xcodeproj"
XCODE_WORKSPACE="$IOS_DIR/App/App.xcworkspace"
SCHEME="App"
ARCHIVE_PATH="$IOS_DIR/build/PronunFit.xcarchive"
EXPORT_PATH="$IOS_DIR/build/export"

# ── 설정 ──
SERVER_URL="${SERVER_URL:-https://multitranslator.onrender.com}"
BUILD_SECRET="${BUILD_SECRET:-pronunfit-build-2026-secret}"

# 1. Xcode 프로젝트에서 버전 읽기
VERSION_NAME=$(xcodebuild -project "$XCODE_PROJECT" -showBuildSettings 2>/dev/null | grep "MARKETING_VERSION" | head -1 | awk '{print $NF}')
VERSION_CODE=$(xcodebuild -project "$XCODE_PROJECT" -showBuildSettings 2>/dev/null | grep "CURRENT_PROJECT_VERSION" | head -1 | awk '{print $NF}')

if [ -z "$VERSION_NAME" ]; then
  echo "❌ MARKETING_VERSION을 찾을 수 없습니다."
  exit 1
fi

echo "📦 iOS 네이티브 버전: v${VERSION_NAME} (build: ${VERSION_CODE})"
echo ""

# 2. 웹 빌드
echo "🔨 웹 번들 빌드 중..."
cd "$PROJECT_DIR"
npm run build
echo ""

# 3. Capacitor sync
echo "🔄 Capacitor sync iOS..."
npx cap sync ios

# iOS Capgo autoUpdate 비활성화
# cap sync가 루트 capacitor.config.json을 iOS로 복사하는데,
# iOS에서는 Capgo OTA를 사용하지 않으므로 autoUpdate를 꺼야 함
IOS_CAP_CONFIG="$IOS_DIR/App/App/capacitor.config.json"
if [ -f "$IOS_CAP_CONFIG" ]; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$IOS_CAP_CONFIG', 'utf8'));
    cfg.plugins.CapacitorUpdater = { autoUpdate: false };
    cfg.backgroundColor = '#f8fafc';
    fs.writeFileSync('$IOS_CAP_CONFIG', JSON.stringify(cfg, null, '\t') + '\n');
    console.log('✅ iOS capacitor.config.json: autoUpdate → false, backgroundColor → #f8fafc');
  "
fi
echo ""

# 4. CocoaPods install (필요 시)
if [ -f "$IOS_DIR/App/Podfile" ]; then
  echo "📦 CocoaPods install..."
  cd "$IOS_DIR/App"
  pod install
  cd "$PROJECT_DIR"
  echo ""
fi

# 5. Xcode Archive
echo "🏗️  Xcode Archive 중..."
WORKSPACE_OR_PROJECT=""
if [ -d "$XCODE_WORKSPACE" ]; then
  WORKSPACE_OR_PROJECT="-workspace $XCODE_WORKSPACE"
else
  WORKSPACE_OR_PROJECT="-project $XCODE_PROJECT"
fi

xcodebuild archive \
  $WORKSPACE_OR_PROJECT \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=iOS" \
  CODE_SIGN_STYLE=Automatic \
  | tail -5

echo ""
echo "✅ Archive 완료: $ARCHIVE_PATH"
echo ""

# 6. Export IPA (ExportOptions.plist 필요)
EXPORT_OPTIONS="$IOS_DIR/ExportOptions.plist"
if [ -f "$EXPORT_OPTIONS" ]; then
  echo "📤 IPA Export 중..."
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    | tail -3

  echo ""
  echo "✅ IPA Export 완료: $EXPORT_PATH"
else
  echo "⚠️  ExportOptions.plist 없음 — Xcode Organizer에서 수동 업로드하세요."
  echo "   Archive 위치: $ARCHIVE_PATH"
fi

echo ""

# 7. 서버 API로 Firestore 업데이트
# ⚠️ 권장: 빌드 직후 자동 갱신은 비활성화하고, App Store 실제 출시 확정 후 수동 갱신.
#   이유: 빌드 vs 공개 시점 괴리로 사용자에게 "없는 버전" 업데이트 팝업 방지
#   (memory: feedback_manual_native_version_update.md)
# 그래도 자동 갱신을 원할 경우 아래 echo 주석 제거.
echo "☁️  Firestore 업데이트 SKIP (수동 갱신 권장 — App Store 출시 확정 후)"
echo "   수동 갱신 시: curl -X POST ${SERVER_URL}/api/config/app \\"
echo "                 -H 'Authorization: Bearer \${BUILD_SECRET}' \\"
echo "                 -d '{\"latestIOSVersion\": \"${VERSION_NAME}\"}'"
HTTP_CODE="000"
# 자동 갱신을 원하면 아래 주석을 해제:
# HTTP_CODE=$(curl -s -o /tmp/config_response_ios.txt -w "%{http_code}" \
#   -X POST "${SERVER_URL}/api/config/app" \
#   -H "Content-Type: application/json" \
#   -H "Authorization: Bearer ${BUILD_SECRET}" \
#   -d "{\"latestIOSVersion\": \"${VERSION_NAME}\"}")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Firestore 업데이트 완료"
elif [ "$HTTP_CODE" = "000" ]; then
  : # 의도적으로 SKIP
else
  echo "⚠️  Firestore 업데이트 실패 (HTTP $HTTP_CODE)"
  cat /tmp/config_response_ios.txt 2>/dev/null
  echo ""
fi

echo ""
echo "🎉 iOS 빌드 완료!"
echo "   Archive: $ARCHIVE_PATH"
echo "   iOS: v${VERSION_NAME} (build ${VERSION_CODE})"
echo ""
echo "👉 다음 단계: Xcode Organizer 또는 Transporter로 App Store Connect에 업로드하세요."
