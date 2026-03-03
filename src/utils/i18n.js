import { useCallback } from 'react';

import ko   from '../locales/ko.json';
import en   from '../locales/en.json';
import ja   from '../locales/ja.json';
import zhCN from '../locales/zh-CN.json';
import vi   from '../locales/vi.json';
import fr   from '../locales/fr.json';
import de   from '../locales/de.json';
import es   from '../locales/es.json';

// 언어 코드 → JSON 매핑
// zh-CN, zh-TW 등 파생 코드를 모두 zh-CN 파일로 연결합니다.
const locales = {
    ko,
    en,
    ja,
    'zh-CN': zhCN,
    'zh-TW': zhCN,
    zh:      zhCN,
    vi,
    fr,
    de,
    es,
};

// 점표기법 키("errors.micAccess")를 중첩 객체에서 찾아 반환합니다.
const resolve = (obj, dotKey) =>
    dotKey.split('.').reduce((acc, k) => acc?.[k], obj);

/**
 * 평문 함수 — React 훅 밖에서도 사용 가능 (커스텀 훅, 유틸리티 등)
 * @param {string} langCode  sourceLang 코드 (예: 'ko', 'en', 'zh-CN')
 * @param {string} key       점표기법 키  (예: 'errors.micAccess')
 * @returns {string}
 */
export const getT = (langCode, key) => {
    const code   = langCode || 'en';
    const locale = locales[code] || locales[code?.split('-')[0]] || locales['en'];
    return resolve(locale, key)
        ?? resolve(locales['en'], key)  // 번역 누락 시 영어 폴백
        ?? key;                          // 영어도 없으면 키 자체 반환
};

/**
 * React 훅 — 컴포넌트 내부에서 사용
 * @param {string} sourceLang  sourceLang 상태값
 * @returns {(key: string) => string}  t('errors.micAccess') 형태로 호출
 */
export const useT = (sourceLang) => {
    return useCallback(
        (key) => getT(sourceLang, key),
        [sourceLang]
    );
};
