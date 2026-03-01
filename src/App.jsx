import React, { useState, useEffect } from 'react';
import { Languages, Sparkles, Settings as SettingsIcon, ArrowLeft, CheckCircle2, LogOut, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import TranslationCard from './components/TranslationCard';
import { Analytics } from '@vercel/analytics/react';
import './App.css';

// Firebase & Auth
import { auth, db } from './firebase/config';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut } from 'firebase/auth';
import { useAuth } from './context/AuthContext';
import Login from './components/Auth/Login';
import Library from './components/Library'; // [신규] 보관함 컴포넌트
import Signup from './components/Auth/Signup';
import { getUiTranslation } from './utils/uiTranslations';

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
  const { user, profile, updateUserProfile } = useAuth();
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'

  // [신규] 온보딩 팝업 표시 여부
  const [showOnboarding, setShowOnboarding] = useState(false);

  // [신규] 닉네임 수정 모드 및 임시 텍스트 상태
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [editNicknameValue, setEditNicknameValue] = useState('');

  // 언어별 목표 점수를 저장하는 상태 (기본값 80점)
  const [languageGoals, setLanguageGoals] = useState(() => {
    try {
      const saved = localStorage.getItem('languageGoals');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

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

  // 번역의 기준이 되는 언어 (출발어, 모국어)
  const [sourceLang, setSourceLang] = useState(() => {
    try {
      const saved = localStorage.getItem('sourceLang');
      return (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) ? saved : 'ko';
    } catch (e) {
      return 'ko';
    }
  });

  // [신규] 실제로 입력하는 텍스트의 언어 (기본은 sourceLang과 동일)
  const [inputLang, setInputLang] = useState(() => {
    try {
      const saved = localStorage.getItem('inputLang');
      return (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) ? saved : 'ko';
    } catch (e) {
      return 'ko';
    }
  });

  // 번역해서 보고 싶은 언어들 (도착어, 최대 3개)
  const [targetLangs, setTargetLangs] = useState(() => {
    try {
      const saved = localStorage.getItem('targetLangs');
      if (!saved) return ['en']; // 기본값: 영어 하나로 변경
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return ['en'];
      // 지원되는 언어 코드만 필터링해서 가져옵니다.
      return parsed.filter(code => SUPPORTED_LANGUAGES.some(l => l.code === code));
    } catch (e) {
      return ['en'];
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
  const [practiceResults, setPracticeResults] = useState({}); // [신규] 발음 연습 기록 상태
  const [saveMessages, setSaveMessages] = useState({}); // [신규] 보관함 저장 상태 알림 메시지

  // [신규] 현재 번역한 텍스트가 단어(Word)인지 문장(Sentence)인지 판별한 결과 ('W' or 'S')
  const [inputType, setInputType] = useState(() => {
    try {
      return localStorage.getItem('inputType') || 'S';
    } catch (e) {
      return 'S';
    }
  });

  // 발음 연습 결과가 나올 때마다 호출되는 함수
  const handlePracticeResult = (langCode, result) => {
    setPracticeResults(prev => ({
      ...prev,
      [langCode]: result
    }));
  };

  // --- 2. 데이터 자동 저장 (Auto Sync) ---
  // 상태(데이터)가 바뀔 때마다 자동으로 브라우저 저장소에 저장해주는 마법 같은 함수입니다.
  useEffect(() => {
    try {
      localStorage.setItem('inputText', inputText);
      localStorage.setItem('sourceLang', sourceLang);
      localStorage.setItem('inputLang', inputLang);
      localStorage.setItem('inputType', inputType); // [신규] 타입 저장
      localStorage.setItem('targetLangs', JSON.stringify(targetLangs));
      localStorage.setItem('translations', JSON.stringify(translations));
      localStorage.setItem('learningTips', JSON.stringify(learningTips));
      localStorage.setItem('pronunciations', JSON.stringify(pronunciations));
      localStorage.setItem('languageGoals', JSON.stringify(languageGoals)); // [신규] 언어 목표 점수 자동 저장
    } catch (e) {
      console.warn("데이터를 저장하지 못했습니다:", e);
    }
  }, [inputText, sourceLang, inputLang, inputType, targetLangs, translations, learningTips, pronunciations]);

  // [신규] sourceLang이나 targetLangs가 바뀔 때, inputLang이 사용 가능한 언어 조합에 없다면 기본값(sourceLang)으로 되돌립니다.
  useEffect(() => {
    const availableLangs = [sourceLang, ...targetLangs];
    if (!availableLangs.includes(inputLang)) {
      setInputLang(sourceLang);
    }
  }, [sourceLang, targetLangs, inputLang]);

  // 화면이 바뀔 때 스크롤을 맨 위로 올려주는 효과
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewMode]);

  // [신규] 첫 로그인 감지 (온보딩 유도)
  useEffect(() => {
    // 사용자가 로그인했고(profile 로드 됨), 아직 온보딩(초기 설정)을 안 끝냈다면, 설정 화면으로 이동시킴
    if (user && profile && profile.hasCompletedOnboarding !== true) {
      setViewMode('settings');
      setShowOnboarding(true);
      // [수정] 내 브라우저(캐시)에 과거에 골라둔 언어 3개가 남아있을 수 있으므로 강제로 '영어'로 리셋!
      setTargetLangs(['en']);
    }
  }, [user, profile]);

  // [신규] 온보딩 [확인] 버튼을 눌렀을 때
  const handleCompleteOnboarding = async () => {
    try {
      await updateUserProfile({ hasCompletedOnboarding: true });
      setShowOnboarding(false);
    } catch (e) {
      console.error("Failed to complete onboarding:", e);
      setShowOnboarding(false); // 실패하더라도 팝업은 닫아줌
    }
  };

  // [신규] 닉네임 수정 모드로 전환
  const handleEditNickname = () => {
    setEditNicknameValue(profile?.displayName || user?.displayName || 'Google User');
    setIsEditingNickname(true);
  };

  // [신규] 닉네임 저장
  const handleSaveNickname = async () => {
    if (!editNicknameValue.trim()) return;
    try {
      await updateUserProfile({ displayName: editNicknameValue });
      setIsEditingNickname(false);
    } catch (e) {
      alert("Failed to update nickname. Please try again.");
    }
  };

  // --- 3. 비즈니스 로직 (핵심 기능) ---

  // '번역' 버튼을 눌렀을 때 실행되는 메인 함수
  const handleTranslate = async () => {
    if (!inputText.trim()) return; // 입력한 글자가 없으면 아무것도 안 함

    setIsTranslating(true); // "번역 중..." 상태 시작
    setIsGeneratingTips(true); // "AI 분석 중..." 상태 시작

    // 새로운 번역을 위해 기존 팁과 발음 정보를 비웁니다.
    setLearningTips({});
    setPronunciations({});
    setPracticeResults({}); // [신규] 새로운 번역 시 이전 연습 결과 지우기

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
        // [로직 변경] sourceLang 대신 사용자가 선택한 inputLang을 번역 출발어로 간주합니다.
        if (inputLang === langCode) {
          // 입력 언어와 목적 언어가 같다면 번역 생략하고 원문 그대로 사용 (사용자 요청 사항 반영)
          newTranslations[langCode] = inputText;
        } else {
          const result = await fetchTranslation(inputText, inputLang, langCode);
          newTranslations[langCode] = result;
        }
      }));

      setTranslations(newTranslations); // 번역 결과 저장

      // 3-2. API KEY 필요없이 앱이 동작하도록 우선 임시 메시지 또는 제한적 팁 제공 (API 키를 서버에서 관리하거나 기본 기능을 우회한다고 가정)
      generateGeminiTips(inputText, newTranslations);

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
      const inputLangName = SUPPORTED_LANGUAGES.find(l => l.code === inputLang)?.name || inputLang;

      // AI에게 보내는 상세 지시서 (프롬프트 고도화)
      const prompt = `
        You are a professional multilingual language tutor. Provide detailed learning tips and pronunciation guides.
        
        [Target Application Context]
        - The user's primary language for this session is "${sourceLangName}". This is the language the user understands.
        - The input text provided by the user is written in "${inputLangName}".
        - CRITICAL RULE: ALL explanations, tips, and dictionary definitions MUST be written in the user's primary language: "${sourceLangName}". 
        - ABSOLUTELY DO NOT write the explanations in the target language being learned. For example, if you are explaining a Korean translation to a Chinese user, the explanation must be in Chinese, NOT Korean.

        [Data]
        - Source Text (Input in ${inputLangName}): "${original}"
        - Current Translations to learn:
        ${targetLangsInfo}

        [Requirement 1: Input Type]
        - Determine if "${original}" is a single "word" (or short idiom) or a full "sentence".

        [Requirement 2: Educational Tips]
        - If "sentence": Provide 2-3 tips about grammar, nuance, or usage. The tips MUST be translated and written in "${sourceLangName}".
        - If "word": Provide dictionary-style tips: 
          1. Meaning and Part of Speech. (Must be explained in "${sourceLangName}")
          2. Common synonyms/antonyms.
          3. A practical example sentence using the target word, with its translation in "${sourceLangName}".
          Make sure all explanations are strictly written in "${sourceLangName}".

        [Requirement 3: Pronunciation]
        - en: IPA / ja: Hiragana / zh-CN: Pinyin with tones / Others: Romanization.

        [Output Format]
        - Return ONLY valid JSON format.
        {
          "type": "word" or "sentence",
          "data": {
            ${targetLangs.map(code => `
            "${code}": {
              "tips": ["Tip 1 written entirely in ${sourceLangName}", "Tip 2 written entirely in ${sourceLangName}", "Tip 3 written entirely in ${sourceLangName}"],
              "pronunciation": "Pronunciation text"
            }`).join(',')}
          }
        }
      `;

      // 프론트엔드 환경변수나 백엔드를 통해 안전하게 호출한다고 가정합니다.
      // (기존의 geminiApiKey 변수를 더이상 화면에서 받지 않으므로, VITE_GEMINI_API_KEY를 직접 사용)
      const apiKeyToUse = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSy_YOUR_API_KEY';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKeyToUse}`,
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

      // [신규] AI가 판별한 결과에 따라 단어(W)인지 문장(S)인지 상태에 저장합니다.
      if (result.type) {
        setInputType(result.type.toLowerCase() === 'word' ? 'W' : 'S');
      }

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
      return { status: "error" };
    }

    try {
      // 1. 중복 데이터 검사 쿼리
      const q = query(
        collection(db, "savedCards"),
        where("userId", "==", user.uid),
        where("langCode", "==", langCode),
        where("sourceText", "==", inputText)
      );

      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        // 이미 동일한 조건의 카드가 존재함
        return { status: "duplicate" };
      }

      // 2. 중복이 없을 경우 새로 저장
      const cardData = {
        userId: user.uid,
        userEmail: user.email,
        language: SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name || langCode,
        langCode: langCode,
        sourceText: inputText,
        sourceLang: sourceLang, // 모국어 (UI 기준 언어)
        inputLang: inputLang,   // 실제 텍스트가 입력된 언어
        inputType: inputType,   // [신규] 'W' (Word) 또는 'S' (Sentence)
        translatedText: translations[langCode],
        learningTip: learningTips[langCode] || [],
        pronunciation: pronunciations[langCode] || "",
        pronunciationScore: practiceResults[langCode]?.pronunciationScore || null,
        pronunciationAudioUrl: practiceResults[langCode]?.audioUrl || null,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "savedCards"), cardData);
      return { status: "success" };
    } catch (error) {
      console.error("저장 중 오류 발생:", error);
      return { status: "error" };
    }
  };

  // 3. 선택한 카드들을 한꺼번에 저장하는 함수
  const handleSaveSelected = async () => {
    if (selectedCards.size === 0) return;

    setIsSavingCards(true);
    let successCount = 0;

    // 선택된 모든 언어 코드에 대해 순차적으로 저장 진행
    for (const langCode of selectedCards) {
      const result = await saveToFirebase(langCode);
      if (result.status === "success") {
        successCount++;
        setSaveMessages(prev => ({ ...prev, [langCode]: `✅ ${getUiTranslation(sourceLang, 'savedSuccess')}` }));
      } else if (result.status === "duplicate") {
        setSaveMessages(prev => ({ ...prev, [langCode]: `⚠️ ${getUiTranslation(sourceLang, 'alreadyInLibrary')}` }));
      }
    }

    setIsSavingCards(false);

    if (successCount > 0) {
      // 선택 모드 해제
      setIsInSelectionMode(false);
      setSelectedCards(new Set());
    }
  };

  // 4. 개별 저장 함수 (스와이프 제스처용)
  const handleSwipeSave = async (langCode) => {
    const result = await saveToFirebase(langCode);
    if (result.status === "success") {
      setSaveMessages(prev => ({ ...prev, [langCode]: `✅ ${getUiTranslation(sourceLang, 'savedToLibrary')}` }));
    } else if (result.status === "duplicate") {
      setSaveMessages(prev => ({ ...prev, [langCode]: `⚠️ ${getUiTranslation(sourceLang, 'alreadyInLibrary')}` }));
    }

    // 3초 후 메시지 제거
    setTimeout(() => {
      setSaveMessages(prev => {
        const newMessages = { ...prev };
        delete newMessages[langCode];
        return newMessages;
      });
    }, 3000);
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
        {/* [디자인 변경]: 앱 이름을 PronunFit으로 변경하고, framer-motion을 활용해 타이핑 애니메이션과 입체 3D 효과를 줍니다. */}
        <motion.h1
          className="main-logo-3d"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 1 },
            visible: {
              opacity: 1,
              transition: {
                staggerChildren: 0.15, // 한 글자씩 나타나는 딜레이 (타이핑 효과)
              }
            }
          }}
        >
          {"PronunFit".split("").map((char, index) => (
            <motion.span
              key={index}
              variants={{
                hidden: { opacity: 0, y: 20, scale: 0.8 }, // 시작할 때 투명하고 약간 아래에 위치
                visible: { opacity: 1, y: 0, scale: 1 }    // 나타날 때 원래 위치로 고정되며 완성됨
              }}
              style={{ display: "inline-block" }}
            >
              {char}
            </motion.span>
          ))}
        </motion.h1>
      </header>

      <main className="app-main-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={viewMode} // viewMode가 바뀔 때마다 새로운 화면으로 인식하여 애니메이션 실행
            initial={{ opacity: 0, y: 20 }} // 화면이 약간 아래에서 투명하게 시작
            animate={{ opacity: 1, y: 0 }}  // 제자리로 오면서 선명해짐
            exit={{ opacity: 0, y: -20 }}   // 화면이 바뀔 때 위로 스르륵 사라짐
            transition={{ duration: 0.3 }}  // 0.3초 동안 부드럽게 전환
            style={{ width: '100%' }}
          >
            {/* 번역 모드(translation)일 때 보여주는 화면 */}
            {viewMode === 'translation' ? (
              <>
                <div className="primary-sentence-container">
                  <div className="input-lang-selector" style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                    {/* 모국어 + 번역 도착어들을 입력 언어 옵션으로 제공합니다 */}
                    {[sourceLang, ...targetLangs].filter((value, index, self) => self.indexOf(value) === index).map((langCode) => {
                      const lang = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
                      if (!lang) return null;
                      const isSelected = inputLang === langCode;
                      return (
                        <button
                          key={langCode}
                          onClick={() => setInputLang(langCode)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: '16px',
                            border: isSelected ? 'none' : '1px solid #e2e8f0',
                            background: isSelected ? lang.color : 'white',
                            color: isSelected ? lang.textColor : '#64748b',
                            fontWeight: '700',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            boxShadow: isSelected ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
                            transition: 'all 0.2s'
                          }}
                        >
                          {lang.name}
                        </button>
                      );
                    })}
                  </div>
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
                        onPracticeResult={handlePracticeResult} // [신규] 발음 연습 결과를 App으로 전달
                        targetGoal={languageGoals[langCode] || 80} // [신규] 목표 점수 전달
                        librarySaveMessage={saveMessages[langCode]} // [신규] 중복 저장 방지 피드백 메시지
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
              /* [신규] 보관함 모드일 때 보여주는 화면: 언어별 목표 점수 설정값을 전달합니다. */
              <Library
                user={user}
                sourceLang={sourceLang}
                onSpeak={handleSpeak}
                languageGoals={languageGoals}
              />
            ) : (
              /* 설정 모드(settings)일 때 보여주는 화면 */
              <div className="settings-container" style={{ position: 'relative' }}>
                {/* [신규] 온보딩 팝업 */}
                {showOnboarding && (
                  <div className="onboarding-overlay" style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(255,255,255,0.95)', zIndex: 100,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '2rem', borderRadius: '16px',
                    backdropFilter: 'blur(5px)'
                  }}>
                    <h2 style={{ marginBottom: '1rem', color: 'var(--primary-color)', textAlign: 'center' }}>Welcome to PronunFit! 🎉</h2>
                    <p style={{ textAlign: 'center', marginBottom: '2rem', color: '#475569', lineHeight: '1.5' }}>
                      To get started, please select your <b>primary language</b> (Source Language) and the language you want to learn (<b>Target Language</b>).
                    </p>
                    <button className="translate-btn" onClick={handleCompleteOnboarding}>
                      Go to Settings 🚀
                    </button>
                  </div>
                )}

                <div className="user-profile-section">
                  <div className="user-info">
                    <div className="user-avatar">
                      <User size={24} color="var(--primary-color)" />
                    </div>
                    <div className="user-details">
                      {isEditingNickname ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                          <input
                            type="text"
                            value={editNicknameValue}
                            onChange={(e) => setEditNicknameValue(e.target.value)}
                            style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', width: '150px' }}
                            autoFocus
                          />
                          <button onClick={handleSaveNickname} style={{ padding: '6px 12px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
                        </div>
                      ) : (
                        <p className="user-email" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {profile?.displayName || user.email}
                          <span onClick={handleEditNickname} style={{ fontSize: '0.8rem', color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' }}>Edit</span>
                        </p>
                      )}
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

                {/* [신규] 언어별 목표 점수 관리 UI (슬라이더 방식) */}
                <div className="settings-group">
                  <label className="settings-label">Target Score Goals 🎯</label>
                  <p className="target-limit-msg" style={{ marginBottom: '1rem' }}>
                    Set your pronunciation target score for each language.
                  </p>
                  <div className="goal-sliders">
                    {targetLangs.map(code => {
                      const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
                      const currentGoal = languageGoals[code] || 80; // 기본값 80
                      return (
                        <div key={code} className="goal-slider-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', background: '#f8fafc', padding: '10px 15px', borderRadius: '12px' }}>
                          <span style={{ width: '80px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{lang?.name}</span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={currentGoal}
                            onChange={(e) => setLanguageGoals({ ...languageGoals, [code]: parseInt(e.target.value) })}
                            style={{ flex: 1, margin: '0 15px', accentColor: lang?.textColor || 'var(--primary-color)' }}
                          />
                          <span style={{ minWidth: '40px', textAlign: 'right', fontWeight: 'bold', color: lang?.textColor || 'var(--primary-color)' }}>{currentGoal}</span>
                        </div>
                      );
                    })}
                    {targetLangs.length === 0 && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Please select a target language above first.</p>
                    )}
                  </div>
                </div>

                <button className="translate-btn" style={{ alignSelf: 'center' }} onClick={() => setViewMode('translation')}>
                  Save Settings & Return
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 화면 하단에 고정된 메뉴바 (네비게이션) - 아이콘 전용 */}
      <nav className="app-nav">
        <button
          className={`nav-item ${viewMode === 'translation' ? 'active' : ''}`}
          onClick={() => { setViewMode('translation'); setIsInSelectionMode(false); setSelectedCards(new Set()); }}
          title="Language Card"
        >
          <Languages size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'library' ? 'active' : ''}`}
          onClick={() => { setViewMode('library'); setIsInSelectionMode(false); setSelectedCards(new Set()); }}
          title="Library"
        >
          <Sparkles size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'settings' ? 'active' : ''}`}
          onClick={() => { setViewMode('settings'); setIsInSelectionMode(false); setSelectedCards(new Set()); }}
          title="Settings"
        >
          <SettingsIcon size={32} />
        </button>
      </nav>
    </div>
  );
}

export default App;
