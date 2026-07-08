---
name: changes-0325
description: 2026-03-25 작업 — 익명→실계정 연결, 데이터 마이그레이션, 구독 만료/다운그레이드 완성, RevenueCat Pub/Sub 연동, 광고 tier 반응형, 러시아어 강세, UI 축소
type: project
---

# 2026-03-25 변경 사항 (v1.3.67 ~ v1.3.85)

## 1. 네이티브 익명→Google 업그레이드 UID 보존 (v1.3.67)

**문제**: 네이티브 앱에서 익명 → Google 로그인 시 새 UID 생성, 기존 학습 데이터 orphan.

**원인**: `capacitor.config.json`의 `skipNativeAuth: false` → `signInWithGoogle()`이 네이티브+웹 양쪽 로그인 → `auth.currentUser`가 교체되어 `linkWithCredential` 실패.

**수정**: `skipNativeAuth: true` → credential만 반환, 익명 유저 유지되어 linking 성공. Login/Signup/App.jsx는 `signInWithCredential()` 명시 호출하므로 영향 없음.

## 2. Vocab 카테고리 폴더 테마 컬러 border (v1.3.68)

`VocabTab.jsx/css` — 7개 카테고리별 고유색 (daily:emerald, travel:blue, business:amber, education:violet, social:pink, tech:cyan, culture:orange). CSS 변수 `--cat-theme`, `.vocab-category--open` 클래스.

## 3. Admin Auth 삭제 엔드포인트 (v1.3.69)

`POST /api/admin/delete-auth-by-email` — BUILD_SECRET 인증, `dryRun` 옵션. 테스트 시 Firebase Auth orphan 레코드 삭제용.

## 4. 재방문 유저 익명→기존계정 데이터 마이그레이션 (v1.3.69~v1.3.71)

### 서버: `POST /api/migrate-anonymous`
- savedCards `userId` 업데이트
- 서브컬렉션(pronunciation_records, dailyProgress, sceneHistory, vocabHistory) merge 복사
- 카운터 합산 (increment): trialCardCount, savedCardCount, trialPronCount, 각종 GenerateCount
- 온보딩 상태 보존, 익명 Firestore+Auth 삭제

### 클라이언트 (3개 파일)
- **AccountUpgradeModal.jsx**: `credential-already-in-use` → `signInWithCredential` → migrate API (Google/Facebook/Email)
- **Login.jsx**: 기존 계정 로그인 시 `prevAnonUid` 저장 → 성공 후 migrate
- **Signup.jsx**: 회원가입 시 동일 패턴
- App.jsx 랜딩 로그인은 미적용 (anonymous 없으므로 불필요)

### 테스트 결과 ✅
- 앱 삭제 → 재설치 → 익명 → Google 로그인 → 기존 계정 복원 + 익명 데이터 마이그레이션 성공

## 5. RevenueCat → Firestore 동기화 보강 (v1.3.72~v1.3.73)

- 클라이언트 `getCustomerInfo()` 동기화에 `subscriptionExpiresAt`, `autoRenew` 추가
- `needsExpirySync`: expiresAt 없으면 tier 동일해도 동기화
- useEffect dependency: `[user?.uid]` → `[user?.uid, profile?.tier, !!profile?.subscriptionExpiresAt]`
- `!profile` 가드 추가 (profile 로드 전 실행 방지)

## 6. 구독 만료/다운그레이드 완성 (v1.3.74~v1.3.82)

### 문제 이력
- **원본**: `autoRenew===true` → 만료 체크 완전 skip → 영구 Pro
- **v1.3.74**: RC 네이티브 skip (`tierSource==='revenuecat' && isNativePlatform()`) → 동기화 useEffect에 위임했으나 dependency 미변경으로 재실행 안 됨
- **v1.3.82**: skip 완전 제거 → `subscriptionExpiresAt` 기반 무조건 체크

### 최종 다운그레이드 경로 3개
1. **AuthContext 만료 체크**: `subscriptionExpiresAt` 지나면 즉시 (Toss autoRenew만 24시간 grace)
2. **App.jsx restorePurchases**: 앱 시작 시 활성 구독 없으면 다운그레이드
3. **웹 /api/check-subscription**: 서버 경유 RevenueCat API 확인

### Toss vs RevenueCat 만료 처리
| | Toss (웹) | RevenueCat (네이티브) |
|---|---|---|
| 갱신 주체 | 서버 cron (빌링키) | Google Play 자동갱신 |
| expiresAt 업데이트 | 서버 cron | App.jsx restorePurchases |
| autoRenew=true 만기 | 24시간 grace | 즉시 체크 |

### 다운그레이드 필드 처리 (v1.3.75)
- `tier: 'trial'`, `autoRenew: false`, `tierUpdatedAt`만 업데이트
- **null 설정 금지** → Firestore 필드 삭제 방지 (phoneNumber 등 유실 방지)
- onSnapshot 문서 재생성에 `{ merge: true }` 추가 (전체 덮어쓰기 방지)

### 테스트 결과 ✅
- 구독 → Pro 전환 → 만료 → trial 다운그레이드 + 데이터 보존 확인

## 7. RevenueCat ↔ Google Play 연동 이슈 (v1.3.76~v1.3.80)

### 문제: 구매 완료되지만 RevenueCat에 반영 안 됨
- Google Play 결제 완료 → RevenueCat API `entitlements: {}`, `last_seen` 미갱신
- Service Account JSON "Valid credentials" ✅ — 하지만 Pub/Sub 미연결

### 원인 & 해결
- **Google Cloud Pub/Sub 미연결**: RevenueCat이 Google Play 구매 이벤트를 실시간 수신 불가
- Pub/Sub API 활성화 후 → RevenueCat 대시보드에 거래 이력 일괄 동기화
- `restorePurchases()` 앱 시작 시 자동 호출 → Google Play 구매 복원

### App.jsx RevenueCat 초기화 플로우 (v1.3.80~82)
- **AuthContext race condition 해결**: AuthContext `getCustomerInfo()`가 App.jsx `configure()` 전에 실행되는 문제
- App.jsx에서 `configure()` → `restorePurchases()` → **Firestore 직접 기록**
- 활성 구독 있음 → tier/expiresAt/autoRenew/planId 기록
- 활성 구독 없음 + pro/premium + tierSource=revenuecat → trial 다운그레이드

### 웹 전용: `/api/check-subscription` (v1.3.76)
- 서버에서 RevenueCat API로 구독 상태 조회 + Firestore 동기화
- 앱에서 구독 후 웹만 사용하는 유저의 만기 감지

## 8. 홈 화면 UI 간격 축소 (v1.3.83)

`HomePage.css` — 주간 학습현황 ~20% 축소, 오늘의 진도 여유공간 ~10% 축소:
- section padding 16→12, title margin 12→8, star padding 6→4
- gauge padding 14→10, header margin 8→6, msg margin 6→4
- 홈 전체 gap 16→12

## 9. 러시아어 강세 정확도 강화 (v1.3.84)

3개 파일 프롬프트 수정:
- **vocab.js** Rule 6: 강세 정확도 필수 규칙 + 흔한 오류 예시 (привéт, извини́те, молокó) + ё 제외 + U+0301 지시
- **scene.js** Phase 1/2/3: 동일 강화 (3곳 replace_all)
- **App.jsx** Task 4: 러시아어 강세 규칙 추가 (기존에는 `others: Romanization`으로만 처리)

## 10. 광고 tier 반응형 개선 (v1.3.85)

**문제**: Pro→Trial 전환 시 광고 재표시 안 됨. `useAdMob` dependency `[]`로 tier 변경 감지 불가.

**수정** (`useAdMob.js`):
- `isPaid` 변수 + `[isPaid]` dependency
- Pro/Premium 전환 → `removeBanner()` 호출
- Trial 전환 → `showBanner()` 재실행
- `bannerShowing` ref로 중복 표시/제거 방지

## 버전 이력
| 버전 | 내용 |
|---|---|
| v1.3.67 | skipNativeAuth: true |
| v1.3.68 | Vocab 카테고리 테마 border |
| v1.3.69 | 마이그레이션 API + AccountUpgradeModal |
| v1.3.70 | 이메일 마이그레이션 + errWrongPassword i18n |
| v1.3.71 | Login/Signup 마이그레이션 |
| v1.3.72 | RevenueCat expiresAt/autoRenew 동기화 |
| v1.3.73 | useEffect profile 가드 + dependency 보강 |
| v1.3.74 | 만료 체크 개선 — autoRenew skip 제거 |
| v1.3.75 | 다운그레이드 필드 보존 + onSnapshot merge:true |
| v1.3.76 | 웹 RevenueCat 구독 확인 (/api/check-subscription) |
| v1.3.77 | restorePurchases() 자동 호출 |
| v1.3.78~79 | 디버그 alert (RevenueCat SDK 통신 확인) |
| v1.3.80 | App.jsx Firestore 직접 tier 동기화 (race condition 해결) |
| v1.3.82 | RC 만료 skip 제거 + restorePurchases 다운그레이드 |
| v1.3.83 | 홈 UI 간격 축소 |
| v1.3.84 | 러시아어 강세 정확도 강화 |
| v1.3.85 | 광고 tier 반응형 (Pro→Trial 시 광고 재표시) |
