import { useEffect, useRef } from 'react';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;

// AdMob 광고 단위 ID
const AD_UNITS = {
    bannerTop:    'ca-app-pub-8626604652301297/3986871373', // Banner01
    bannerBottom: 'ca-app-pub-8626604652301297/4166267528', // Banner02
};

// 테스트 디바이스 ID (개발 중 실제 광고 클릭 방지)
// 릴리스 빌드 시 빈 배열로 변경
const TEST_DEVICE_IDS = [];

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
    await AdMob.initialize({ testingDevices: TEST_DEVICE_IDS, initializeForTesting: false });
    admobInitialized = true;
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

                // 상단 배너
                await AdMob.showBanner({
                    adId: AD_UNITS.bannerTop,
                    adSize: BannerAdSize.ADAPTIVE_BANNER,
                    position: BannerAdPosition.TOP_CENTER,
                    margin: 0,
                    isTesting: false,
                });

                // 하단 배너
                await AdMob.showBanner({
                    adId: AD_UNITS.bannerBottom,
                    adSize: BannerAdSize.ADAPTIVE_BANNER,
                    position: BannerAdPosition.BOTTOM_CENTER,
                    margin: 0,
                    isTesting: false,
                });
            } catch (e) {
                console.error('[AdMob] 초기화 실패:', e);
            }
        };

        setup();

        return () => {
            getAdMob().then(AdMob => AdMob?.removeBanner?.().catch(() => {}));
        };
    }, []);
};
