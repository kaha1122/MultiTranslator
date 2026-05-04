#!/usr/bin/env node
/**
 * check-i18n — 10개 locale 파일 간 i18n 키 완전성 검증
 *
 * 동기:
 *   Sprint 3-3 freeTalk.guide* 5개 키가 ko/en 에 누락되어 사용자 화면에
 *   'freeTalk.guideTitle' 같은 키가 그대로 노출되는 사고 발생.
 *   빌드는 통과하지만 런타임에서만 발견되는 문제 → 자동 검증 도구 도입.
 *
 * 동작:
 *   1) en.json 을 reference 로 사용 (가장 완전하다고 가정)
 *   2) 다른 9개 locale 파일에서 모든 reference 키가 존재하는지 검사
 *   3) 누락 키 1개라도 발견 시 exit 1 + 누락 목록 출력
 *   4) 추가 키(en 에 없는데 다른 언어에 있는) 는 warning 으로 출력
 *
 * 사용:
 *   npm run check-i18n
 *   (성공 시 exit 0, 누락 시 exit 1, 실행 오류 시 exit 2)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = 'src/locales';
const REFERENCE_LOCALE = 'en';
const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'vi', 'fr', 'de', 'es', 'ru', 'pt-BR'];

// 의도적으로 언어별 다를 수 있는 키 — 검증 제외 (현재 없음, 추후 필요 시 추가)
// 예: 'tts.voiceMap' 같이 언어별 voice 가 다를 경우.
const ALLOWED_DIFFS = new Set([]);

// JSON 객체를 점표기법 keys 배열로 평탄화
// 값이 string/number/boolean/null 이면 leaf, object 면 재귀.
function flattenKeys(obj, prefix = '') {
    const keys = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return keys;
    for (const k of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            keys.push(...flattenKeys(v, fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

function loadLocale(code) {
    const path = join(LOCALES_DIR, `${code}.json`);
    if (!existsSync(path)) {
        console.error(`❌ locale file missing: ${path}`);
        process.exit(2);
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        console.error(`❌ failed to parse ${path}: ${e.message}`);
        process.exit(2);
    }
}

const reference = loadLocale(REFERENCE_LOCALE);
const refKeys = flattenKeys(reference);
const refKeysSet = new Set(refKeys);

console.log(`📊 reference locale: ${REFERENCE_LOCALE}.json — ${refKeys.length} keys`);

let hasError = false;
let totalMissing = 0;
let totalExtra = 0;

for (const lang of LOCALES) {
    if (lang === REFERENCE_LOCALE) continue;
    const data = loadLocale(lang);
    const langKeys = flattenKeys(data);
    const langKeysSet = new Set(langKeys);

    const missing = refKeys.filter(k => !langKeysSet.has(k) && !ALLOWED_DIFFS.has(k));
    const extra = langKeys.filter(k => !refKeysSet.has(k) && !ALLOWED_DIFFS.has(k));

    if (missing.length > 0) {
        hasError = true;
        totalMissing += missing.length;
        console.error(`\n❌ ${lang}.json — ${missing.length} missing key(s):`);
        for (const k of missing) console.error(`     - ${k}`);
    }
    if (extra.length > 0) {
        totalExtra += extra.length;
        console.warn(`\n⚠️  ${lang}.json — ${extra.length} extra key(s) (not in reference):`);
        for (const k of extra) console.warn(`     + ${k}`);
    }
    if (missing.length === 0 && extra.length === 0) {
        console.log(`✅ ${lang}.json — ${langKeys.length} keys (parity with reference)`);
    } else {
        console.log(`   ${lang}.json — ${langKeys.length} keys`);
    }
}

console.log('\n──────────────────────────────────────────');
if (hasError) {
    console.error(`❌ check-i18n FAILED — total ${totalMissing} missing key(s) across locales`);
    console.error('');
    console.error('해결 방법:');
    console.error('  1) 누락된 locale 파일에 reference (en.json) 의 해당 키를 자국어 번역으로 추가');
    console.error('  2) 같은 키를 모든 10개 언어에 일괄 추가 (memory: feedback_i18n_completeness.md)');
    console.error('  3) 다시 npm run check-i18n 으로 검증');
    process.exit(1);
}
if (totalExtra > 0) {
    console.warn(`⚠️  check-i18n PASSED with ${totalExtra} extra key(s) — leftover/typo 의심, 점검 권장`);
} else {
    console.log(`✅ check-i18n PASSED — all 10 locales have full key parity (${refKeys.length} keys each)`);
}
process.exit(0);
