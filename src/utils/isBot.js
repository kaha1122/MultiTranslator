/**
 * Google AdSense / 검색엔진 봇 감지
 * 봇이면 랜딩 페이지를 건너뛰고 앱 콘텐츠를 직접 노출하여
 * AdSense 심사 및 SEO 크롤링이 가능하도록 함
 */
const BOT_PATTERN = /Googlebot|AdsBot|Mediapartners-Google|bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|facebookexternalhit|Twitterbot|LinkedInBot|crawler|spider|bot/i;

export const isBot = () => BOT_PATTERN.test(navigator.userAgent);
