---
name: changes-0404
description: 2026-04-04 — AdMob 배너 아래 투명영역 최종 해결(CSS pseudo-element), YouTube iframe playsinline, 빌드스크립트 backgroundColor 패치
type: project
---

## 2026-04-04 변경사항 (v1.4.8 → v1.4.9)

### 1. AdMob 배너 아래 safe-area 투명 영역 — 최종 해결

#### 문제
iOS에서 AdMob 배너 아래 ~34px(홈 인디케이터 영역)에 앱 콘텐츠가 비쳐 보임.

#### 6번의 시도와 실패/성공 기록

| # | 커밋 | 접근 | 결과 | 실패 이유 |
|---|------|------|------|----------|
| 1 | `ca6f47b` | CSS `env(safe-area-inset-bottom)` 레이아웃 재구현 | ❌ | CSS는 WebView 콘텐츠 영역 안에서만 동작. 배너 아래는 네이티브 영역 |
| 2 | `b87905d` | CSS `.platform-native body { background-color }` | ❌ | 같은 이유 — body 배경 위에 콘텐츠 요소가 덮음 |
| 3 | `92ffa7a` | Platform CSS 클래스를 App.jsx useEffect로 이동 | ❌ | 클래스 타이밍 문제는 해결했으나 근본 원인 동일 |
| 4 | `c1f9bcd` | `capacitor.config.json`에 `ios.backgroundColor` 추가 | ❌ | `cap sync ios`가 플랫폼별 오버라이드를 네이티브 config에 전파 안 함 (Capgo autoUpdate와 동일 패턴) |
| 5 | `a3a17d0` | AppDelegate `window?.backgroundColor` 설정 | ❌ | UIWindow는 WebView 뒤에 있어서 WebView 콘텐츠가 앞에서 덮음 |
| **6** | **`69c7bae`** | **CSS `html.admob-active.platform-native::after` pseudo-element** | **✅** | **WebView 콘텐츠 최상위 레이어에 불투명 커버** |

#### 근본 원인 분석
- AdMob 플러그인(`BannerExecutor.swift`)이 배너를 `safeAreaLayoutGuide.bottom`에 정렬
- 배너 아래 ~34px은 **WebView 콘텐츠가 그대로 렌더링되는 영역**
- CSS body 배경색, capacitor config, UIWindow 배경 — 모두 콘텐츠 요소 뒤에 있어서 효과 없음
- 해결: `position: fixed; z-index: 99999`로 WebView 내 최상위에 불투명 커버 배치

#### 최종 해결 코드 (App.css)
```css
html.admob-active.platform-native::after {
  content: '';
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: env(safe-area-inset-bottom, 0px);
  background: var(--bg-primary);
  z-index: 99999;
  pointer-events: none;
}
```

#### 안전성
- `admob-active` + `platform-native` 조합에서만 활성화
- `env(safe-area-inset-bottom)` → Android/Web에서는 0px → 무영향
- `pointer-events: none` → 터치 이벤트 투과
- 네이티브 배너는 WebView 상위 레이어이므로 커버에 영향 없음

#### 3레이어 배경색 구조 (모두 유지 필요)
| 레이어 | 설정 | 역할 |
|--------|------|------|
| CSS body.platform-native | `background-color: var(--bg-primary)` | WebView 콘텐츠 영역 배경 |
| capacitor.config.json | `backgroundColor: "#f8fafc"` | WKWebView 자체 배경 (로딩 깜빡임 방지) |
| CSS html::after | `background: var(--bg-primary)` | 배너 아래 safe-area 불투명 커버 |

#### 빌드 스크립트 backgroundColor 패치 추가
- `cap sync ios`가 루트 config의 `ios.backgroundColor`를 네이티브 config에 전파하지 않음 (Capgo autoUpdate와 동일 패턴)
- `scripts/build-ios.sh` + `ios/App/ci_scripts/ci_post_clone.sh` 양쪽에 `cfg.backgroundColor = '#f8fafc'` 패치 추가
- autoUpdate 패치와 동일한 검증된 방식

---

### 2. YouTube iframe 오류 153 — 최종 해결 (HTTPS 프록시)

#### 문제
iOS WKWebView에서 YouTube embed 동영상 재생 시 "오류 153 — 동영상 플레이어 구성 오류" 발생.

#### 근본 원인
iOS WKWebView는 `capacitor://` 커스텀 스킴에서 **HTTP Referer 헤더를 전송하지 않음** (Apple WKWebView 제한, WebKit Bug 169846). YouTube는 2025년 7월 API 정책 강화 이후 Referer 헤더로 embed 요청의 출처를 검증하므로, Referer 없는 요청을 거부.

#### 3번의 시도

| # | 커밋 | 접근 | 결과 | 이유 |
|---|------|------|------|------|
| 1 | `174c479` | iframe에 `playsinline=1` 추가 | ❌ | 인라인 재생 파라미터일 뿐, origin/referer 문제와 무관 |
| 2 | `a8918bd` | `capacitor.config.json`에 `iosScheme: "https"` | ❌ | Capacitor가 `WKWebView.handlesURLScheme("https") == true`이므로 무시 → 자동으로 `capacitor://`로 리셋 |
| **3** | **`1c44792`** | **HTTPS 프록시 (youtube.html)** | **✅** | Vercel HTTPS 도메인에서 서빙 → 올바른 Referer 전송 |

#### 최종 해결: HTTPS 프록시 방식
```
[iOS App] → iframe src="https://multi-translator-seven.vercel.app/youtube.html?v=VIDEO_ID"
              → [Vercel HTTPS로 서빙 + 올바른 Referer 헤더]
                  → iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
                      → YouTube 정상 재생 ✅
```

#### 수정 파일
- `public/youtube.html`: 프록시 파일 신규 생성 (youtube-nocookie.com + referrerpolicy strict-origin-when-cross-origin)
- `VideoReader.jsx`: `Capacitor.getPlatform() === 'ios'` 분기 — iOS만 프록시 URL, Android/Web은 직접 embed 유지
- `capacitor.config.json`: 무효한 `iosScheme: "https"` 제거

#### 핵심 교훈
- iOS WKWebView의 커스텀 스킴 제한은 앱 레벨에서 직접 해결 불가
- HTTPS 도메인에서 중간 페이지를 서빙하여 Referer를 보장하는 프록시 패턴이 유일한 해결책
- `iosScheme: "https"` 설정은 Capacitor가 내부적으로 유효성 검증 후 무시하므로 효과 없음

---

### 커밋 이력
- `966a75e` fix(ios): 빌드 스크립트에 네이티브 배경색 패치 추가
- `a3a17d0` fix(ios): UIWindow 배경색 설정 (AppDelegate)
- `69c7bae` fix(ios): 광고 배너 아래 safe-area 불투명 커버 추가 ← **최종 해결**
- `174c479` fix(ios): YouTube iframe에 playsinline=1 추가 (효과 없음)
- `a8918bd` fix(ios): iosScheme https (효과 없음 → 제거됨)
- `1c44792` fix(ios): YouTube HTTPS 프록시 방식 ← **최종 해결**
- `01ef677` 1.4.10

### 배포
- Capgo production: v1.4.10
- Vercel: 자동 (main push)
- iOS: Xcode Cloud 빌드 트리거 (배경색 패치는 네이티브 빌드 필요, CSS 커버는 Capgo로 즉시 적용)
