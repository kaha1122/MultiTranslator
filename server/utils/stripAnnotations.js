// Gemini가 규칙(프롬프트 rule #7 등)을 가끔 무시하고 주입하는 주석 패턴 제거.
// 목표어로 써야 할 "순수 텍스트" 필드(sentence, word, example, passage)에만 적용.
// pronunciation / learning_tip / translation / meaning 등에는 적용하지 않음 (설계상 보존).
//
//   ja:  한자(히라가나/가타카나) → 한자만 남김  (예: 食べる（たべる）→ 食べる)
//   zh:  한자(성조기호 포함 핀인) → 한자만 남김 (예: 咖啡(kāfēi) → 咖啡)
// zh 는 간체(zh-CN)·번체(zh-TW) 공통. 성조기호 필수 조건으로 회사명 영문주석
// (예: 腾讯(Tencent), 苹果(Apple)) false positive를 회피.

const PINYIN_TONE_CHARS = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛÜ';

// 한자(CJK) + 전각/반각 괄호 + 히라가나/가타카나 → 한자만
const FURIGANA_RE = /([\u4E00-\u9FFF])[\(（]([\u3040-\u30FF]+)[\)）]/g;

// 한자(CJK) + 전각/반각 괄호 + 성조기호 하나 이상 포함된 핀인(라틴+성조) → 한자만
const PINYIN_RE = new RegExp(
    `([\\u4E00-\\u9FFF])[\\(（]([a-zA-Z\\s]*[${PINYIN_TONE_CHARS}][a-zA-Z\\s${PINYIN_TONE_CHARS}]*)[\\)）]`,
    'g'
);

function stripAnnotations(text, langCode) {
    if (!text || typeof text !== 'string') return text;
    if (langCode === 'ja') return text.replace(FURIGANA_RE, '$1');
    if (langCode === 'zh-CN' || langCode === 'zh-TW' || langCode === 'zh') {
        return text.replace(PINYIN_RE, '$1');
    }
    return text;
}

module.exports = { stripAnnotations };
