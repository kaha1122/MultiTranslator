---
name: language-expansion
description: 러시아어(ru)/브라질 포르투갈어(pt-BR) 언어 추가 — 17개 파일 수정, locale 생성, 서버 LANG_SPECIFIC_GUIDE/TTS/Video 채널
type: project
---

## 러시아어(ru) + 브라질 포르투갈어(pt-BR) 추가 (2026-03-15)

**Why:** 사용자 확장을 위해 8개 → 10개 언어 지원
**How to apply:** 새 언어 추가 시 아래 17개 위치를 모두 수정해야 함

### 수정된 파일 목록 (17개)

**신규 locale 파일:**
- `src/locales/ru.json` — 러시아어 UI 번역 (793키)
- `src/locales/pt-BR.json` — 브라질 포르투갈어 UI 번역 (793키)

**클라이언트 (8개):**
- `src/App.jsx` — SUPPORTED_LANGUAGES, languageNames
- `src/utils/i18n.js` — import + locales 등록 (pt → ptBR 매핑 포함)
- `src/utils/phoneFormat.js` — RU(+7), BR(+55) + getCountryByLang 매핑
- `src/components/OnboardingModal.jsx` — LANGUAGES 배열
- `src/components/VideoReader.jsx` — SUPPORTED_LANGUAGES (ru 제외 — YouTube 차단)
- `src/components/VocabTab.jsx` — LANG_NAMES + visibleLanguages 필터
- `src/components/ScenePractice.jsx` — LANG_NAMES
- `src/components/TranslationCard.jsx` — langNames
- `src/components/LandingPage.jsx` — ALL_LANGS + detectLang
- `src/components/Legal/LegalPages.jsx` — DATE_LOCALES

**서버 (5개):**
- `server/routes/analyze.js` — azureLangMap(ru-RU, pt-BR), langNames, coaching fallbacks
- `server/routes/tts.js` — AZURE_TTS_VOICE_MAP (ru-RU-SvetlanaNeural, pt-BR-FranciscaNeural, 둘 다 styles:[])
- `server/routes/scene.js` — LANG_NAMES_FOR_SCENE + LANG_SPECIFIC_GUIDE
- `server/routes/vocab.js` — LANG_NAMES + LANG_SPECIFIC_GUIDE
- `server/routes/video.js` — CURATED_CHANNELS (pt-BR만, ru는 YouTube 차단)

### 러시아 YouTube 채널 이슈
- 2022년 3월부터 러시아 국영 미디어(RT, ТАСС, РИА Новости, Россия 24 등) YouTube 차단
- 유효한 뉴스/문화/엔터/스포츠 채널 확보 불가 → Video 탭에서 ru 제외
- Scene/Vocab/Translation/발음평가 등 다른 기능은 정상 작동

### 브라질 YouTube 채널 (검증됨)
| 카테고리 | 채널명 | 채널 ID |
|----------|--------|---------|
| news | Jornal O Globo | UC-6xqzMBF2CXTImn_a4aCVg |
| culture | Manual do Mundo | UCKHhA5hN2UohhFDfNXB_cvQ |
| entertainment | Porta dos Fundos | UCEWHPFNilsT0IfQfutVzsag |
| sports | CazéTV | UCZiYbVptd3PVPf4f6eR6UaQ |

### 버그 수정
- `VocabTab.jsx` visibleLanguages 필터에 ru, pt-BR 누락 → 추가
- Video 탭: targetLangs에 포함된 언어만 표시됨 (sourceLang만 설정하면 보이지 않음)
