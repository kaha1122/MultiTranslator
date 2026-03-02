import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
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
