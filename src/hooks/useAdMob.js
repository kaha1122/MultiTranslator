import { useEffect } from 'react';

const isNativePlatform = () => window.Capacitor?.isNativePlatform?.() === true;
const isIOS = () => window.Capacitor?.getPlatform?.() === 'ios';

const IS_TESTING = false; // App Store production. 검증 시 true로 일시 변경 후 반드시 복원.

// Android 프로덕션 Ad Unit IDs
const AD_UNITS_ANDROID = {
    bannerTop:      'ca-app-pub-8626604652301297/3986871373', // Banner01
    bannerBottom:   'ca-app-pub-8626604652301297/4166267528', // Banner02
    rewardedCards:  'ca-app-pub-8626604652301297/4860569967', // Bonus01 (RewardC, +5)
    rewardedProns:  'ca-app-pub-8626604652301297/9921324956', // Bonus02 (RewardP, +10)
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
    if (!isNativePlatform()) return false;
    try {
        await loadAdMob();
        if (!_adMob) return false;

        const { InterstitialAdPluginEvents } = await import('@capacitor-community/admob');

        return await new Promise(async (resolve) => {
            const handles = [];
            let shown = false;
            const cleanup = () => handles.forEach(h => h?.remove?.());

            handles.push(await _adMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
                cleanup(); resolve(shown);
            }));
            handles.push(await _adMob.addListener(InterstitialAdPluginEvents.FailedToLoad, (e) => {
                console.error('[AdMob Interstitial] FailedToLoad:', JSON.stringify(e));
                cleanup(); resolve(false);
            }));
            handles.push(await _adMob.addListener(InterstitialAdPluginEvents.FailedToShow, (e) => {
                console.error('[AdMob Interstitial] FailedToShow:', JSON.stringify(e));
                cleanup(); resolve(false);
            }));

            try {
                await _adMob.prepareInterstitial({ adId: AD_UNITS.interstitial, isTesting: IS_TESTING });
                await _adMob.showInterstitial();
                shown = true;
            } catch (e) {
                console.error('[AdMob Interstitial] 실패:', e?.message);
                cleanup(); resolve(false);
            }
        });
    } catch (e) {
        console.error('[AdMob Interstitial] 오류:', e?.message);
        return false;
    }
}

// 폴백 높이 — SizeChanged 이벤트 도착 전 또는 info.height 미수신 시 사용.
// ADAPTIVE_BANNER는 화면에 따라 50~110px 가변이므로 보수적으로 100 (이전 60 → nav 가림 사례).
// CSS에선 max(--admob-bottom, 100px)로 한번 더 floor 보장.
const DEFAULT_BANNER_HEIGHT = 100;

// AdMob 플러그인을 모듈 변수에 캐싱 — async 함수에서 return하면
// JS가 thenable 감지를 위해 AdMob.then()을 호출 → 네이티브 브릿지 에러 발생
let _adMob = null;
let _admobInitialized = false;

// 모듈 레벨 배너 상태 — StrictMode/hot reload/effect 재실행으로 setup이 동시에
// 두 번 진입하면 BannerExecutor.updateExistingAdView()에서 destroy된 AdView에
// loadAd() 호출 → NPE (BannerExecutor.java:230). 모듈 레벨에서 단일 직렬화.
let _bannerShowing = false;
let _bannerSetupInFlight = false;

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
    const isPaid = tier === 'pro' || tier === 'premium';
    // ⚠ 콜드스타트 미동기화 가드: tier가 null/undefined면 profile 미로드 상태로 간주.
    //   profile이 null일 때 AuthContext가 'trial' 폴백을 주면 Pro 유저에게 ATT 프롬프트 +
    //   배너 깜빡임이 발생함. App.jsx에서 `useAdMob(profile ? tier : null)` 로 호출.
    const isReady = tier != null;

    // Pro/Premium 전환 시 배너 제거
    useEffect(() => {
        if (!isNativePlatform()) return;
        if (!isReady) return;
        if (isPaid && _bannerShowing) {
            if (_adMob) _adMob.removeBanner?.().catch(() => {});
            setOffset(false);
            _bannerShowing = false;
            console.log('[AdMob] Banner removed (paid tier)');
        }
    }, [isPaid, isReady]);

    // Trial 시 배너 표시
    useEffect(() => {
        if (!isNativePlatform() || isPaid) return;
        if (!isReady) return; // profile 미로드 상태에서는 ATT/AdMob 초기화 보류
        if (_bannerShowing || _bannerSetupInFlight) return; // 동시 setup 진입 차단

        let listenerHandles = [];
        let cancelled = false;

        const setup = async () => {
            _bannerSetupInFlight = true;
            try {
                await loadAdMob();
                if (!_adMob || cancelled) return;

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

                if (cancelled) return;

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
                    // no-fill 시 예약된 100px 공간 회수 — 빈 영역이 콘텐츠 아래 표시되는 결함 방지
                    // (iOS 출시 전 AdMob no-fill / 인터넷 끊김 / 광고 차단기 사용 시 발생)
                    setOffset(false);
                }));

                // 🚨 NPE 가드: showBanner 직전에 기존 AdView를 명시적으로 정리.
                // 두 번째 진입이 'updateExistingAdView' 경로로 들어가면서 destroy된 mAdView에
                // loadAd()를 호출하는 결함(BannerExecutor.java:230) 회피.
                try { await _adMob.removeBanner(); } catch {}

                if (cancelled) return;

                console.log('[AdMob] showBanner 시도, adId:', AD_UNITS.bannerBottom, 'isTesting:', IS_TESTING);

                await _adMob.showBanner({
                    adId: AD_UNITS.bannerBottom,
                    adSize: BannerAdSize.ADAPTIVE_BANNER,
                    position: BannerAdPosition.BOTTOM_CENTER,
                    margin: 0,
                    isTesting: IS_TESTING,
                });

                _bannerShowing = true;
                console.log('[AdMob] showBanner 호출 완료');

            } catch (e) {
                console.error('[AdMob] 초기화/배너 실패:', e?.message, JSON.stringify(e));
            } finally {
                _bannerSetupInFlight = false;
            }
        };

        setup();

        return () => {
            cancelled = true;
            listenerHandles.forEach(h => h?.remove?.());
            if (_adMob) _adMob.removeBanner?.().catch(() => {});
            setOffset(false);
            _bannerShowing = false;
        };
    }, [isPaid, isReady]);
};
