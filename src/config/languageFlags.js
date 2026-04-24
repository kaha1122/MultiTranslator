// 다국가 언어의 사용자 국가별 국기 변형 표 — 표시(display) 레이어 전용
// Firestore 데이터(targetLang/sourceLang/langCode)는 단일 코드 유지
//
// 우선순위: profile.phoneCountry > navigator.language region > profile.geoCountry
// 매핑 없는 언어/국가 조합은 fallback flag 반환
//
// 적용 대상: SUPPORTED_LANGUAGES 10개 중 다국가 사용 7개
//   - 단일 국가 언어(ko/ja/vi)는 변형 없음
//   - EXTRA_LANGUAGES 28개는 적용 외 (default flag 그대로)

export const LANG_FLAG_VARIANTS = {
  es: {
    default: '🇪🇸',
    byCountry: {
      MX: '🇲🇽', AR: '🇦🇷', CO: '🇨🇴', PE: '🇵🇪', CL: '🇨🇱',
      VE: '🇻🇪', EC: '🇪🇨', GT: '🇬🇹', CU: '🇨🇺', BO: '🇧🇴',
      DO: '🇩🇴', HN: '🇭🇳', PY: '🇵🇾', SV: '🇸🇻', NI: '🇳🇮',
      CR: '🇨🇷', PR: '🇵🇷', UY: '🇺🇾', US: '🇺🇸',
    },
  },
  en: {
    default: '🇺🇸',
    byCountry: {
      GB: '🇬🇧', AU: '🇦🇺', CA: '🇨🇦', IN: '🇮🇳', NZ: '🇳🇿',
      IE: '🇮🇪', ZA: '🇿🇦', PH: '🇵🇭', SG: '🇸🇬',
    },
  },
  'pt-BR': {
    default: '🇧🇷',
    byCountry: { PT: '🇵🇹', AO: '🇦🇴', MZ: '🇲🇿', CV: '🇨🇻' },
  },
  fr: {
    default: '🇫🇷',
    byCountry: {
      CA: '🇨🇦', BE: '🇧🇪', CH: '🇨🇭', LU: '🇱🇺', MC: '🇲🇨',
      SN: '🇸🇳', CI: '🇨🇮', CM: '🇨🇲', MG: '🇲🇬', HT: '🇭🇹',
    },
  },
  de: {
    default: '🇩🇪',
    byCountry: { AT: '🇦🇹', CH: '🇨🇭', LI: '🇱🇮', LU: '🇱🇺' },
  },
  'zh-CN': {
    default: '🇨🇳',
    byCountry: { SG: '🇸🇬', MY: '🇲🇾' },
  },
  ru: {
    default: '🇷🇺',
    // BY 벨라루스, KZ 카자흐스탄, KG 키르기스스탄: 러시아어 공용어
    // UZ 우즈베키스탄, AM 아르메니아: 비공식이지만 인종간 공용어/광범위 사용
    // ⚠️ 의도적으로 제외: UA(우크라이나), GE(조지아) — 정치적 민감
    byCountry: {
      BY: '🇧🇾', KZ: '🇰🇿', KG: '🇰🇬',
      UZ: '🇺🇿', AM: '🇦🇲',
    },
  },
};

// navigator.language('en-GB', 'es-MX', 'pt-BR') 의 region 부분 추출
// 'zh-Hant' 같은 script tag는 제외 (2글자 ISO 3166-1 alpha-2만 인정)
export function countryFromLocale(locale) {
  if (!locale) return null;
  const parts = String(locale).split(/[-_]/);
  if (parts.length < 2) return null;
  const region = parts[1].toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? region : null;
}

// profile + navigator.language 조합으로 사용자 국가 추정
//   priority: profile.phoneCountry > navigator.language region > profile.geoCountry > null
export function resolveUserCountry(profile) {
  if (profile?.phoneCountry) return profile.phoneCountry;
  if (typeof navigator !== 'undefined') {
    const fromLocale = countryFromLocale(navigator.language);
    if (fromLocale) return fromLocale;
  }
  if (profile?.geoCountry) return profile.geoCountry;
  return null;
}

// 표시용 국기 결정 — 매핑 없는 언어는 fallbackFlag 반환
export function resolveFlag(langCode, userCountry, fallbackFlag) {
  const v = LANG_FLAG_VARIANTS[langCode];
  if (!v) return fallbackFlag;
  if (userCountry && v.byCountry[userCountry]) return v.byCountry[userCountry];
  return v.default || fallbackFlag;
}
