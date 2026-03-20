import { useEffect, useRef } from 'react';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;

const AD_UNITS = {
    bannerTop:    'ca-app-pub-8626604652301297/3986871373', // Banner01
    bannerBottom: 'ca-app-pub-8626604652301297/4166267528', // Banner02
};

const BANNER_HEIGHT = 60; // ADAPTIVE_BANNER 대략적인 높이(px)

let admobInitialized = false;

async function getAdMob() {
    if (!isNativePlatform()) return null;
    try {
        const { AdMob } = await import('@capacitor-community/admob');
        return AdMob;
    } catch {
        return null;
    }
}

async function initAdMob() {
    if (admobInitialized) return;
    const AdMob = await getAdMob();
    if (!AdMob) return;
    await AdMob.initialize({ testingDevices: [], initializeForTesting: false });
    admobInitialized = true;
}

// CSS 변수로 헤더/하단 nav 위치를 배너 높이만큼 이동
function applyBannerOffsets(top, bottom) {
    const root = document.documentElement;
    root.style.setProperty('--admob-top', top ? `${BANNER_HEIGHT}px` : '0px');
    root.style.setProperty('--admob-bottom', bottom ? `${BANNER_HEIGHT}px` : '0px');
}

export const useAdMob = () => {
    const initialized = useRef(false);

    useEffect(() => {
        if (!isNativePlatform() || initialized.current) return;
        initialized.current = true;

        const setup = async () => {
            try {
                await initAdMob();
                const AdMob = await getAdMob();
                if (!AdMob) return;

                const { BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');

                // 상단 배너 표시
                await AdMob.showBanner({
                    adId: AD_UNITS.bannerTop,
                    adSize: BannerAdSize.BANNER,
                    position: BannerAdPosition.TOP_CENTER,
                    margin: 0,
                    isTesting: false,
                });

                // 하단 배너: 상단 배너 제거 후 하단으로 재표시
                // (플러그인이 동시 2개 미지원 — 하단만 유지)
                await AdMob.removeBanner();

                await AdMob.showBanner({
                    adId: AD_UNITS.bannerBottom,
                    adSize: BannerAdSize.BANNER,
                    position: BannerAdPosition.BOTTOM_CENTER,
                    margin: 0,
                    isTesting: false,
                });

                // 하단 배너만 운영 → 하단 nav를 올려야 함
                applyBannerOffsets(false, true);

            } catch (e) {
                console.error('[AdMob] 초기화 실패:', e);
            }
        };

        setup();

        return () => {
            getAdMob().then(AdMob => AdMob?.removeBanner?.().catch(() => {}));
            applyBannerOffsets(false, false);
        };
    }, []);
};
