import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * [v1.5.78-diag] Thermal Guard 진단 컴포넌트 — staging 전용, 검증 후 제거 예정.
 *
 * 목적: v1.5.76 CSS 가드(html.platform-native + prefers-reduced-* 미디어쿼리)가
 *   실제로 DOM에 적용되고 발화하는지 디바이스 화면에 직접 표시.
 *
 * 진단 항목:
 *   1) Capacitor.getPlatform() / isNativePlatform()
 *   2) html / body element의 classList (platform-native 포함 여부)
 *   3) 실제 가드 효과 — 테스트 div에 .streak-status-overlay 클래스 적용 후
 *      computed backdrop-filter / animation 측정
 *   4) iOS 시스템 a11y 설정 — prefers-reduced-motion / -transparency 활성 여부
 *   5) admob-active 클래스 및 --admob-bottom CSS var 값
 *
 * 표시: 화면 상단 floating 배지. 클릭 시 닫기 + sessionStorage 영구 닫기.
 *   판정 색: 🟢 가드 작동 / 🔴 가드 미작동 / 🟡 비네이티브(웹).
 */
export default function ThermalGuardDiag() {
    const [diag, setDiag] = useState(null);
    const [dismissed, setDismissed] = useState(() => {
        try {
            return sessionStorage.getItem('thermalGuardDiagDismissed') === '1';
        } catch (e) { return false; }
    });

    useEffect(() => {
        // 약간 지연시켜 platform-native 클래스 적용 useEffect(App.jsx:578)가 먼저 fire되도록.
        const timer = setTimeout(() => {
            const platform = Capacitor.getPlatform?.() || 'unknown';
            const isNative = Capacitor.isNativePlatform?.() || false;
            const htmlClasses = document.documentElement.className || '(empty)';
            const bodyClasses = document.body?.className || '(empty)';
            const hasPlatformNative = htmlClasses.includes('platform-native');

            // 실제 가드 효과 검증 — 테스트 div에 .streak-status-overlay 적용
            const testOverlay = document.createElement('div');
            testOverlay.className = 'streak-status-overlay';
            testOverlay.style.position = 'absolute';
            testOverlay.style.opacity = '0';
            testOverlay.style.pointerEvents = 'none';
            testOverlay.style.width = '1px';
            testOverlay.style.height = '1px';
            document.body.appendChild(testOverlay);

            const testPiece = document.createElement('div');
            testPiece.className = 'streak-status-piece';
            testOverlay.appendChild(testPiece);

            const overlayStyle = getComputedStyle(testOverlay);
            const pieceStyle = getComputedStyle(testPiece);

            const overlayBackdrop = overlayStyle.backdropFilter || overlayStyle.webkitBackdropFilter || 'unknown';
            const pieceAnimation = pieceStyle.animationName || 'unknown';

            document.body.removeChild(testOverlay);

            // 시스템 a11y 설정
            let reducedMotion = false, reducedTransparency = false;
            try {
                reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
            } catch (e) { /* noop */ }

            // AdMob
            const admobActive = document.documentElement.classList.contains('admob-active');
            const admobBottom = getComputedStyle(document.documentElement)
                .getPropertyValue('--admob-bottom').trim() || '(unset)';

            // 가드 판정
            // 네이티브 + platform-native 적용 + backdrop-filter가 none이면 작동 중
            const guardWorking = isNative && hasPlatformNative
                && (overlayBackdrop === 'none' || overlayBackdrop === '');

            setDiag({
                platform,
                isNative,
                htmlClasses,
                bodyClasses,
                hasPlatformNative,
                overlayBackdrop,
                pieceAnimation,
                reducedMotion,
                reducedTransparency,
                admobActive,
                admobBottom,
                guardWorking,
            });
        }, 800); // 800ms 대기 — useEffect 마운트 + Capacitor bridge 준비

        return () => clearTimeout(timer);
    }, []);

    const handleDismiss = () => {
        try { sessionStorage.setItem('thermalGuardDiagDismissed', '1'); } catch (e) { /* noop */ }
        setDismissed(true);
    };

    if (dismissed || !diag) return null;

    // 색상 판정
    const verdictColor = !diag.isNative
        ? '#f59e0b'   // 🟡 web
        : diag.guardWorking
            ? '#10b981'   // 🟢 작동
            : '#dc2626';  // 🔴 미작동

    const verdictIcon = !diag.isNative
        ? '🟡 WEB'
        : diag.guardWorking
            ? '🟢 OK'
            : '🔴 FAIL';

    return (
        <div
            style={{
                position: 'fixed',
                top: 'calc(env(safe-area-inset-top, 0px) + 4px)',
                left: '8px',
                right: '8px',
                zIndex: 99999,
                background: verdictColor,
                color: 'white',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '0.62rem',
                lineHeight: 1.35,
                fontWeight: 600,
                maxWidth: '420px',
                margin: '0 auto',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                fontFamily: 'monospace',
            }}
            onClick={handleDismiss}
            role="button"
            aria-label="Dismiss thermal guard diagnostic"
        >
            <div style={{ fontWeight: 800, marginBottom: 2, fontSize: '0.7rem' }}>
                🩺 Thermal Guard Diag · v1.5.78-diag · {verdictIcon}
            </div>
            <div>
                Platform: <b>{diag.platform}</b> · isNative: <b>{String(diag.isNative)}</b>
            </div>
            <div>
                html.platform-native: <b>{diag.hasPlatformNative ? '✅ YES' : '❌ NO'}</b>
            </div>
            <div style={{ wordBreak: 'break-all', opacity: 0.92 }}>
                html.class: {diag.htmlClasses}
            </div>
            <div>
                .streak-status-overlay backdrop-filter:{' '}
                <b>{diag.overlayBackdrop === 'none' || diag.overlayBackdrop === '' ? '✅ none' : `❌ ${diag.overlayBackdrop}`}</b>
            </div>
            <div>
                .streak-status-piece animation-name:{' '}
                <b>{diag.pieceAnimation === 'none' ? '✅ none' : `❌ ${diag.pieceAnimation}`}</b>
            </div>
            <div>
                a11y reduced-motion: <b>{String(diag.reducedMotion)}</b> · reduced-transparency: <b>{String(diag.reducedTransparency)}</b>
            </div>
            <div>
                AdMob: active=<b>{String(diag.admobActive)}</b> · bottom=<b>{diag.admobBottom}</b>
            </div>
            <div style={{ marginTop: 4, opacity: 0.85, fontSize: '0.58rem' }}>
                (tap to dismiss) · v1.5.78-diag staging only
            </div>
        </div>
    );
}
