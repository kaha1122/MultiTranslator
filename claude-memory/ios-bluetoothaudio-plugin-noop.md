---
name: ios-bluetoothaudio-plugin-noop
description: iOS BluetoothAudioPlugin은 pbxproj Sources 미포함 + Capacitor 8 packageClassList 미등록으로 실기기에서 전부 no-op — v1.5.67~74 발열 완화가 실제로 배포된 적 없음 (2026-07-06 확정)
metadata: 
  node_type: memory
  type: project
  originSessionId: 35ce7300-efb5-4d73-9290-3f0ae6e2b5b1
---

2026-07-06 검증 확정 (Kdramaanylang 피드백 계기): PronunFit iOS의 `BluetoothAudioPlugin.m/.swift`는 `ios/App/App/`에 존재하지만 **project.pbxproj Sources에 AppDelegate.swift만 등록**되어 있어 컴파일 자체가 안 됨. 또한 Capacitor 8은 `registerPlugins()`가 번들 `capacitor.config.json`의 `packageClassList`(cap sync가 node_modules 스캔으로 덮어씀)만 로드하므로, 컴파일되더라도 인앱 플러그인 등록 경로가 없음 (CAP_PLUGIN 매크로 런타임 스캔은 Capacitor 5에서 제거됨).

**결과**: iOS에서 BluetoothAudio 전 메서드(endAudioSession, scheduleEndAudioSession, deactivateAudioSession, activateAudioSession, startBluetoothSco 등)가 조용히 reject → `.catch(() => {})`로 무증상. 즉 CLAUDE.md에 "확정"으로 기록된 v1.5.67/1.5.73/1.5.74 iOS 발열 완화(Pattern 1/4)와 2026-06-17 광고 후 세션 해제 수정은 **실기기에서 한 번도 동작한 적 없음**. Android는 MainActivity.registerPlugin으로 정상.

**How to apply**: 수정 시 ① pbxproj Sources에 .swift 추가(.m은 잔재 — .swift가 이미 CAPBridgedPlugin 채택이므로 삭제) ② `CAPBridgeViewController` 서브클래스 `capacitorDidLoad`에서 `bridge?.registerPluginInstance(BluetoothAudioPlugin())` + Main.storyboard customClass 교체 (packageClassList 수동 편집은 cap sync가 덮어써서 불가). 네이티브 변경이므로 OTA 불가, IPA 재빌드 필요. 수정 전까지 iOS 발열 관련 기존 "해결" 기록은 신뢰 금지.
