import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'

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
window.__exitConfirmed = false;
window.history.pushState(null, null, window.location.href);
window.onpopstate = function () {
  if (window.__exitConfirmed) return;
  window.history.pushState(null, null, window.location.href);
  window.dispatchEvent(new Event('app-back-pressed'));
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
if ('serviceWorker' in navigator && import.meta.env.PROD) {
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
