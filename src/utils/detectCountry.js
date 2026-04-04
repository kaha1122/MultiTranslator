// IP 기반 국가 감지 (결제 통화 결정용)
// 서버 경유 방식 — iOS WKWebView에서도 안정적으로 동작
// 캐시하여 세션 동안 한 번만 호출

let cached = null;

const SERVER_URL = (() => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
})();

export async function detectCountry() {
    if (cached) return cached;

    try {
        const res = await fetch(`${SERVER_URL}/api/detect-country`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        cached = {
            country: data.country || 'US',
            currency: data.country === 'KR' ? 'KRW' : 'USD',
            city: data.city || '',
            region: data.region || '',
        };
    } catch {
        // 서버 감지 실패 시 기본값 USD (해외 사용자 가정)
        cached = { country: 'US', currency: 'USD', city: '', region: '' };
    }

    return cached;
}

export function isKorea(countryInfo) {
    return countryInfo?.country === 'KR';
}
