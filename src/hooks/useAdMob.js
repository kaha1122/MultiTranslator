import { useEffect, useRef } from 'react';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;

const IS_TESTING = true; // TODO: 실 광고 전환 시 false로 변경

const AD_UNITS = IS_TESTING ? {
    bannerTop:      'ca-app-pub-3940256099942544/6300978111', // AdMob Test Banner
    bannerBottom:   'ca-app-pub-3940256099942544/6300978111', // AdMob Test Banner
    rewardedCards:  'ca-app-pub-3940256099942544/5224354917', // AdMob Test Rewarded
    rewardedProns:  'ca-app-pub-3940256099942544/5224354917', // AdMob Test Rewarded
} : {
    bannerTop:      'ca-app-pub-8626604652301297/3986871373', // Banner01
    bannerBottom:   'ca-app-pub-8626604652301297/4166267528', // Banner02
    rewardedCards:  'ca-app-pub-8626604652301297/4860569967', // Bonus01 (RewardC, +5)
    rewardedProns:  'ca-app-pub-8626604652301297/4166267528', // Bonus02 (RewardP, +10)
};

export { AD_UNITS, IS_TESTING };

const BANNER_HEIGHT = 50;

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
    await AdMob.initialize({ testingDevices: [], initializeForTesting: IS_TESTING });
    admobInitialized = true;
}

function setOffset(top, bottom) {
    const r = document.documentElement;
    r.style.setProperty('--admob-top',    top    ? `${BANNER_HEIGHT}px` : '0px');
    r.style.setProperty('--admob-bottom', bottom ? `${BANNER_HEIGHT}px` : '0px');
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

                const { BannerAdSize, BannerAdPosition, BannerAdPluginEvents } = await import('@capacitor-community/admob');

                // 배너 에러 리스너 (원인 파악용)
                AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (e) => {
                    console.error('[AdMob Banner] FailedToLoad:', JSON.stringify(e));
                });
                AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
                    console.log('[AdMob Banner] Loaded OK');
                });

                console.log('[AdMob] showBanner 시도, adId:', AD_UNITS.bannerTop, 'isTesting:', IS_TESTING);

                // 상단 배너 표시
                await AdMob.showBanner({
                    adId: AD_UNITS.bannerTop,
                    adSize: BannerAdSize.BANNER,
                    position: BannerAdPosition.TOP_CENTER,
                    margin: 0,
                    isTesting: IS_TESTING,
                });
                // 상단 배너 높이만큼 헤더 아래로 이동
                setOffset(true, false);
                console.log('[AdMob] showBanner 호출 완료');

                // 하단 배너 시도 (플러그인이 동시 2개 지원하는 경우)
                try {
                    await AdMob.showBanner({
                        adId: AD_UNITS.bannerBottom,
                        adSize: BannerAdSize.BANNER,
                        position: BannerAdPosition.BOTTOM_CENTER,
                        margin: 0,
                        isTesting: IS_TESTING,
                    });
                    setOffset(true, true);
                } catch (e2) {
                    console.warn('[AdMob] 하단 배너 동시 표시 불가 — 상단만 운영:', e2?.message);
                }

            } catch (e) {
                console.error('[AdMob] 초기화/배너 실패:', e?.message, JSON.stringify(e));
            }
        };

        setup();

        return () => {
            getAdMob().then(AdMob => AdMob?.removeBanner?.().catch(() => {}));
            setOffset(false, false);
        };
    }, []);
};
