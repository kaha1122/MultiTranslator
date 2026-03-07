import { useEffect, useRef } from 'react';

/**
 * Google AdSense 광고 배너
 *
 * [슬롯 ID 발급 방법]
 * AdSense 심사 통과 후:
 *   AdSense 대시보드 → 광고 → 광고 단위 → 디스플레이 광고 생성
 *   → 발급된 data-ad-slot 값을 ADSENSE_SLOTS 상수에 채워넣으면 즉시 활성화됩니다.
 */
const AdBanner = ({ slot, style }) => {
    const pushed = useRef(false);

    useEffect(() => {
        if (!slot || slot === 'TODO') return;
        if (pushed.current) return;
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
            pushed.current = true;
        } catch (e) {
            // AdSense 스크립트 로드 전이면 무시
        }
    }, [slot]);

    if (!slot || slot === 'TODO') return null;

    return (
        <div style={{ textAlign: 'center', overflow: 'hidden', ...style }}>
            <ins
                className="adsbygoogle"
                style={{ display: 'block' }}
                data-ad-client="ca-pub-8626604652301297"
                data-ad-slot={slot}
                data-ad-format="auto"
                data-full-width-responsive="true"
            />
        </div>
    );
};

export default AdBanner;
