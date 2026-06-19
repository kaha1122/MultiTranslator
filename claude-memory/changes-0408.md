---
name: changes-0408
description: 2026-04-08 — Android 무광고 진단(tier=pro 자동복원), RevenueCat Transfer Behavior 변경(Keep with original), Bonus02 광고ID 오기재 수정
type: project
---

## 2026-04-08 변경 사항 및 진단

### 1. Android 무광고 증상 — 원인 추적 (상세)

#### 증상
사용자 폰에서 어제(4/7)까지 정상 표시되던 AdMob 배너가 4/8 아침부터 안 나옴. 앱 삭제 후 재설치해도 동일.

#### 거짓 단서들 (배제 과정)
1. **"검토 필요" 잠금?** → AdMob 콘솔 확인 결과 Android 앱 인증 ✅ "준비됨" 상태. iOS와 달리 잠겨있지 않음.
2. **No-fill?** → 광고 활동 보고서에서 4/6: 요청 정상, 4/7: 요청 34/노출 27/일치율 **100%**. fill 자체는 정상이었음.
3. **v1.2.3 자동업데이트의 사이드이펙트?** → 후보였으나 진짜 원인 아님.
4. **Bonus02 광고 단위 "적용 불가"?** → "적용 불가"는 게재빈도 캡이 배너/네이티브에 해당 안 됨이라는 정상 표시. 무광고와 무관.

#### 진짜 원인 — RevenueCat 자동 entitlement 복원 → tier=pro
사용자가 방금 만든 새 익명 UID `b4DRREi9VEO3aoPEVlHCOq4zMjd2`의 Firestore 문서에서 결정적 증거 발견:
- `tier: "pro"`
- `tierSource: "revenuecat"`
- `subscriptionExpiresAt: 2026-05-06` (= 4/6 결제일 + 1개월)

[useAdMob.js:109,124](src/hooks/useAdMob.js#L109)는 `isPaid = tier==='pro'||tier==='premium'`이면 배너 호출 자체를 안 함. 즉 광고 안 나오는 게 **의도된 동작**.

#### 도미노 체인
1. [App.jsx:296](src/App.jsx#L296) `Purchases.configure({ appUserID: user.uid })` — 새 익명 UID로 RevenueCat 백엔드에 사용자 생성
2. [App.jsx:300](src/App.jsx#L300) `Purchases.restorePurchases()` — Google Play Billing의 `queryPurchasesAsync()` 호출
3. Google Play가 OS 수준 Google 계정에 연결된 활성 purchase token 반환 (Firebase UID 무관, OS 계정 단위)
4. SDK가 그 토큰을 RevenueCat 백엔드에 POST
5. RevenueCat 백엔드: 토큰이 이미 다른 appUserID 소유 → **Transfer Behavior 기본값 "Transfer to new App User ID"** → 새 UID로 소유권 이전
6. customerInfo에 `entitlements.active.Pro` 반환
7. [App.jsx:317-331](src/App.jsx#L317-L331) `setDoc({ tier: 'pro', tierSource: 'revenuecat', ... })` → Firestore에 박힘
8. AuthContext → useAdMob → isPaid=true → 배너 호출 차단

### 2. 해결책 — RevenueCat Transfer Behavior 변경

#### 위치
RevenueCat 대시보드 → Project settings → **Handling multiple app user IDs** → **Transferring purchases seen on multiple App User IDs**

#### 변경
- 기본값: ❌ `Transfer to new App User ID`
- 변경 후: ✅ **`Keep with original App User ID`**

#### 왜 이게 안전한가 (코드 변경 0)
Firebase 익명 UID는 휘발성이 아니라, **linkWithCredential 시 그대로 영구화**되는 패턴([changes-0324.md](changes-0324.md) "linkWithPopup 통일" 참조). 따라서:

| 시나리오 | Level 1 적용 후 |
|---|---|
| 익명 → 계정연결 → 결제 → 재설치/폰변경 | 같은 UID 복원 → 원래 소유자 → entitlement 정상 ✅ |
| 익명만으로 결제 시도 | [App.jsx:220-228](src/App.jsx#L220-L228) `requestUpgrade`가 `user.isAnonymous`면 AccountUpgradeModal 강제 → **익명 결제 자체가 코드상 차단됨** → 시나리오 발생 불가 ✅ |
| 본인 테스트 (이번 케이스) | 새 익명 UID는 entitlement 못 받음 → tier=trial → 광고 정상 ✅ |

**핵심 통찰**: "익명 UID는 영구화되며, 결제는 익명 상태에서 코드상 불가능" → Transfer 기능 자체가 우리에게 필요 없음. Keep이 모든 케이스에서 정답.

#### 부작용 차단
- Firestore "유령 Pro" 문서 누적 방지 (디바이스마다 새 익명 UID에 tier=pro 박히는 현상)
- RevenueCat 대시보드 익명 UID 폭증 방지
- AuthContext + App.jsx 이중 sync race condition 노출 위험 감소

#### 검증
사용자가 앱 삭제 → 재설치 → 익명으로 시작 → **AdMob 배너(Preply 광고) 정상 표시 확인 ✅**. Transfer Behavior 변경은 코드/배포 없이 즉시 서버측 반영.

### 3. Bonus02 광고 단위 ID 오기재 수정 (별개 버그)

#### 문제
[useAdMob.js:13](src/hooks/useAdMob.js#L13) Android `rewardedProns`가 Banner02 ID(`4166267528`)로 잘못 들어있어 발음 보상형 광고 요청이 형식 불일치로 항상 실패. AdMob 콘솔 스크린샷에서 실제 Bonus02 ID는 `9921324956`로 확인.

#### 영향
- "광고 보고 +10 발음" 버튼이 항상 실패 → 사용자 보너스 못 받음
- AdMob 정책 위반 소지 (한 광고 단위를 두 형식으로 호출)
- Bonus02 광고 단위는 콘솔에 만들어져 있는데 0회 요청 상태로 방치 → 발음 보상형 수익 0

#### 수정
```diff
- rewardedProns:  'ca-app-pub-8626604652301297/4166267528', // Banner02 ID (잘못)
+ rewardedProns:  'ca-app-pub-8626604652301297/9921324956', // Bonus02 (RewardP, +10)
```
iOS 쪽 [useAdMob.js:22](src/hooks/useAdMob.js#L22)는 `3209808845`로 별개 ID 들어있어 정상.

#### 배포
- 커밋: `603232e` fix(android): Bonus02 보상형 광고 ID 수정 — Banner02 ID 오기재
- main → origin/main push → Vercel production → Capgo production OTA 자동 적용

### 4. 디버그 유틸리티

`server/query-user.js` — 일회용 Firestore + Firebase Auth 조회 스크립트. UID 인자로 받아 사용자 문서와 provider 정보 출력. 서비스 계정 키는 `server/.env`의 `FIREBASE_SERVICE_ACCOUNT_BASE64`에서 로드.

```bash
cd server && node query-user.js <UID>
```

`.gitignore`에 추가하여 추적 제외 (로컬에서 재사용 가능). 키가 하드코딩되지 않아 그 자체로는 안전하지만, 일회용 디버그 유틸이라 git에 둘 필요 없음.

### 핵심 교훈

1. **무광고 증상 진단 시 tier 먼저 의심**: useAdMob의 `isPaid` 가드가 강력해서 tier=pro면 모든 광고 요청이 차단됨. 콘솔/심사/네트워크 살피기 전에 사이드바 등급 표시부터 확인할 것.

2. **RevenueCat 익명 UID 트랩**: `Purchases.configure({ appUserID: firebaseUid })`로 익명 UID를 넘기면, RevenueCat은 그 UID를 identified(non-anonymous) 사용자로 봄. Default Transfer Behavior와 결합되면 OS Google 계정에 묶인 구독이 디바이스의 모든 새 익명 사용자에게 자동 이전됨. **앱이 익명 결제를 차단하는 구조라면 Transfer Behavior는 반드시 "Keep"으로**.

3. **AdMob 광고 단위 ID는 콘솔과 byte-level 대조**: 복사-붙여넣기 실수로 다른 형식의 ID가 들어가면 AdMob 정책 위반 + 수익 0. 신규 광고 단위 추가 시 콘솔 ID와 코드를 양방향 검증할 것.
