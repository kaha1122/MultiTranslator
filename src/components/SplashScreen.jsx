import React, { useEffect, useState } from 'react';
import { getT } from '../utils/i18n';
import './SplashScreen.css';

// ─────────────────────────────────────────────────────────────────────────────
// SplashScreen.jsx
//
// 앱을 아이콘으로 처음 열 때 잠깐 보이는 로딩 화면입니다.
// "PronunFit" 로고 + 회전하는 원형 링 + 사운드 웨이브가 나타났다가
// 약 2.3초 후에 부드럽게 사라지며 메인 화면으로 전환됩니다.
//
// 사용 방법: App.jsx에서 showSplash가 true일 때만 이 컴포넌트를 렌더링합니다.
// ─────────────────────────────────────────────────────────────────────────────

function SplashScreen({ onFinish }) {
    const lang = localStorage.getItem('sourceLang') || navigator.language?.split('-')[0] || 'ko';
    const tagLine = getT(lang.startsWith('zh') ? 'zh-CN' : lang, 'splashTagline');
    // isFading: true가 되면 CSS 트랜지션으로 화면이 투명해지기 시작합니다.
    const [isFading, setIsFading] = useState(false);

    useEffect(() => {
        // 1.8초 후부터 페이드 아웃 시작
        const fadeTimer = setTimeout(() => setIsFading(true), 1800);

        // 페이드 아웃 0.5초 완료 후, 부모에게 "스플래시 끝!" 신호 전달
        const finishTimer = setTimeout(() => onFinish(), 2300);

        // 컴포넌트가 사라질 때 타이머 정리 (메모리 누수 방지)
        return () => {
            clearTimeout(fadeTimer);
            clearTimeout(finishTimer);
        };
    }, [onFinish]);

    return (
        <div className={`splash-screen ${isFading ? 'splash-fading' : ''}`}>

            {/* ── 회전하는 원형 링 3겹 ───────────────────────────────────────
                각 링이 다른 속도로 회전하여 역동적인 느낌을 줍니다.
            ─────────────────────────────────────────────────────────────── */}
            <div className="splash-ring-wrapper">
                <div className="splash-ring ring-outer" />
                <div className="splash-ring ring-middle" />
                <div className="splash-ring ring-inner" />

                {/* 링 중앙에 사운드 웨이브 SVG */}
                <div className="splash-center">
                    <svg className="splash-wave-icon" viewBox="0 0 60 30" fill="none">
                        <rect className="wave-bar bar1" x="2" y="10" width="6" height="10" rx="3" fill="white" />
                        <rect className="wave-bar bar2" x="12" y="4" width="6" height="22" rx="3" fill="white" />
                        <rect className="wave-bar bar3" x="22" y="0" width="6" height="30" rx="3" fill="white" />
                        <rect className="wave-bar bar4" x="32" y="4" width="6" height="22" rx="3" fill="white" />
                        <rect className="wave-bar bar5" x="42" y="8" width="6" height="14" rx="3" fill="white" />
                        <rect className="wave-bar bar6" x="52" y="12" width="6" height="6" rx="3" fill="white" />
                    </svg>
                </div>
            </div>

            {/* ── 앱 이름 + 부제목 ──────────────────────────────────────── */}
            <div className="splash-text-block">
                <h1 className="splash-app-name">PronunFit</h1>
                <p className="splash-tagline">{tagLine}</p>
            </div>

        </div>
    );
}

export default SplashScreen;
