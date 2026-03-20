import { useEffect, useRef } from 'react';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;

const IS_TESTING = true; // TODO: 실 광고 전환 시 false로 변경

const AD_UNITS = IS_TESTING ? {
    bannerTop:      'ca-app-pub-3940256099942544/6300978111', // AdMob Test Banner
    bannerBottom:   'ca-app-pub-3940256099942544/6300978111', // AdMob Test Banner
    rewardedCards:  'ca-app-pub-3940256099942544/5224354917', // AdMob Test Rewarded
    rewardedProns:  'ca-app-pub-3940256099942544/5224354917', // AdMob Test Rewarded
    interstitial:   'ca-app-pub-3940256099942544/1033173712', // AdMob Test Interstitial
} : {
    bannerTop:      'ca-app-pub-8626604652301297/3986871373', // Banner01
    bannerBottom:   'ca-app-pub-8626604652301297/4166267528', // Banner02
    rewardedCards:  'ca-app-pub-8626604652301297/4860569967', // Bonus01 (RewardC, +5)
    rewardedProns:  'ca-app-pub-8626604652301297/4166267528', // Bonus02 (RewardP, +10)
    interstitial:   'ca-app-pub-8626604652301297/6443880844', // Interstitial01
};

export { AD_UNITS, IS_TESTING };

export async function showInterstitialAd() {
    if (!isNativePlatform()) return;
    try {
        await loadAdMob();
        if (!_adMob) return;

        const { InterstitialAdPluginEvents } = await import('@capacitor-community/admob');

        await new Promise(async (resolve) => {
            const handles = [];
            const cleanup = () => handles.forEach(h => h?.remove?.());

            handles.push(await _adMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
                cleanup(); resolve();
            }));
            handles.push(await _adMob.addListener(InterstitialAdPluginEvents.FailedToLoad, (e) => {
                console.error('[AdMob Interstitial] FailedToLoad:', JSON.stringify(e));
                cleanup(); resolve();
            }));
            handles.push(await _adMob.addListener(InterstitialAdPluginEvents.FailedToShow, (e) => {
                console.error('[AdMob Interstitial] FailedToShow:', JSON.stringify(e));
                cleanup(); resolve();
            }));

            try {
                await _adMob.prepareInterstitial({ adId: AD_UNITS.interstitial, isTesting: IS_TESTING });
                await _adMob.showInterstitial();
            } catch (e) {
                console.error('[AdMob Interstitial] 실패:', e?.message);
                cleanup(); resolve();
            }
        });
    } catch (e) {
        console.error('[AdMob Interstitial] 오류:', e?.message);
    }
}

const BANNER_HEIGHT = 50;

// AdMob 플러그인을 모듈 변수에 캐싱 — async 함수에서 return하면
// JS가 thenable 감지를 위해 AdMob.then()을 호출 → 네이티브 브릿지 에러 발생
let _adMob = null;
let _admobInitialized = false;

async function loadAdMob() {
    if (_adMob) return;
    if (!isNativePlatform()) return;
    try {
        const mod = await import('@capacitor-community/admob');
        _adMob = mod.AdMob;
    } catch {
        _adMob = null;
    }
}

function setOffset(bottom) {
    const r = document.documentElement;
    r.style.setProperty('--admob-top', '0px');
    r.style.setProperty('--admob-bottom', bottom ? `${BANNER_HEIGHT}px` : '0px');
}

export const useAdMob = (tier) => {
    const initialized = useRef(false);

    useEffect(() => {
        if (!isNativePlatform() || initialized.current) return;
        if (tier === 'pro' || tier === 'premium') return;
        initialized.current = true;

        let listenerHandles = [];

        const setup = async () => {
            try {
                await loadAdMob();
                if (!_adMob) return;

                if (!_admobInitialized) {
                    await _adMob.initialize({});
                    _admobInitialized = true;
                }

                const { BannerAdSize, BannerAdPosition, BannerAdPluginEvents } = await import('@capacitor-community/admob');

                listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.Loaded, () => {
                    console.log('[AdMob Banner] Loaded OK');
                    setOffset(true);
                }));
                listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.FailedToLoad, (e) => {
                    console.error('[AdMob Banner] FailedToLoad:', JSON.stringify(e));
                }));

                console.log('[AdMob] showBanner 시도, adId:', AD_UNITS.bannerBottom, 'isTesting:', IS_TESTING);

                await _adMob.showBanner({
                    adId: AD_UNITS.bannerBottom,
                    adSize: BannerAdSize.ADAPTIVE_BANNER,
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
            if (_adMob) _adMob.removeBanner?.().catch(() => {});
            setOffset(false);
        };
    }, []);
};
