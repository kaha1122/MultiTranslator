import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'

// Capgo OTA 플랫폼별 초기화
if (Capacitor.getPlatform() === 'ios') {
  // iOS: autoUpdate=true (capacitor.config.json) — 네이티브 플러그인이 자동 다운로드/적용.
  // notifyAppReady()로 OTA 적용 후 정상 launch 신호 → Capgo가 롤백하지 않음.
  // 과거 builtin 강제 reset 로직(503f3a0/17721a6)은 제거 — 2026-05-07 룰 변경
  // (decision_ios_capgo_ota_reactivation.md). 무한 reload 회귀 시 즉시 보고할 것.
  // 다운그레이드 방지는 Capgo dashboard 운영 디시플린(구버전 push 금지)에 의존.
  CapacitorUpdater.notifyAppReady();
} else if (Capacitor.getPlatform() === 'android') {
  // Android: 수동 Capgo OTA 운영 (autoUpdate: false)
  // — autoUpdate: true 시 appMovedToBackground → semaphoreWait 메인스레드 블로킹 → ANR 발생
  // — 수동 모드: 포그라운드에서 다운로드 → 다음 앱 실행 시 자동 적용
  CapacitorUpdater.notifyAppReady();

  // ⭐ 다운그레이드 방지: latest <= current 면 OTA skip
  //   - capacitor.config.json default channel='production'이라 신규 device는 production에 할당됨
  //   - 만약 production 채널이 빌트인 번들보다 구버전이면 다운그레이드 + 무한 reload 발생 (set 호출이 reload 트리거)
  //   - staging APK 테스트 / 신규 AAB 출시 직후 등 빌트인이 OTA보다 새로운 케이스 보호
  const cmpVer = (a, b) => {
    const pa = String(a).split('.').map(n => parseInt(n) || 0);
    const pb = String(b).split('.').map(n => parseInt(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  };

  (async () => {
    try {
      const latest = await CapacitorUpdater.getLatest();
      if (!latest?.url) return;

      // 현재 번들 버전 확인 — 'builtin'이면 package.json 버전(__APP_VERSION__)으로 폴백
      let currentVersion = __APP_VERSION__;
      try {
        const info = await CapacitorUpdater.current();
        const v = info?.bundle?.version;
        if (v && v !== 'builtin') currentVersion = v;
      } catch {}

      if (cmpVer(latest.version, currentVersion) <= 0) {
        console.log(`[Capgo] Android: OTA skip — current ${currentVersion} >= latest ${latest.version}`);
        return;
      }

      console.log('[Capgo] Android: 새 번들 감지, 다운로드 시작', latest.version);
      const bundle = await CapacitorUpdater.download({ url: latest.url, version: latest.version });
      console.log('[Capgo] Android: 다운로드 완료, 다음 실행 시 적용', bundle.version);
      CapacitorUpdater.set({ id: bundle.id });
    } catch (err) {
      console.warn('[Capgo] Android: OTA 실패', err);
    }
  })();
} else {
  // Web: Capacitor 네이티브 플러그인 미동작 — notifyAppReady만 호출
  CapacitorUpdater.notifyAppReady();
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', background: '#fff1f1', minHeight: '100vh' }}>
          <h2 style={{ color: '#dc2626' }}>앱 오류 발생</h2>
          <p style={{ color: '#991b1b', fontSize: '0.9rem' }}>{String(this.state.error)}</p>
          <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>{this.state.error?.stack}</p>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            style={{ marginTop: '1rem', padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            로컬 데이터 초기화 후 재시작
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 모바일 Back 키 인터셉트 (React 렌더 전에 즉시 설정) ──
// "두 번 뒤로 누르면 종료" 패턴:
// 1차 Back → 토스트 표시 + 2초 타이머
// 2차 Back (2초 내) → guard 해제 → OS가 자연스럽게 PWA 종료
window.__backPressedOnce = false;
window.__backTimer = null;
window.history.pushState(null, null, window.location.href);
window.onpopstate = function () {
  if (window.__backPressedOnce) {
    // 2초 이내 두 번째 Back → guard 없이 통과 → PWA 종료
    clearTimeout(window.__backTimer);
    window.__backPressedOnce = false;
    return; // pushState 안 함 → 히스토리 비어서 OS가 닫음
  }
  // 첫 번째 Back → guard 유지 + 토스트 요청
  window.history.pushState(null, null, window.location.href);
  window.__backPressedOnce = true;
  window.dispatchEvent(new Event('app-back-pressed'));
  window.__backTimer = setTimeout(() => {
    window.__backPressedOnce = false;
  }, 2000);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker 등록
//
// [이게 왜 필요한가?]
// Service Worker(sw.js)를 브라우저에 등록해야
// - PWA "홈 화면에 추가" 설치 팝업이 뜹니다
// - 오프라인에서도 기본 화면을 볼 수 있습니다
//
// [조건]
// - 'serviceWorker' in navigator : 이 브라우저가 Service Worker를 지원하는지 확인
// - import.meta.env.PROD : 개발(로컬) 환경이 아닌 실제 배포(Vercel) 환경에서만 등록
//   (개발 중에는 오프라인 캐싱이 개발을 방해할 수 있어서 제외)
// ─────────────────────────────────────────────────────────────────────────────
// 네이티브 앱에서는 Service Worker 불필요
const isNative = window.Capacitor?.isNativePlatform?.();
if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service Worker 등록 성공! 범위:', registration.scope);
      })
      .catch((error) => {
        console.error('[PWA] Service Worker 등록 실패:', error);
      });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// [idle 발열 절감 v1.5.66] 앱 숨김 시 무한 CSS animation 일시정지
//
// html[data-app-hidden="1"] 룰(index.css)이 animation-play-state: paused 처리.
// document.visibilitychange는 web/PWA 표준이지만 iOS WKWebView에서 신뢰성 낮아
// Capacitor App.appStateChange 시그널도 함께 등록.
// ─────────────────────────────────────────────────────────────────────────────
const setAppHidden = (hidden) => {
  document.documentElement.dataset.appHidden = hidden ? '1' : '0';
};
setAppHidden(document.visibilityState === 'hidden');
document.addEventListener('visibilitychange', () => {
  setAppHidden(document.visibilityState === 'hidden');
});
if (isNative) {
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => setAppHidden(!isActive));
  }).catch(() => { /* plugin 미가용 시 visibilitychange만 동작 */ });
}

// [제거] 포그라운드 30초 무활동 idle 가드(v1.5.80) + 광고 직후 60초 강제 idle(v1.5.82)
// 두 로직은 실측 발열 절감 효과가 없었던 반면, data-app-idle="1" 가드가 백그라운드
// 복귀 시 리셋되지 않아 .home-page 진입 애니메이션(homeSlideUp)이 opacity:0에서 멈춰
// "복귀 후 흰 화면 → 터치하면 깨어남" 버그를 유발 → 전면 제거.
// 백그라운드 진입 시 정지(data-app-hidden, 위)만 유지 — 이건 실제 thermal 가드.
