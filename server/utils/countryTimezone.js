// 국가코드 → IANA 타임존 매핑 + local hour 판정 유틸
// Re-engagement cron이 매시간 실행될 때, "지금 local 10시인 국가" 식별에 사용

// 사용자 deviceLang fallback이 없을 때를 대비한 우선순위:
//   1) user.geoCountry (IP 기반 감지)
//   2) deviceLangToCountry(user.deviceLang) (브라우저 언어 추정)
//   3) 'KR' (개발 본거지 fallback)
const TZ_BY_COUNTRY = {
    // East Asia (UTC+9 / +8)
    KR: 'Asia/Seoul',
    JP: 'Asia/Tokyo',
    CN: 'Asia/Shanghai',
    TW: 'Asia/Taipei',
    HK: 'Asia/Hong_Kong',
    SG: 'Asia/Singapore',
    MY: 'Asia/Kuala_Lumpur',
    PH: 'Asia/Manila',

    // Southeast Asia (UTC+7)
    VN: 'Asia/Ho_Chi_Minh',
    TH: 'Asia/Bangkok',
    ID: 'Asia/Jakarta',

    // South Asia
    IN: 'Asia/Kolkata',  // UTC+5:30

    // Europe — DST 대응을 위해 IANA TZ 사용
    DE: 'Europe/Berlin',
    FR: 'Europe/Paris',
    ES: 'Europe/Madrid',
    IT: 'Europe/Rome',
    NL: 'Europe/Amsterdam',
    PL: 'Europe/Warsaw',
    GB: 'Europe/London',
    PT: 'Europe/Lisbon',
    AT: 'Europe/Vienna',
    CH: 'Europe/Zurich',
    SE: 'Europe/Stockholm',
    NO: 'Europe/Oslo',
    DK: 'Europe/Copenhagen',
    FI: 'Europe/Helsinki',
    GR: 'Europe/Athens',
    CZ: 'Europe/Prague',
    BE: 'Europe/Brussels',
    IE: 'Europe/Dublin',

    // Middle East / Russia / Turkey
    RU: 'Europe/Moscow',
    TR: 'Europe/Istanbul',
    IL: 'Asia/Jerusalem',
    SA: 'Asia/Riyadh',
    AE: 'Asia/Dubai',

    // Americas — 1차는 단일 슬롯 정책 (US는 PT 기준)
    BR: 'America/Sao_Paulo',
    US: 'America/Los_Angeles',  // PT 기준 (Phase 2: 동부/중부 분리 검토)
    CA: 'America/Toronto',
    MX: 'America/Mexico_City',
    AR: 'America/Argentina/Buenos_Aires',
    CL: 'America/Santiago',

    // Oceania
    AU: 'Australia/Sydney',
    NZ: 'Pacific/Auckland',
};

// brower deviceLang → 대표 country (geoCountry 미설정 fallback)
const COUNTRY_BY_DEVICELANG = {
    ko: 'KR',
    en: 'US',
    ja: 'JP',
    'zh-CN': 'CN',
    zh: 'CN',
    vi: 'VN',
    es: 'ES',
    fr: 'FR',
    de: 'DE',
    ru: 'RU',
    'pt-BR': 'BR',
    pt: 'BR',
    it: 'IT',
    th: 'TH',
    id: 'ID',
    tr: 'TR',
};

function deviceLangToCountry(deviceLang) {
    if (!deviceLang) return null;
    if (COUNTRY_BY_DEVICELANG[deviceLang]) return COUNTRY_BY_DEVICELANG[deviceLang];
    const short = deviceLang.split('-')[0];
    return COUNTRY_BY_DEVICELANG[short] || null;
}

/**
 * 유저의 effective country code 결정
 * @param {{ geoCountry?: string, deviceLang?: string }} user
 * @returns {string} ISO country code (대문자), 결정 실패 시 'KR' fallback
 */
function effectiveCountry(user) {
    const geo = (user?.geoCountry || '').toUpperCase().trim();
    if (geo && TZ_BY_COUNTRY[geo]) return geo;
    const fromLang = deviceLangToCountry(user?.deviceLang);
    if (fromLang && TZ_BY_COUNTRY[fromLang]) return fromLang;
    return 'KR';
}

/**
 * @param {string} country ISO code
 * @param {Date} [now] 기준 시각 (테스트용)
 * @returns {number} 해당 국가의 현재 local hour (0-23). 매핑 없으면 -1
 */
function getLocalHour(country, now = new Date()) {
    const tz = TZ_BY_COUNTRY[country];
    if (!tz) return -1;
    try {
        const fmt = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            hour12: false,
            timeZone: tz,
        });
        const h = parseInt(fmt.format(now), 10);
        // 24시 표기에서 일부 환경이 '24'를 반환할 수 있어 정규화
        return isNaN(h) ? -1 : (h % 24);
    } catch {
        return -1;
    }
}

/**
 * 현재 시각이 해당 국가에서 local 10시 슬롯에 들어가는지
 * @param {string} country
 * @param {Date} [now]
 */
function isLocalHour10(country, now = new Date()) {
    return getLocalHour(country, now) === 10;
}

/**
 * 현재 UTC 시각 기준 local 10시인 모든 국가 목록 반환
 * @param {Date} [now]
 * @returns {string[]} ISO country codes
 */
function countriesAtLocalHour10(now = new Date()) {
    return Object.keys(TZ_BY_COUNTRY).filter(c => isLocalHour10(c, now));
}

module.exports = {
    TZ_BY_COUNTRY,
    deviceLangToCountry,
    effectiveCountry,
    getLocalHour,
    isLocalHour10,
    countriesAtLocalHour10,
};
