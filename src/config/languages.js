// ── 언어 목록 중앙 관리 모듈 ──────────────────────────────────────────────
// 모든 컴포넌트에서 이 파일을 import하여 사용합니다.

// 기존 10개 주요 언어 (소스 언어 / UI 언어 / 온보딩용)
export const SUPPORTED_LANGUAGES = [
  { code: 'ko', name: '한국어', tts: 'ko-KR', color: '#f0fdf4', textColor: '#166534', flag: '🇰🇷' },
  { code: 'en', name: 'English', tts: 'en-US', color: '#e0e7ff', textColor: '#4338ca', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', tts: 'ja-JP', color: '#fef2f2', textColor: '#b91c1c', flag: '🇯🇵' },
  { code: 'zh-CN', name: '中文', tts: 'zh-CN', color: '#fff7ed', textColor: '#9a3412', flag: '🇨🇳' },
  { code: 'vi', name: 'Tiếng Việt', tts: 'vi-VN', color: '#f0fdf4', textColor: '#166534', flag: '🇻🇳' },
  { code: 'fr', name: 'Français', tts: 'fr-FR', color: '#f1f5f9', textColor: '#475569', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', tts: 'de-DE', color: '#f1f5f9', textColor: '#475569', flag: '🇩🇪' },
  { code: 'es', name: 'Español', tts: 'es-ES', color: '#f1f5f9', textColor: '#475569', flag: '🇪🇸' },
  { code: 'ru', name: 'Русский', tts: 'ru-RU', color: '#f1f5f9', textColor: '#475569', flag: '🇷🇺' },
  { code: 'pt-BR', name: 'Português', tts: 'pt-BR', color: '#f1f5f9', textColor: '#475569', flag: '🇧🇷' },
];

// Gemini Tier 1 추가 언어 (28개)
export const EXTRA_LANGUAGES = [
  { code: 'ar', name: 'العربية', tts: 'ar-SA', color: '#f1f5f9', textColor: '#475569', flag: '🇸🇦' },
  { code: 'bn', name: 'বাংলা', tts: 'bn-IN', color: '#f1f5f9', textColor: '#475569', flag: '🇧🇩' },
  { code: 'bg', name: 'Български', tts: 'bg-BG', color: '#f1f5f9', textColor: '#475569', flag: '🇧🇬' },
  { code: 'zh-TW', name: '中文(繁體)', tts: 'zh-TW', color: '#f1f5f9', textColor: '#475569', flag: '🇹🇼' },
  { code: 'hr', name: 'Hrvatski', tts: 'hr-HR', color: '#f1f5f9', textColor: '#475569', flag: '🇭🇷' },
  { code: 'cs', name: 'Čeština', tts: 'cs-CZ', color: '#f1f5f9', textColor: '#475569', flag: '🇨🇿' },
  { code: 'da', name: 'Dansk', tts: 'da-DK', color: '#f1f5f9', textColor: '#475569', flag: '🇩🇰' },
  { code: 'nl', name: 'Nederlands', tts: 'nl-NL', color: '#f1f5f9', textColor: '#475569', flag: '🇳🇱' },
  { code: 'et', name: 'Eesti', tts: 'et-EE', color: '#f1f5f9', textColor: '#475569', flag: '🇪🇪' },
  { code: 'fi', name: 'Suomi', tts: 'fi-FI', color: '#f1f5f9', textColor: '#475569', flag: '🇫🇮' },
  { code: 'el', name: 'Ελληνικά', tts: 'el-GR', color: '#f1f5f9', textColor: '#475569', flag: '🇬🇷' },
  { code: 'he', name: 'עברית', tts: 'he-IL', color: '#f1f5f9', textColor: '#475569', flag: '🇮🇱' },
  { code: 'hi', name: 'हिन्दी', tts: 'hi-IN', color: '#f1f5f9', textColor: '#475569', flag: '🇮🇳' },
  { code: 'hu', name: 'Magyar', tts: 'hu-HU', color: '#f1f5f9', textColor: '#475569', flag: '🇭🇺' },
  { code: 'id', name: 'Indonesia', tts: 'id-ID', color: '#f1f5f9', textColor: '#475569', flag: '🇮🇩' },
  { code: 'it', name: 'Italiano', tts: 'it-IT', color: '#f1f5f9', textColor: '#475569', flag: '🇮🇹' },
  { code: 'lv', name: 'Latviešu', tts: 'lv-LV', color: '#f1f5f9', textColor: '#475569', flag: '🇱🇻' },
  { code: 'lt', name: 'Lietuvių', tts: 'lt-LT', color: '#f1f5f9', textColor: '#475569', flag: '🇱🇹' },
  { code: 'no', name: 'Norsk', tts: 'nb-NO', color: '#f1f5f9', textColor: '#475569', flag: '🇳🇴' },
  { code: 'pl', name: 'Polski', tts: 'pl-PL', color: '#f1f5f9', textColor: '#475569', flag: '🇵🇱' },
  { code: 'ro', name: 'Română', tts: 'ro-RO', color: '#f1f5f9', textColor: '#475569', flag: '🇷🇴' },
  { code: 'sr', name: 'Srpski', tts: 'sr-RS', color: '#f1f5f9', textColor: '#475569', flag: '🇷🇸' },
  { code: 'sk', name: 'Slovenčina', tts: 'sk-SK', color: '#f1f5f9', textColor: '#475569', flag: '🇸🇰' },
  { code: 'sl', name: 'Slovenščina', tts: 'sl-SI', color: '#f1f5f9', textColor: '#475569', flag: '🇸🇮' },
  { code: 'sw', name: 'Kiswahili', tts: 'sw-KE', color: '#f1f5f9', textColor: '#475569', flag: '🇰🇪' },
  { code: 'sv', name: 'Svenska', tts: 'sv-SE', color: '#f1f5f9', textColor: '#475569', flag: '🇸🇪' },
  { code: 'th', name: 'ไทย', tts: 'th-TH', color: '#f1f5f9', textColor: '#475569', flag: '🇹🇭' },
  { code: 'tr', name: 'Türkçe', tts: 'tr-TR', color: '#f1f5f9', textColor: '#475569', flag: '🇹🇷' },
  { code: 'uk', name: 'Українська', tts: 'uk-UA', color: '#f1f5f9', textColor: '#475569', flag: '🇺🇦' },
];

// 전체 언어 목록 (기존 10개 + 추가 28개 = 38개)
export const ALL_LANGUAGES = [...SUPPORTED_LANGUAGES, ...EXTRA_LANGUAGES];

// 유틸: 언어 코드 → 언어 이름
export const getLangName = (code) => ALL_LANGUAGES.find(l => l.code === code)?.name || code;

// 유틸: 언어 코드 → 전체 언어 정보 (code, name, tts, color, textColor, flag)
export const getLangInfo = (code) => ALL_LANGUAGES.find(l => l.code === code);
