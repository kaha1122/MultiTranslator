---
name: changes-0407
description: 2026-04-07 — Google Sign-In NPE 수정(AccountUpgradeModal useCredentialManager 누락), iOS AdMob no-fill 진단(검토 필요 배지=Apple 심사 대기), Apple ID 6761342764
type: project
---

## 2026-04-07 변경 사항 및 진단

### 1. Google Sign-In NullPointerException 크래시 수정

#### 증상
Firebase Crashlytics 경고: 안드로이드 익명→Google 계정 업그레이드 시 `SignInHubActivity.onCreate`에서 NullPointerException 크래시. 사용자가 며칠 전 "익명에서 계정 전환했는데 email이 없었던 문제"로 겪었던 것과 일치.

#### AI 어드바이저 오진단
"strings.xml에 server_client_id 누락"이라고 진단했으나 **틀림**. 이미 [capacitor.config.json:19](capacitor.config.json#L19)에 `googleProviderWebClientId` 등록되어 있고 `@capacitor-firebase/authentication` 플러그인은 strings.xml이 아니라 이 값을 사용함. Login/Signup/홈 Google 로그인은 정상 동작 중 (changes-0321 메모리 참조).

#### 진짜 원인
[AccountUpgradeModal.jsx:72](src/components/AccountUpgradeModal.jsx#L72)만 `useCredentialManager: false` 옵션 누락. 다른 3곳(App.jsx:1884, Login.jsx:84, Signup.jsx:96)은 모두 옵션 통일됨. changes-0321에서 Play Store 앱서명 SHA-1 환경에서 Credential Manager 경로는 NPE로 깨져서 레거시 Sign-In 강제 필요했는데, AccountUpgradeModal만 누락된 채로 남아있었음.

#### 수정
```js
// AccountUpgradeModal.jsx:72
const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
```
4개 파일 모두 동일 옵션으로 통일. 다음 AAB 빌드부터 적용 (Capgo OTA로는 네이티브 플러그인 동작 변경 안 됨).

---

### 2. iOS AdMob 광고 안 나오는 문제 — "검토 필요" 진단

#### 증상
- iOS 빌드(어제 Apple 심사 제출)에서 AdMob 배너가 안 보임
- 배너 자리에 앱 콘텐츠(Start 버튼)가 비쳐 보임 → 사용자는 "투명 영역 회귀"로 오인

#### 사용자 가설 (틀림)
어제 commit `88cb4c9`(Xcode Build Phase 패치)가 0404의 투명 영역 fix에 사이드이펙트를 줬다고 추측. **검증 결과 사실 아님**:
- `88cb4c9`가 변경한 파일: `.gitignore`, `project.pbxproj`, `package.json`, `package-lock.json`
- L1/L2/L3(App.css body bg, capacitor backgroundColor, pseudo-element) 무수정
- Build Phase 스크립트는 기존 [scripts/build-ios.sh:56-63](scripts/build-ios.sh#L56-L63)과 byte-equivalent (`CapacitorUpdater.autoUpdate=false` + `backgroundColor='#f8fafc'`)
- 0405 이후 관련 파일 변경 커밋은 `291e058`(useAdMob `IS_TESTING true→false`) + `88cb4c9` 단 2개

#### 진짜 원인 (도미노 체인)
1. 어제 `291e058`로 `IS_TESTING = false` (프로덕션 광고 ON)
2. iOS 신규 앱 → AdMob fill rate 0% (Apple 심사 대기 중이라 검토 미통과)
3. `BannerAdPluginEvents.FailedToLoad` 발생 → [useAdMob.js:163-165](src/hooks/useAdMob.js#L163-L165)는 콘솔 로그만 찍음
4. `Loaded`/`SizeChanged` 미발생 → `setOffset(60)` 호출 안 됨 → `--admob-bottom: 0px`
5. **`admob-active` 클래스가 `<html>`에 추가 안 됨**
6. CSS pseudo-element [App.css:52](src/App.css#L52) `html.admob-active.platform-native::after`는 admob-active 클래스 의존 → 활성화 안 됨 → safe-area 커버 사라짐
7. 배너도 없고 커버도 없으니 그 자리에 앱 nav/콘텐츠가 보임 → "투명한 것처럼 보이는" 영역

**핵심**: 0404의 투명 영역 fix는 회귀하지 않았음. 새로운 증상이 발생해서 시각적으로 비슷해 보였을 뿐.

#### AdMob 콘솔 확인 결과
- iOS 앱 등록되어 있음 (PronunFit iOS, Apple ID `6761342764`, Bundle ID `com.arigems.pronunfit`)
- ⚠️ **"검토 필요"** 배지 표시
- 광고 활동 실적: **요청수 12, 노출수 0, 일치율 0.00%**
- 요청은 정상 송신 중 = 코드/Bundle ID/App ID 모두 OK
- AdMob이 검토 미통과 상태로 fill을 0%로 막아둠

#### App Store URL 등록 시도 결과
- AdMob 콘솔 → 앱 인증 → App Store에서 `https://apps.apple.com/app/id6761342764` 검색
- **결과**: "앱을 찾을 수 없습니다"
- **이유**: 앱이 아직 App Store에 라이브가 아님 (Apple 심사 대기 중) → AdMob 크롤러가 공개 페이지를 못 찾음

#### 결정된 대응
1. **Apple 심사 통과 대기** (24~72시간 예상)
2. 라이브 시작되면 AdMob에서 다시 검색 → 선택 → 저장 → 검토 통과 → fill 시작
3. 옵션 2 (CSS 셀렉터 `html.platform-ios::after`로 보강)는 **사용자가 적용 거부** — 심사 통과까지 그냥 기다림

---

### 3. Apple 심사 정보 (재확인용)

| 항목 | 값 |
|------|-----|
| 제출 일시 | 2026-04-06 오후 9:46 |
| 버전 | iOS 1.0 (빌드 81) |
| 상태 | 심사 대기 중 |
| Apple ID | `6761342764` |
| Bundle ID | `com.arigems.pronunfit` |
| App Store URL | `https://apps.apple.com/app/id6761342764` (라이브 후 정상화) |
| SKU | PronunFit_iOS1 |
| 카테고리 | 교육 |
| 제출자 | HaSeungwoo |

### 심사 통과 후 체크리스트

1. App Store URL 접속해서 라이브 페이지 뜨는지 확인
2. AdMob 콘솔 → PronunFit iOS → 앱 설정 → 앱 인증 → URL 검색 → 선택 → 저장
3. AdMob "검토 필요" 배지가 "검토 중" 또는 사라지는지 확인 (수 시간)
4. TestFlight/App Store 빌드에서 실제 광고 표시 확인
5. 며칠 지나도 fill rate 0%면 AdMob 정책 센터 추가 조치 필요

---

---

### 4. v1.2.3 (code 22) AAB 빌드 + 배포

#### 배경
2번 진단으로 NPE 수정이 네이티브 플러그인 동작에 영향 → Capgo OTA로는 불충분 → AAB 빌드 + Play Store 업데이트 필요. 사용자가 production 배포 명시적 요청.

#### 버전 bump
- `android/app/build.gradle`: versionCode 21→22, versionName 1.2.2→1.2.3
- `package.json`: 1.4.14→1.4.15

#### 커밋/배포
- `3136b49` fix(android): 익명→Google 계정 업그레이드 NPE 크래시 해결 — v1.2.3 (code 22)
- main push → Vercel production 자동 배포
- `bash scripts/build-aab.sh` → BUILD SUCCESSFUL in 31s
- AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- Firestore `latestNativeVersion → 1.2.3` 자동 업데이트 완료

#### 사용자 수동 작업 필요
- Play Console → 프로덕션 → 새 버전 만들기 → AAB 업로드 → 출시
- Google Play 자체 심사 수~24시간

#### 주의
Firestore latestNativeVersion이 1.2.3으로 즉시 업데이트되어, Play Store 출시 전까지 기존 사용자가 "업데이트 있음" 팝업을 봐도 Play Store에 신버전이 없는 짧은 윈도우 발생 가능.

---

### 5. 비공개 테스트(Closed testing) 트랙 함정 — 지인 20명 "(체험판)" 표시 문제

#### 증상
지인 20명에게 비공개 테스트로 베타를 돌렸음. 어제 프로덕션 출시 후에도 그들의 폰에서 앱 이름 옆에 "(체험판)" 배지가 사라지지 않음. 사용자가 시도한 것:
- Play Store에서 PronunFit 앱 페이지 → "체험판 종료" 섹션 안 보임 (방법 1 실패)
- 앱 삭제 후 재설치 했지만 여전히 "(체험판)" (방법 B 실패)
- 자가 탈퇴 URL이 떠오르지 않음

#### 근본 원인
**비공개 테스트(Closed testing)는 일반 방법으로 안 풀림**:
- 공개 테스트(Open): URL로 자가 등록/탈퇴 가능
- 내부 테스트(Internal): Play Store 앱에서 "체험판 종료" 버튼 보임
- **비공개 테스트(Closed)**: 이메일 그룹 단위 등록 → **자가 탈퇴 UI 없음**. 개발자만 제거 가능. Google이 의도적으로 그렇게 설계함.

테스터의 디바이스는 한 번 비공개 트랙으로 설치하면 Play Store가 그 디바이스를 "테스터 디바이스"로 마킹 → 항상 테스트 트랙 우선 다운로드 + "(체험판)" 배지 + 프로덕션 동일 버전 출시해도 트랙 분리 유지.

#### 해결 절차 (개발자 + 테스터 양쪽 작업 필요)

**개발자 측 (Play Console)**:
1. Play Console → PronunFit → 좌측 메뉴 **테스트 → 비공개 테스트(Closed testing)**
2. 활성 트랙 클릭 진입
3. **A. 활성 출시 보관**: 출시 탭 → 활성 출시 ⋯ → "출시 중단(Halt rollout)" 또는 "보관(Archive)"
4. **B. 테스터 그룹 제거**: 테스터 탭 → 이메일 목록 통째로 제거 또는 그룹 unlink

**테스터 측** (개발자 작업 후):
1. Play Store 앱 캐시 삭제 (시스템 설정 → 앱 → Google Play 스토어 → 저장공간 → 캐시 삭제)
2. 그래도 안 되면 데이터 삭제 (계정 로그아웃 안 됨, 약관 재동의 필요)
3. PronunFit 앱 삭제 → Play Store에서 재설치
4. 최후 수단: Google 계정 OS 레벨 로그아웃 → 재로그인 → 캐시 삭제 → 재설치

**중요**: 재설치 전에 Google/Email 계정 로그인 상태 확인 필수 (익명 데이터 손실 방지).

#### 동기화 지연
Play Store 서버 + 디바이스 로컬 캐시 동기화에 수 시간~24시간 소요 가능.

#### 향후 베타 테스트 권장사항
**비공개 테스트(Closed) 대신 내부 테스트(Internal testing) 사용**:
- 100명 한도 (지인 20명 충분)
- 테스터가 Play Store 앱에서 자가 탈퇴 가능
- 출시 즉시 반영 (비공개는 검토 대기 있음)
- 관리 단순함

#### 진행 상태
사용자가 Play Console 비공개 테스트 정리 작업 진행 중. 테스터에게 캐시 삭제 가이드 발송 예정.

---

### 검증 방법론 메모 (재발 방지)

이 세션에서 사용자가 "어제 코드 변경이 사이드이펙트를 줬다"고 강하게 의심했지만, **git show + 파일별 책임 매트릭스로 byte-level 검증**한 결과 사실이 아니었음. 향후 회귀 의심 시:

1. `git log --since="..." -- <관련 파일>`로 후보 커밋 압축
2. `git show <commit> --stat`로 변경 파일 확인
3. 각 파일이 영향받는 레이어와 매핑 (예: L1/L2/L3 매트릭스)
4. byte-level 비교가 가능한 경우 두 패치의 의미적 동등성 검증
5. **회귀가 아니라 새 증상일 수 있음**을 항상 고려 (시각적 유사성에 속지 말 것)
