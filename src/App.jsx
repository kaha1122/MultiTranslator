import React, { useState, useEffect, useCallback } from 'react';
import { Languages, Sparkles, Settings as SettingsIcon, ArrowLeft, CheckCircle2, LogOut, User, AlertCircle, MoreHorizontal, Mail, Phone, MapPin, X, Lock, Newspaper, Youtube } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import TranslationCard from './components/TranslationCard';
import { Analytics } from '@vercel/analytics/react';
import './App.css';
import './components/Auth/Auth.css'; // [추가] 모달창 디자인을 위해 Auth.css 활용

// Firebase & Auth
import { auth, db } from './firebase/config';
import { collection, addDoc, serverTimestamp, query, getDocs, where } from 'firebase/firestore';
// ↑ [버그 수정] where 추가: saveToFirebase 함수에서 중복 데이터 검사에 `where`를 사용하는데
//   import 목록에서 빠져있어서 "where is not defined" 런타임 에러가 발생, 카드 저장이 안 됐습니다.
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut } from 'firebase/auth';
import { useAuth } from './context/AuthContext';
import Login from './components/Auth/Login';
import Library from './components/Library'; // [신규] 보관함 컴포넌트
import Signup from './components/Auth/Signup';
import { getT } from './utils/i18n';
import axios from 'axios'; // [신규] 백엔드 예열 통신을 위한 라이브러리 추가

// [신규] 첫 사용자 환영(온보딩) 화면 모달 컴포넌트 불러오기
import OnboardingModal from './components/OnboardingModal';
import TrialLimitModal from './components/TrialLimitModal';
import ApiKeySetupWizard from './components/ApiKeySetupWizard';
import UpgradeModal from './components/UpgradeModal';
import VoaReader from './components/VoaReader';
import TedReader from './components/TedReader';
import ScenePractice from './components/ScenePractice';
import LandingPage from './components/LandingPage';
import AdBanner from './components/AdBanner';

// [신규] AdSense 승인을 위한 법적 페이지 컴포넌트 (Privacy Policy, Terms, Contact)
import { PrivacyPolicyPage, TermsOfServicePage, ContactPage } from './components/Legal/LegalPages';

// [신규] 스플래시 화면 - 앱 아이콘으로 열 때 처음 보이는 로딩 화면
import SplashScreen from './components/SplashScreen';

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

// 브라우저/기기 언어를 감지하여 지원 언어 코드로 변환
const detectBrowserSourceLang = () => {
  try {
    const browserLang = (navigator.language || navigator.userLanguage || 'ko').toLowerCase();
    if (browserLang.startsWith('zh')) return 'zh-CN';
    const matched = SUPPORTED_LANGUAGES.find(l => browserLang.startsWith(l.code.toLowerCase()));
    return matched?.code || 'ko';
  } catch (e) { return 'ko'; }
};

// source 언어에 따른 스마트 기본 target 설정
// 영어권 → 한국어 학습, 나머지 → 영어 학습
const getDefaultTargetLangs = (src) => src === 'en' ? ['ko'] : ['en'];

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
  // ── 스플래시 화면 상태 ──────────────────────────────────────────────────
  // 앱 시작 시 한 번만 true, 스플래시가 끝나면 false로 바뀌어 메인 화면이 나타납니다.
  const [showSplash, setShowSplash] = useState(true);
  // useCallback: SplashScreen에 넘겨줄 onFinish 함수가 매 렌더링마다 새로 생성되지 않도록 최적화
  const handleSplashFinish = useCallback(() => setShowSplash(false), []);

  const {
    user, profile, updateUserProfile,
    tier, trialCardCount, savedCardCount, trialPronCount,
    TRIAL_CARD_LIMIT, TRIAL_PRON_LIMIT,
    isTrialSavedCardLimitReached,
    incrementTrialCard, incrementSavedCard,
    byokGeminiKey,
  } = useAuth();
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [showLanding, setShowLanding] = useState(true);

  // [신규] 온보딩 팝업 표시 여부
  const [showOnboarding, setShowOnboarding] = useState(false);

  // [신규] 인앱 브라우저 안내 팝업
  const [showInAppWarning, setShowInAppWarning] = useState(false);

  // Trial 한도 도달 모달 / BYOK API 키 설정 마법사
  const [showTrialLimitModal, setShowTrialLimitModal] = useState(false);
  const [showApiKeyWizard, setShowApiKeyWizard] = useState(false);
  const [trialCardCurrentCount, setTrialCardCurrentCount] = useState(0);

  // 업그레이드 모달
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // TossPayments 빌링 성공 후 URL 파라미터 처리
  const [paymentToast, setPaymentToast] = useState(''); // 'success' | 'fail' | ''
  const SERVER_URL_FOR_BILLING = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    const authKey = params.get('authKey');
    const customerKey = params.get('customerKey');
    const tier = params.get('tier');
    const email = params.get('email');

    if (billing === 'success' && authKey && customerKey && tier) {
      window.history.replaceState({}, '', window.location.pathname);
      fetch(`${SERVER_URL_FOR_BILLING}/api/toss-confirm-billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey, customerKey, tier, userEmail: email ? decodeURIComponent(email) : '' }),
      })
        .then(r => r.json())
        .then(data => {
          setPaymentToast(data.success ? 'success' : 'fail');
          setTimeout(() => setPaymentToast(''), 4000);
        })
        .catch(() => { setPaymentToast('fail'); setTimeout(() => setPaymentToast(''), 4000); });
    } else if (billing === 'fail') {
      window.history.replaceState({}, '', window.location.pathname);
      setPaymentToast('fail');
      setTimeout(() => setPaymentToast(''), 3000);
    }
  }, []);

  // ── PWA 홈 화면 설치 유도 배너 상태 ──────────────────────────────────────
  // deferredPrompt: 브라우저가 "설치 가능" 이벤트를 던져주면 여기에 보관해둡니다.
  //   나중에 사용자가 [설치] 버튼을 눌렀을 때 이것을 실행해서 팝업을 띄웁니다.
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  // showInstallBanner: 배너를 화면에 보여줄지 여부
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // [신규] 닉네임 등 프로필 수정 모달 상태
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileFormData, setProfileFormData] = useState({
    nickname: '',
    phone: '',
    address: ''
  });

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
  const [viewMode, setViewMode] = useState('voa');

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
      const detected = detectBrowserSourceLang();
      return (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) ? saved : detected;
    } catch (e) {
      return detectBrowserSourceLang();
    }
  });

  // [신규] 실제로 입력하는 텍스트의 언어 (기본은 sourceLang과 동일)
  const [inputLang, setInputLang] = useState(() => {
    try {
      const saved = localStorage.getItem('inputLang');
      const detected = detectBrowserSourceLang();
      return (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) ? saved : detected;
    } catch (e) {
      return detectBrowserSourceLang();
    }
  });

  // 번역해서 보고 싶은 언어들 (도착어, 최대 3개)
  const [targetLangs, setTargetLangs] = useState(() => {
    try {
      const saved = localStorage.getItem('targetLangs');
      if (!saved) return getDefaultTargetLangs(detectBrowserSourceLang());
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return getDefaultTargetLangs(detectBrowserSourceLang());
      // 지원되는 언어 코드만 필터링해서 가져옵니다.
      return parsed.filter(code => SUPPORTED_LANGUAGES.some(l => l.code === code));
    } catch (e) {
      return getDefaultTargetLangs(detectBrowserSourceLang());
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

  // --- 보관함 저장 상태 ---
  const [savedLangCodes, setSavedLangCodes] = useState(new Set()); // 현재 번역에서 저장된 langCode들
  const [practiceResults, setPracticeResults] = useState({}); // [신규] 발음 연습 기록 상태

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

  // ── PWA 설치 이벤트 감지 ──────────────────────────────────────────────────
  // 브라우저가 앱 설치가 가능하다고 판단하면 'beforeinstallprompt' 이벤트를 발생시킵니다.
  // 우리는 이 이벤트를 가로채서 저장해두었다가, 사용자가 [설치] 버튼을 눌렀을 때 실행합니다.
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault(); // 브라우저 기본 팝업은 막고
      setDeferredPrompt(e); // 이벤트 객체를 보관
      setShowInstallBanner(true); // 우리 배너를 표시
    };

    // 이미 설치된 경우에는 배너를 숨깁니다
    const handleAppInstalled = () => {
      setShowInstallBanner(false);
      setDeferredPrompt(null);
      console.log('[PWA] 앱이 설치되었습니다!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    // 컴포넌트가 사라질 때 이벤트 리스너를 정리합니다 (메모리 누수 방지)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // [설치] 버튼을 눌렀을 때 실행
  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      // iOS Safari: 브라우저 공유 메뉴 안내
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS) {
        alert('홈 화면에 추가하려면:\n하단 공유 버튼(□↑) → "홈 화면에 추가"를 선택하세요.');
      }
      return;
    }
    deferredPrompt.prompt(); // 브라우저 설치 팝업 실행
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] 사용자 선택:', outcome); // 'accepted' or 'dismissed'
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  };


  // 1. 브라우저의 TTS(음성 합성 엔진)를 미리 깨워서 첫 재생 지연 방지
  // 2. 백엔드 서버(Render)에 "Ping"을 보내 잠들어 있던 서버를 깨워서 첫 분석 지연 방지
  useEffect(() => {
    // 1. TTS 예열
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }

    // 2. 백엔드 서버 예열 (Cold Start 방지)
    const wakeupServer = async () => {
      try {
        let apiUrl = 'http://localhost:5000'; // 기본값 (로컬 환경)
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) {
          apiUrl = import.meta.env.VITE_API_URL; // Vercel 배포 환경
        } else if (typeof window !== 'undefined') {
          apiUrl = `http://${window.location.hostname}:5000`; // 모바일 로컬 테스트 환경
        }

        // 아무것도 기대하지 않고 가볍게 "똑똑" 문만 두드리는 요청입니다.
        await axios.get(`${apiUrl}/ping`);
        console.log("백엔드 서버 예열(Warm-up) 완료! 🚀");
      } catch (err) {
        console.log("백엔드 서버 예열 중 (서버가 아직 준비 중이거나 로컬입니다).");
      }
    };

    wakeupServer();
  }, []);

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
  }, [inputText, sourceLang, inputLang, inputType, targetLangs, translations, learningTips, pronunciations, languageGoals]);

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

  // 온보딩 표시 여부 — Firestore + localStorage 동시 확인 (단일 effect)
  // profile이 업데이트될 때마다 실행되지만, 이미 "본 적 있음" 기록이 있으면 절대 팝업 재표시 안 함
  useEffect(() => {
    if (!user || !profile) return;
    const hasSeen = localStorage.getItem(`hasSeenOnboarding_${user.uid}`);
    // 둘 중 하나라도 완료 기록이 있으면 팝업 없음
    if (hasSeen || profile.hasCompletedOnboarding === true) {
      // Firestore는 완료됐는데 localStorage가 없으면 동기화해 두기
      if (!hasSeen) localStorage.setItem(`hasSeenOnboarding_${user.uid}`, 'true');
      return;
    }
    // 두 곳 모두 기록 없음 → 최초 온보딩
    setViewMode('settings');
    setShowOnboarding(true);
    setTargetLangs(['en']);
  }, [user, profile]);

  // [신규] 온보딩 [확인] 버튼을 눌렀을 때
  const handleCompleteOnboarding = async () => {
    // localStorage도 함께 설정 — Effect 2(localStorage 기반)가 재실행되어도 팝업 재표시 방지
    if (user) localStorage.setItem(`hasSeenOnboarding_${user.uid}`, 'true');
    setShowOnboarding(false);
    try {
      await updateUserProfile({ hasCompletedOnboarding: true });
    } catch (e) {
      console.error("Failed to complete onboarding:", e);
    }
  };

  // [수정] 프로필 수정 모달 열기
  const handleEditProfile = () => {
    // ❗ [Bug 수정] profile이 아직 로딩 중이면 모달을 열지 않습니다.
    //   이전에는 profile이 null일 때 모달을 열면 Google 원본 이름(user.displayName)으로
    //   폼이 채워졌고, 모르고 저장하면 커스텀 닉네임이 덮어씨지는 버그가 발생했습니다.
    if (!profile) {
      alert('Profile is loading. Please try again in a moment.');
      return;
    }
    setProfileFormData({
      // profile이 반드시 존재하는 시점에만 만드니 -> profile.displayName 우선
      nickname: profile.displayName || user?.displayName || 'Google User',
      phone: profile.phoneNumber || '',
      address: profile.address || ''
    });
    setShowProfileModal(true);
  };

  // [신규] 프로필 저장 (setDoc 사용으로 병합 처리됨)
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!profileFormData.nickname.trim()) return;
    try {
      await updateUserProfile({
        displayName: profileFormData.nickname,
        phoneNumber: profileFormData.phone,
        address: profileFormData.address,
        updatedAt: serverTimestamp()
      });
      setShowProfileModal(false);
    } catch (e) {
      alert("Failed to update profile. Please try again.");
    }
  };

  // [수정] 설정 저장 (홈 화면으로 돌아가기) 및 인앱 브라우저 감지 경고 띄우기
  const handleSaveSettings = () => {
    // ❗ [Bug 수정] 언어 설정을 localStorage에 저장합니다.
    //   이전에는 저장을 하지 않아서 로그아웃 후 재접속하면
    //   sourceLang·targetLangs·inputLang이 기본값(한국어+영어)으로 초기화됐습니다.
    try {
      localStorage.setItem('sourceLang', sourceLang);
      localStorage.setItem('inputLang', inputLang);
      localStorage.setItem('targetLangs', JSON.stringify(targetLangs));
      localStorage.setItem('languageGoals', JSON.stringify(languageGoals));
    } catch (e) {
      console.warn('언어 설정 로컬 저장 실패:', e);
    }

    // 1. 접속한 브라우저의 고유 서명(User Agent) 확인
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    // 카카오톡, 인스타그램, 네이버, 라인, 페이스북 등의 키워드 감지
    const isAppBrowser = /KAKAOTALK|Instagram|NAVER|Line|FBAN|FBAV/i.test(ua);

    if (isAppBrowser) {
      // 인앱 브라우저인 경우, 사용자에게 친절한 모달 팝업을 띄움 (화면 이동은 하지 않음)
      setShowInAppWarning(true);
    } else {
      // 일반 브라우저인 경우 바로 홈 화면(번역 모드)으로 이동
      setViewMode('translation');
    }
  };

  // --- 3. 비즈니스 로직 (핵심 기능) ---

  // '번역' 버튼을 눌렀을 때 실행되는 메인 함수
  // MyMemory 대신 Gemini가 번역 + 팁 + 발음을 한 번에 처리합니다.
  const handleTranslate = async (retryCount = 0) => {
    if (!inputText.trim()) return;

    setIsTranslating(true);
    setIsGeneratingTips(true);
    setLearningTips({});
    setSavedLangCodes(new Set()); // 새 번역 시 별 저장 상태 초기화
    setPronunciations({});
    setPracticeResults({});

    try {
      const sourceLangName = SUPPORTED_LANGUAGES.find(l => l.code === sourceLang)?.name || sourceLang;
      const inputLangName = SUPPORTED_LANGUAGES.find(l => l.code === inputLang)?.name || inputLang;


      const targetLangNames = targetLangs.map(code =>
        SUPPORTED_LANGUAGES.find(l => l.code === code)?.name || code
      );

      const prompt = `
        You are a professional multilingual translator and language tutor.

        [Context]
        - User's native language: ${sourceLangName}
        - Input text language: ${inputLangName}
        - Source text: "${inputText}"
        - Target languages (in order): ${targetLangNames.join(', ')}

        [Task 1: Translation]
        Translate the source text into each target language. If input matches a target, copy as-is.

        [Task 2: Input Type]
        Classify as "word" (single word/idiom) or "sentence".

        [Task 3: Educational Tips — language rule]
        "tips" is an ordered array matching the target languages above.
        Every string in "tips" MUST be written in ${sourceLangName}.
        Do not use any other language for tips — not English, not French, not Korean.
        Only ${sourceLangName}.
        - sentence type: 2-3 grammar/nuance/usage tips per translation.
        - word type: (1) Meaning & Part of Speech (2) Synonyms/Antonyms (3) Example sentence.

        [Task 4: Pronunciation]
        en: IPA / ja: Hiragana / zh-CN: Pinyin / others: Romanization

        [Output — valid JSON only, no markdown]
        {
          "type": "word" | "sentence",
          "tips": [
            ${targetLangNames.map(name => `["${sourceLangName} tip about ${name} translation", "${sourceLangName} tip 2"]`).join(',\n            ')}
          ],
          "data": {
            ${targetLangs.map(code => `"${code}": { "translation": "...", "pronunciation": "..." }`).join(',\n            ')}
          }
        }
      `;

      const apiKeyToUse = byokGeminiKey || import.meta.env.VITE_GEMINI_API_KEY;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKeyToUse}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );

      if (!response.ok) {
        if (response.status === 429 && retryCount < 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return handleTranslate(retryCount + 1);
        }
        throw new Error(`AI service connection error (${response.status})`);
      }

      const data = await response.json();
      const textResponse = data.candidates[0].content.parts[0].text;
      const jsonString = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(jsonString);

      if (result.type) {
        setInputType(result.type.toLowerCase() === 'word' ? 'W' : 'S');
      }

      const newTranslations = {};
      const newTips = {};
      const newProns = {};
      if (result.data) {
        targetLangs.forEach(langCode => {
          const entry = result.data[langCode];
          if (entry) {
            newTranslations[langCode] = entry.translation || inputText;
            newProns[langCode] = entry.pronunciation;
          }
        });
      }
      // tips 파싱 — 배열 인덱스로 언어코드에 매핑 (키 없음 → 언어 연상 차단)
      if (Array.isArray(result.tips)) {
        targetLangs.forEach((langCode, i) => {
          newTips[langCode] = result.tips[i] || [];
        });
      } else if (result.tips && typeof result.tips === 'object') {
        // 폴백: Gemini가 객체로 응답한 경우 언어코드 키로 시도
        targetLangs.forEach(langCode => {
          newTips[langCode] = result.tips[langCode] || [];
        });
      } else if (result.data) {
        targetLangs.forEach(langCode => {
          if (result.data[langCode]?.tips) newTips[langCode] = result.data[langCode].tips;
        });
      }

      setTranslations(newTranslations);
      setLearningTips(newTips);
      setPronunciations(newProns);
      incrementTrialCard(); // 번역 클릭 누적 (분석용, 모든 tier에서 기록)

    } catch (error) {
      console.error("번역 실패:", error);
      alert("An error occurred during translation. Please try again.");
    } finally {
      setIsTranslating(false);
      setIsGeneratingTips(false);
    }
  };

  // --- 보관함 저장 로직 ---

  // Firebase Firestore에 실제 데이터를 저장하는 공통 함수
  const saveToFirebase = async (langCode) => {
    if (!user) { // userAuthState에서 가져온 user 객체 사용
      alert("Login required to use library.");
      return { status: "error" };
    }

    try {
      // 1. Trial 카드 저장 한도 체크 (누적 저장 횟수 기준 — 삭제해도 카운트 감소 없음)
      if (isTrialSavedCardLimitReached) {
        setTrialCardCurrentCount(savedCardCount);
        setShowTrialLimitModal(true);
        return { status: "trial_limit" };
      }

      // 2. 중복 데이터 검사 쿼리
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
        geminiKeySource: byokGeminiKey ? 'byok' : 'app', // 어떤 Gemini 키로 번역했는지
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "savedCards"), cardData);
      incrementSavedCard(); // 저장 누적 카운터 증가 (Trial 한도 산정용)
      return { status: "success" };
    } catch (error) {
      console.error("저장 중 오류 발생:", error);
      return { status: "error" };
    }
  };

  // 별 버튼 저장 함수
  const handleStarSave = async (langCode) => {
    const result = await saveToFirebase(langCode);
    if (result.status === "success" || result.status === "duplicate") {
      setSavedLangCodes(prev => new Set([...prev, langCode]));
    }
  };

  // 5. VOA 문장을 Library에 저장하는 함수
  const saveVoaCard = async (sentenceText, articleTitle, pronunciationScore = null) => {
    if (!user) { alert(getT(sourceLang, 'voa.loginRequired')); return; }
    if (isTrialSavedCardLimitReached) {
      setTrialCardCurrentCount(savedCardCount);
      setShowTrialLimitModal(true);
      return;
    }
    try {
      await addDoc(collection(db, "savedCards"), {
        userId: user.uid,
        userEmail: user.email,
        sourceText: sentenceText,
        translatedText: sentenceText,
        langCode: 'en',
        language: 'English',
        inputLang: 'en',
        inputType: 'S',
        sourceLang,
        sourceType: 'voa',
        articleTitle,
        learningTip: [],
        pronunciation: '',
        pronunciationScore,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
    } catch (error) {
      console.error("VOA 카드 저장 오류:", error);
    }
  };

  // 6. YouTube(TED) 문장을 Library에 저장하는 함수
  const saveTedCard = async (sentenceText, videoUrl) => {
    if (!user) { alert(getT(sourceLang, 'ted.loginRequired')); return; }
    if (isTrialSavedCardLimitReached) {
      setTrialCardCurrentCount(savedCardCount);
      setShowTrialLimitModal(true);
      return;
    }
    try {
      await addDoc(collection(db, "savedCards"), {
        userId: user.uid,
        userEmail: user.email,
        sourceText: sentenceText,
        translatedText: sentenceText,
        langCode: 'en',
        language: 'English',
        inputLang: 'en',
        inputType: 'S',
        sourceLang,
        sourceType: 'youtube',
        articleTitle: videoUrl,
        learningTip: [],
        pronunciation: '',
        pronunciationScore: null,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
    } catch (error) {
      console.error("YouTube 카드 저장 오류:", error);
    }
  };

  // 7. Scene 카드를 Library에 저장하는 함수
  const saveSceneCard = async ({ sentence, translation, langCode, scene, sceneHint, learningTip, pronunciationScore = null }) => {
    if (!user) { alert(getT(sourceLang, 'scene.loginRequired')); return; }
    if (isTrialSavedCardLimitReached) {
      setTrialCardCurrentCount(savedCardCount);
      setShowTrialLimitModal(true);
      return;
    }
    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
    try {
      await addDoc(collection(db, "savedCards"), {
        userId: user.uid,
        userEmail: user.email,
        sourceText: sceneHint || scene || '',
        translatedText: sentence,
        langCode,
        language: langInfo?.name || langCode,
        inputLang: langCode,
        inputType: 'S',
        sourceLang,
        sourceType: 'scene',
        scene,
        learningTip: learningTip ? [{ type: 'tip', content: learningTip }] : [],
        pronunciation: '',
        pronunciationScore,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
    } catch (error) {
      console.error("Scene 카드 저장 오류:", error);
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

  // (온보딩 effect는 위 단일 effect로 통합됨)

  // 온보딩 모달 [시작하기] 버튼을 누르면 완전히 닫고, 다음부터 안 뜨게 브라우저에 각인시킵니다.
  const handleCloseOnboarding = () => {
    setShowOnboarding(false);
    if (user) {
      localStorage.setItem(`hasSeenOnboarding_${user.uid}`, 'true');
    }
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

  // ── 스플래시 화면: 모든 화면보다 먼저 렌더링됩니다 ──────────────────────
  // 앱이 처음 로드될 때 showSplash가 true이면 스플래시만 보여주고,
  // 2.3초 후 handleSplashFinish 가 호출되어 false로 전환됩니다.
  if (showSplash) return <SplashScreen onFinish={handleSplashFinish} />;

  // ── Legal 페이지는 로그인 여부에 관계없이 항상 접근 가능해야 합니다 ──────────────
  // AdSense 심사관이 로그인 없이도 Privacy Policy / Contact 등을 볼 수 있어야 하기 때문입니다.
  if (viewMode === 'privacy') return <PrivacyPolicyPage onBack={() => setViewMode(user ? 'settings' : 'login-legal')} />;
  if (viewMode === 'terms') return <TermsOfServicePage onBack={() => setViewMode(user ? 'settings' : 'login-legal')} />;
  if (viewMode === 'contact') return <ContactPage onBack={() => setViewMode(user ? 'settings' : 'login-legal')} />;


  // 로그인이 되어있지 않으면 랜딩 → 로그인/회원가입 화면을 보여줍니다.
  if (!user) {
    if (showLanding) {
      return <LandingPage onStart={() => setShowLanding(false)} onInstall={handleInstallClick} showInstall={showInstallBanner} />;
    }
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
        <motion.h1
          className="main-logo-3d"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 1 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.15 }
            }
          }}
        >
          {"PronunFit".split("").map((char, index) => (
            <motion.span
              key={index}
              variants={{
                hidden: { opacity: 0, y: 20, scale: 0.8 },
                visible: { opacity: 1, y: 0, scale: 1 }
              }}
              style={{ display: "inline-block" }}
            >
              {char}
            </motion.span>
          ))}
        </motion.h1>
        {/* 광고: 로고 아래 전체 너비 배너 — slot은 AdSense 심사 통과 후 채우세요 */}
        <AdBanner slot="TODO" style={{ width: '100%', margin: '4px 0 0' }} />
      </header>

      <main className="app-main-content">
        {/* 번역 탭 */}
        <div style={{ display: viewMode === 'translation' ? 'block' : 'none', width: '100%' }}>
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
                    onSave={() => handleStarSave(langCode)}
                    isSaved={savedLangCodes.has(langCode)}
                    onPracticeResult={handlePracticeResult}
                    onTrialLimitReached={() => setShowTrialLimitModal(true)}
                    targetGoal={languageGoals[langCode] || 80}
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
            {/* 광고: 번역 결과 카드 아래 — slot은 AdSense 심사 통과 후 채우세요 */}
            <AdBanner slot="TODO" style={{ margin: '12px 0 4px' }} />
          </>
        </div>

        {/* VOA 탭 — 항상 마운트 유지 (탭 전환 시 기사 재로딩 방지) */}
        <div style={{ display: viewMode === 'voa' ? 'block' : 'none', width: '100%' }}>
          <VoaReader
            sourceLang={sourceLang}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
            onSaveToLibrary={saveVoaCard}
          />
        </div>

        {/* YouTube(TED) 탭 */}
        <div style={{ display: viewMode === 'ted' ? 'block' : 'none', width: '100%', height: '100%' }}>
          <TedReader
            sourceLang={sourceLang}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
            onSaveToLibrary={saveTedCard}
          />
        </div>

        {/* Scene 탭 */}
        <div style={{ display: viewMode === 'scene' ? 'block' : 'none', width: '100%' }}>
          <ScenePractice
            sourceLang={sourceLang}
            targetLangs={targetLangs}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
            onSaveToLibrary={saveSceneCard}
            onSpeak={handleSpeak}
          />
        </div>

        {/* Library 탭 */}
        <div style={{ display: viewMode === 'library' ? 'block' : 'none', width: '100%' }}>
          {/* 광고: 라이브러리 목록 상단 — slot은 AdSense 심사 통과 후 채우세요 */}
          <AdBanner slot="TODO" style={{ margin: '0 0 8px' }} />
          <Library
            user={user}
            sourceLang={sourceLang}
            onSpeak={handleSpeak}
            languageGoals={languageGoals}
          />
        </div>

        {/* Settings 탭 */}
        <div style={{ display: viewMode === 'settings' ? 'block' : 'none', width: '100%' }}>
          <div className="settings-container" style={{ position: 'relative' }}>
            {/* [신규] 온보딩 팝업 */}
            {showOnboarding && (
              <div className="onboarding-overlay" style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(255,255,255,0.95)', zIndex: 9999,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '2rem', borderRadius: '0',
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
                  <p className="user-email" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {profile?.displayName || user?.displayName || 'Google User'}
                    <span onClick={handleEditProfile} style={{ fontSize: '0.8rem', color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' }}>Edit</span>
                  </p>
                  <p className="user-email-secondary">{user.email}</p>
                  <p className="user-status" style={{ textDecoration: 'underline' }}>{{
                    trial: 'Free Trial',
                    byok_free: 'BYOK Free',
                    silver: 'Silver',
                    pro: 'Pro',
                    premium: 'Premium',
                  }[tier] || 'Free Trial'}</p>
                </div>
              </div>
              <button className="logout-btn" onClick={handleLogout}>
                <LogOut size={18} />
                Logout
              </button>
            </div>

            {/* --- [신규] 프로필 수정 모달 (Signup 디자인 적용) --- */}
            <AnimatePresence>
              {showProfileModal && (
                <motion.div
                  className="modal-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowProfileModal(false)}
                  style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
                    padding: '20px' // 화면 작은 폰에서 짤리지 않게 패딩 추가
                  }}
                >
                  <motion.div
                    className="auth-card"
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}
                  >
                    <button
                      onClick={() => setShowProfileModal(false)}
                      style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}
                    >
                      <X size={24} />
                    </button>

                    <div className="auth-header">
                      <div className="auth-icon-circle signup-icon">
                        <User size={24} color="white" />
                      </div>
                      <h2>Edit Profile</h2>
                      <p>Update your information</p>
                    </div>

                    <form onSubmit={handleSaveProfile} className="auth-form">
                      <div className="input-wrapper">
                        <label className="input-label">Email address</label>
                        <div className="input-group">
                          <Mail size={18} className="input-icon" style={{ color: '#cbd5e1' }} />
                          <input
                            type="email"
                            value={user.email || ''}
                            disabled
                            style={{ background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed', borderColor: '#e2e8f0' }}
                          />
                        </div>
                      </div>

                      <div className="input-wrapper">
                        <label className="input-label">Nickname <span className="required-star">*</span></label>
                        <div className="input-group">
                          <User size={18} className="input-icon" />
                          <input
                            type="text"
                            placeholder="Nickname"
                            value={profileFormData.nickname}
                            onChange={(e) => setProfileFormData({ ...profileFormData, nickname: e.target.value })}
                            required
                          />
                        </div>
                      </div>

                      <div className="input-wrapper">
                        <label className="input-label">Phone</label>
                        <div className="input-group">
                          <Phone size={18} className="input-icon" />
                          <input
                            type="tel"
                            placeholder="010-0000-0000"
                            value={profileFormData.phone}
                            onChange={(e) => setProfileFormData({ ...profileFormData, phone: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="input-wrapper">
                        <label className="input-label">Address</label>
                        <div className="input-group">
                          <MapPin size={18} className="input-icon" />
                          <input
                            type="text"
                            placeholder="Seoul, Korea"
                            value={profileFormData.address}
                            onChange={(e) => setProfileFormData({ ...profileFormData, address: e.target.value })}
                          />
                        </div>
                      </div>

                      <button type="submit" className="auth-submit-btn" style={{ marginTop: '10px' }}>
                        Save Changes
                      </button>
                    </form>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

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

            <button className="translate-btn" style={{ alignSelf: 'center' }} onClick={handleSaveSettings}>
              Save Settings & Return
            </button>

            {/* ── API 키 & 플랜 섹션 ───────────────────────────────────────── */}
            <div className="settings-group" style={{ marginTop: '8px' }}>
              <label className="settings-label">
                <Lock size={16} /> {getT(sourceLang, 'settings.apiKeys')} · {getT(sourceLang, 'settings.myTier')}
              </label>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#f8fafc', borderRadius: '12px', padding: '12px 16px'
              }}>
                <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#1e293b' }}>
                  {{
                    trial: `🆓 ${getT(sourceLang, 'settings.tierTrial')} (🃏 ${savedCardCount}/${TRIAL_CARD_LIMIT} · 🎤 ${trialPronCount}/${TRIAL_PRON_LIMIT})`,
                    byok_free: `✅ ${getT(sourceLang, 'settings.tierByokFree')}`,
                    silver: `🥈 ${getT(sourceLang, 'settings.tierSilver')}`,
                    pro: `⭐ ${getT(sourceLang, 'settings.tierPro')}`,
                    premium: `💎 ${getT(sourceLang, 'settings.tierPremium')}`,
                  }[tier] || `🆓 ${getT(sourceLang, 'settings.tierTrial')}`}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(tier === 'trial' || tier === 'byok_free') && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      style={{
                        padding: '8px 14px', background: '#00a884', color: 'white',
                        border: 'none', borderRadius: '8px', fontWeight: 'bold',
                        cursor: 'pointer', fontSize: '0.82rem'
                      }}
                    >
                      ✨ 업그레이드
                    </button>
                  )}
                  <button
                    onClick={() => setShowApiKeyWizard(true)}
                    style={{
                      padding: '8px 14px', background: '#6366f1', color: 'white',
                      border: 'none', borderRadius: '8px', fontWeight: 'bold',
                      cursor: 'pointer', fontSize: '0.82rem'
                    }}
                  >
                    🔑 {getT(sourceLang, 'settings.apiKeys')}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Legal 링크 Footer ──────────────────────────────────────────────
                    AdSense 심사를 위해 Privacy Policy / Terms / Contact 링크가
                    앱 안에서 눈에 잘 띄는 곳에 있어야 합니다.
                    Settings 화면 하단에 항상 표시합니다.
                ──────────────────────────────────────────────────────────────────── */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              paddingTop: '8px',
              borderTop: '1px solid #f1f5f9',
              flexWrap: 'wrap'
            }}>
              {[
                { label: '개인정보처리방침', mode: 'privacy' },
                { label: '이용약관', mode: 'terms' },
                { label: '연락처', mode: 'contact' },
              ].map(({ label, mode }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '0.78rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    padding: '4px 0',
                    textDecoration: 'underline',
                    textDecorationColor: '#cbd5e1'
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* 인앱 브라우저 안내 팝업 — 탭과 무관하게 항상 표시 가능 */}
      {showInAppWarning && (
        <div className="onboarding-overlay" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '20px'
        }}>
          <div style={{
            background: 'white', borderRadius: '20px', padding: '20px',
            width: '100%', maxWidth: '380px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', gap: '15px', maxHeight: '90vh', overflowY: 'auto'
          }}>
            <style>{`
              @keyframes pulse-yellow { 0% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(234, 179, 8, 0); } 100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); } }
              @keyframes pulse-red { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'center', color: '#eab308' }}>
              <AlertCircle size={40} />
            </div>
            <h3 style={{ textAlign: 'center', color: '#1e293b', margin: 0 }}>브라우저 변경 안내</h3>
            <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '12px', fontSize: '0.9rem', color: '#334155', lineHeight: '1.5' }}>
              <p style={{ margin: '0 0 10px 0' }}>🎙️ 마이크 기능을 100% 활용하시려면 우측 하단의 [⋮] 버튼 등을 눌러 <b>'다른 브라우저로 열기'(Chrome/Edge/Safari)</b>를 선택해 주세요!</p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>To fully use the microphone, please tap the menu button and select <b>'Open in another browser' (Chrome/Edge/Safari)</b>.</p>
            </div>
            <div style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f1f5f9', display: 'flex', justifyContent: 'center' }}>
              <img src="/kakaotalk_guide.png" alt="Browser Guide" style={{ width: '100%', maxHeight: '50vh', objectFit: 'contain', display: 'block' }} />
            </div>
            <button
              style={{ marginTop: '5px', padding: '12px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' }}
              onClick={() => { setShowInAppWarning(false); setViewMode('translation'); }}
            >
              알겠습니다 (Got it)
            </button>
          </div>
        </div>
      )}

      {/* ── PWA 홈 화면 설치 유도 배너 ──────────────────────────────────────
          showInstallBanner가 true일 때만 네비게이션 바 바로 위에 나타납니다.
          Chrome / Edge 계열 브라우저가 설치 가능 상태라고 판단해야 뜹니다.
          iOS Safari는 이 팝업이 지원되지 않아 자동으로 안 뜹니다.
      ──────────────────────────────────────────────────────────────────── */}
      {showInstallBanner && (
        <div style={{
          position: 'fixed',
          bottom: '80px',   // 하단 네비게이션 바 위에 위치
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)',
          maxWidth: '440px',
          background: 'white',
          borderRadius: '16px',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
          border: '1px solid #e2e8f0',
          zIndex: 999,
        }}>
          {/* 앱 아이콘 미리보기 */}
          <img src="/icon-192.png" alt="PronunFit" style={{ width: 40, height: 40, borderRadius: '10px' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#111827' }}>홈 화면에 추가</div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>PronunFit을 앱처럼 사용하세요!</div>
          </div>
          {/* 설치 버튼 */}
          <button
            onClick={handleInstallClick}
            style={{
              background: '#00a884', color: 'white', border: 'none',
              borderRadius: '10px', padding: '8px 14px',
              fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              flexShrink: 0
            }}
          >설치</button>
          {/* 닫기 버튼 */}
          <button
            onClick={() => setShowInstallBanner(false)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px', flexShrink: 0 }}
          >✕</button>
        </div>
      )}

      {/* 화면 하단에 고정된 메뉴바 (네비게이션) - 아이콘 전용 */}
      <nav className="app-nav">

        <button
          className={`nav-item ${viewMode === 'voa' ? 'active' : ''}`}
          onClick={() => { setViewMode('voa'); }}
          title="VOA News"
        >
          <Newspaper size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'ted' ? 'active' : ''}`}
          onClick={() => { setViewMode('ted'); }}
          title="YouTube Practice"
        >
          <Youtube size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'scene' ? 'active' : ''}`}
          onClick={() => { setViewMode('scene'); }}
          title="Scene Practice"
        >
          <MapPin size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'translation' ? 'active' : ''}`}
          onClick={() => { setViewMode('translation'); }}
          title="Language Card"
        >
          <Languages size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'library' ? 'active' : ''}`}
          onClick={() => { setViewMode('library'); }}
          title="Library"
        >
          <Sparkles size={32} />
        </button>
        <button
          className={`nav-item ${viewMode === 'settings' ? 'active' : ''}`}
          onClick={() => { setViewMode('settings'); }}
          title="Settings"
        >
          <SettingsIcon size={32} />
        </button>
      </nav>

      {/* 🚀 [신규] 온보딩 안내 모달 */}
      <OnboardingModal
        isOpen={showOnboarding}
        onClose={handleCloseOnboarding}
      />

      {/* Trial 한도 도달 모달 */}
      {showTrialLimitModal && (
        <TrialLimitModal
          sourceLang={sourceLang}
          cardCount={trialCardCurrentCount}
          onClose={() => setShowTrialLimitModal(false)}
          onSetupByok={() => { setShowTrialLimitModal(false); setShowApiKeyWizard(true); }}
        />
      )}

      {/* BYOK API 키 설정 마법사 */}
      {showApiKeyWizard && (
        <ApiKeySetupWizard
          sourceLang={sourceLang}
          onClose={() => setShowApiKeyWizard(false)}
          onComplete={() => setShowApiKeyWizard(false)}
        />
      )}

      {/* 업그레이드 모달 */}
      {showUpgradeModal && (
        <UpgradeModal
          sourceLang={sourceLang}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}

      {/* Stripe 결제 결과 토스트 */}
      {paymentToast && (
        <div style={{
          position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
          background: paymentToast === 'success' ? '#00a884' : '#64748b',
          color: 'white', padding: '12px 24px', borderRadius: '20px',
          fontWeight: '700', fontSize: '0.9rem', zIndex: 3000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)', whiteSpace: 'nowrap'
        }}>
          {paymentToast === 'success' ? '🎉 결제가 완료되었습니다! 플랜이 업그레이드됩니다.' : '결제에 실패하거나 취소되었습니다.'}
        </div>
      )}
    </div>
  );
}

export default App;
