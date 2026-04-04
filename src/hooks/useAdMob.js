import { useEffect, useRef } from 'react';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;
const isIOS = () => window.Capacitor?.getPlatform?.() === 'ios';

const IS_TESTING = true; // TODO: 실 광고 전환 시 false로 변경

// Android 프로덕션 Ad Unit IDs
const AD_UNITS_ANDROID = {
    bannerTop:      'ca-app-pub-8626604652301297/3986871373', // Banner01
    bannerBottom:   'ca-app-pub-8626604652301297/4166267528', // Banner02
    rewardedCards:  'ca-app-pub-8626604652301297/4860569967', // Bonus01 (RewardC, +5)
    rewardedProns:  'ca-app-pub-8626604652301297/4166267528', // Bonus02 (RewardP, +10)
    interstitial:   'ca-app-pub-8626604652301297/6443880844', // Interstitial01
};

// iOS 프로덕션 Ad Unit IDs
const AD_UNITS_IOS = {
    bannerTop:      'ca-app-pub-8626604652301297/4522890515', // iOS Banner01 (bannerTop 미사용, bannerBottom과 동일)
    bannerBottom:   'ca-app-pub-8626604652301297/4522890515', // iOS Banner01
    rewardedCards:  'ca-app-pub-8626604652301297/6602055685', // iOS Bonus01 (RewardC)
    rewardedProns:  'ca-app-pub-8626604652301297/3209808845', // iOS Bonus02 (RewardP)
    interstitial:   'ca-app-pub-8626604652301297/2858455055', // iOS Interstitial01
};

const AD_UNITS_TEST = {
    bannerTop:      'ca-app-pub-3940256099942544/6300978111', // AdMob Test Banner
    bannerBottom:   'ca-app-pub-3940256099942544/6300978111', // AdMob Test Banner
    rewardedCards:  'ca-app-pub-3940256099942544/5224354917', // AdMob Test Rewarded
    rewardedProns:  'ca-app-pub-3940256099942544/5224354917', // AdMob Test Rewarded
    interstitial:   'ca-app-pub-3940256099942544/1033173712', // AdMob Test Interstitial
};

const AD_UNITS = IS_TESTING ? AD_UNITS_TEST : (isIOS() ? AD_UNITS_IOS : AD_UNITS_ANDROID);

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

const DEFAULT_BANNER_HEIGHT = 60;

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

// 플랫폼 CSS 클래스는 App.jsx useEffect에서 설정 (Capacitor 브릿지 준비 보장)

function setOffset(height) {
    const r = document.documentElement;
    r.style.setProperty('--admob-top', '0px');
    r.style.setProperty('--admob-bottom', height ? `${height}px` : '0px');
    // 광고 유무에 따라 CSS 클래스 토글 — CSS에서 safe-area 분기에 사용
    if (height) {
        r.classList.add('admob-active');
    } else {
        r.classList.remove('admob-active');
    }
}

export const useAdMob = (tier) => {
    const bannerShowing = useRef(false);
    const isPaid = tier === 'pro' || tier === 'premium';

    // Pro/Premium 전환 시 배너 제거
    useEffect(() => {
        if (!isNativePlatform()) return;
        if (isPaid && bannerShowing.current) {
            if (_adMob) _adMob.removeBanner?.().catch(() => {});
            setOffset(false);
            bannerShowing.current = false;
            console.log('[AdMob] Banner removed (paid tier)');
        }
    }, [isPaid]);

    // Trial 시 배너 표시
    useEffect(() => {
        if (!isNativePlatform() || isPaid || bannerShowing.current) return;

        let listenerHandles = [];

        const setup = async () => {
            try {
                await loadAdMob();
                if (!_adMob) return;

                if (!_admobInitialized) {
                    // iOS: ATT 프롬프트를 AdMob 초기화 전에 표시 (Apple 필수)
                    if (isIOS()) {
                        try {
                            const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                            const attResult = await FirebaseAuthentication.requestAppTrackingTransparencyPermission();
                            // ATT 승인 상태를 window에 저장 → App.jsx에서 Firestore에 기록
                            const status = attResult?.status || 'unknown';
                            window.__attStatus = status;
                            console.log('[ATT] status:', status);
                        } catch (e) {
                            console.warn('[ATT] requestPermission failed:', e?.message);
                            window.__attStatus = 'error';
                        }
                    }
                    await _adMob.initialize({});
                    _admobInitialized = true;
                }

                const { BannerAdSize, BannerAdPosition, BannerAdPluginEvents } = await import('@capacitor-community/admob');

                listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
                    const h = info?.height || DEFAULT_BANNER_HEIGHT;
                    console.log('[AdMob Banner] SizeChanged, height:', h);
                    setOffset(h);
                }));
                listenerHandles.push(await _adMob.addListener(BannerAdPluginEvents.Loaded, () => {
                    console.log('[AdMob Banner] Loaded OK');
                    setOffset(DEFAULT_BANNER_HEIGHT); // SizeChanged가 아직 안 왔을 때 폴백
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

                bannerShowing.current = true;
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
            bannerShowing.current = false;
        };
    }, [isPaid]);
};
