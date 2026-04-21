// 서버 server/utils/stripAnnotations.js 와 동일 로직 (클라이언트 ESM 버전).
// Translation 응답처럼 generic proxy(/api/translate)를 쓰는 경우, 서버가 필드 구조를
//모르므로 클라이언트 측에서 적용한다.
//
//   ja:  한자(히라가나/가타카나) → 한자만 남김
//   zh:  한자(성조기호 포함 핀인) → 한자만 남김  (zh-CN, zh-TW 공통)
// 성조기호 필수 조건으로 회사명 영문주석(예: 腾讯(Tencent)) false positive 회피.

const PINYIN_TONE_CHARS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ';

const FURIGANA_RE = /([\u4E00-\u9FFF])[\(（]([\u3040-\u30FF]+)[\)）]/g;
const PINYIN_RE = new RegExp(
    `([\\u4E00-\\u9FFF])[\\(（]([a-zA-Z\\s]*[${PINYIN_TONE_CHARS}][a-zA-Z\\s${PINYIN_TONE_CHARS}]*)[\\)）]`,
    'g'
);

export function stripAnnotations(text, langCode) {
    if (!text || typeof text !== 'string') return text;
    if (langCode === 'ja') return text.replace(FURIGANA_RE, '$1');
    if (langCode === 'zh-CN' || langCode === 'zh-TW' || langCode === 'zh') {
        return text.replace(PINYIN_RE, '$1');
    }
    return text;
}
