---
name: tts-native-experiment
description: "Azure TTS 비용절감 실험 — 네이티브 Web Speech가 Vocab 단어·예문에서 체감차 없음, 단계 확대 로드맵"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2ebce3b4-b138-4eed-8c85-57920ab97715
---

# 네이티브(기기) TTS 비용절감 실험

**배경**: 2026-05 Azure 청구서 ₩40,520 중 Neural TTS(음성합성)가 ₩25,498(전체 62.9%)로 최대 비용원. STT(받아쓰기)·발음평가(Enhanced)와 달리 TTS는 캐시 가능하지만, "처음 합성"은 막을 수 없음 → 근본 대안으로 **기기 내장 Web Speech API**(=$0) 품질 평가 실험.

**1차 실험 (2026-06-09, 커밋 d9bddc3, web v2.0.8)**:
- 영향도 최저 지점인 **Vocab 탭 단어·예문 듣기**만 Azure → 네이티브(`handleSpeakNative`, App.jsx)로 전환.
- 발음 평가 결과 재생은 음소 정확도 중요 → Azure 유지(`onSpeakAssessment` prop으로 분리).
- 그 외 전 탭(Translation/Listening/Scene/Library/FreeTalking)은 Azure 유지 → 같은 앱 A/B.
- **웹 전용 배포**(Vercel production). 네이티브 앱(Capgo)은 미반영(WebView speechSynthesis 지원 별도 검증 필요).

**결과**: 사용자 체감 **"전혀 문제 없음, Azure와 차이 못 느낌"** (단어·예문 = 짧은 문장).

**확대 전 검증 필요 (rollout 가드)**:
- 긴 텍스트: Listening 지문(chars 400+)은 네이티브 prosody 약점이 더 드러날 수 있음 → 다음 테스트 대상.
- 크로스 디바이스: 1차는 단일 기기. iOS/Android/데스크톱 OS voice 품질·존재 편차 큼(en/es/fr 양호, vi/ru/ja 편차).
- 네이티브 앱: Capgo WebView speechSynthesis 동작 별도 확인 후에야 OTA 확대 가능.

**확대 로드맵(품질 합격 시)**: Vocab(완료) → Translation/Scene(짧은 문장) → Listening(최대 비용, 긴 지문 검증 후) → FreeTalking AI voice. 발음평가 재생은 Azure 유지 권장.

**구현 패턴**: 모든 TTS는 App.jsx `handleSpeak`(Azure) 단일 chokepoint + `handleSpeakFallback`(기존 Web Speech 폴백). `handleSpeakNative`는 Azure 오디오/네이티브 음성 정지 후 `SpeechSynthesisUtterance` 재생 + 언어 일치 voice 선택. 컴포넌트별 `onSpeak` prop만 교체하면 부위별 전환 가능.

**포인트 차감 side effect (중요)**: 포인트 차감은 `handleSpeak` 내부, 캐시 MISS(신규 Azure 합성) 직전 `if (!opts._skipGate && !byokAzureKey && !tryConsumeTtsPoint()) return;`(App.jsx)에서만 발생 — Trial 1점, Pro/Premium·BYOK·캐시HIT은 무료. ListeningTab은 추가로 onTtsGate(pre-fetch 게이트)도 사용.

---

## 2026-06-09 본격 구현 (web v2.0.9, 커밋 4ec9bd5) — 절충안 채택

**철학 확정(사용자 결정)**: 1차 실험 후 "내 폰만 좋아서 좋게 들렸을 수 있다(저가폰 우려)" → **절충안** 채택. 저가폰 나쁜음성 유저는 구매여력 없다고 보고 target 제외.

**라우팅 `handleSpeakSmart`(handleSpeakNative 대체)**: Web Speech 우선, 음성 선택 = 언어 매칭 중 **네트워크(`localService===false`, Google/Apple 고품질) 우선 → default → 첫 매칭**. Azure 폴백(진짜 실패만): 엔진 없음 / 언어 음성 0개 / onerror / voices 미로드(600ms 타임아웃). **"나쁘지만 재생되는" 음성은 폴백 불가**(API가 품질 미노출 — localService≠품질). native-eligible: **Vocab 단어·예문·발음해부도🔊 + Listening 핵심단어·에세이 문장**. 유지(Azure): Listening 지문·대화 문장(멀티보이스), Translation·Scene·Library·FreeTalking.

**플랫폼 현실(검색 확인)**: iOS는 네트워크 음성 거의 없음(Apple 음성만, getVoices 불완전) → **iOS는 대부분 azure-fallback(reason=no-voice)** = 절감은 Android·데스크톱 웹 집중. Android는 기기 Google TTS 엔진의 네트워크 음성 존재 시 native(삼성 자체음성=localService true라 제외될 수 있음). OS버전 컷오프 없음(엔진·언어·네트워크 의존).

**포인트(최종 결정, v2.0.10 5585c01)**: 네이티브 재생은 **텍스트당 1회만 차감** — 같은 text+lang 첫 재생만 1점(Trial), 반복 재생 무료(Azure 캐시 무료-반복과 동일). `ttsChargedRef`(App.jsx, 세션 Set)로 추적. 신규 텍스트 0점이면 차단+팝업. native→Azure onerror 폴백은 `_skipGate`로 재과금 방지. 보정: 광고보상 +5→**+10**([server/routes/adReward.js](server/routes/adReward.js) AD_REWARD_AMOUNT + i18n 10 locale reward.topUpBonus/Desc) 유지. 일일충전은 +10→+15 했다가 **+10 원복**(v2.0.18 2026-06-10 — 차감을 텍스트당1회로 완화해 +15 과함, 1일차 30 유지). 카드 모달 상단고정 fix(v2.0.17, .mcm-overlay center→flex-start, 녹음 후 콘텐츠 늘면 상단 이탈 방지).
  - 교훈: 처음 "엔진무관 항상 차감(옵션2)"으로 v2.0.9 배포 → 실사용서 "누를 때마다 차감"이 학습자 반복청취에 과함 → "텍스트당 1회"로 수정(v2.0.10). 네이티브 비용$0라도 사용량 게이트는 신규 텍스트에만.

**텔레메트리(portion 실측)**: 매 재생 fire-and-forget 비콘 → 서버 `[TTSRoute]` 로그(`POST /api/tts/route-log`, optionalAuth, [server/routes/tts.js](server/routes/tts.js)). 필드: source(vocab.word|example|assess / listening.word|example|assess|sentence), engine(native|azure-fallback), lang, platform(web/android/ios), voice+localService 또는 reason. Render 로그 grep `[TTSRoute]`로 native vs Azure portion·언어·플랫폼 분석. always-Azure 사이트는 기존 `[AzureTTS]` 로그에만 잡힘(교차 분석).

**보류**: 웹앱 포인트 **구매**(+200) 버튼 — 네이티브는 IAP, 웹은 Toss/PayPal 일회성 결제 신규 필요 → 별도 작업으로 보류(2026-06-09).

## 2026-06-09 Listening 문장 카드 (web v2.0.11, 3867ae5)

개별 문장 즉시재생(지문과 음성 불일치 + 매 재생 차감) 제거 → **문장 클릭 시 카드 팝업**으로 전환. **`MessageCardModal` + `ScenePracticeCard` 재사용**(Free Talking 메시지 카드와 동일 패턴 — App.jsx가 ScenePracticeCard 주입). 카드 = 번역·발음기호·learning tip + 네이티브 TTS + 발음연습(녹음·평가) + 저장.
- 신규 서버 엔드포인트 `POST /api/listening/annotate-sentence`([server/routes/listening.js](server/routes/listening.js), callGeminiJson Flash-Lite): 문장 → {translation, pronunciation(ja히라가나/zh병음/ru강세), learning_tip}. 온디맨드(클릭 시) + 클라 세션 캐시(annotateCacheRef).
- **차감**: 카드 열기(annotate)=1점(onTtsGate, 신규 문장만/캐시 재오픈 무료) + 카드 내 TTS=네이티브 text당 1점 + 발음평가=기존 Pron 2점.
- 저장: `saveSceneCard`에 `sourceType` 파라미터 추가(기본 'scene' 유지 — 기존 Scene 저장 무영향), Listening 문장은 `sourceType='listening'`.
- 지문 전체 재생(Azure, 대화 A/B 남녀 음성) 유지 — 카드는 단일 네이티브 음성. `playSentence`/`playingSentenceIdx` 제거.
- 교훈: Free Talking의 MessageCardModal+ScenePracticeCard는 "문장+TTS+발음연습+저장" 범용 카드로 다른 탭에서도 재사용 가능. 기존 문장에 메타데이터 없으면 온디맨드 AI annotate로 채움.

## 2026-06-09 카드 통일 단계A + Free Talking 카드 제거 (v2.0.14~2.0.15)
- **단계A(2.0.14)**: MessageCardModal이 ScenePracticeCard 대신 **VocabWordCard 직접 렌더**(문장→word, 번역→meaning, example='' → 예문박스·토글 자동숨김). 두 카드 차이는 "단어/문장 + 예문유무"뿐이라 VocabWordCard로 통일 가능. **단계B(Scene 탭 이전 + ScenePracticeCard 삭제)는 미완 — 후속.**
- **Free Talking 카드 제거(2.0.15)**: 메시지 클릭→카드 팝업 완전 제거(ChatBubble button→div 비클릭). 이유: ①대화 문장이 저장가치 있는 딱맞는 표현 아님 ②포인트0일 때 한도팝업이 MessageCardModal 뒤로 가려 TTS/발음연습 안 됨(z-index). Listening 문장 카드는 유지(annotate+저장가치 있음, 카드 열기 onTtsGate로 0점 차단).
- **문장 카드 레이아웃(headlineBlock)**: VocabWordCard headlineBlock prop — 문장은 🔊·⭐ 윗줄 우측, 문장 본문 아래 전체폭(긴 문장이 버튼과 겹쳐 좁아지던 문제). MessageCardModal이 항상 전달. 단어 카드는 기존 레이아웃.
- **annotate tip 언어 버그 fix(2.0.12)**: Flash-Lite가 learning_tip을 영어로 쓰던 것 → 프롬프트에 "translation·learning_tip은 sourceLang으로만" CRITICAL 규칙.
- **잠재 이슈**: Listening 카드 안에서 포인트 소진 시 한도팝업이 모달 뒤로 갈 z-index 가능성(카드 열기는 게이트되지만 카드 내 TTS/발음 중 소진). 미발생 시 보류.

## 2026-06-10 모바일 네이티브 TTS — 플랫폼별 확정 + Android 플러그인 AAB
**실기기 로그로 확정**: iOS 앱=네이티브 동작(WKWebView가 speechSynthesis 지원, voice="Samantha" 온디바이스) / **Android 앱=`reason=no-engine`→Azure 폴백**. 원인=Android System WebView가 Web Speech(speechSynthesis) **미노출**(Chromium 이슈 487255 — Chrome 브라우저엔 있지만 WebView엔 없음. 같은 폰이라도 웹=동작/앱=폴백). **코드 버그 아님.**
- **해결**: `@capacitor-community/text-to-speech@8.0.1`(Cap8 호환) 추가 → handleSpeakSmart에 `Capacitor.getPlatform()==='android'` 분기(네이티브 TextToSpeech 엔진, 실패 시 Azure 폴백=리스크 하한). iOS/웹은 Web Speech 유지.
- **AAB**: versionCode 33→**34**, versionName 1.3.2→**1.3.6**(iOS와 정렬). 번들 2.0.16. **서명 AAB 빌드 완료**(`android/app/build/outputs/bundle/release/app-release.aab`, build-aab.sh, JBR+release-keystore.jks). web/git push(35d8281) + Capgo prod 2.0.16 업로드 완료.
- **✅ 내부테스트 검증 성공(2026-06-10)**: Android 앱 `[TTSRoute] engine=native platform=android voice="android-plugin"` 확인 → 전 플랫폼(웹/iOS/Android) 네이티브 TTS 완성. TTS 비용 절감 목표 달성.
- **남은 수동 작업(사용자)**: ① Play Console 업로드 → **내부테스트 먼저**(Android 네이티브 TTS 실기기 검증, 미검증 상태) → production 승격 ② 승격 후 Firebase `config/app.latestNativeVersion`="1.3.6" 수동 업데이트(빌드↔공개 괴리 팝업 방지). ③ pending-aab-fixes의 billing-client 8.0.1 force는 이번에 미포함(다음 빌드).
- 교훈: Android System WebView ≠ Chrome — speechSynthesis 미지원이 근본 한계. 네이티브 플러그인이 유일 해법(AAB 필수, OTA 불가). 구 AAB 유저는 플러그인 부재로 OTA 신번들에서도 Azure 폴백(안전).

## 2026-06-10 후반 — Translation 탭 길이 가드 진화 + z-index + 번역 차감

**SaveCard(MessageCardModal) z-index 근본 해결(v2.0.19, 649d112)**: MessageCard가 `--z-chat-popup(5100)`이던 건 FreeTalking 잔재 → `--z-dropdown(1000)`으로 낮춤. 한도/업그레이드/목표달성 등 인터럽트 모달이 항상 카드 위로. (앞서 우려한 "팝업이 카드 뒤로 가림" 해소.) + 발음결과 하단 LEARNING TIP 광고가림 패딩.

**Translation 탭 TTS 길이 가드(점진 진화)**:
- v2.0.20(5aa48a8): TranslationCard onSpeak를 handleSpeakSmart(native-first)로 통일 + 본문>500자 TTS 버튼 disable. → 전 탭(Vocab/Listening/Translation) native-first 통일 완료.
- v2.0.21(6cbe49f): **발음 연습 버튼도** disable(practiceTooLong) + 한도를 **언어별**로 — CJK(ko/ja/zh-CN/zh-TW) **100자**, 그 외(영어 등) **150자**. i18n card.ttsTooLong "듣기·발음연습 미지원"으로 확장(10 locale).
- v2.0.22(37bdd4b): **다중언어 그룹 차단** — 번역 묶음 중 한 언어라도 한도 초과면 `groupTooLong`=true → 전체 카드 함께 차단. (같은 내용도 CJK는 글자수 적어 개별 한도엔 안 걸리던 문제: 영어만 막히고 중·일 열림 → 일괄 차단.) `getTtsCharLimit` export, App.jsx가 `displayLangs.some(초과)`로 판정.
- 길이 감각: 영어 150자≈1.5문장 / 한글 100자≈1문장 남짓. 일상 번역(1~3문장)은 안 걸리고 문단급만 차단.

**번역 생성 1점 차감(v2.0.23, bfd6039)**: 그동안 번역은 무료·무제한이었음(2026-05-07 카드한도 폐기 후 미게이팅, 2026-06-07 포인트목록서 제외 — 핵심기능+Gemini저비용이라 의도적). 사용자 요청으로 Vocab/Scene과 동일 **1점** 차감 추가. 시작 게이트(Trial&0점→requestLimitModal('translation')='points'사유 차단) + 성공 시 addAdPoints(1). retryCount>0 재게이트 안 함. ⚠️ side effect: Trial 0점이면 핵심기능인 번역도 막힘.
  - 번역 탭 차감 구조 최종: 번역 생성 1 / 카드 TTS 1(텍스트당1회) / 발음연습 2.

**FreeTalking PreGuide tip 제거(v2.0.20, 960f38a)**: 카드 제거 후에도 "메시지 탭하면 카드" 안내 남아 오안내 → freeTalk.preGuide.tip 키 10 locale 제거.

**통합 TTS 재생 우선순위 확정(v2.0.24~25, 8d00ccf)** — handleSpeakSmart 재작성, 사용자 정의:
  **① 캐시(메모리→IndexedDB) → ② 네이티브 TTS → ③ Azure**. ①캐시·②네이티브=**무료·무차감**(학습 카드 복습 과금 부적절), ③Azure만 1점 차감(=저장 후 한 번도 연습/듣기 안 한 신규 합성=자연 과금시점). Vocab 단어·예문/Listening/Translation/**Library 카드 모두 공통**(Library도 handleSpeak{saved}→handleSpeakSmart 전환).
  - **IndexedDB 영속 캐시 opts.saved 게이트 제거**(58983d6) → 모든 Azure 합성을 기기 영속 저장(LRU 500→1000). 미저장 카드·Android 미지원언어(ru/zh-CN/ja) native폴백 반복재생 매번과금 누수 차단.
  - **중요 개념**: IndexedDB엔 **Azure 합성분(mp3 Blob)만** 저장 가능. 네이티브 TTS(Web Speech/플러그인)는 OS가 직접 말해 **파일이 없음 → 저장 불가(불필요, 항상 무료)**. 그래서 "모든 카드 발음이 IndexedDB에"는 아니고 Azure 거친 것만.
  - 네이티브 무차감 전환으로 ttsChargedRef/_skipGate 경로 제거(이전 "native 텍스트당 1회 차감"은 폐기).

**버전 맵(2026-06-10, web/OTA)**: 2.0.16(Android플러그인AAB) → 2.0.17(카드 상단고정) → 2.0.18(일일충전 15→10) → 2.0.19(z-index) → 2.0.20(Translation native+500) → 2.0.21(발음연습 disable+언어별한도) → 2.0.22(그룹차단) → 2.0.23(번역 1점 차감) → 2.0.24(IndexedDB 전체확대) → **2.0.25(통합 재생 우선순위 캐시→네이티브→Azure)** = 현재 Capgo production. 네이티브 AAB 1.3.6/code34(내부테스트).

관련: [[changes-0606-session3]] [[changes-0606-session2]] (Azure 비용구조·SSML 과금·TTS 캐시)
