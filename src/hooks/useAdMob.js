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

function setOffset(bottom) {
    const r = document.documentElement;
    r.style.setProperty('--admob-top', '0px');
    r.style.setProperty('--admob-bottom', bottom ? `${BANNER_HEIGHT}px` : '0px');
}

export const useAdMob = () => {
    const initialized = useRef(false);

    useEffect(() => {
        if (!isNativePlatform() || initialized.current) return;
        initialized.current = true;

        let listenerHandles = [];

        const setup = async () => {
            try {
                await initAdMob();
                const AdMob = await getAdMob();
                if (!AdMob) return;

                const { BannerAdSize, BannerAdPosition, BannerAdPluginEvents } = await import('@capacitor-community/admob');

                // 이벤트 리스너 등록 (cleanup에서 제거)
                listenerHandles.push(await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
                    console.log('[AdMob Banner] Loaded OK');
                    setOffset(true);
                }));
                listenerHandles.push(await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (e) => {
                    console.error('[AdMob Banner] FailedToLoad:', JSON.stringify(e));
                }));

                console.log('[AdMob] showBanner 시도, adId:', AD_UNITS.bannerBottom, 'isTesting:', IS_TESTING);

                // 하단 배너 표시 (하나만 운영 — 동시 2개는 플러그인 미지원)
                await AdMob.showBanner({
                    adId: AD_UNITS.bannerBottom,
                    adSize: BannerAdSize.BANNER,
                    position: BannerAdPosition.BOTTOM_CENTER,
                    margin: 0,
                    isTesting: IS_TESTING,
                });

                console.log('[AdMob] showBanner 호출 완료');

            } catch (e) {
                console.error('[AdMob] 초기화/배너 실패:', e?.message, JSON.stringify(e));
            }
        };

        setup();

        return () => {
            listenerHandles.forEach(h => h?.remove?.());
            getAdMob().then(AdMob => AdMob?.removeBanner?.().catch(() => {}));
            setOffset(false);
        };
    }, []);
};
