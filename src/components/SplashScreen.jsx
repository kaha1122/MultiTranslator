import React, { useEffect, useState } from 'react';
import splashBg from '../assets/splash-bg.jpg';
import './SplashScreen.css';

// 앱 시작 시 잠깐 보이는 스플래시. 배경 이미지에 로고/서브텍스트가 이미 포함돼 있음.
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
            style={{ backgroundImage: `url(${splashBg})` }}
            role="img"
            aria-label="PronunFit"
        />
    );
}

export default SplashScreen;
