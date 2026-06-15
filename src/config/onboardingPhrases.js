// ── 온보딩 첫 발음 챌린지 고정 문장 ───────────────────────────────────────
// 학습어(targets[0])별 짧고 쉬운 인사 1문장. "먼저 들어보기 → 따라 말하기 → 결과" 흐름에 사용.
// fr/es는 단어 1~2개로는 발음 게이지 음소가 빈약해 살짝 긴 버전으로 보강.
// 10개 외(38개 학습어 중) 선택 시 영어 인사로 폴백.

export const ONBOARDING_PHRASES = {
  ko: '만나서 반가워요.',
  en: 'Nice to meet you.',
  ja: 'はじめまして。',
  'zh-CN': '很高兴认识你。',
  vi: 'Rất vui được gặp bạn.',
  fr: 'Enchanté de vous rencontrer.',
  de: 'Schön, dich zu treffen.',
  es: 'Mucho gusto en conocerte.',
  ru: 'Очень приятно.',
  'pt-BR': 'Prazer em conhecer você.',
};

export const getOnboardingPhrase = (langCode) =>
  ONBOARDING_PHRASES[langCode] || ONBOARDING_PHRASES.en;
