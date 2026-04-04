// ── 결제 통화 결정용 (UpgradeModal) ──────────────────────────────────
// 클라이언트에서 직접 IP API 호출 — VPN 등 사용자 네트워크 그대로 반영
// 실패 시 USD 기본값 (해외 사용자 가정 — 결제 안전)
// 세션 캐시: 한 세션 동안 한 번만 호출

let cachedCountry = null;

export async function detectCountry() {
    if (cachedCountry) return cachedCountry;

    try {
        const res = await fetch('https://ipwhois.app/json/?objects=country_code', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        cachedCountry = {
            country: data.country_code || 'US',
            currency: data.country_code === 'KR' ? 'KRW' : 'USD',
        };
    } catch {
        cachedCountry = { country: 'US', currency: 'USD' };
    }

    return cachedCountry;
}

export function isKorea(countryInfo) {
    return countryInfo?.country === 'KR';
}

// ── 프로필 기록용 (AuthContext) ──────────────────────────────────────
// 서버 경유 — iOS WKWebView에서도 안정적
// 실패 시 빈값 반환 (Firestore에 잘못된 값 저장 방지)
// 캐시 없음 — 로그인마다 최신 정보 취득

const SERVER_URL = (() => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
})();

export async function detectGeoInfo() {
    try {
        const res = await fetch(`${SERVER_URL}/api/detect-country`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        // 빈값이면 저장하지 않도록 country가 있을 때만 반환
        if (!data.country) return { country: '', city: '', region: '' };
        return {
            country: data.country,
            city: data.city || '',
            region: data.region || '',
        };
    } catch {
        return { country: '', city: '', region: '' };
    }
}
