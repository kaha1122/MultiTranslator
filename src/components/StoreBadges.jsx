// ── 앱 스토어 다운로드 배지 (데스크톱 웹 우측 패널) ────────────────────────────
// 배지 문구는 스토어 공식 표기(영문)를 그대로 쓴다 — 번역하지 않음.
const APP_STORE_URL = 'https://apps.apple.com/app/pronunfit/id6761342764';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.arigems.pronunfit';

const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M16.37 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8-1.29-1.82-2.32-4.63-2.32-7.28 0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
    <path d="M3.6 2.1 13.4 12l-9.8 9.9c-.37-.2-.6-.6-.6-1.1V3.2c0-.5.23-.9.6-1.1z" fill="#34d399" />
    <path d="M16.6 8.8 13.4 12 3.6 2.1c.2-.1.5-.1.8.05l12.2 6.65z" fill="#60a5fa" />
    <path d="M16.6 15.2 4.4 21.85c-.3.15-.6.15-.8.05L13.4 12l3.2 3.2z" fill="#f87171" />
    <path d="M20.4 10.9c.8.45.8 1.75 0 2.2l-3.8 2.1L13.4 12l3.2-3.2 3.8 2.1z" fill="#fbbf24" />
  </svg>
);

export default function StoreBadges({ compact = false }) {
  return (
    <div className={`store-badges${compact ? ' store-badges--compact' : ''}`}>
      <a className="store-badge" href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
        <AppleIcon />
        <span className="store-badge-text"><small>Download on the</small>App Store</span>
      </a>
      <a className="store-badge" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
        <PlayIcon />
        <span className="store-badge-text"><small>GET IT ON</small>Google Play</span>
      </a>
    </div>
  );
}
