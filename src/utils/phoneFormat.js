export const COUNTRY_PHONES = [
  { code: 'KR', dial: '+82',  flag: '🇰🇷', name: '한국',       maxDigits: 11, format: (n) => n.length <= 3 ? n : n.length <= 7 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}` },
  { code: 'US', dial: '+1',   flag: '🇺🇸', name: 'USA',        maxDigits: 10, format: (n) => n.length <= 3 ? n : n.length <= 6 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}` },
  { code: 'JP', dial: '+81',  flag: '🇯🇵', name: '日本',       maxDigits: 11, format: (n) => n.length <= 3 ? n : n.length <= 7 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}` },
  { code: 'CN', dial: '+86',  flag: '🇨🇳', name: '中国',       maxDigits: 11, format: (n) => n.length <= 3 ? n : n.length <= 7 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,7)}-${n.slice(7)}` },
  { code: 'VN', dial: '+84',  flag: '🇻🇳', name: 'Việt Nam',   maxDigits: 10, format: (n) => n.length <= 3 ? n : n.length <= 6 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}` },
  { code: 'FR', dial: '+33',  flag: '🇫🇷', name: 'France',     maxDigits: 10, format: (n) => n.length <= 2 ? n : n.length <= 4 ? `${n.slice(0,2)}-${n.slice(2)}` : n.length <= 6 ? `${n.slice(0,2)}-${n.slice(2,4)}-${n.slice(4)}` : n.length <= 8 ? `${n.slice(0,2)}-${n.slice(2,4)}-${n.slice(4,6)}-${n.slice(6)}` : `${n.slice(0,2)}-${n.slice(2,4)}-${n.slice(4,6)}-${n.slice(6,8)}-${n.slice(8)}` },
  { code: 'DE', dial: '+49',  flag: '🇩🇪', name: 'Deutschland', maxDigits: 11, format: (n) => n.length <= 4 ? n : n.length <= 7 ? `${n.slice(0,4)}-${n.slice(4)}` : `${n.slice(0,4)}-${n.slice(4,7)}-${n.slice(7)}` },
  { code: 'ES', dial: '+34',  flag: '🇪🇸', name: 'España',     maxDigits: 9,  format: (n) => n.length <= 3 ? n : n.length <= 6 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}` },
  { code: 'GB', dial: '+44',  flag: '🇬🇧', name: 'UK',         maxDigits: 11, format: (n) => n.length <= 4 ? n : n.length <= 7 ? `${n.slice(0,4)}-${n.slice(3)}` : `${n.slice(0,4)}-${n.slice(4,7)}-${n.slice(7)}` },
  { code: 'CA', dial: '+1',   flag: '🇨🇦', name: 'Canada',     maxDigits: 10, format: (n) => n.length <= 3 ? n : n.length <= 6 ? `${n.slice(0,3)}-${n.slice(3)}` : `${n.slice(0,3)}-${n.slice(3,6)}-${n.slice(6)}` },
];

export const formatPhoneByCountry = (value, countryCode) => {
  const country = COUNTRY_PHONES.find(c => c.code === countryCode) || COUNTRY_PHONES[0];
  const nums = value.replace(/\D/g, '').slice(0, country.maxDigits);
  if (!nums) return '';
  return country.format(nums);
};

export const getCountryByLang = (lang) => {
  const map = { ko: 'KR', en: 'US', ja: 'JP', 'zh-CN': 'CN', vi: 'VN', fr: 'FR', de: 'DE', es: 'ES' };
  return map[lang] || 'KR';
};
