---
name: iOS Capgo OTA 재활성화 (2026-05-07)
description: iOS Capgo OTA 비활성화 룰 폐기 — autoUpdate=true 유지, Android와 동일하게 iOS도 OTA 자동화 적용
type: project
originSessionId: 6ef15aab-9f8a-4f40-9bae-d9f7e43530cf
---
iOS에서도 Capgo OTA를 정식 사용한다. 과거 "iOS Capgo OTA 비활성화 유지" 룰은 **폐기**됐다.

**Why:**
- 사용자가 2026-05-07 명시적으로 룰 제거를 요청 — "Capgo를 이용해 자동화해야 할 것 같다"
- 직전 push에 commit `e7f108d` (feat(ios,capgo): iOS Capgo OTA 활성화 (autoUpdate=true) + ci_post_clone 정리) 가 main에 머지되어 이미 적용됨
- 과거(2026-04-03) iOS 무한 reload 이슈로 빌드 스크립트가 `autoUpdate`를 false로 강제 patch하던 흐름은 이번 변경으로 정리됨

**How to apply:**
- `capacitor.config.json`의 `CapacitorUpdater.autoUpdate`는 **iOS/Android 공통 true** — 다시 false로 되돌리지 말 것
- `scripts/build-ios.sh` / `ios/App/ci_scripts/ci_post_clone.sh`에서 autoUpdate를 false로 패치하는 로직이 있다면 추가 금지 (직전 커밋에서 정리됨)
- Capgo upload 시 채널은 Android와 동일하게 `production` / `staging`. iOS도 `npx @capgo/cli bundle upload --channel <ch>` 후 `channel currentBundle <ch>` 검증
- `changes-0402-session2.md` / `changes-0403.md` 의 "iOS Capgo OTA 비활성화" 기술은 **historical record** 이다. 그 시점엔 사실이었지만 현재 룰이 아니므로 그 메모리만 보고 비활성화 작업을 다시 수행하지 말 것
- 만약 iOS에서 무한 reload 회귀가 재발하면 **즉시 비활성화하지 말고 사용자에게 보고** — 이번엔 자동화 유지가 우선순위
- 네이티브 변경(Swift/Plugin 추가)은 여전히 OTA 불가 → IPA 재빌드 필수

## 2026-05-09 후속 검증 — 무한 reload 회귀 재발 없음 (확정)

`d915fb9`(JS 레이어 reset-to-builtin 제거) + Capgo v1.5.6 production 첫 적용 후 사용자 검증:
- 1.3.0 build 4 + 88 + 89 + 90 + 91 (연속 빌드)
- v1.5.6 OTA 적용 시점 launch
- 위 모든 단계에서 무한 reload 재현되지 않음

→ **iOS Capgo OTA 안정 판정**. 향후 일상 운영 시 무한 reload 위험은 해소된 것으로 간주. 다만 OTA 적용 직후 새 launch는 항상 짧게 모니터링 권장 (Capgo plugin 자체 버그/네트워크 race 가능성).
