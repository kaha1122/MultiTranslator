// IP 기반 국가 감지 (결제 통화 결정용)
// 캐시하여 세션 동안 한 번만 호출

let cached = null;

export async function detectCountry() {
    if (cached) return cached;

    try {
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        cached = { country: data.country_code || 'US', currency: data.country_code === 'KR' ? 'KRW' : 'USD' };
    } catch {
        // 감지 실패 시 기본값 USD (해외 사용자 가정)
        cached = { country: 'US', currency: 'USD' };
    }

    return cached;
}

export function isKorea(countryInfo) {
    return countryInfo?.country === 'KR';
}
