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
    MO: 'Asia/Macau',
    SG: 'Asia/Singapore',
    MY: 'Asia/Kuala_Lumpur',
    PH: 'Asia/Manila',
    MN: 'Asia/Ulaanbaatar',
    KP: 'Asia/Pyongyang',

    // Southeast Asia (UTC+7)
    VN: 'Asia/Ho_Chi_Minh',
    TH: 'Asia/Bangkok',
    ID: 'Asia/Jakarta',
    KH: 'Asia/Phnom_Penh',
    LA: 'Asia/Vientiane',
    MM: 'Asia/Yangon',          // UTC+6:30
    BN: 'Asia/Brunei',

    // South Asia
    IN: 'Asia/Kolkata',         // UTC+5:30
    PK: 'Asia/Karachi',
    BD: 'Asia/Dhaka',
    LK: 'Asia/Colombo',         // UTC+5:30
    NP: 'Asia/Kathmandu',       // UTC+5:45
    MV: 'Indian/Maldives',
    BT: 'Asia/Thimphu',
    AF: 'Asia/Kabul',           // UTC+4:30

    // Central Asia (UTC+5 / +6)
    UZ: 'Asia/Tashkent',
    KZ: 'Asia/Almaty',
    KG: 'Asia/Bishkek',
    TJ: 'Asia/Dushanbe',
    TM: 'Asia/Ashgabat',

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
    HU: 'Europe/Budapest',
    RO: 'Europe/Bucharest',
    BG: 'Europe/Sofia',
    SK: 'Europe/Bratislava',
    SI: 'Europe/Ljubljana',
    HR: 'Europe/Zagreb',
    RS: 'Europe/Belgrade',
    BA: 'Europe/Sarajevo',
    MK: 'Europe/Skopje',
    AL: 'Europe/Tirane',
    ME: 'Europe/Podgorica',
    XK: 'Europe/Belgrade',     // 코소보 — Belgrade TZ 공유
    LT: 'Europe/Vilnius',
    LV: 'Europe/Riga',
    EE: 'Europe/Tallinn',
    LU: 'Europe/Luxembourg',
    IS: 'Atlantic/Reykjavik',
    MT: 'Europe/Malta',
    CY: 'Asia/Nicosia',

    // Russia / Eastern Europe / Caucasus
    RU: 'Europe/Moscow',       // 11개 TZ 중 모스크바 기준 (1차)
    TR: 'Europe/Istanbul',
    UA: 'Europe/Kyiv',
    BY: 'Europe/Minsk',
    MD: 'Europe/Chisinau',
    GE: 'Asia/Tbilisi',
    AM: 'Asia/Yerevan',
    AZ: 'Asia/Baku',

    // Middle East
    IL: 'Asia/Jerusalem',
    SA: 'Asia/Riyadh',
    AE: 'Asia/Dubai',
    QA: 'Asia/Qatar',
    KW: 'Asia/Kuwait',
    BH: 'Asia/Bahrain',
    OM: 'Asia/Muscat',
    JO: 'Asia/Amman',
    LB: 'Asia/Beirut',
    SY: 'Asia/Damascus',
    IQ: 'Asia/Baghdad',
    IR: 'Asia/Tehran',          // UTC+3:30
    YE: 'Asia/Aden',
    PS: 'Asia/Gaza',

    // Africa
    EG: 'Africa/Cairo',
    MA: 'Africa/Casablanca',
    DZ: 'Africa/Algiers',
    TN: 'Africa/Tunis',
    LY: 'Africa/Tripoli',
    SD: 'Africa/Khartoum',
    NG: 'Africa/Lagos',
    KE: 'Africa/Nairobi',
    ET: 'Africa/Addis_Ababa',
    GH: 'Africa/Accra',
    CI: 'Africa/Abidjan',
    SN: 'Africa/Dakar',
    ZA: 'Africa/Johannesburg',
    UG: 'Africa/Kampala',
    TZ: 'Africa/Dar_es_Salaam',
    RW: 'Africa/Kigali',
    BI: 'Africa/Bujumbura',
    MZ: 'Africa/Maputo',
    AO: 'Africa/Luanda',
    CD: 'Africa/Kinshasa',
    CG: 'Africa/Brazzaville',
    CF: 'Africa/Bangui',
    CM: 'Africa/Douala',
    GA: 'Africa/Libreville',
    GQ: 'Africa/Malabo',
    SO: 'Africa/Mogadishu',
    DJ: 'Africa/Djibouti',
    ER: 'Africa/Asmara',
    BF: 'Africa/Ouagadougou',
    BJ: 'Africa/Porto-Novo',
    TG: 'Africa/Lome',
    NE: 'Africa/Niamey',
    ML: 'Africa/Bamako',
    GN: 'Africa/Conakry',
    GW: 'Africa/Bissau',
    SL: 'Africa/Freetown',
    LR: 'Africa/Monrovia',
    GM: 'Africa/Banjul',
    MR: 'Africa/Nouakchott',
    SZ: 'Africa/Mbabane',
    LS: 'Africa/Maseru',
    BW: 'Africa/Gaborone',
    NA: 'Africa/Windhoek',
    ZM: 'Africa/Lusaka',
    ZW: 'Africa/Harare',
    MW: 'Africa/Blantyre',
    MG: 'Indian/Antananarivo',
    KM: 'Indian/Comoro',
    MU: 'Indian/Mauritius',
    SC: 'Indian/Mahe',
    SS: 'Africa/Juba',
    TD: 'Africa/Ndjamena',

    // Americas — 1차는 단일 슬롯 정책 (US는 PT 기준)
    BR: 'America/Sao_Paulo',
    US: 'America/Los_Angeles',  // PT 기준 (Phase 2: 동부/중부 분리 검토)
    CA: 'America/Toronto',
    MX: 'America/Mexico_City',
    AR: 'America/Argentina/Buenos_Aires',
    CL: 'America/Santiago',
    CO: 'America/Bogota',
    PE: 'America/Lima',
    VE: 'America/Caracas',
    EC: 'America/Guayaquil',
    BO: 'America/La_Paz',
    PY: 'America/Asuncion',
    UY: 'America/Montevideo',
    SV: 'America/El_Salvador',
    NI: 'America/Managua',
    HN: 'America/Tegucigalpa',
    PA: 'America/Panama',
    GT: 'America/Guatemala',
    CR: 'America/Costa_Rica',
    BZ: 'America/Belize',
    CU: 'America/Havana',
    DO: 'America/Santo_Domingo',
    HT: 'America/Port-au-Prince',
    JM: 'America/Jamaica',
    PR: 'America/Puerto_Rico',
    TT: 'America/Port_of_Spain',
    BB: 'America/Barbados',
    BS: 'America/Nassau',
    GY: 'America/Guyana',
    SR: 'America/Paramaribo',
    CW: 'America/Curacao',
    AW: 'America/Aruba',

    // Oceania
    AU: 'Australia/Sydney',
    NZ: 'Pacific/Auckland',
    FJ: 'Pacific/Fiji',
    PG: 'Pacific/Port_Moresby',
    SB: 'Pacific/Guadalcanal',
    KI: 'Pacific/Tarawa',
    WS: 'Pacific/Apia',
    TO: 'Pacific/Tongatapu',
    VU: 'Pacific/Efate',
    NC: 'Pacific/Noumea',
    PF: 'Pacific/Tahiti',
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

/**
 * Phase 2: Streak 위험 푸시용 — local 22시인 모든 국가 목록 반환
 * cron 통합 운영 시 매시간 호출되며 22시 슬롯에서만 발송됨
 * @param {Date} [now]
 * @returns {string[]} ISO country codes
 */
function countriesAtLocalHour22(now = new Date()) {
    return Object.keys(TZ_BY_COUNTRY).filter(c => getLocalHour(c, now) === 22);
}

/**
 * Streak 정기 리마인더용 — local 13시인 모든 국가 목록 반환
 * cron 통합 운영 시 매시간 호출되며 13시 슬롯에서만 발송됨
 * (2026-05-18: Android LocalNotifications 12:30 chain 회귀 → FCM cron 13:00 전환)
 * @param {Date} [now]
 * @returns {string[]} ISO country codes
 */
function countriesAtLocalHour13(now = new Date()) {
    return Object.keys(TZ_BY_COUNTRY).filter(c => getLocalHour(c, now) === 13);
}

// IANA TZ로 country의 현재 local Y/M/D/h/m/s 추출. 매핑 없으면 null.
function getLocalDateParts(country, now = new Date()) {
    const tz = TZ_BY_COUNTRY[country];
    if (!tz) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        }).formatToParts(now);
        const get = (type) => parseInt(parts.find(p => p.type === type).value, 10);
        return {
            Y: get('year'), M: get('month'), D: get('day'),
            h: get('hour'), m: get('minute'), s: get('second'),
        };
    } catch {
        return null;
    }
}

/**
 * country의 현재 local 날짜 ('YYYY-MM-DD'). 매핑 없으면 server local fallback.
 */
function getLocalDateStr(country, now = new Date()) {
    const p = getLocalDateParts(country, now);
    if (p) return `${p.Y}-${String(p.M).padStart(2, '0')}-${String(p.D).padStart(2, '0')}`;
    const d = now;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * country의 현재 local 자정에 해당하는 UTC Date 객체.
 * 매핑 없으면 server local 자정 fallback.
 * 사용: streak-risk cron에서 "오늘 자정(현지) < lastActiveAt" 컷오프 비교.
 */
function getLocalStartOfToday(country, now = new Date()) {
    const p = getLocalDateParts(country, now);
    if (!p) {
        const d = new Date(now); d.setHours(0, 0, 0, 0); return d;
    }
    const elapsedMs = (p.h * 3600 + p.m * 60 + p.s) * 1000;
    return new Date(now.getTime() - elapsedMs);
}

module.exports = {
    TZ_BY_COUNTRY,
    deviceLangToCountry,
    effectiveCountry,
    getLocalHour,
    isLocalHour10,
    countriesAtLocalHour10,
    countriesAtLocalHour13,
    countriesAtLocalHour22,
    getLocalDateStr,
    getLocalStartOfToday,
};
