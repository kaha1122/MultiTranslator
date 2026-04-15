import { showInterstitialAd as showNativeInterstitial } from '../hooks/useAdMob';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;

// 웹 광고 제공자 훅 — 향후 AdSense / SSP / 자체 모달 연동 시 아래 전역 객체를 세팅
//   window.__webAdProvider = { ready: true, showInterstitial: async () => boolean }
// ready 가 true 이고 showInterstitial 이 존재하면 자동으로 활성화된다.
const getWebAdProvider = () => {
  const p = typeof window !== 'undefined' ? window.__webAdProvider : null;
  return p && p.ready === true && typeof p.showInterstitial === 'function' ? p : null;
};

// 현재 플랫폼에서 전면광고가 가용한지 여부. 점수 누적 자체를 스킵할지 판단용.
export const adsReady = () => {
  if (isNativePlatform()) return true;
  return !!getWebAdProvider();
};

// 전면광고 표시. 성공 시 true, 실패/미가용 시 false. 호출자는 실패 시 점수 롤백에 사용한다.
export const showInterstitial = async () => {
  try {
    if (isNativePlatform()) {
      const ok = await showNativeInterstitial();
      return ok !== false;
    }
    const web = getWebAdProvider();
    if (!web) return false;
    const ok = await web.showInterstitial();
    return ok !== false;
  } catch (e) {
    console.error('[adProvider] showInterstitial 실패:', e?.message);
    return false;
  }
};
