---
name: lang-specific-guide
description: 10개 언어별 문법/어휘 특성 가이드 (LANG_SPECIFIC_GUIDE) — 난이도별 프롬프트에 언어 고유 문법 규칙 주입
type: project
---

## LANG_SPECIFIC_GUIDE (server/routes/scene.js, server/routes/vocab.js)

Scene 문장 생성과 Vocab 단어 생성 프롬프트에서 언어별로 적절한 문법/어휘 가이드를 동적으로 주입하기 위한 설계.

### 도입 배경
- **Why:** 기존 프롬프트가 영어 중심(phrasal verbs, conjunctions, modals 등)으로 작성되어 있어, 일본어/한국어/중국어 등 비영어권 문장 생성 시 부적절한 가이드가 적용됨
- **How to apply:** 난이도 설명(DIFFICULTY_DESC)을 수정하거나 새 언어를 추가할 때, 반드시 LANG_SPECIFIC_GUIDE도 함께 업데이트할 것

### 구조
- `LANG_SPECIFIC_GUIDE[langCode]` — 언어별 `{ basic, inter, adv, unit }` 객체
- `getDifficultyDesc(level, langCode)` 함수가 LANG_SPECIFIC_GUIDE를 참조하여 언어별 난이도 설명 생성
- Scene 프롬프트(scene-sentence, scene-reply)와 Vocab 프롬프트(vocab-words) 모두 이 함수를 사용

### 지원 언어 및 핵심 특성
| 언어 | 코드 | 단위 | 핵심 문법 요소 |
|------|------|------|---------------|
| English | en | words | phrasal verbs, modals, conditionals |
| Japanese | ja | 文節 | です/ます, て-form, 敬語/謙譲語/尊敬語 |
| Chinese | zh-CN | characters/words | 是/有/在, 把/被, 成语 |
| Korean | ko | 어절 | 해요체, -지만/-니까, 관용구, 사자성어 |
| Vietnamese | vi | words | classifiers, 호칭어(anh/chị/em), tục ngữ |
| French | fr | words | imparfait/passé composé, subjonctif |
| German | de | words | trennbare Verben, Nebensätze, Konjunktiv |
| Spanish | es | words | pretérito/imperfecto, subjuntivo, refranes |
| Russian | ru | words | 완료/불완료상, причастия/деепричастия, фразеологизмы |
| Portuguese (BR) | pt-BR | words | pretérito perfeito/imperfeito, subjuntivo, provérbios |
