import React, { useState, useEffect } from 'react';
import { Languages, Sparkles, Settings as SettingsIcon, ArrowLeft, CheckCircle2, LogOut, User } from 'lucide-react';
import TranslationCard from './components/TranslationCard';
import { Analytics } from '@vercel/analytics/react';
import './App.css';

// Firebase & Auth
import { auth, db } from './firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut } from 'firebase/auth';
import { useAuth } from './context/AuthContext';
import Login from './components/Auth/Login';
import Library from './components/Library'; // [신규] 보관함 컴포넌트
import Signup from './components/Auth/Signup';

// Supported Language List
const SUPPORTED_LANGUAGES = [
  { code: 'ko', name: '한국어', tts: 'ko-KR', color: '#f0fdf4', textColor: '#166534' },
  { code: 'en', name: 'English', tts: 'en-US', color: '#e0e7ff', textColor: '#4338ca' },
  { code: 'ja', name: '日本語', tts: 'ja-JP', color: '#fef2f2', textColor: '#b91c1c' },
  { code: 'zh-CN', name: '中文', tts: 'zh-CN', color: '#fff7ed', textColor: '#9a3412' },
  { code: 'vi', name: 'Tiếng Việt', tts: 'vi-VN', color: '#f0fdf4', textColor: '#166534' },
  { code: 'fr', name: 'Français', tts: 'fr-FR', color: '#f1f5f9', textColor: '#475569' },
  { code: 'de', name: 'Deutsch', tts: 'de-DE', color: '#f1f5f9', textColor: '#475569' },
  { code: 'es', name: 'Español', tts: 'es-ES', color: '#f1f5f9', textColor: '#475569' },
];

const languageNames = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': 'Chinese',
  vi: 'Vietnamese',
  fr: 'French',
  de: 'German',
  es: 'Spanish'
};

function App() {
  const { user, profile } = useAuth();
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'

  // Gemini API Key from environment variables
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const [geminiApiKey, setGeminiApiKey] = useState(envApiKey || '');

  // --- 1. 상태 관리 (State Management) ---
  // 이 부분은 앱이 돌아가는 동안 변하는 데이터(글자, 언어 설정 등)를 저장하는 바구니입니다.

  // 현재 화면 모드 ('translation': 번역 화면, 'settings': 설정 화면)
  const [viewMode, setViewMode] = useState('translation');

  // 사용자가 입력한 번역할 텍스트
  const [inputText, setInputText] = useState(() => {
    try {
      // 새로고침해도 글자가 남아있도록 브라우저 저장소(localStorage)에서 읽어옵니다.
      return localStorage.getItem('inputText') || '';
    } catch (e) {
      return '';
    }
  });

  // 번역의 기준이 되는 언어 (출발어)
  const [sourceLang, setSourceLang] = useState(() => {
    try {
      const saved = localStorage.getItem('sourceLang');
      // 저장된 언어가 있고, 우리 앱이 지원하는 언어일 때만 사용합니다. 기본값은 '한국어(ko)'입니다.
      return (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) ? saved : 'ko';
    } catch (e) {
      return 'ko';
    }
  });

  // 번역해서 보고 싶은 언어들 (도착어, 최대 3개)
  const [targetLangs, setTargetLangs] = useState(() => {
    try {
      const saved = localStorage.getItem('targetLangs');
      if (!saved) return ['en', 'ja', 'zh-CN']; // 기본값: 영어, 일본어, 중국어
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return ['en', 'ja', 'zh-CN'];
      // 지원되는 언어 코드만 필터링해서 가져옵니다.
      return parsed.filter(code => SUPPORTED_LANGUAGES.some(l => l.code === code));
    } catch (e) {
      return ['en', 'ja', 'zh-CN'];
    }
  });

  // 생성된 번역 결과물들을 저장하는 곳
  const [translations, setTranslations] = useState(() => {
    try {
      const saved = localStorage.getItem('translations');
      const parsed = saved ? JSON.parse(saved) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  });

  // AI(Gemini)가 만들어준 학습 팁들을 저장하는 곳
  const [learningTips, setLearningTips] = useState(() => {
    try {
      const saved = localStorage.getItem('learningTips');
      const parsed = saved ? JSON.parse(saved) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  });

  // AI(Gemini)가 만들어준 발음 가이드(병음, 히라가나 등)를 저장하는 곳
  const [pronunciations, setPronunciations] = useState(() => {
    try {
      const saved = localStorage.getItem('pronunciations');
      const parsed = saved ? JSON.parse(saved) : {};
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  });

  // 현재 번역 중인지, 팁을 만드는 중인지 나타내는 상태 (화면에 로딩 표시용)
  const [isTranslating, setIsTranslating] = useState(false);
  const [isGeneratingTips, setIsGeneratingTips] = useState(false);

  // --- [신규] 보관함 저장 및 선택 모드 전역 상태 ---
  const [selectedCards, setSelectedCards] = useState(new Set()); // 선택된 언어 코드들
  const [isInSelectionMode, setIsInSelectionMode] = useState(false); // 선택 모드 활성화 여부
  const [isSavingCards, setIsSavingCards] = useState(false); // Firebase 저장 중 로딩 상태

  // --- 2. 데이터 자동 저장 (Auto Sync) ---
  // 상태(데이터)가 바뀔 때마다 자동으로 브라우저 저장소에 저장해주는 마법 같은 함수입니다.
  useEffect(() => {
    try {
      localStorage.setItem('inputText', inputText);
      localStorage.setItem('sourceLang', sourceLang);
      localStorage.setItem('targetLangs', JSON.stringify(targetLangs));
      localStorage.setItem('translations', JSON.stringify(translations));
      localStorage.setItem('learningTips', JSON.stringify(learningTips));
      localStorage.setItem('pronunciations', JSON.stringify(pronunciations));
    } catch (e) {
      console.warn("데이터를 저장하지 못했습니다:", e);
    }
  }, [inputText, sourceLang, targetLangs, translations, learningTips, pronunciations]);

  // 화면이 바뀔 때 스크롤을 맨 위로 올려주는 효과
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewMode]);

  // --- 3. 비즈니스 로직 (핵심 기능) ---

  // '번역' 버튼을 눌렀을 때 실행되는 메인 함수
  const handleTranslate = async () => {
    if (!inputText.trim()) return; // 입력한 글자가 없으면 아무것도 안 함

    setIsTranslating(true); // "번역 중..." 상태 시작
    setIsGeneratingTips(true); // "AI 분석 중..." 상태 시작

    // 새로운 번역을 위해 기존 팁과 발음 정보를 비웁니다.
    setLearningTips({});
    setPronunciations({});

    try {
      // 3-1. 여러 언어로 동시에 번역 요청 (외부 API 활용)
      const fetchTranslation = async (text, sLang, tLang) => {
        try {
          const response = await fetch(
            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sLang}|${tLang}`
          );
          const data = await response.json();
          return data?.responseData?.translatedText || `[Translation error: ${tLang}]`;
        } catch (e) {
          return `[Service under maintenance: ${tLang}]`;
        }
      };

      const newTranslations = {};
      // 선택한 모든 도착 언어에 대해 번역을 수행합니다.
      await Promise.all(targetLangs.map(async (langCode) => {
        const result = await fetchTranslation(inputText, sourceLang, langCode);
        newTranslations[langCode] = result;
      }));

      setTranslations(newTranslations); // 번역 결과 저장

      // 3-2. AI 학습 팁 생성 요청 (Gemini API 활용)
      if (geminiApiKey) {
        generateGeminiTips(inputText, newTranslations);
      } else {
        // API 키가 없으면 안내 문구를 띄웁니다.
        const fallbackTips = {};
        targetLangs.forEach(lang => {
          fallbackTips[lang] = ["Enter Gemini API Key in settings to see AI learning tips!"];
        });
        setLearningTips(fallbackTips);
        setIsGeneratingTips(false);
      }

    } catch (error) {
      console.error("번역 실패:", error);
      alert("An error occurred during translation. Please try again.");
      setIsGeneratingTips(false);
    } finally {
      setIsTranslating(false); // 번역 완료
    }
  };

  // Gemini AI에게 번역 결과에 대한 상세 팁을 물어보는 함수
  const generateGeminiTips = async (original, translatedMap, retryCount = 0) => {
    try {
      // AI가 이해할 수 있도록 번역 데이터를 정리합니다.
      const targetLangsInfo = targetLangs.map(code => {
        const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
        return `${lang?.name || code} (${code}): "${translatedMap[code]}"`;
      }).join('\n');

      const targetCodes = targetLangs.join(', ');
      const sourceLangName = SUPPORTED_LANGUAGES.find(l => l.code === sourceLang)?.name || sourceLang;

      // AI에게 보내는 상세 지시서 (프롬프트 고도화)
      const prompt = `
        You are a professional multilingual language tutor. Provide detailed learning tips and pronunciation guides.
        
        [Target Application Context]
        - The user's primary language for this session is "${sourceLangName}".
        - CRITICAL RULE: All explanations and tips MUST be written entirely in "${sourceLangName}". Do not use English unless you are explaining an English word.

        [Data]
        - Source Text (Input): "${original}"
        - Current Translations:
        ${targetLangsInfo}

        [Requirement 1: Input Type]
        - Determine if "${original}" is a single "word" (or short idiom) or a full "sentence".

        [Requirement 2: Educational Tips]
        - If "sentence": Provide 2-3 tips about grammar, nuance, or usage. Write these tips in "${sourceLangName}".
        - If "word": Provide dictionary-style tips: 
          1. Meaning and Part of Speech evaluated and translated in "${sourceLangName}".
          2. Common synonyms/antonyms.
          3. A practical example sentence using the word with its translation in "${sourceLangName}".
          Make sure all explanations are written in "${sourceLangName}".

        [Requirement 3: Pronunciation]
        - en: IPA / ja: Hiragana / zh-CN: Pinyin with tones / Others: Romanization.

        [Output Format]
        - Return ONLY valid JSON format.
        {
          "type": "word" or "sentence",
          "data": {
            ${targetLangs.map(code => `
            "${code}": {
              "tips": ["Tip 1 in ${sourceLangName}", "Tip 2 in ${sourceLangName}", "Tip 3 in ${sourceLangName}"],
              "pronunciation": "Pronunciation text"
            }`).join(',')}
          }
        }
      `;

      // 구글의 최신 AI(Gemini 2.0 Flash)에게 질문을 보냅니다.
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // 초보자 설명(주석): 
            // Gemini 2.0 Flash를 사용할 때 답변이 JSON 형식이 아닌 일반 텍스트로 나와서 버그가 생기는 것을 막기 위해
            // 강제로 JSON 형식으로만 응답하도록 'responseMimeType' 옵션을 추가했습니다.
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        // 너무 자주 요청했을 때(429) 한 번 더 시도해줍니다.
        if (response.status === 429 && retryCount < 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return generateGeminiTips(original, translatedMap, retryCount + 1);
        }
        throw new Error(`AI service connection error (${response.status})`);
      }

      const data = await response.json();
      const textResponse = data.candidates[0].content.parts[0].text;
      // 응답에서 순수한 데이터(JSON)만 뽑아서 저장합니다.
      const jsonString = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(jsonString);

      // 개별 언어별로 팁과 발음을 분리하여 저장합니다.
      const newTips = {};
      const newProns = {};
      if (result.data) {
        targetLangs.forEach(langCode => {
          if (result.data[langCode]) {
            newTips[langCode] = result.data[langCode].tips;
            newProns[langCode] = result.data[langCode].pronunciation;
          }
        });
      }

      setLearningTips(newTips);
      setPronunciations(newProns);
    } catch (error) {
      console.error("Gemini 분석 오류:", error);
      const errorTips = {};
      targetLangs.forEach(lang => errorTips[lang] = ["Failed to load AI analysis. Please check your API key."]);
      setLearningTips(errorTips);
    } finally {
      setIsGeneratingTips(false); // 분석 완료
    }
  };

  // --- [신규] 보관함 저장 및 제스처 로직 ---

  // 1. 카드 선택 토글 로직 (롱프레스 또는 클릭 시)
  const toggleSelectCard = (langCode) => {
    setSelectedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(langCode)) {
        newSet.delete(langCode);
      } else {
        newSet.add(langCode);
      }
      // 선택된 것이 하나라도 있으면 선택 모드 유지, 없으면 해제
      setIsInSelectionMode(newSet.size > 0);
      return newSet;
    });
  };

  // 2. Firebase Firestore에 실제 데이터를 저장하는 공통 함수
  const saveToFirebase = async (langCode) => {
    if (!user) { // userAuthState에서 가져온 user 객체 사용
      alert("Login required to use library.");
      return false;
    }

    try {
      const cardData = {
        userId: user.uid,
        userEmail: user.email,
        language: SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name || langCode,
        langCode: langCode,
        sourceText: inputText,
        sourceLang: sourceLang,
        translatedText: translations[langCode],
        learningTip: learningTips[langCode] || [],
        pronunciation: pronunciations[langCode] || "",
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "savedCards"), cardData);
      return true;
    } catch (error) {
      console.error("저장 중 오류 발생:", error);
      return false;
    }
  };

  // 3. 선택한 카드들을 한꺼번에 저장하는 함수
  const handleSaveSelected = async () => {
    if (selectedCards.size === 0) return;

    setIsSavingCards(true);
    let successCount = 0;

    // 선택된 모든 언어 코드에 대해 순차적으로 저장 진행
    for (const langCode of selectedCards) {
      const success = await saveToFirebase(langCode);
      if (success) successCount++;
    }

    alert(`Success! Saved ${successCount} translation cards to library. ✨`);
    setSelectedCards(new Set());
    setIsInSelectionMode(false);
    setIsSavingCards(false);
  };

  // 4. 스와이프 제스처 시 호출되는 자동 저장 함수
  const handleSwipeSave = async (langCode) => {
    const success = await saveToFirebase(langCode);
    if (success) {
      console.log(`${langCode} card sent to library.`);
    }
  };

  // 문장을 소리로 읽어주는 함수 (브라우저 내장 기능 활용)
  const handleSpeak = (text, langCode) => {
    if (!text) return;
    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    if (langInfo) utterance.lang = langInfo.tts; // 해당 언어의 목소리 설정
    synth.speak(utterance);
  };

  // 로그아웃을 처리하는 함수
  const handleLogout = async () => {
    try {
      await signOut(auth); // Firebase 서버에 로그아웃 알림
      setViewMode('translation'); // 로그아웃 후 기본 화면으로 이동
    } catch (error) {
      console.error("로그아웃 실패:", error);
    }
  };

  // 설정 화면에서 도착 언어(번역될 언어)를 선택하거나 해제하는 함수
  const toggleTargetLang = (code) => {
    if (targetLangs.includes(code)) {
      // 이미 선택된 언어라면 목록에서 뺍니다.
      setTargetLangs(targetLangs.filter(c => c !== code));
    } else {
      // 새로 선택하는 경우, 최대 3개까지만 가능하도록 제한합니다.
      if (targetLangs.length >= 3) {
        alert("You can select up to 3 target languages.");
        return;
      }
      setTargetLangs([...targetLangs, code]);
    }
  };

  // --- 4. 화면 렌더링 (UI Rendering) ---

  // 로그인이 되어있지 않으면 로그인/회원가입 화면을 먼저 보여줍니다.
  if (!user) {
    return authMode === 'login' ? (
      <Login onSwitchToSignup={() => setAuthMode('signup')} />
    ) : (
      <Signup onSwitchToLogin={() => setAuthMode('login')} />
    );
  }

  // 로그인이 되어있을 때 보여주는 메인 앱 화면
  return (
    <div className="app-container">
      {/* Vercel 분석 도구 (성능 및 방문자 통계용) */}
      <Analytics />

      <header className="app-header">
        <h1 className="main-logo-badge">My Polyglot Tutor</h1>
      </header>

      <main className="app-main-content">
        {/* 번역 모드(translation)일 때 보여주는 화면 */}
        {viewMode === 'translation' ? (
          <>
            <div className="primary-sentence-container">
              <span className="primary-label">
                {/* 설정된 출발 언어의 이름을 가져와서 라벨로 보여줍니다. */}
                {(SUPPORTED_LANGUAGES.find(l => l.code === sourceLang)?.name || 'Unknown')} Sentence
              </span>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Enter text to translate..."
                className="text-input"
              />
              <div className="translate-btn-container">
                <button
                  className="translate-btn"
                  onClick={handleTranslate}
                  disabled={isTranslating || !inputText.trim()}
                >
                  {isTranslating ? 'Translating...' : (
                    <>
                      <Sparkles size={20} />
                      Translate
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 번역 결과 카드들이 나오는 영역 */}
            <div className="cards-grid">
              {targetLangs.map((langCode) => {
                const lang = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
                return (
                  <TranslationCard
                    key={langCode}
                    language={lang?.name}
                    langCode={langCode}
                    sourceLangCode={sourceLang}
                    text={translations[langCode]}
                    pronunciation={pronunciations[langCode]}
                    learningTip={learningTips[langCode]}
                    badgeColor={lang?.color}
                    badgeTextColor={lang?.textColor}
                    onSpeak={() => handleSpeak(translations[langCode], langCode)}
                    isSelected={selectedCards.has(langCode)}
                    onToggleSelect={() => toggleSelectCard(langCode)}
                    onSwipeSave={() => handleSwipeSave(langCode)}
                    isInSelectionMode={isInSelectionMode}
                  />
                );
              })}
              {/* 선택한 언어가 하나도 없을 때 보여주는 메시지 */}
              {targetLangs.length === 0 && (
                <p style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                  Please select at least 1 target language.
                </p>
              )}
            </div>

            {/* 선택 모드일 때 나타나는 일괄 저장 플로팅 버튼 */}
            {isInSelectionMode && (
              <div className="selection-fab-container">
                <button
                  className={`save-fab ${isSavingCards ? 'loading' : ''}`}
                  onClick={handleSaveSelected}
                  disabled={isSavingCards}
                >
                  {isSavingCards ? "Saving..." : `Save ${selectedCards.size} cards ✨`}
                </button>
                <button className="cancel-fab" onClick={() => { setSelectedCards(new Set()); setIsInSelectionMode(false); }}>
                  Cancel
                </button>
              </div>
            )}
          </>
        ) : viewMode === 'library' ? (
          /* [신규] 보관함 모드일 때 보여주는 화면 */
          <Library
            user={user}
            sourceLang={sourceLang}
            onSpeak={handleSpeak}
          />
        ) : (
          /* 설정 모드(settings)일 때 보여주는 화면 */
          <div className="settings-container">
            <div className="user-profile-section">
              <div className="user-info">
                <div className="user-avatar">
                  <User size={24} color="var(--primary-color)" />
                </div>
                <div className="user-details">
                  <p className="user-email">{profile?.displayName || user.email}</p>
                  {profile?.displayName && <p className="user-email-secondary">{user.email}</p>}
                  <p className="user-status">{profile?.membership || 'Free'} Member</p>
                </div>
              </div>
              <button className="logout-btn" onClick={handleLogout}>
                <LogOut size={18} />
                Logout
              </button>
            </div>

            {/* 출발 언어(입력 언어)를 바꾸는 곳 */}
            <div className="settings-group">
              <label className="settings-label">
                <ArrowLeft size={18} /> Select Source Language
              </label>
              <div className="lang-grid">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <div
                    key={lang.code}
                    className={`lang-option ${sourceLang === lang.code ? 'selected' : ''}`}
                    onClick={() => setSourceLang(lang.code)}
                  >
                    {sourceLang === lang.code && <CheckCircle2 size={16} />}
                    {lang.name}
                  </div>
                ))}
              </div>
            </div>

            {/* 도착 언어(번역될 언어)를 바꾸는 곳 */}
            <div className="settings-group">
              <label className="settings-label">
                Select Target Languages (Max 3)
              </label>
              <p className="target-limit-msg">Currently {targetLangs.length}/3 selected</p>
              <div className="lang-grid">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <div
                    key={lang.code}
                    className={`lang-option ${targetLangs.includes(lang.code) ? 'selected' : ''} ${!targetLangs.includes(lang.code) && targetLangs.length >= 3 ? 'disabled' : ''}`}
                    onClick={() => toggleTargetLang(lang.code)}
                  >
                    {targetLangs.includes(lang.code) && <CheckCircle2 size={16} />}
                    {lang.name}
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <label className="settings-label">AI Learning Tip Settings</label>
              <div className="api-key-section">
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="Enter Gemini API Key"
                  className="api-key-input"
                />
              </div>
            </div>

            <button className="translate-btn" style={{ alignSelf: 'center' }} onClick={() => setViewMode('translation')}>
              Save Settings & Return
            </button>
          </div>
        )}
      </main>

      {/* 화면 하단에 고정된 메뉴바 (네비게이션) */}
      <nav className="app-nav">
        <button
          className={`nav-item ${viewMode === 'translation' ? 'active' : ''}`}
          onClick={() => { setViewMode('translation'); setIsInSelectionMode(false); setSelectedCards(new Set()); }}
        >
          <Languages size={24} />
          <span>Language Card</span>
        </button>
        <button
          className={`nav-item ${viewMode === 'library' ? 'active' : ''}`}
          onClick={() => { setViewMode('library'); setIsInSelectionMode(false); setSelectedCards(new Set()); }}
        >
          <Sparkles size={24} />
          <span>Library</span>
        </button>
        <button
          className={`nav-item ${viewMode === 'settings' ? 'active' : ''}`}
          onClick={() => { setViewMode('settings'); setIsInSelectionMode(false); setSelectedCards(new Set()); }}
        >
          <SettingsIcon size={24} />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
