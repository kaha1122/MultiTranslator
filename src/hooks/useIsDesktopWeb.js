// ── 데스크톱 웹 판별 (2026-09-28 웹 3단 레이아웃) ─────────────────────────────
// 웹 + 폭 1024px 이상일 때만 true. 네이티브(Android/iOS, 태블릿 포함)는 항상 false라
// 같은 번들이 OTA로 나가도 앱 레이아웃은 바뀌지 않는다.
// html.desktop-web 클래스도 함께 토글 — CSS 쪽 데스크톱 규칙은 전부 이 클래스 하위에 둔다.
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

const QUERY = '(min-width: 1024px)';

const detect = () => {
  if (Capacitor.isNativePlatform()) return false;
  try { return window.matchMedia(QUERY).matches; } catch { return false; }
};

export function useIsDesktopWeb() {
  const [isDesktopWeb, setIsDesktopWeb] = useState(detect);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return undefined;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsDesktopWeb(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('desktop-web', isDesktopWeb);
  }, [isDesktopWeb]);

  return isDesktopWeb;
}
