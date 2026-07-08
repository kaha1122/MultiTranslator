---
name: 2026-05-15 세션 — Capgo 1.5.34 native required 진단 + 1.5.35 OTA + Streak Risk TZ fix
description: codespace pull 후 1.5.34 OTA 차단 진단(@capacitor/share native 의존) → 1.5.33 롤백 → share 제거 + --ignore-metadata-check로 1.5.35 강제 OTA. Streak risk push 컷오프 timezone 버그 발견 + 수정.
type: project
originSessionId: 43570a4d-6d9d-41a3-9155-579eec31f327
---
# 2026-05-15 세션 종합

## 1️⃣ Capgo 1.5.34 OTA 차단 진단 + 1.5.35 우회 배포

### 증상
사용자 보고: "오늘 Capgo로 배포한 1.5.34가 앱에서 업데이트 안 됨". Capgo 시스템 장애(오전 timeout) 이후 발생.

### 진단 — 시스템 장애 아니라 native 호환성 차단
```bash
npx @capgo/cli@latest bundle releaseType com.arigems.pronunfit --channel production
# Recommendation: native
```

`bundle compatibility` 체크 결과 10개 plugin이 "iOS and Android native code changed"로 ❌. 핵심:
```
@capacitor/share  Local=- Remote=8.0.1  ✅ "Package only exists on remote (will be removed)"
```

### 근본 원인 — codespace에서 들어온 share native 의존
- 어제 main pull로 `android/app/capacitor.build.gradle` + `android/capacitor.settings.gradle`에 `@capacitor/share` 참조 modified 상태로 들어옴
- `package.json`에 `@capacitor/share: ^8.0.1` dependency 등록되어 있었음
- Play Store 배포 AAB(v1.2.10/v1.2.11)에는 share 미포함 → Capgo가 native 호환성 깨졌다고 판단 → OTA 차단

### 대응 흐름
1. **즉시 롤백**: `channel set production --bundle 1.5.33` (해당 시점엔 share 영향 받기 전 마지막 안정 번들)
2. **share 제거 시도**: `npm uninstall @capacitor/share` + `git checkout android/*.gradle`
3. **여전히 `releaseType: native`** — 9개 plugin도 ❌ 표시. Capgo의 conservative 휴리스틱.
4. **결정적 검증**: JS 코드에서 `@capacitor/*` import 전수 grep → `@capacitor/core` + `@capacitor/app` 둘뿐 (둘 다 기존 AAB 포함). 새 native 호출 0건.
5. **강제 업로드**: `bundle upload --ignore-metadata-check`. Checksum check는 통과 ("compatible with production channel"). 9.53초 만에 성공.
6. **검증**: `channel currentBundle production` → `1.5.35` ✅

### 학습
- **`--ignore-metadata-check`**: Capgo의 사전 native 호환성 체크만 우회. checksum/실제 번들 검증은 별도로 통과해야 함. **JS 코드에 새 native plugin 호출이 없을 때만 안전.**
- **Capgo compatibility 체크는 보수적**: 같은 plugin 버전이라도 lockfile/manifest hash 차이로 "native code changed" 표시함. 실제 native 호환은 더 좁은 조건.
- **share 임시 제거 상태**: 1.5.35는 share 미포함. `pending-aab-fixes.md` ③번 항목(ReferralModal Android 분기 부활)은 여전히 다음 native AAB 시점에 처리. 그동안 Android 친구추천은 `navigator.share` 미노출 → 클립보드 fallback만 동작.

### Working tree 보류 상태
- `package.json` (1.5.34 → 1.5.35, share dependency 제거) — main에 commit 안 함
- `package-lock.json` — 동일
- → 다음 native AAB 빌드 시 share 재설치할 거라 working tree에 보존. 다른 PC에서 작업 시 share 재install 가능성 있음.

## 2️⃣ Streak Risk Push timezone 버그 발견 + 수정 (Render production 배포)

### 증상
사용자 보고: "3일 연속 streak 이후 미접속 시 22시까지 안 하면 구제 푸시 받아야 하는데 오늘 안 옴".

### 진단 — `lastActiveAt` 컷오프가 server UTC 기준이라 한/일 사용자 자동 탈락

[server/routes/reengagement.js](server/routes/reengagement.js)의 `processStreakRiskForCountry`:
```js
// 잘못된 코드 (수정 전)
const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
// .where('lastActiveAt', '<', tsStartOfToday)
```

Render UTC 기준 → UTC 00:00 = KST/JST 09:00. 한/일 사용자가 09시 이후 어떤 학습이라도 했으면 무조건 탈락.

### 사용자 케이스 (vTXu7ZlWNXMOjXw5Orco2KKUaR72 = sw.haka@gmail.com)
```json
"tier": "trial",                                  // 정기구독 자동갱신 실패로 다운그레이드
"lifecycleStage": "subscriber",                   // 과거 구독자 이력 보존 (정상)
"currentNativePlatform": "android",
"currentNativeVersion": "1.2.11",
"geoCountry": "JP",                               // 일본 출장 중 IP 기반 (정상)
"deviceLang": "ko",
"lastActiveAt": "2026-05-15T00:45:30Z",           // = 09:45 KST (본인 학습)
"streakCurrent": 4,                               // 22시 학습으로 3→4 증가
"streakUpdatedAt": "2026-05-15T13:26:11Z",        // = 22:26 KST
"fcmTokensCount": 2,
```
→ `00:45 UTC > 00:00 UTC(server)` → `< tsStartOfToday` 실패 → 후보 탈락

### 수정 (commit `df7d0fd`, main push, Render 자동 배포)

`server/utils/countryTimezone.js`에 헬퍼 3개 추가:
- `getLocalDateParts(country, now)` — IANA TZ로 country 현재 Y/M/D/h/m/s 추출
- `getLocalDateStr(country, now)` — 'YYYY-MM-DD' (country local)
- `getLocalStartOfToday(country, now)` — Date (country local 자정의 UTC ms)

`processStreakRiskForCountry` 적용:
```js
const todayStr = getLocalDateStr(country, now);          // country local
const startOfToday = getLocalStartOfToday(country, now); // country local 자정
const tsStartOfToday = Timestamp.fromDate(startOfToday);
```

### 효과
- 한/일 사용자가 본인 시간대 자정 이후 활동 없을 때만 후보로 잡힘 (의도된 동작)
- Re-engagement D1~D6 cron(`processWindow`)은 별도 로직이라 무영향. 그쪽도 UTC 기준 가능성 — 추후 점검 가치.

## 3️⃣ 진단 스크립트 확장

`server/check-user-tier.js`에 11개 필드 추가:
- Geo/Push reach: `geoCountry`, `deviceLang`, `fcmTokensCount`, `lifecycleStage`, `reengagementOptOut`
- Streak: `streakCurrent/Longest/UpdatedAt`, `earnedMilestones`, `streakIntroDismissed`, `streakRiskOptOut`, `lastStreakRiskPush{Date,At}`
- + `lastActiveDay`

호출어 "**진단 스크립트로 UID 확인해줘**"가 streak/reengagement 디버깅에도 그대로 활용됨.

## 4️⃣ Trial vs Subscriber 모순의 정상 설명 (사용자 확인)

사용자 본인 확인: **"정기 구독 후 자동갱신 실패 → tier만 trial로 다운그레이드, lifecycleStage='subscriber'는 과거 구독자 이력으로 보존"**. 별도 cleanup 불필요한 의도된 동작. 진단 시 이 패턴이 자주 보일 것.

## 5️⃣ geoCountry stale 가능성 (관찰)

사용자가 일본 출장 후 한국 귀국. geoCountry는 IP 기반이라 한 번 set 후 갱신 시점이 명확하지 않음. KST=JST(UTC+9)라 streak risk cron 동작에는 영향 없지만, 향후 Phase 2 분리(US 동/중부 등) 시 이슈 가능. 별도 추적 작업은 보류.

## 변경된 파일 (server-only — Render 자동 배포)

| 파일 | 변경 |
|---|---|
| [server/utils/countryTimezone.js](server/utils/countryTimezone.js) | `getLocalDateParts/Str/getLocalStartOfToday` 추가 |
| [server/routes/reengagement.js](server/routes/reengagement.js) | `processStreakRiskForCountry` country local TZ 적용, `toLocalDateStr` 제거 |
| [server/check-user-tier.js](server/check-user-tier.js) | streak/geo/reengagement 11개 필드 출력 |

## 검증 권장

내일(2026-05-16) 사용자가 본인 시간대 자정~22시 사이에 학습 안 한 경우, 22:00 KST/JST cron에서 push 받는지 확인. `lastStreakRiskPushDate/At` 필드 갱신 여부로 검증.
