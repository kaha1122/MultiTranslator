import React, { useEffect, useState } from 'react';
import splashBg from '../assets/splash-bg.jpg';
import './SplashScreen.css';

// 앱 시작 시 잠깐 보이는 스플래시. 배경 이미지에 로고/서브텍스트가 이미 포함돼 있음.
// 데스크톱 브라우저에서도 이미지가 원본 비율(9:16.5)로 중앙에 표시되도록 inner 박스 사용.
function SplashScreen({ onFinish }) {
    const [isFading, setIsFading] = useState(false);

    useEffect(() => {
        const fadeTimer = setTimeout(() => setIsFading(true), 1800);
        const finishTimer = setTimeout(() => onFinish(), 2300);
        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(finishTimer);
        };
    }, [onFinish]);

    return (
        <div
            className={`splash-screen ${isFading ? 'splash-fading' : ''}`}
            role="img"
            aria-label="PronunFit"
        >
            <div
                className="splash-inner"
                style={{ backgroundImage: `url(${splashBg})` }}
            />
        </div>
    );
}

export default SplashScreen;
