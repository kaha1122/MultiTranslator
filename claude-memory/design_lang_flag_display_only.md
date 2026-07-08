---
name: 언어별 국기 표시는 표시 레이어에서만 분기
description: 다국가 언어(es/en/pt/ar/fr/de 등)의 국기를 사용자 국가별로 다르게 보여주되, Firestore 데이터는 단일 langCode 유지
type: feedback
originSessionId: 0580bd81-42d7-4590-b029-dfe5abaf7641
---
**적용 대상은 SUPPORTED_LANGUAGES 10개 주요 언어만** (EXTRA_LANGUAGES 28개는 변형 적용 안 함, default flag 그대로). 그 중 다국가 사용 언어(es, en, pt-BR, fr, de, zh-CN, ru)의 **국기 표시**는 사용자 국가(`phoneCountry` > `deviceLang` locale > IP > default)에 따라 동적으로 변형하되, **저장 데이터는 단일 langCode를 유지**한다.

- Firestore: `targetLang: "es"`, `sourceLang: "es"` 등 그대로 (지역 코드 추가 금지)
- 표시 시점에만 `resolveFlag(langCode, userCountry)` 호출 → 🇲🇽/🇦🇷/🇪🇸 등 분기
- TTS/평가/번역 엔진의 locale도 별도 결정 사항 (표시 국기와 1:1 매핑 강제 금지)

**Why:** 데이터에 지역 코드를 섞으면 통계/집계가 `es-MX` / `es-AR` / `es-ES`로 파편화되고, 기존 사용자 데이터 마이그레이션 부담이 발생. 본질은 "거부감 줄여서 선택률 높이기" UX 문제이므로 표시만 손대는 게 맞음.

**How to apply:**
- 신규 매핑 모듈은 `src/config/languageFlags.js` (LANG_FLAG_VARIANTS + resolveFlag)
- 기존 `SUPPORTED_LANGUAGES[].flag`는 default flag로 유지 (단일 국기 언어는 그대로 사용)
- 언어 선택 UI / 사이드바 / 탭 타이틀바 / 카드 등 표시 컴포넌트에서만 `resolveFlag` 호출
- DB 쿼리, 분석, AI 프롬프트의 lang 파라미터에는 절대 변형 적용 금지
- 사용자가 명시적으로 "지역 선호" override 시에도 별도 필드(`preferredFlagRegion` 등)로 저장, `targetLang`은 불변
