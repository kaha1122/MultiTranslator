---
name: bug-patterns
description: "재발 방지용 버그 패턴 — TDZ, 아이콘 padding, Library 스크롤, i18n fallback, iOS WKWebView(모듈스코프/uiDelegate/YouTube Referer/cap sync 전파) 등"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dbcd70e4-6465-41a4-a9ce-e3ca05f769ad
---

## useState 초기값에서 TDZ 에러 (2026-03-13)
**증상**: 프로덕션 번들에서 `Cannot access 'ue' before initialization` 런타임 에러 (앱 로드 불가)
**원인**: `useState` 초기값에서 아래쪽에 선언된 `const` 변수(`sourceLang`)를 참조 → Rollup 번들링 후 TDZ 발생
**해결**: 초기값에 정적 기본값 사용, 실제 값은 이벤트 핸들러에서 세팅

> **핵심 룰**: `useState()` 초기값에서 같은 컴포넌트의 다른 state 변수를 참조하지 말 것! 특히 아래쪽에 선언된 변수는 TDZ 에러 발생. 로컬 dev에선 안 터지고 프로덕션 빌드에서만 터질 수 있음.

### TDZ 변종 — 훅 destructuring 반환값을 선언 전에 참조 (2026-06-14, prod down)
**증상**: prod `Cannot access 'O' before initialization` → 루트 에러바운더리 전체 크래시. JP source Vocab 첫 5단어 자동 로드 시 카드 렌더에서 발생.
**원인**: [VocabTab.jsx](src/components/VocabTab.jsx) VocabWordCard에 pass 배지 추가하며 `const passed = !!assessmentResult && ...` 를 `const { ..., assessmentResult } = useAudioRecorder(...)` **위**에 배치. `assessmentResult`가 선언 전 참조됨.
**해결**: 파생 const는 그 의존 변수(특히 훅 destructuring)가 **선언된 줄 뒤**에 둔다.
> **핵심 룰**: 컴포넌트 상단에 파생값 const를 추가할 때, 참조하는 변수가 그 위에 이미 선언됐는지 반드시 확인. 빌드는 통과하고(ESLint no-use-before-define가 lint crash로 미검출될 수 있음) 해당 컴포넌트가 실제 렌더될 때만 터진다 → **변경 컴포넌트를 직접 렌더하는 실동작 테스트 필수**. 관련: [[feedback_side_effect_check]]

## 아이콘 버튼 padding 누락 (2026-03-07)
**증상**: 커스텀 원형 아이콘 버튼이 흰 원만 보이고 아이콘이 보이지 않음
**원인**: `index.css`의 전역 `button { padding: 0.6em 1.2em; }` → 작은 버튼의 콘텐츠 영역이 축소
**해결**: 커스텀 크기 원형 버튼에 반드시 `padding: 0` 추가

> **핵심 룰**: 전역 `button` 스타일 덮어쓰는 커스텀 버튼은 항상 `padding: 0` 명시!

## 숫자 입력 즉시 기본값 리셋 (2026-03-13)
**증상**: 목표점수 입력칸에서 숫자를 지우면 즉시 기본값(80)으로 리셋되어 새 값 입력 불가
**원인**: `parseInt(e.target.value) || defaultValue`가 빈 문자열을 0으로 변환 → 즉시 기본값 적용
**해결**: 표시용 `rawGoal` 상태 분리, 빈 문자열 허용, `onBlur`에서만 기본값 복원

> **핵심 룰**: controlled number input에서 빈 값 허용 필요 시 별도 문자열 상태 + onBlur 검증 패턴 사용!

## setTimeout 기반 스크롤 간헐적 실패 (2026-03-13)
**증상**: Scene 카드 생성 후 스크롤이 될 때도 있고 안 될 때도 있음
**원인**: `setTimeout(150ms)` 사용 시 React 상태 업데이트 → 리렌더 → DOM 페인트가 150ms 안에 완료되지 않으면 `ref.current`가 null
**해결**: `useEffect` + `requestAnimationFrame` 패턴으로 교체 — React가 DOM 업데이트를 완료한 후에만 실행

> **핵심 룰**: 조건부 렌더링 요소에 대한 스크롤은 `setTimeout`이 아닌 상태 기반 `useEffect`로 처리할 것!

## i18n 키 경로가 UI에 그대로 표시 (2026-03-13)
**증상**: 태그에 `tags.action.Initiating`이 그대로 표시됨
**원인**: `t()` 함수가 키를 못 찾으면 키 경로 전체를 반환 → truthy라 `|| fallback` 작동 안 됨
**해결**: `tTag()` 헬퍼 — 반환값이 prefix로 시작하면 locale 미등록으로 판단, 원래 영문 값 fallback

> **핵심 룰**: `t(key) || fallbackValue` 패턴은 키 미등록 시 작동 안 됨. 동적 키에는 반드시 `tTag()` 헬퍼 사용!

## onSnapshot이 삭제된 Firestore 문서를 재생성 (2026-03-15)
**증상**: 회원탈퇴 후 Firestore에서 유저 문서가 여전히 남아있음
**원인**: 서버가 문서 삭제 → 클라이언트 `onSnapshot`이 "문서 없음" 감지 → `setDoc`으로 자동 재생성
**해결**: `accountDeletionInProgress` 모듈 레벨 플래그 추가, 탈퇴 중에는 `setDoc` 스킵. 페이지 리로드 후 자동 리셋.

> **핵심 룰**: `onSnapshot`에서 "문서 없음 → 자동 생성" 패턴이 있을 때, 의도적 삭제(탈퇴 등)와 구분하는 플래그가 필요!

## Firestore doc.delete()는 서브컬렉션을 삭제하지 않음 (2026-03-15)
**증상**: 회원탈퇴 후 메인 문서는 삭제되었으나 dailyProgress, pronunciation_records 등 서브컬렉션이 남아 유령 문서 표시
**원인**: Firestore의 `doc().delete()`는 해당 문서만 삭제, 하위 서브컬렉션은 자동 삭제 안됨
**해결**: `listCollections()` → `listDocuments()` → `batch.delete()` 재귀 삭제 후 메인 문서 삭제

> **핵심 룰**: Firestore 문서 삭제 시 서브컬렉션이 있으면 반드시 `listCollections()`로 재귀 삭제!

## Capgo setChannel 하드코딩으로 OTA 채널 무효화 (2026-03-18)
**증상**: APK를 staging 채널로 빌드해도 OTA 업데이트를 못 받음
**원인**: App.jsx에 `CapacitorUpdater.setChannel({ channel: 'production' })` 하드코딩 → 런타임에 production으로 강제 전환
**해결**: `vite.config.js`에 `define: { __CAPGO_CHANNEL__ }` 추가, 빌드 시 `CAPGO_CHANNEL=staging npm run build`로 채널 주입

> **핵심 룰**: Capgo `setChannel`은 절대 하드코딩 금지! Vite define으로 빌드 타임에 주입할 것. staging 빌드: `CAPGO_CHANNEL=staging npm run build`, production: 그냥 `npm run build`

## Android Back 키 stale closure (2026-03-18)
**증상**: Back 키를 두 번 눌러도 앱이 종료되지 않음
**원인**: `showExitToast` 상태가 useEffect deps에 없어 클로저가 항상 초기값 false를 읽음
**해결**: `showExitToastRef` 추가, 상태 변경 시 ref 동기화, 클로저 내에서는 ref로 읽기

> **핵심 룰**: useEffect 내 이벤트 핸들러에서 state를 읽을 때 deps에 없으면 stale closure 발생. 자주 바뀌는 값은 ref로 미러링해서 읽을 것!

## Android Back 키 window.history.back() SPA에서 동작 안 함 (2026-03-18)
**증상**: Back 키 누르면 검은 화면만 뜨고 이전 화면으로 안 돌아감
**원인**: Capacitor SPA에서는 브라우저 히스토리가 없어 `window.history.back()` 무효
**해결**: `viewModeHistoryRef` 스택으로 viewMode 변경 이력 관리, Back 시 pop해서 `setViewMode()` 직접 호출

> **핵심 룰**: Capacitor SPA에서 Back 키 처리는 `window.history.back()` 절대 사용 금지! viewMode 히스토리 스택을 직접 관리할 것.

## Library 스크롤 + 팝업 충돌 (2026-03-12)
**증상**: 북마크 후 Library로 이동 시 스크롤이 안 됨
**원인**: DailyProgressPopup 오버레이가 동시에 표시되면서 scrollIntoView 무효화
**해결**: `progressPopupOpen` prop을 Library에 전달, 팝업 닫힌 후 스크롤 실행

## iOS WKWebView 모듈 스코프 크래시 (2026-04-04)
**증상**: iOS 앱 흰 화면 (Android/Web 정상)
**원인**: `useAdMob.js` 모듈 스코프 IIFE에서 `document.body.appendChild()` 호출 → iOS WKWebView에서 body가 null → TypeError → 모듈 전체 실패 → React 마운트 안 됨
**해결**: JS probe 방식 완전 제거, CSS `env(safe-area-inset-bottom)` 직접 사용
> **핵심 룰**: useAdMob.js 등 모듈 스코프에서 `document.body` 접근 절대 금지. `document.documentElement`만 안전. body 접근은 DOMContentLoaded 또는 React useEffect에서.

## iOS WKWebView Capacitor 브릿지 타이밍 (2026-04-04)
**증상**: iOS에서 `platform-native` CSS 클래스가 안 붙어 배경색 미적용 (Android는 정상)
**원인**: 모듈 스코프에서 `window.Capacitor?.isNativePlatform()` 호출 → iOS에서는 Capacitor 브릿지가 모듈 평가보다 늦게 주입 → undefined 반환
**해결**: App.jsx useEffect로 이동 (React 렌더 시점 = 브릿지 보장)
> **핵심 룰**: `Capacitor.isNativePlatform()` 등 Capacitor API는 모듈 스코프에서 호출 금지. React 컴포넌트 내부(useEffect)에서만 호출.

## iOS WKWebView uiDelegate 파손 (2026-04-04)
**증상**: CAPBridgeViewController 서브클래스에서 `webView.uiDelegate = self` → 검은 화면 또는 흰 화면
**원인**: Capacitor 8 내부의 CAPWebViewDelegationHandler가 uiDelegate를 관리. 어떤 방식으로든 교체하면 JS 브릿지 파손
**해결**: 서브클래스 제거, Main.storyboard는 CAPBridgeViewController 유지
> **핵심 룰**: Capacitor 8에서 webView.uiDelegate를 절대 교체하지 말 것. Plugin 방식의 forwardingTarget도 안전하지 않음.

## iOS YouTube embed 오류 153 (2026-04-04)
**증상**: iOS에서 YouTube iframe embed 재생 시 "오류 153 — 동영상 플레이어 구성 오류"
**원인**: iOS WKWebView는 `capacitor://` 커스텀 스킴에서 HTTP Referer 헤더를 전송하지 않음 (WebKit Bug 169846). YouTube는 2025.07부터 Referer로 embed 출처를 검증하므로 거부.
**실패한 시도**: `playsinline=1` 추가 (origin과 무관), `iosScheme: "https"` (Capacitor가 내장 스킴을 무시 → 자동 리셋)
**해결**: HTTPS 도메인(Vercel)에서 서빙되는 `public/youtube.html` 프록시 페이지 생성. iOS만 프록시 URL 사용, Android/Web은 직접 embed 유지.
> **핵심 룰**: iOS WKWebView에서 YouTube embed는 직접 iframe 불가. HTTPS 도메인의 프록시 HTML을 경유해야 Referer가 정상 전송됨. `iosScheme: "https"`는 Capacitor가 `WKWebView.handlesURLScheme()` 검증 후 무시하므로 효과 없음.

## iOS cap sync가 플랫폼별 config를 전파하지 않음 (2026-04-04)
**증상**: 루트 `capacitor.config.json`에 `ios.backgroundColor` 추가했는데 iOS 앱에 적용 안 됨
**원인**: `npx cap sync ios`는 `ios` 섹션의 플랫폼별 오버라이드를 `ios/App/App/capacitor.config.json`에 플래트닝하지 않음. 해당 파일은 `.gitignore` 대상이라 매 빌드마다 재생성됨 (Capgo autoUpdate와 동일 패턴).
**해결**: 빌드 스크립트(`build-ios.sh`, `ci_post_clone.sh`)에서 `cap sync ios` 후 node 스크립트로 패치
> **핵심 룰**: iOS 네이티브 config에 값을 주입하려면 빌드 스크립트에서 패치해야 함. 루트 config의 `ios: {}` 섹션은 sync 시 전파 안 됨.

## Android Crashlytics Gradle 플러그인 누락 (2026-04-05)
**증상**: 앱 시작 즉시 크래시 (스플래시 직후 종료). logcat: `FATAL EXCEPTION: The Crashlytics build ID is missing`
**원인**: `@capacitor-firebase/crashlytics` npm 패키지는 설치했지만, Android `build.gradle`에 `firebase-crashlytics-gradle` 플러그인 미등록. Firebase가 초기화 시 Crashlytics build ID를 찾지 못해 앱 전체가 크래시.
**해결**: `android/build.gradle` dependencies에 `classpath 'com.google.firebase:firebase-crashlytics-gradle:3.0.3'` 추가 + `android/app/build.gradle`에 `apply plugin: 'com.google.firebase.crashlytics'` 추가
> **핵심 룰**: Capacitor Firebase 플러그인 설치 시 npm 패키지뿐 아니라 **Android/iOS 네이티브 플러그인 설정도 반드시 확인**. 특히 Crashlytics는 Gradle 플러그인이 없으면 앱이 아예 열리지 않음.

## 클라 재계산 값이 읽기 실패 시 올바른 저장값을 클로버 (2026-05-31)
**증상**: 3일 연속 학습(dailyProgress 28/29/30 `goalAchievedToday:true`)한 Pro 유저인데 `streakCurrent=0` 저장됨. UI streak도 0으로 깜빡임. (UID gUCviv..., Android VN)
**원인**: [src/hooks/useStreak.js](../../../../Projects/multi-translator/src/hooks/useStreak.js)는 매 세션 Firestore를 읽어 streak 재계산 후 persist. 콜드스타트 시 `getDocs(dailyProgress)` 읽기 실패(Android는 iOS와 달리 long-polling 분기 없이 기본 WebChannel) → `catch`에서 로그만 찍고 `streakCurrent`는 초기값 0에 머묾 → persist effect가 "로드 성공 여부 무관"하게 0을 `setDoc(merge)` → 기존의 올바른 streak(3)을 0으로 덮어씀. (writes는 offline queue로 성공하므로 dailyProgress doc은 정상 기록됨 → "쓰기 OK, 읽기 실패"의 비대칭)
**해결**: `streakLoaded` state 가드 추가 — `load()` try 성공 끝에서만 `setStreakLoaded(true)`, persist effect 상단 `if (!streakLoaded) return;`. + `lastPersistedRef` 전진을 `setDoc().then()` 안으로 이동(쓰기 실패 시 재시도 보장). 유저 데이터는 dailyProgress 재계산 후 admin 1회 보정.
> **핵심 룰**: 클라가 읽어서 재계산→저장하는 필드는 **읽기 실패 시 절대 persist 금지** (실패=초기값이 정답값을 덮어씀). "로드 성공 1회" 플래그를 state로 두고 persist 가드. serverTimestamp+merge라도 잘못된 값은 클로버됨. 서버 cron이 `where('streakCurrent','>=',3)` 등으로 이 필드를 읽으면 stale 0이 푸시 대상에서 제외시키는 2차 피해까지 발생.
