import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Languages, Sparkles, Settings as SettingsIcon, ArrowLeft, CheckCircle2, LogOut, User, AlertCircle, MoreHorizontal, Mail, Phone, MapPin, X, Lock, Youtube, Volume2, BookOpen, BarChart3 } from 'lucide-react';
// [중요] 새 아이콘은 별도 import — 기존 라인 수정 시 Rollup 번들 순서 변경으로 TDZ 오류 발생
import { Menu, HelpCircle, ChevronDown, ChevronRight, ShieldCheck, Home, CreditCard } from 'lucide-react';
import { Camera } from 'lucide-react'; // [신규] 카메라 OCR 버튼 아이콘
import { motion, AnimatePresence } from 'framer-motion';
import TranslationCard from './components/TranslationCard';
import { Analytics } from '@vercel/analytics/react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import './App.css';
import './components/Auth/Auth.css'; // [추가] 모달창 디자인을 위해 Auth.css 활용
import { geminiUrl } from './config/gemini';

// Firebase & Auth
import { auth, db, RecaptchaVerifier } from './firebase/config';
import { PhoneAuthProvider } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, getDocs, getDocsFromServer, where } from 'firebase/firestore';
// ↑ [버그 수정] where 추가: saveToFirebase 함수에서 중복 데이터 검사에 `where`를 사용하는데
//   import 목록에서 빠져있어서 "where is not defined" 런타임 에러가 발생, 카드 저장이 안 됐습니다.
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut, signInAnonymously, signInWithPopup, signInWithCredential, GoogleAuthProvider as FirebaseGoogleAuthProvider, getAdditionalUserInfo, sendEmailVerification, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { googleProvider } from './firebase/config';
import { setDoc, getDoc, doc } from 'firebase/firestore';
import { useAuth, setAccountDeletionFlag } from './context/AuthContext';
import Login from './components/Auth/Login';
import Library from './components/Library'; // [신규] 보관함 컴포넌트
import Signup from './components/Auth/Signup';
import { getT } from './utils/i18n';
import axios from 'axios'; // [신규] 백엔드 예열 통신을 위한 라이브러리 추가
import { authFetch, getIdToken } from './utils/authFetch';

// [신규] 첫 사용자 환영(온보딩) 화면 모달 컴포넌트 불러오기
import TrialLimitModal from './components/TrialLimitModal';
import ApiKeySetupWizard from './components/ApiKeySetupWizard';
import UpgradeModal from './components/UpgradeModal';
import AccountUpgradeModal from './components/AccountUpgradeModal';
import ConfirmModal from './components/ConfirmModal';
import VideoReader from './components/VideoReader';
import VocabTab from './components/VocabTab';
import ScenePractice from './components/ScenePractice';
import DailyProgressPopup from './components/DailyProgressPopup';
import HomePage from './components/HomePage';
import OnboardingModal from './components/OnboardingModal';
import RenewalReminderPopup from './components/RenewalReminderPopup';
import StatsPage from './components/StatsPage';
import BookmarkPromptModal from './components/BookmarkPromptModal';
import { useDailyProgress, getToday } from './hooks/useDailyProgress';
import { useAdMob, AD_UNITS, IS_TESTING } from './hooks/useAdMob';
import AppGuide from './components/AppGuide';
import TabTutorial, { TAB_TUTORIALS } from './components/TabTutorial';
import LandingPage from './components/LandingPage';
import AdBanner from './components/AdBanner';
import CameraOCRModal from './components/CameraOCRModal'; // [신규] 카메라 OCR 모달
import { COUNTRY_PHONES, formatPhoneByCountry, getCountryByLang } from './utils/phoneFormat';
import { playSuccessSound } from './utils/soundEffects';

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
  { code: 'ru', name: 'Русский', tts: 'ru-RU', color: '#f1f5f9', textColor: '#475569' },
  { code: 'pt-BR', name: 'Português', tts: 'pt-BR', color: '#f1f5f9', textColor: '#475569' },
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
  es: 'Spanish',
  ru: 'Russian',
  'pt-BR': 'Portuguese'
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
    proPronCount, PRO_PRON_LIMIT,
    TRIAL_DAILY_CARD_LIMIT, TRIAL_DAILY_PRON_LIMIT,
    isTrialSavedCardLimitReached,
    setDailyTrialCardReached, setDailyTrialPronReached,
    incrementTrialCard, incrementSavedCard,
    incrementSceneGenerate, incrementVocabGenerate,
    byokGeminiKey, byokAzureKey, byokAzureRegion,
  } = useAuth();
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [showLanding, setShowLanding] = useState(true);
  const [showAccountUpgrade, setShowAccountUpgrade] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAnonSignupPrompt, setShowAnonSignupPrompt] = useState(false);
  // 로그인 성공 시 모달 자동 닫기
  useEffect(() => {
    if (showLoginModal && user && !user.isAnonymous) setShowLoginModal(false);
  }, [user, showLoginModal]);

  // anonymous 유저: 날짜 바뀐 첫 방문 시 사이드바 + 가입 유도 팝업 자동 표시
  useEffect(() => {
    if (!user?.isAnonymous) return;
    const today = new Date().toISOString().slice(0, 10);
    const lastShown = localStorage.getItem('anonSignupPromptDate');
    if (lastShown === today) return;
    // 최초 방문(lastShown 없음): 오늘 날짜만 기록하고 팝업 생략 (다음날부터 표시)
    if (!lastShown) {
      localStorage.setItem('anonSignupPromptDate', today);
      return;
    }
    // 날짜 바뀐 재방문 → 잠시 후 사이드바 열고 팝업
    const t = setTimeout(() => {
      localStorage.setItem('anonSignupPromptDate', today);
      setSidebarOpen(true);
      setShowAnonSignupPrompt(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [user?.uid]);

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
    const tierParam = params.get('tier');
    const planId = params.get('planId');
    const months = params.get('months');
    const email = params.get('email');
    const currency = params.get('currency') || 'KRW';

    if (billing === 'success' && authKey && customerKey && tierParam) {
      window.history.replaceState({}, '', window.location.pathname);
      authFetch(`${SERVER_URL_FOR_BILLING}/api/toss-confirm-billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey, customerKey, tier: tierParam, planId: planId || tierParam, months: parseInt(months) || 1, userEmail: email ? decodeURIComponent(email) : '', currency }),
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
    phoneCountry: 'KR'
  });
  // 이메일 인증 & 비밀번호 변경 상태
  const [emailVerifSent, setEmailVerifSent] = useState(false);
  const [pwChangeMode, setPwChangeMode] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState({ type: '', text: '' });
  // 전화번호 SMS 인증 상태
  const [phoneVerifStep, setPhoneVerifStep] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'verifying' | 'verified'
  const [phoneVerifCode, setPhoneVerifCode] = useState('');
  const [phoneVerifMsg, setPhoneVerifMsg] = useState({ type: '', text: '' });
  const [phoneConfirmResult, setPhoneConfirmResult] = useState(null);
  const recaptchaContainerRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  // 언어별 목표 점수를 저장하는 상태 (기본값 80점)
  const [languageGoals, setLanguageGoals] = useState(() => {
    try {
      const saved = localStorage.getItem('languageGoals');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // 하루 학습 목표 카드 수 (기본 10장)
  const [dailyGoal, setDailyGoal] = useState(() => {
    try { return parseInt(localStorage.getItem('dailyGoal') || '10', 10); }
    catch (e) { return 10; }
  });

  // Daily progress hook
  const { todayCount, todaySaveCount, todayPronCount, weeklyData, incrementAchievement, incrementDailySave, incrementDailyPron } = useDailyProgress(user, dailyGoal);

  // AdMob 배너 광고 (Android 전용)
  useAdMob();

  // ── 보상형 광고 보너스 (Trial 전용, 하루 단위 localStorage) ──────────────
  const getBonusForToday = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(`rewardBonus_${getToday()}`) || '{}');
      return { cards: stored.cards || 0, prons: stored.prons || 0 };
    } catch { return { cards: 0, prons: 0 }; }
  };
  const [rewardBonus, setRewardBonus] = useState(getBonusForToday);
  const [rewardAdLoading, setRewardAdLoading] = useState(false);

  const handleRewardedAd = async (type) => {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    setRewardAdLoading(true);
    const handles = [];
    try {
      const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob');
      const adId = type === 'cards' ? AD_UNITS.rewardedCards : AD_UNITS.rewardedProns;

      await new Promise(async (resolve, reject) => {
        // 리스너를 prepare 전에 먼저 등록
        handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, (reward) => {
          const amount = reward?.amount ?? (type === 'cards' ? 5 : 10);
          const today = getToday();
          const prev = getBonusForToday();
          const next = { ...prev };
          if (type === 'cards') next.cards += amount;
          else next.prons += amount;
          localStorage.setItem(`rewardBonus_${today}`, JSON.stringify(next));
          setRewardBonus(next);
          resolve();
        }));
        handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => resolve()));
        handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToLoad, (e) =>
          reject(new Error(`로드 실패: ${JSON.stringify(e)}`))));
        handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, (e) =>
          reject(new Error(`표시 실패: ${JSON.stringify(e)}`))));

        try {
          await AdMob.prepareRewardVideoAd({ adId, isTesting: IS_TESTING });
          setRewardAdLoading(false); // 로드 완료 → 로딩 표시 끔
          await AdMob.showRewardVideoAd();
        } catch (e) { reject(e); }
      });
    } catch (e) {
      console.error('[RewardedAd] 실패:', e);
      alert(`광고 오류: ${e.message}`);
    } finally {
      setRewardAdLoading(false);
      handles.forEach(h => h?.remove?.());
    }
  };

  // Trial 일간 제한 동기화 (보너스 반영)
  useEffect(() => {
    if (tier === 'trial') {
      setDailyTrialCardReached(todaySaveCount >= TRIAL_DAILY_CARD_LIMIT + rewardBonus.cards);
      setDailyTrialPronReached(todayPronCount >= TRIAL_DAILY_PRON_LIMIT + rewardBonus.prons);
    } else {
      setDailyTrialCardReached(false);
      setDailyTrialPronReached(false);
    }
  }, [tier, todayCount, todaySaveCount, todayPronCount, rewardBonus, TRIAL_DAILY_CARD_LIMIT, TRIAL_DAILY_PRON_LIMIT, setDailyTrialCardReached, setDailyTrialPronReached]);

  // 발음 목표 달성 팝업 상태
  const [showProgressPopup, setShowProgressPopup] = useState(false);

  // 북마크 유도 팝업 상태 (비Library 탭에서 목표 달성 시)
  const [bookmarkPrompt, setBookmarkPrompt] = useState(null); // { score, saveFn }

  // Translation 탭 — 저장 완료된 카드의 docId (langCode → docId)
  const [savedCardIds, setSavedCardIds] = useState({});

  // Library 전용 — 직접 카운트
  const handleTargetAchieved = async (key) => {
    const wasNew = await incrementAchievement(key);
    if (wasNew) setShowProgressPopup(true);
  };

  // 비Library 탭에서 목표 달성 시 — 북마크 안내 팝업 표시 + 음향효과
  const handleBookmarkPrompt = useCallback((score) => {
    playSuccessSound(); // 소리는 항상 재생
    if (localStorage.getItem('hideBookmarkPrompt') === 'true') return;
    setBookmarkPrompt({ score });
  }, []);

  // --- 1. 상태 관리 (State Management) ---
  // 이 부분은 앱이 돌아가는 동안 변하는 데이터(글자, 언어 설정 등)를 저장하는 바구니입니다.

  // 현재 화면 모드 — 기본 홈은 'home', URL 경로에 따라 초기 모드 설정
  const [viewMode, setViewMode] = useState(() => {
    const path = window.location.pathname;
    // legal 페이지는 비로그인 랜딩에서만 URL로 진입 허용
    // 로그인 후 새로고침 시에는 홈으로 리다이렉트
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    if (path === '/contact') return 'contact';
    return 'home';
  });

  // 새로고침 시 /privacy, /terms, /contact URL로 직접 진입한 로그인 사용자만 홈으로 리다이렉트
  const [initialRedirectDone, setInitialRedirectDone] = useState(false);
  useEffect(() => {
    if (initialRedirectDone) return;
    if (user && ['/privacy', '/terms', '/contact'].includes(window.location.pathname)) {
      window.history.replaceState({}, '', '/');
      setViewMode('home');
    }
    if (user !== undefined) setInitialRedirectDone(true);
  }, [user, initialRedirectDone]);
  const [focusCardId, setFocusCardId] = useState(null);
  const [libraryBackTo, setLibraryBackTo] = useState(null);
  const [dictBackTo, setDictBackTo] = useState(null); // Scene/Vocab → 사전 이동 시 원래 탭 기억

  // ── 앱 버전 / Capgo 번들 버전 / 업데이트 상태 ──
  const [appVersion, setAppVersion] = useState('');      // 네이티브 versionName
  const [bundleVersion, setBundleVersion] = useState(''); // Capgo OTA 버전 (있을 때만)
  const [updateStatus, setUpdateStatus] = useState('');
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // 네이티브 앱 버전 (build.gradle versionName)
    CapacitorApp.getInfo().then(info => {
      setAppVersion(info.version);
    }).catch(() => { });
    // Capgo OTA 번들 버전 (builtin이 아닐 때만 표시)
    CapacitorUpdater.current().then(info => {
      const v = info?.bundle?.version;
      if (v && v !== 'builtin') setBundleVersion(v);
    }).catch(() => { });
    // 이벤트 리스너
    CapacitorUpdater.addListener('updateAvailable', (res) => {
      setUpdateStatus(`⬇️ 다운로드 중... v${res.bundle.version}`);
    });
    CapacitorUpdater.addListener('downloadComplete', (res) => {
      setUpdateStatus(`✅ 완료 v${res.bundle.version} — 재시작 시 적용`);
    });
    CapacitorUpdater.addListener('downloadFailed', (res) => {
      setUpdateStatus(`❌ 실패: ${JSON.stringify(res)}`);
    });
    CapacitorUpdater.addListener('noNeedUpdate', () => {
      setUpdateStatus('');
    });
    // 채널 등록 (빌드 타임에 결정: staging or production)
    CapacitorUpdater.setChannel({ channel: __CAPGO_CHANNEL__ }).catch(() => { });
  }, []);

  // ── 모바일 Back 키 → 종료 토스트 (두 번 누르면 종료) ──
  const [showExitToast, setShowExitToast] = useState(false);
  const exitTimerRef = useRef(null);
  const showExitToastRef = useRef(false); // stale closure 방지용

  // 좌측 드로어(햄버거 메뉴) 상태 — useEffect보다 앞에 선언 (TDZ 방지)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [qaMenuOpen, setQaMenuOpen] = useState(false); // Q&A 서브메뉴 펼침 상태

  // showExitToast 변경 시 ref 동기화
  React.useEffect(() => {
    showExitToastRef.current = showExitToast;
  }, [showExitToast]);

  // ── 안드로이드 Back 키용 viewMode 히스토리 스택 ──
  const viewModeHistoryRef = useRef(['home']);
  const isNavigatingBackRef = useRef(false);

  // viewMode가 바뀔 때마다 히스토리에 push (뒤로가기로 인한 변경은 제외)
  React.useEffect(() => {
    if (isNavigatingBackRef.current) {
      isNavigatingBackRef.current = false;
      return;
    }
    const history = viewModeHistoryRef.current;
    if (viewMode !== history[history.length - 1]) {
      viewModeHistoryRef.current = [...history, viewMode];
    }
  }, [viewMode]);

  React.useEffect(() => {
    // 1. Web 브라우저용 뒤로 가기 처리 (기존 유지)
    const webHandler = () => {
      setShowExitToast(true);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => setShowExitToast(false), 2000);
    };
    window.addEventListener('app-back-pressed', webHandler);

    // 2. 안드로이드 (Capacitor) 하드웨어 기기 뒤로 가기 처리
    let nativeListener = null;
    if (Capacitor.isNativePlatform()) {
      nativeListener = CapacitorApp.addListener('backButton', () => {
        // 사이드바 열려있으면 먼저 닫기
        if (sidebarOpen) {
          setSidebarOpen(false);
          return;
        }

        // viewMode 히스토리 스택에서 이전 화면으로 이동
        const history = viewModeHistoryRef.current;
        if (history.length > 1) {
          const newHistory = history.slice(0, -1);
          viewModeHistoryRef.current = newHistory;
          isNavigatingBackRef.current = true;
          setViewMode(newHistory[newHistory.length - 1]);
        } else {
          // 루트(홈)일 때: 한 번 더 누르면 앱 종료
          if (showExitToastRef.current) {
            CapacitorApp.exitApp();
          } else {
            setShowExitToast(true);
            showExitToastRef.current = true;
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
            exitTimerRef.current = setTimeout(() => {
              setShowExitToast(false);
              showExitToastRef.current = false;
            }, 2000);
          }
        }
      });
    }

    return () => {
      window.removeEventListener('app-back-pressed', webHandler);
      if (nativeListener) {
        nativeListener.then(l => l.remove());
      }
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);


  // 탭 이동 또는 사이드바 열기 시 종료 토스트 즉시 해제
  React.useEffect(() => {
    if (showExitToast) {
      setShowExitToast(false);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, sidebarOpen]);

  // 로그인 시 사이드바 닫기 (이전 상태 잔류 방지)
  React.useEffect(() => {
    if (user) setSidebarOpen(false);
  }, [user]);

  // 첫 방문 탭 튜토리얼 상태
  const [tutorialTab, setTutorialTab] = useState(null);
  const [tutorialStep, setTutorialStep] = useState(0);

  // viewMode 변경 시 첫 방문이면 튜토리얼 표시
  React.useEffect(() => {
    if (!TAB_TUTORIALS[viewMode]) return;
    const key = `pronunfit_tutorial_${viewMode}`;
    if (!localStorage.getItem(key)) {
      const timer = setTimeout(() => {
        setTutorialTab(viewMode);
        setTutorialStep(0);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [viewMode]);

  const handleTutorialNext = () => {
    const total = TAB_TUTORIALS[tutorialTab]?.length || 2;
    if (tutorialStep < total - 1) {
      setTutorialStep(tutorialStep + 1);
    } else {
      localStorage.setItem(`pronunfit_tutorial_${tutorialTab}`, 'seen');
      setTutorialTab(null);
      setTutorialStep(0);
    }
  };

  const handleTutorialSkip = () => {
    localStorage.setItem(`pronunfit_tutorial_${tutorialTab}`, 'seen');
    setTutorialTab(null);
    setTutorialStep(0);
  };

  // 스와이프로 탭 이동 — 메인 탭 순서
  const TAB_ORDER = ['home', 'scene', 'vocab', 'translation', 'library', 'video', 'stats'];
  const swipeStartX = React.useRef(null);
  const swipeStartY = React.useRef(null);

  const handleTouchStart = useCallback((e) => {
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    const dy = e.changedTouches[0].clientY - swipeStartY.current;
    swipeStartX.current = null;
    swipeStartY.current = null;
    // 수평 이동이 수직보다 크고 60px 이상일 때만 탭 전환
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (sidebarOpen) return; // 드로어 열린 상태에서는 무시
    const cur = TAB_ORDER.indexOf(viewMode);
    if (cur === -1) return;
    if (dx < 0 && cur < TAB_ORDER.length - 1) setViewMode(TAB_ORDER[cur + 1]); // 왼쪽 스와이프 → 다음
    if (dx > 0 && cur > 0) setViewMode(TAB_ORDER[cur - 1]);                     // 오른쪽 스와이프 → 이전
  }, [viewMode, sidebarOpen]);

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

  // Library에서 카드 삭제 시 현재 세션의 savedLangCodes/savedCardIds 초기화
  const handleCardDeleted = useCallback((langCode, sourceText) => {
    if (sourceText === inputText) {
      setSavedLangCodes(prev => {
        const next = new Set(prev);
        next.delete(langCode);
        return next;
      });
      setSavedCardIds(prev => {
        const next = { ...prev };
        delete next[langCode];
        return next;
      });
    }
  }, [inputText]);

  // --- 보관함 저장 상태 ---
  const [savedLangCodes, setSavedLangCodes] = useState(new Set()); // 현재 번역에서 저장된 langCode들
  const [practiceResults, setPracticeResults] = useState({}); // [신규] 발음 연습 기록 상태
  const [showCameraModal, setShowCameraModal] = useState(false); // [신규] 카메라 OCR 모달

  // [신규] 현재 번역한 텍스트가 단어(Word)인지 문장(Sentence)인지 판별한 결과 ('W' or 'S')
  const [inputType, setInputType] = useState(() => {
    try {
      return localStorage.getItem('inputType') || 'S';
    } catch (e) {
      return 'S';
    }
  });
  const [translationDifficulty, setTranslationDifficulty] = useState('basic');

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
      localStorage.setItem('dailyGoal', String(dailyGoal)); // [신규] 일일 학습 목표 자동 저장
    } catch (e) {
      console.warn("데이터를 저장하지 못했습니다:", e);
    }
  }, [inputText, sourceLang, inputLang, inputType, targetLangs, translations, learningTips, pronunciations, languageGoals, dailyGoal]);

  // Translation 탭을 벗어나면 inputText를 비워줍니다 (카드 내역은 유지)
  useEffect(() => {
    if (viewMode !== 'translation') {
      setInputText('');
    }
  }, [viewMode]);

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

  // 신규 유저 첫 로그인 시 온보딩 팝업 표시
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!user || !profile) return;
    if (profile.hasCompletedOnboarding === true) return;
    // 이 기기에서 이미 온보딩을 마쳤으면 신규 anonymous여도 다시 묻지 않음
    if (localStorage.getItem('deviceOnboardingDone') === '1') return;
    setShowOnboarding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const handleOnboardingComplete = (src, tgts) => {
    setSourceLang(src);
    setInputLang(src);
    setTargetLangs(tgts);
    localStorage.setItem('sourceLang', src);
    localStorage.setItem('inputLang', src);
    localStorage.setItem('targetLangs', JSON.stringify(tgts));
    localStorage.setItem('deviceOnboardingDone', '1'); // 이 기기에서 온보딩 완료 표시
    setShowOnboarding(false);
    setViewMode('home');
    updateUserProfile({
      hasCompletedOnboarding: true,
      sourceLang: src,
      targetLang: tgts[0] || null,
      targetLangs: tgts,
    }).catch(() => { });
  };

  // [수정] 프로필 수정 모달 열기
  const handleEditProfile = () => {
    // profile이 null이면 user 객체(Firebase Auth)의 정보로 폴백
    const p = profile || {};
    const savedCountry = p.phoneCountry || getCountryByLang(sourceLang);
    const savedPhone = p.phoneNumber || '';
    // Strip country dial code from stored number for display
    const dialPrefix = (COUNTRY_PHONES.find(c => c.code === savedCountry) || COUNTRY_PHONES[0]).dial;
    const localDigits = savedPhone.startsWith(dialPrefix) ? savedPhone.slice(dialPrefix.length) : savedPhone.replace(/\D/g, '');
    setProfileFormData({
      nickname: p.displayName || user?.displayName || 'Google User',
      phone: localDigits ? formatPhoneByCountry(localDigits, savedCountry) : '',
      phoneCountry: savedCountry
    });
    setEmailVerifSent(false);
    setPwChangeMode(false);
    setPwForm({ current: '', newPw: '', confirm: '' });
    setPwMsg({ type: '', text: '' });
    setPhoneVerifStep(profile?.phoneVerified ? 'verified' : 'idle');
    setPhoneVerifCode('');
    setPhoneVerifMsg({ type: '', text: '' });
    setPhoneConfirmResult(null);
    setShowProfileModal(true);
  };

  // 회원탈퇴
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0); // 0: 없음, 1: 1차확인, 2: 2차확인

  const handleDeleteAccount = () => {
    setDeleteConfirmStep(1);
  };

  const executeDeleteAccount = async () => {
    setDeleteConfirmStep(0);
    try {
      setAccountDeletionFlag(true); // onSnapshot 문서 재생성 방지
      const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const res = await authFetch(`${SERVER_URL}/api/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setShowProfileModal(false);
        try { await signOut(auth); } catch { }
        window.location.reload();
      } else {
        setAccountDeletionFlag(false);
        alert(getT(sourceLang, 'auth.deleteFailed'));
      }
    } catch {
      setAccountDeletionFlag(false);
      alert(getT(sourceLang, 'auth.deleteFailed'));
    }
  };

  // [신규] 프로필 저장 (setDoc 사용으로 병합 처리됨)
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!profileFormData.nickname.trim()) return;
    try {
      const rawDigits = profileFormData.phone.replace(/\D/g, '');
      const dialCode = (COUNTRY_PHONES.find(c => c.code === profileFormData.phoneCountry) || COUNTRY_PHONES[0]).dial;
      await updateUserProfile({
        displayName: profileFormData.nickname,
        phoneNumber: rawDigits ? `${dialCode}${rawDigits}` : '',
        phoneCountry: profileFormData.phoneCountry,
        updatedAt: serverTimestamp()
      });
      setShowProfileModal(false);
    } catch (e) {
      alert("Failed to update profile. Please try again.");
    }
  };

  // 전화번호 SMS 인증 발송
  const handleSendPhoneVerification = async () => {
    const rawDigits = profileFormData.phone.replace(/\D/g, '');
    if (!rawDigits) {
      setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneRequired') });
      return;
    }
    const dialCode = (COUNTRY_PHONES.find(c => c.code === profileFormData.phoneCountry) || COUNTRY_PHONES[0]).dial;
    const fullPhone = `${dialCode}${rawDigits}`;

    try {
      setPhoneVerifStep('sending');
      setPhoneVerifMsg({ type: '', text: '' });

      // 중복 번호 체크 (verifiedPhones 컬렉션 — 보안 규칙 독립)
      try {
        const phoneDocRef = doc(db, 'verifiedPhones', fullPhone);
        const phoneDoc = await getDoc(phoneDocRef);
        if (phoneDoc.exists() && phoneDoc.data()?.userId !== user.uid) {
          setPhoneVerifStep('idle');
          setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneDuplicate') });
          return;
        }
      } catch (dupErr) {
        console.error('[PhoneVerif] duplicate check failed:', dupErr);
        setPhoneVerifStep('idle');
        setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneVerifFailed') });
        return;
      }

      // reCAPTCHA 초기화
      if (recaptchaVerifierRef.current) {
        try { recaptchaVerifierRef.current.clear(); } catch (e) { /* ignore */ }
      }
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, recaptchaContainerRef.current, {
        size: 'invisible',
        callback: () => { /* resolved */ }
      });

      const phoneProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneProvider.verifyPhoneNumber(fullPhone, recaptchaVerifierRef.current);
      setPhoneConfirmResult(verificationId);
      setPhoneVerifStep('sent');
      setPhoneVerifMsg({ type: 'success', text: getT(sourceLang, 'auth.phoneCodeSent') });
    } catch (e) {
      console.error('[PhoneVerif] error:', e);
      setPhoneVerifStep('idle');
      if (e.code === 'auth/too-many-requests') {
        setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneTooMany') });
      } else if (e.code === 'auth/invalid-phone-number') {
        setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneInvalid') });
      } else {
        setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneVerifFailed') });
      }
    }
  };

  // SMS 인증 코드 확인
  const handleVerifyPhoneCode = async () => {
    if (!phoneVerifCode.trim() || !phoneConfirmResult) return;
    try {
      setPhoneVerifStep('verifying');
      const credential = PhoneAuthProvider.credential(phoneConfirmResult, phoneVerifCode);

      // 코드 검증: updatePhoneNumber으로 현재 계정에 전화번호 설정
      try {
        const { updatePhoneNumber } = await import('firebase/auth');
        await updatePhoneNumber(auth.currentUser, credential);
      } catch (phoneErr) {
        // 코드 자체가 틀린 경우 → 에러 throw
        if (phoneErr.code === 'auth/invalid-verification-code' || phoneErr.code === 'auth/invalid-verification-id') {
          throw phoneErr;
        }
        // credential-already-in-use, provider-already-linked 등 → 코드는 맞았으나 연결만 실패
        console.log('[PhoneVerif] updatePhoneNumber skipped:', phoneErr.code);
      }

      // 코드 검증 성공 → Firestore에 phoneVerified 저장
      const dialCode = (COUNTRY_PHONES.find(c => c.code === profileFormData.phoneCountry) || COUNTRY_PHONES[0]).dial;
      const rawDigits = profileFormData.phone.replace(/\D/g, '');
      const fullPhoneNum = `${dialCode}${rawDigits}`;
      await updateUserProfile({
        phoneNumber: fullPhoneNum,
        phoneCountry: profileFormData.phoneCountry,
        phoneVerified: true,
        updatedAt: serverTimestamp()
      });
      // verifiedPhones 컬렉션에 중복 체크용 문서 생성
      await setDoc(doc(db, 'verifiedPhones', fullPhoneNum), {
        userId: user.uid,
        verifiedAt: serverTimestamp()
      });
      setPhoneVerifStep('verified');
      setPhoneVerifMsg({ type: 'success', text: getT(sourceLang, 'auth.phoneVerified') });
    } catch (e) {
      console.error('[PhoneVerif] code error:', e.code, e.message);
      setPhoneVerifStep('sent');
      setPhoneVerifMsg({ type: 'error', text: getT(sourceLang, 'auth.phoneCodeWrong') });
    }
  };

  // 이메일 인증 메일 발송
  const handleSendEmailVerification = async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      setEmailVerifSent(true);
    } catch (e) {
      if (e.code === 'auth/too-many-requests') {
        alert(getT(sourceLang, 'auth.verifTooMany'));
      } else {
        alert(getT(sourceLang, 'auth.verifFailed'));
      }
    }
  };

  // 비밀번호 변경
  const handleChangePassword = async () => {
    setPwMsg({ type: '', text: '' });
    if (pwForm.newPw.length < 6) {
      setPwMsg({ type: 'error', text: getT(sourceLang, 'auth.pwMinLength') });
      return;
    }
    if (pwForm.newPw !== pwForm.confirm) {
      setPwMsg({ type: 'error', text: getT(sourceLang, 'auth.pwMismatch') });
      return;
    }
    try {
      const credential = EmailAuthProvider.credential(user.email, pwForm.current);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, pwForm.newPw);
      setPwMsg({ type: 'success', text: getT(sourceLang, 'auth.pwChanged') });
      setPwForm({ current: '', newPw: '', confirm: '' });
      setTimeout(() => setPwChangeMode(false), 1500);
    } catch (e) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setPwMsg({ type: 'error', text: getT(sourceLang, 'auth.pwWrongCurrent') });
      } else {
        setPwMsg({ type: 'error', text: `${getT(sourceLang, 'auth.pwChangeFail')}: ${e.code}` });
      }
    }
  };

  // Google 사용자인지 확인 (비밀번호 변경 UI 숨김용)
  const isGoogleUser = user?.providerData?.[0]?.providerId === 'google.com';

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
      // 일반 브라우저인 경우 홈으로 이동
      setViewMode('home');
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

        [Task 5: Difficulty Classification]
        Classify the source text difficulty as one of: "basic", "intermediate", "high".
        - "basic": simple everyday words/phrases a beginner would learn first
        - "intermediate": natural daily expressions, moderate vocabulary
        - "high": complex structures, idioms, nuanced or specialized language

        [Output — valid JSON only, no markdown]
        {
          "type": "word" | "sentence",
          "difficulty": "basic" | "intermediate" | "high",
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
        geminiUrl(apiKeyToUse),
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
      if (result.difficulty) {
        setTranslationDifficulty(result.difficulty);
      } else {
        setTranslationDifficulty('basic');
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

  // Video 탭에서 메모 전송 시 자동 번역 트리거
  const pendingTranslateRef = useRef(false);
  useEffect(() => {
    if (pendingTranslateRef.current && viewMode === 'translation' && inputText.trim()) {
      pendingTranslateRef.current = false;
      handleTranslate();
    }
  }, [viewMode, inputText]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // isDeleted: true 카드는 중복으로 처리하지 않음 → 삭제 후 재저장 가능하도록
      const activeDocs = querySnapshot.docs.filter(d => !d.data().isDeleted);
      if (activeDocs.length > 0) {
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
        sourceType: 'translation',
        difficulty: translationDifficulty,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, "savedCards"), cardData);
      incrementSavedCard(); // 저장 누적 카운터 증가 (Trial 한도 산정용)
      return { status: "success", id: docRef.id };
    } catch (error) {
      console.error("저장 중 오류 발생:", error);
      return { status: "error" };
    }
  };

  // 별 버튼 저장 함수 — 저장 성공 시 목표 달성 점수면 daily progress 카운트
  const handleStarSave = async (langCode) => {
    const result = await saveToFirebase(langCode);
    if (result.status === "success") {
      setSavedLangCodes(prev => new Set([...prev, langCode]));
      setSavedCardIds(prev => ({ ...prev, [langCode]: result.id }));
      incrementDailySave();
      // Library로 이동하여 저장된 카드 포커스
      if (result.id) {
        setFocusCardId(result.id);
        setLibraryBackTo('translation');
        setViewMode('library');
      }
    } else if (result.status === "duplicate") {
      setSavedLangCodes(prev => new Set([...prev, langCode]));
    }
  };

  // 5. Video 탭 문장을 Library에 저장하는 함수 (다국어 지원)
  const saveVideoCard = async (sentenceText, videoTitle, langCode, pronunciationScore = null) => {
    if (!user) { alert(getT(sourceLang, 'video.loginRequired')); return; }
    if (isTrialSavedCardLimitReached) {
      setTrialCardCurrentCount(savedCardCount);
      setShowTrialLimitModal(true);
      return;
    }
    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
    try {
      const docRef = await addDoc(collection(db, "savedCards"), {
        userId: user.uid,
        userEmail: user.email,
        sourceText: sentenceText,
        translatedText: sentenceText,
        langCode,
        language: langInfo?.name || langCode,
        inputLang: langCode,
        inputType: 'S',
        sourceLang,
        sourceType: 'translation',
        articleTitle: videoTitle,
        learningTip: [],
        pronunciation: '',
        pronunciationScore,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      const goal = languageGoals[langCode] || 80;
      if (pronunciationScore != null && pronunciationScore >= goal) {
        const wasNew = await incrementAchievement(`library-${docRef.id}`);
        if (wasNew) setShowProgressPopup(true);
      }
    } catch (error) {
      console.error("Video 카드 저장 오류:", error);
    }
  };

  // 6. Scene 카드를 Library에 저장하는 함수
  const saveSceneCard = async ({ sentence, translation, langCode, scene, category = 'locations', sceneHint, learningTip, pronunciationScore = null, difficulty = 'basic', selectedEmotion = '', interactionType = '' }) => {
    if (!user) { alert(getT(sourceLang, 'scene.loginRequired')); return; }
    if (isTrialSavedCardLimitReached) {
      setTrialCardCurrentCount(savedCardCount);
      setShowTrialLimitModal(true);
      return;
    }
    // 중복 체크: 같은 문장이 이미 저장되어 있으면 기존 ID 반환
    try {
      const dupQ = query(
        collection(db, "savedCards"),
        where("userId", "==", user.uid),
        where("translatedText", "==", sentence),
        where("sourceType", "==", "scene")
      );
      const dupSnap = await getDocs(dupQ);
      const active = dupSnap.docs.find(d => !d.data().isDeleted);
      if (active) return null; // 이미 저장됨 → 중복 방지
    } catch (e) { console.error("Scene duplicate check failed:", e); }

    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
    try {
      const docRef = await addDoc(collection(db, "savedCards"), {
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
        difficulty,
        scene,
        category,
        learningTip: learningTip ? [{ type: 'tip', content: learningTip }] : [],
        pronunciation: '',
        pronunciationScore,
        selectedEmotion,
        interactionType,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      const goal = languageGoals[langCode] || 80;
      if (pronunciationScore != null && pronunciationScore >= goal) {
        const wasNew = await incrementAchievement(`library-${docRef.id}`);
        if (wasNew) setShowProgressPopup(true);
      }
      return docRef.id;
    } catch (error) {
      console.error("Scene 카드 저장 오류:", error);
      return null;
    }
  };

  // 7. Vocab 카드를 Library에 저장하는 함수
  const saveVocabCard = async ({ word, meaning, example, exampleTranslation, pronunciation, learningTip, langCode, topic, categoryId = 'custom', topicId = 'custom', difficulty = 'basic', pronunciationScore = null }) => {
    if (!user) { alert(getT(sourceLang, 'scene.loginRequired')); return; }
    if (isTrialSavedCardLimitReached) {
      setTrialCardCurrentCount(savedCardCount);
      setShowTrialLimitModal(true);
      return;
    }
    // 중복 체크: 같은 단어가 이미 저장되어 있으면 기존 ID 반환
    try {
      const dupQ = query(
        collection(db, "savedCards"),
        where("userId", "==", user.uid),
        where("translatedText", "==", word),
        where("sourceType", "==", "vocab")
      );
      const dupSnap = await getDocs(dupQ);
      const active = dupSnap.docs.find(d => !d.data().isDeleted);
      if (active) return null; // 이미 저장됨 → 중복 방지
    } catch (e) { console.error("Vocab duplicate check failed:", e); }

    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
    try {
      const docRef = await addDoc(collection(db, "savedCards"), {
        userId: user.uid,
        userEmail: user.email,
        sourceText: meaning,          // 뜻 (모국어)
        translatedText: word,         // 단어 (학습 언어)
        langCode,
        language: langInfo?.name || langCode,
        inputLang: langCode,
        inputType: 'W',               // 단어
        sourceLang,
        sourceType: 'vocab',
        difficulty,
        categoryId,
        topicId,
        scene: topic || '',
        learningTip: learningTip || [],
        example: example || '',
        exampleTranslation: exampleTranslation || '',
        pronunciation: pronunciation || '',
        pronunciationScore,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      const goal = languageGoals[langCode] || 80;
      if (pronunciationScore != null && pronunciationScore >= goal) {
        const wasNew = await incrementAchievement(`library-${docRef.id}`);
        if (wasNew) setShowProgressPopup(true);
      }
      return docRef.id;
    } catch (error) {
      console.error("Vocab 카드 저장 오류:", error);
      return null;
    }
  };

  // 문장을 소리로 읽어주는 함수 (브라우저 내장 기능 활용)
  // Web Speech API fallback (오프라인 / Azure 실패 시)
  const handleSpeakFallback = (text, langCode) => {
    if (!text) return;
    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
    const utterance = new SpeechSynthesisUtterance(text);
    if (langInfo) utterance.lang = langInfo.tts;
    window.speechSynthesis.speak(utterance);
  };

  // Azure Neural TTS — 모든 탭 공용 (실패 시 Web Speech API로 폴백)
  const handleSpeak = async (text, langCode, emotion) => {
    if (!text) return;
    const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    try {
      const res = await authFetch(`${SERVER_URL}/api/azure-tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          langCode,
          emotion: emotion || undefined,
          byokAzureKey: byokAzureKey || undefined,
          byokAzureRegion: byokAzureRegion || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Azure TTS ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = (err) => {
        console.warn('[TTS] Audio play error:', err);
        URL.revokeObjectURL(url);
        handleSpeakFallback(text, langCode);
      };
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          // autoplay 차단 시 사용자 인터랙션 후 재시도
          document.addEventListener('click', () => audio.play(), { once: true });
        });
      }
    } catch (e) {
      console.warn('[TTS] Azure failed:', e.message);
      handleSpeakFallback(text, langCode);
    }
  };

  // 로그아웃을 처리하는 함수
  const handleLogout = async () => {
    try {
      // 네이티브 환경: Capacitor Firebase Auth도 함께 로그아웃 (미처리 시 앱 재실행 시 로딩 stuck)
      if (window.Capacitor?.isNativePlatform?.()) {
        try {
          const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
          await FirebaseAuthentication.signOut();
        } catch (e) { /* 플러그인 오류 무시 */ }
      }
      localStorage.setItem('didExplicitLogout', '1'); // 로그아웃 플래그: 새 anonymous 자동 생성 방지
      await signOut(auth);
      setShowLanding(true); // 로그아웃 후 랜딩 페이지로
      setViewMode('home');
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
  if (viewMode === 'privacy') return <PrivacyPolicyPage onBack={() => setViewMode(user ? 'settings' : 'login-legal')} sourceLang={sourceLang} />;
  if (viewMode === 'terms') return <TermsOfServicePage onBack={() => setViewMode(user ? 'settings' : 'login-legal')} sourceLang={sourceLang} />;
  if (viewMode === 'contact') return <ContactPage onBack={() => setViewMode(user ? 'settings' : 'login-legal')} sourceLang={sourceLang} />;
  if (viewMode === 'guide') return <AppGuide onBack={() => setViewMode('home')} sourceLang={sourceLang} />;
  // stats는 이제 메인 탭이므로 여기서 early return하지 않음


  // 랜딩페이지 Google 로그인 — 인앱 브라우저면 로그인 화면으로 넘기고, 아니면 직접 OAuth 실행
  const isNativePlatform = window.Capacitor?.isNativePlatform?.();

  // 네이티브 Google Sign-In (Capacitor Firebase Auth 플러그인)
  const handleNativeGoogleLogin = async () => {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (idToken) {
      const credential = FirebaseGoogleAuthProvider.credential(idToken);
      const cred = await signInWithCredential(auth, credential);
      const info = getAdditionalUserInfo(cred);
      const profileData = { uid: cred.user.uid, email: cred.user.email, updatedAt: serverTimestamp() };
      if (info?.isNewUser) {
        profileData.displayName = cred.user.displayName || 'Google User';
        profileData.hasCompletedOnboarding = false;
        profileData.createdAt = serverTimestamp();
      }
      await setDoc(doc(db, 'users', cred.user.uid), profileData, { merge: true });
    }
  };

  const handleGoogleLoginFromLanding = async () => {
    if (isNativePlatform) {
      try { await handleNativeGoogleLogin(); } catch (err) { console.error('Native Google login error:', err); }
      return;
    }
    const ua = navigator.userAgent || '';
    const isInApp = /KAKAOTALK|KAKAO|Instagram|NAVER|Line\/|FBAN|FBAV/i.test(ua)
      || (/Android/.test(ua) && /wv\)/.test(ua))
      || (/iPhone|iPad/.test(ua) && !/Safari/.test(ua));
    if (isInApp) { setShowLanding(false); return; }
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const info = getAdditionalUserInfo(cred);
      const profileData = { uid: cred.user.uid, email: cred.user.email, updatedAt: serverTimestamp() };
      if (info?.isNewUser) {
        profileData.displayName = cred.user.displayName || 'Google User';
        profileData.hasCompletedOnboarding = false;
        profileData.createdAt = serverTimestamp();
      }
      await setDoc(doc(db, 'users', cred.user.uid), profileData, { merge: true });
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') console.error('Google login error:', err);
    }
  };

  // ── 진입 분기 ────────────────────────────────────────────────────────────────

  // [폴백] signInAnonymously 실패 또는 명시적 로그아웃 후 user가 null → 랜딩 또는 로그인 화면
  if (!user) {
    if (showLanding) {
      const handleStartFreeAfterLogout = async () => {
        localStorage.removeItem('didExplicitLogout');
        try { await signInAnonymously(auth); } catch (e) { console.error(e); }
        setShowLanding(false);
      };
      return <LandingPage
        onGoogleLogin={handleGoogleLoginFromLanding}
        onStartFree={window.Capacitor?.isNativePlatform?.() ? undefined : handleStartFreeAfterLogout}
        onLogin={() => { setShowLanding(false); setAuthMode('login'); }}
        onSignup={() => { setShowLanding(false); setAuthMode('signup'); }}
        onInstall={handleInstallClick}
        showInstall={showInstallBanner}
        onSpeak={handleSpeak}
        onPrivacy={() => setViewMode('privacy')}
        onTerms={() => setViewMode('terms')}
        onContact={() => setViewMode('contact')}
      />;
    }
    return authMode === 'login' ? (
      <Login onSwitchToSignup={() => setAuthMode('signup')} sourceLang={sourceLang} />
    ) : (
      <Signup onSwitchToLogin={() => setAuthMode('login')} sourceLang={sourceLang} />
    );
  }

  // [Web] 익명 유저 + 랜딩 미완료 → 랜딩페이지
  if (!isNativePlatform && user?.isAnonymous && showLanding) {
    return <LandingPage
      onGoogleLogin={handleGoogleLoginFromLanding}
      onStartFree={() => setShowLanding(false)}
      onLogin={() => { setShowLanding(false); setShowAccountUpgrade(true); }}
      onSignup={() => { setShowLanding(false); setShowAccountUpgrade(true); }}
      onInstall={handleInstallClick}
      showInstall={showInstallBanner}
      onSpeak={handleSpeak}
      onPrivacy={() => setViewMode('privacy')}
      onTerms={() => setViewMode('terms')}
      onContact={() => setViewMode('contact')}
    />;
  }

  // 메인 앱 화면
  return (
    <div className="app-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Vercel 분석 도구 */}
      <Analytics />

      {/* 익명→실계정 업그레이드 모달 */}
      {showAccountUpgrade && (
        <AccountUpgradeModal
          sourceLang={sourceLang}
          onClose={() => setShowAccountUpgrade(false)}
        />
      )}

      {/* 기존 계정 로그인 모달 (이메일/구글 모두 지원) */}
      {showLoginModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowLoginModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '460px', margin: '0 16px' }}>
            <Login
              sourceLang={sourceLang}
              onSwitchToSignup={() => setShowLoginModal(false)}
              onCancel={() => setShowLoginModal(false)}
            />
          </div>
        </div>
      )}

      {/* anonymous 가입 유도 팝업 (날짜 바뀐 첫 방문 시 자동 표시) */}
      {showAnonSignupPrompt && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
        }} onClick={() => setShowAnonSignupPrompt(false)}>
          <div style={{
            width: 'calc(100% - 48px)', maxWidth: '360px',
            background: '#fff', borderRadius: '24px',
            padding: '28px 24px 24px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
            animation: 'fadeInScale 0.25s ease',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowAnonSignupPrompt(false)} style={{
                position: 'absolute', top: '-12px', right: '-8px',
                background: 'none', border: 'none', fontSize: '1.3rem',
                cursor: 'pointer', color: '#94a3b8', lineHeight: 1,
              }}>×</button>
            </div>
            <div style={{ fontSize: '1.5rem', textAlign: 'center', marginBottom: '8px' }}>🎉</div>
            <h3 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
              {getT(sourceLang, 'upgrade.promptTitle')}
            </h3>
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
              {getT(sourceLang, 'upgrade.promptDesc')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => { setShowAnonSignupPrompt(false); setShowAccountUpgrade(true); }}
                style={{
                  padding: '13px', borderRadius: '14px', border: 'none',
                  background: 'linear-gradient(135deg, #00a884, #059669)',
                  color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
                }}
              >
                {getT(sourceLang, 'upgrade.sidebarBtn') || '무료 계정 만들기'}
              </button>
              <button
                onClick={() => setShowAnonSignupPrompt(false)}
                style={{
                  padding: '11px', borderRadius: '14px', border: '1px solid #e2e8f0',
                  background: 'transparent', color: '#94a3b8', fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                {getT(sourceLang, 'upgrade.later') || '나중에'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 좌측 슬라이드 드로어 */}
      {sidebarOpen && (
        <>
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
          <div className="sidebar sidebar-enter">
            {/* 드로어 상단: 로고 + 닫기 */}
            <div className="sidebar-header">
              <p className="sidebar-logo">PronunFit</p>
              <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
                <X size={20} />
              </button>
            </div>

            {/* 유저 정보 */}
            {user?.isAnonymous ? (
              /* 익명 유저: 계정 만들기 CTA */
              <div style={{ padding: '12px 16px', background: '#f0fdf4', borderRadius: '14px', margin: '0 4px 4px' }}>
                <p style={{ fontWeight: 700, fontSize: '0.88rem', color: '#166534', margin: '0 0 10px' }}>
                  {getT(sourceLang, 'upgrade.sidebarTitle')}
                </p>
                <button
                  onClick={() => { setSidebarOpen(false); setShowAccountUpgrade(true); }}
                  style={{
                    width: '100%', padding: '9px', borderRadius: '10px',
                    background: '#00a884', border: 'none', color: '#fff',
                    fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                  }}
                >
                  {getT(sourceLang, 'upgrade.sidebarBtn')}
                </button>
                <button
                  onClick={() => { setSidebarOpen(false); setShowLoginModal(true); }}
                  style={{
                    width: '100%', marginTop: '8px', padding: '7px', borderRadius: '10px',
                    background: 'transparent', border: '1px solid #86efac', color: '#166534',
                    fontSize: '0.78rem', cursor: 'pointer',
                  }}
                >
                  {getT(sourceLang, 'upgrade.loginExisting')}
                </button>
              </div>
            ) : (
              <div className="sidebar-user-info">
                <div className="user-avatar" style={{ width: 36, height: 36, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <User size={18} color="var(--primary-color)" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="sidebar-username" style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile?.displayName || user?.displayName || 'User'}
                  </p>
                  <p className="sidebar-user-email" style={{ fontSize: '0.68rem', color: '#94a3b8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                  <p className="sidebar-user-tier">{{
                    trial: 'Free Trial',
                    admin: 'Admin',
                    byok_free: 'BYOK Free',
                    pro: 'Pro',
                    premium: 'Premium',
                  }[tier] || 'Free Trial'}</p>
                </div>
                <button
                  onClick={() => { setSidebarOpen(false); handleEditProfile(); }}
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--primary-color)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    flexShrink: 0,
                    padding: '3px 10px',
                    borderRadius: '12px',
                    border: '1.5px solid var(--primary-color)',
                    background: 'transparent',
                    transition: 'all 0.2s',
                    marginRight: '4px',
                  }}
                  onMouseEnter={(e) => { e.target.style.background = 'var(--primary-color)'; e.target.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--primary-color)'; }}
                >
                  Edit
                </button>
              </div>
            )}

            {/* 메뉴 목록 */}
            <nav className="sidebar-nav">
              <button className={`sidebar-nav-item ${viewMode === 'home' ? 'active' : ''}`}
                onClick={() => { setViewMode('home'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><Home size={16} /></span>
                {getT(sourceLang, 'nav.home')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'scene' ? 'active' : ''}`}
                onClick={() => { setViewMode('scene'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><MapPin size={16} /></span>
                {getT(sourceLang, 'nav.scene')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'vocab' ? 'active' : ''}`}
                onClick={() => { setViewMode('vocab'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><BookOpen size={16} /></span>
                {getT(sourceLang, 'nav.vocab')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'translation' ? 'active' : ''}`}
                onClick={() => { setViewMode('translation'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><Languages size={16} /></span>
                {getT(sourceLang, 'nav.translation')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'library' ? 'active' : ''}`}
                onClick={() => { setViewMode('library'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><Sparkles size={16} /></span>
                {getT(sourceLang, 'nav.library')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'video' ? 'active' : ''}`}
                onClick={() => { setViewMode('video'); setSidebarOpen(false); }}>
                <span className="sidebar-nav-icon"><Youtube size={16} /></span>
                {getT(sourceLang, 'nav.video')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'stats' ? 'active' : ''}`}
                onClick={() => { setViewMode('stats'); setSidebarOpen(false); }}>
                <span className="sidebar-nav-icon"><BarChart3 size={16} /></span>
                {getT(sourceLang, 'nav.stats')}
              </button>

              <div className="sidebar-divider" />

              {/* 추가 학습 (Trial 전용 + 네이티브) */}
              {tier === 'trial' && window.Capacitor?.isNativePlatform?.() && (
                <div style={{ padding: '8px 12px 4px' }}>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, margin: '0 0 6px 4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {getT(sourceLang, 'nav.studyMore') || (['ko','ja','zh-CN'].includes(sourceLang) ? '추가 학습' : 'Study More')}
                  </p>
                  {/* 카드 +5 */}
                  <button
                    onClick={() => handleRewardedAd('cards')}
                    disabled={rewardAdLoading}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', marginBottom: '6px', borderRadius: '12px',
                      background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
                      border: '1px solid #bbf7d0', cursor: 'pointer', textAlign: 'left',
                    }}>
                    <span style={{ fontSize: '1.2rem' }}>🎬</span>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534' }}>
                        {getT(sourceLang, 'reward.watchForCards') || '+5 카드'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#4ade80' }}>
                        {getT(sourceLang, 'reward.watchAd') || '광고 시청 후 카드 5개 추가'}
                      </div>
                    </div>
                  </button>
                  {/* 발음 +10 */}
                  <button
                    onClick={() => handleRewardedAd('prons')}
                    disabled={rewardAdLoading}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', marginBottom: '4px', borderRadius: '12px',
                      background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                      border: '1px solid #bfdbfe', cursor: 'pointer', textAlign: 'left',
                    }}>
                    <span style={{ fontSize: '1.2rem' }}>🎬</span>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e40af' }}>
                        {getT(sourceLang, 'reward.watchForProns') || '+10 발음'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#60a5fa' }}>
                        {getT(sourceLang, 'reward.watchAdPron') || '광고 시청 후 발음 10회 추가'}
                      </div>
                    </div>
                  </button>
                  {rewardAdLoading && (
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', margin: '4px 0 0' }}>
                      {getT(sourceLang, 'reward.loading') || '광고 로딩 중...'}
                    </p>
                  )}
                </div>
              )}

              <div className="sidebar-divider" />

              {/* 구독 플랜 섹션 */}
              <div style={{ padding: '8px 12px 4px' }}>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, margin: '0 0 6px 4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {getT(sourceLang, 'nav.subscriptionTitle') || 'Subscribe'}
                </p>
                {/* Pro */}
                <button
                  onClick={() => { setSidebarOpen(false); setShowUpgradeModal(true); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', marginBottom: '6px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #fefce8, #fef9c3)',
                    border: '1px solid #fde68a', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <span style={{ fontSize: '1.2rem' }}>🌟</span>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>
                      Pro
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#b45309' }}>
                      {getT(sourceLang, 'subscription.proDesc') || '카드 무제한 · 발음 1,500회/월'}
                    </div>
                  </div>
                </button>
                {/* Premium */}
                <button
                  onClick={() => { setSidebarOpen(false); setShowUpgradeModal(true); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 12px', marginBottom: '4px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #fdf4ff, #fae8ff)',
                    border: '1px solid #e9d5ff', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <span style={{ fontSize: '1.2rem' }}>👑</span>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b21a8' }}>
                      Premium
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#9333ea' }}>
                      {getT(sourceLang, 'subscription.premiumDesc') || '카드 · 발음 무제한'}
                    </div>
                  </div>
                </button>
              </div>



              {/* 설정 */}
              <button className={`sidebar-nav-item ${viewMode === 'settings' ? 'active' : ''}`}
                onClick={() => { setViewMode('settings'); setSidebarOpen(false); }}>
                <span className="sidebar-nav-icon"><SettingsIcon size={16} /></span>
                {getT(sourceLang, 'nav.settings')}
              </button>

              {/* Q&A 서브메뉴 */}
              <button className="sidebar-nav-item"
                onClick={() => setQaMenuOpen(prev => !prev)}>
                <span className="sidebar-nav-icon"><HelpCircle size={16} /></span>
                <span style={{ flex: 1 }}>{getT(sourceLang, 'nav.qa')}</span>
                {qaMenuOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {qaMenuOpen && (
                <div className="sidebar-submenu">
                  <button className="sidebar-submenu-item"
                    onClick={() => { setSidebarOpen(false); setViewMode('guide'); }}>
                    {getT(sourceLang, 'nav.qaUsage')}
                  </button>
                </div>
              )}

              <div className="sidebar-divider" />

              {/* 법적 정보 */}
              <div className="sidebar-legal-section">
                <button className="sidebar-legal-btn" onClick={() => { window.history.pushState({}, '', '/privacy'); setViewMode('privacy'); setSidebarOpen(false); }}>
                  {getT(sourceLang, 'nav.privacy')}
                </button>
                <button className="sidebar-legal-btn" onClick={() => { window.history.pushState({}, '', '/terms'); setViewMode('terms'); setSidebarOpen(false); }}>
                  {getT(sourceLang, 'nav.terms')}
                </button>
                <button className="sidebar-legal-btn" onClick={() => { window.history.pushState({}, '', '/contact'); setViewMode('contact'); setSidebarOpen(false); }}>
                  {getT(sourceLang, 'nav.contact')}
                </button>
              </div>

            </nav>

            {/* 로그아웃 (실계정만) */}
            {!user?.isAnonymous && (
              <div className="sidebar-footer">
                <button className="sidebar-logout-btn" onClick={handleLogout}>
                  <LogOut size={16} />
                  {getT(sourceLang, 'settings.logout') || 'Logout'}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <header className="app-header">
        <div className="app-header-row">
          <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Menu">
            <Menu size={26} strokeWidth={2.5} />
          </button>

          <h1 className="main-logo-3d">
            {"PronunFit".split("").map((char, index) => (
              <span key={index} className="logo-char">{char}</span>
            ))}
          </h1>

          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Back 버튼 (해당 탭에서만) */}
            {(viewMode === 'scene' || viewMode === 'vocab') && (
              <button className="header-dict-btn" onClick={() => {
                setDictBackTo(viewMode);
                setViewMode('translation');
              }}>
                {getT(sourceLang, 'nav.dictBtn')}
              </button>
            )}
            {viewMode === 'translation' && dictBackTo && (
              <button className="header-dict-btn" onClick={() => { setViewMode(dictBackTo); setDictBackTo(null); }}>
                Back
              </button>
            )}
            {viewMode === 'library' && libraryBackTo && (
              <button className="header-dict-btn" onClick={() => { setViewMode(libraryBackTo); setLibraryBackTo(null); }}>
                Back
              </button>
            )}
            {/* 홈 버튼 (홈이 아닐 때 항상 표시) */}
            {viewMode === 'home' ? (
              <div className="header-spacer" />
            ) : (
              <button className="header-home-btn" onClick={() => setViewMode('home')} aria-label="Home">
                <Home size={28} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {(() => {
            const TAB_CONTEXT = {
              home: { icon: '🏠', text: getT(sourceLang, 'tabTag.home') },
              scene: { icon: '🎭', text: getT(sourceLang, 'tabTag.scene') },
              translation: { icon: '🔤', text: getT(sourceLang, 'tabTag.translation') },
              vocab: { icon: '📖', text: getT(sourceLang, 'tabTag.vocab') },
              video: { icon: '🎬', text: getT(sourceLang, 'tabTag.video') },
              library: { icon: '⭐', text: getT(sourceLang, 'tabTag.library') },
              stats: { icon: '📊', text: getT(sourceLang, 'tabTag.stats') },
            };
            const ctx = TAB_CONTEXT[viewMode];
            if (!ctx) return null;
            return (
              <motion.div
                key={viewMode}
                className="tab-context-bar"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <span className="tab-context-icon">{ctx.icon}</span>
                <span className="tab-context-text">
                  <span className="marquee-inner">{ctx.text}</span>
                </span>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* 미니 일일 진도 바 + 주간 캘린더 (홈에서는 숨김 — 홈에서 더 크게 표시) */}
        {user && viewMode !== 'home' && (() => {
          const today = getToday();
          const dayLabels = getT(sourceLang, 'daily.days').split(',');
          // Trial: 일간 발음 게이지, Pro: 월간 발음 게이지, Premium/Admin: 숨김
          const isTrialTier = tier === 'trial';
          const isProTier = tier === 'pro';
          const showPronGauge = isTrialTier || isProTier;
          const pronCurrent = isTrialTier ? todayPronCount : (isProTier ? proPronCount : 0);
          const pronLimit = isTrialTier ? TRIAL_DAILY_PRON_LIMIT + rewardBonus.prons : (isProTier ? PRO_PRON_LIMIT : 999);
          const pronFull = pronCurrent >= pronLimit;
          const pronLabel = isTrialTier ? `${pronCurrent}/${pronLimit}` : `${pronCurrent}`;
          return (
            <div style={{ display: 'flex', alignItems: 'stretch', gap: '8px', marginTop: '6px', width: '100%' }}>
              {/* 좌측: 게이지 바 2개 세로 배치 */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: showPronGauge ? '4px' : '0', flex: '0 0 auto', width: '38%' }}>
                {/* 카드 게이지 — trial: 저장 제한(10/일), 유료: 목표 달성 */}
                {(() => {
                  const isTrial = tier === 'trial';
                  const limit = TRIAL_DAILY_CARD_LIMIT + rewardBonus.cards;
                  const goal = dailyGoal;
                  const count = isTrial ? todaySaveCount : todayCount;
                  const isFull = isTrial ? count >= limit : count >= goal;
                  const ratio = isTrial ? Math.min((count / limit) * 100, 100) : Math.min((count / goal) * 100, 100);
                  const barColor = isTrial
                    ? (isFull
                        ? 'linear-gradient(90deg, #fca5a5 0%, #ef4444 60%, #b91c1c 100%)'
                        : 'linear-gradient(90deg, #6ee7b7 0%, #34d399 50%, #059669 100%)')
                    : (isFull
                        ? 'linear-gradient(90deg, #6ee7b7 0%, #10b981 60%, #047857 100%)'
                        : 'linear-gradient(90deg, #c4b5fd 0%, #818cf8 50%, #4338ca 100%)');
                  const glow = isTrial
                    ? (isFull ? '0 0 6px rgba(239,68,68,0.5)' : '0 0 6px rgba(52,211,153,0.4)')
                    : (isFull ? '0 0 6px rgba(16,185,129,0.5)' : '0 0 6px rgba(99,102,241,0.4)');
                  const textColor = isTrial
                    ? (isFull ? '#ef4444' : '#059669')
                    : (isFull ? '#059669' : '#818cf8');
                  const icon = isTrial ? '💾' : '🎯';
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#94a3b8', flexShrink: 0 }}>{icon}</span>
                      <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)' }}>
                        <div style={{
                          height: '100%', borderRadius: '99px',
                          width: `${ratio}%`,
                          background: barColor,
                          transition: 'width 0.5s ease',
                          boxShadow: glow,
                        }} />
                      </div>
                      <span style={{ fontSize: '0.6rem', fontWeight: '700', color: textColor, flexShrink: 0, whiteSpace: 'nowrap' }}>
                        {count}/{isTrial ? limit : goal}
                      </span>
                    </div>
                  );
                })()}
                {/* 발음 게이지 (Trial: 일간, Pro: 월간) */}
                {showPronGauge && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8', flexShrink: 0 }}>🎙️</span>
                    <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)' }}>
                      <div style={{
                        height: '100%', borderRadius: '99px',
                        width: `${Math.min((pronCurrent / pronLimit) * 100, 100)}%`,
                        background: pronFull
                          ? 'linear-gradient(90deg, #fca5a5 0%, #ef4444 60%, #b91c1c 100%)'
                          : isProTier
                            ? 'linear-gradient(90deg, #a7f3d0 0%, #34d399 50%, #059669 100%)'
                            : 'linear-gradient(90deg, #fde68a 0%, #f59e0b 50%, #d97706 100%)',
                        transition: 'width 0.5s ease',
                        boxShadow: pronFull
                          ? '0 0 6px rgba(239,68,68,0.5)'
                          : isProTier
                            ? '0 0 6px rgba(52,211,153,0.4)'
                            : '0 0 6px rgba(245,158,11,0.4)',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.6rem', fontWeight: '700', color: pronFull ? '#dc2626' : (isProTier ? '#059669' : '#d97706'), flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {pronLabel}
                    </span>
                  </div>
                )}
              </div>

              {/* 우측: 주간 캘린더 */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', gap: '2px' }}>
                {weeklyData.map((d, i) => {
                  const isToday = d.date === today;
                  const isFuture = d.date > today;
                  let icon = '○';
                  if (d.achieved) icon = '✅';
                  else if (!isFuture && d.date < today) icon = '🌙';
                  return (
                    <div key={d.date} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1,
                      padding: '2px 0', borderRadius: '6px',
                      background: isToday ? '#eef2ff' : 'transparent',
                      border: isToday ? '1px solid #c7d2fe' : '1px solid transparent',
                      opacity: isFuture ? 0.35 : 1,
                    }}>
                      <span style={{ fontSize: '0.5rem', fontWeight: 700, color: isToday ? '#6366f1' : '#94a3b8', lineHeight: 1 }}>
                        {dayLabels[i] || ''}
                      </span>
                      <span style={{ fontSize: '0.65rem', lineHeight: 1, marginTop: '1px' }}>{icon}</span>
                      {!isFuture && (
                        <span style={{ fontSize: '0.5rem', fontWeight: 700, color: '#64748b', lineHeight: 1, marginTop: '1px' }}>
                          {d.count || 0}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 광고: 로고 아래 전체 너비 배너 — slot은 AdSense 심사 통과 후 채우세요 */}
        <AdBanner slot="TODO" style={{ width: '100%', margin: '4px 0 0' }} />
      </header>

      <main className="app-main-content">
        {/* 홈 탭 */}
        <div style={{ display: viewMode === 'home' ? 'block' : 'none', width: '100%' }}>
          <HomePage
            user={user}
            weeklyData={weeklyData}
            todayCount={todayCount}
            dailyGoal={dailyGoal}
            sourceLang={sourceLang}
            onNavigate={(tab) => setViewMode(tab)}
            isActive={viewMode === 'home'}
          />
        </div>

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
              <div className="text-input-wrapper">
                <textarea
                  rows={2}
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    // 자동 높이 조절
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  ref={(el) => {
                    // inputText가 외부에서 변경될 때(OCR 등)도 높이 조절
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = el.scrollHeight + 'px';
                    }
                  }}
                  placeholder="Enter text to translate"
                  className="text-input"
                  style={{ overflow: 'hidden', resize: 'none' }}
                />
                {inputText && (
                  <button className="text-input-clear" onClick={() => setInputText('')} aria-label="Clear">
                    &times;
                  </button>
                )}
              </div>
              {/* [신규] 카메라 OCR 모달 */}
              {showCameraModal && (
                <CameraOCRModal
                  onClose={() => setShowCameraModal(false)}
                  onTextExtracted={(text) => {
                    setInputText(text);
                    setShowCameraModal(false);
                  }}
                  sourceLang={sourceLang}
                />
              )}
              <div className="translate-btn-container" style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
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
                {/* [신규] 카메라 OCR 버튼 — Translate 버튼 우측 */}
                <button
                  className="camera-ocr-btn-inline"
                  onClick={() => setShowCameraModal(true)}
                  title="카메라로 텍스트 읽기"
                  aria-label="카메라로 텍스트 읽기"
                >
                  <Camera size={28} />
                </button>
              </div>
            </div>

            {/* 번역 결과 카드들이 나오는 영역 */}
            <div className="cards-grid">
              {targetLangs.map((langCode) => {
                const lang = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
                const practiceResult = practiceResults[langCode];
                const goal = languageGoals[langCode] || 80;
                return (
                  <div key={langCode} className="library-card-wrapper">
                    <TranslationCard
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
                      savedCardId={savedCardIds[langCode]}
                      onPracticeResult={handlePracticeResult}
                      onTrialLimitReached={() => setShowTrialLimitModal(true)}
                      onPronSuccess={incrementDailyPron}
                      onBookmarkPrompt={handleBookmarkPrompt}
                      onTargetAchieved={handleTargetAchieved}
                      targetGoal={goal}
                    />
                    {/* 하단 액션바 — Library와 동일한 구조 */}
                    <div className="card-action-bar">
                      <div className="action-left" style={{ display: 'flex', alignItems: 'center' }}>
                        <span className="stat-text" title="목표 점수">🎯 <strong>{goal}</strong></span>
                        <span className="stat-divider">·</span>
                        <span className="stat-text" title="내 점수">⭐️ <strong>{practiceResult?.pronunciationScore ?? '-'}</strong></span>
                        <span className="stat-divider">·</span>
                        <span className="stat-text" title="달성 여부">
                          {practiceResult?.pronunciationScore != null && practiceResult.pronunciationScore >= goal ? '✅' : '❌'}
                        </span>
                        <span className="stat-divider">·</span>
                        <button
                          className="stat-icon-btn"
                          title={practiceResult?.audioUrl ? '내 발음 다시 듣기' : '녹음 후 활성화됩니다'}
                          onClick={() => { if (practiceResult?.audioUrl) new Audio(practiceResult.audioUrl).play(); }}
                          disabled={!practiceResult?.audioUrl}
                          style={{ background: 'none', border: 'none', outline: 'none', cursor: practiceResult?.audioUrl ? 'pointer' : 'default', padding: 0, display: 'flex', alignItems: 'center', opacity: practiceResult?.audioUrl ? 1 : 0.3, color: 'var(--text-secondary)' }}
                        >
                          <Volume2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
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

        {/* Vocab 탭 — AI 단어 학습 */}
        <div style={{ display: viewMode === 'vocab' ? 'block' : 'none', width: '100%' }}>
          <VocabTab
            sourceLang={sourceLang}
            targetLangs={targetLangs}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
                      onPronSuccess={incrementDailyPron}
            onSaveToLibrary={saveVocabCard}
            onSpeak={handleSpeak}
            languageGoals={languageGoals}
            onBookmarkPrompt={handleBookmarkPrompt}
            onGenerate={incrementVocabGenerate}
            onNavigateToLibrary={(cardId) => {
              setFocusCardId(cardId);
              setLibraryBackTo('vocab');
              setViewMode('library');
            }}
          />
          <AdBanner slot="TODO" style={{ margin: '8px 0 4px' }} />
        </div>

        {/* Video 탭 — 다국어 YouTube 동영상 학습 */}
        <div style={{ display: viewMode === 'video' ? 'block' : 'none', width: '100%', height: '100%' }}>
          <VideoReader
            sourceLang={sourceLang}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
                      onPronSuccess={incrementDailyPron}
            onSaveToLibrary={saveVideoCard}
            onBookmarkPrompt={handleBookmarkPrompt}
            languageGoals={languageGoals}
            targetLangs={targetLangs}
            onSendToTranslation={(text, langCode) => {
              setInputText(text);
              setInputLang(langCode);
              pendingTranslateRef.current = true;
              setViewMode('translation');
            }}
          />
        </div>

        {/* Scene 탭 */}
        <div style={{ display: viewMode === 'scene' ? 'block' : 'none', width: '100%' }}>
          <ScenePractice
            sourceLang={sourceLang}
            targetLangs={targetLangs}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
                      onPronSuccess={incrementDailyPron}
            onSaveToLibrary={saveSceneCard}
            onSpeak={handleSpeak}
            languageGoals={languageGoals}
            onBookmarkPrompt={handleBookmarkPrompt}
            onGenerate={incrementSceneGenerate}
            onNavigateToLibrary={(cardId) => {
              setFocusCardId(cardId);
              setLibraryBackTo('scene');
              setViewMode('library');
            }}
          />
          {/* 광고: Scene 탭 하단 — slot은 AdSense 심사 통과 후 채우세요 */}
          <AdBanner slot="TODO" style={{ margin: '8px 0 4px' }} />
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
            todayCount={todayCount}
            dailyGoal={dailyGoal}
            onTargetAchieved={handleTargetAchieved}
            onCardDeleted={handleCardDeleted}
            focusCardId={focusCardId}
            onFocusCardHandled={() => setFocusCardId(null)}
            progressPopupOpen={showProgressPopup}
            libraryBackTo={libraryBackTo}
            onBack={() => {
              const target = libraryBackTo || 'vocab';
              setLibraryBackTo(null);
              setViewMode(target);
            }}
            onTrialLimitReached={() => setShowTrialLimitModal(true)}
            onPronSuccess={incrementDailyPron}
          />
        </div>

        {/* Settings 탭 */}
        <div style={{ display: viewMode === 'settings' ? 'block' : 'none', width: '100%' }}>
          <div className="settings-container" style={{ position: 'relative' }}>

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
                    admin: 'Admin',
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

            {/* 출발 언어(입력 언어)를 바꾸는 곳 */}
            <div className="settings-group">
              <label className="settings-label">
                <ArrowLeft size={18} /> {getT(sourceLang, 'settings.selectSource')}
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
                {getT(sourceLang, 'settings.selectTarget')}
              </label>
              <p className="target-limit-msg">{getT(sourceLang, 'settings.targetCount').replace('{n}', targetLangs.length)}</p>
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
              <label className="settings-label">{getT(sourceLang, 'settings.scoreGoals')} 🎯</label>
              <p className="target-limit-msg" style={{ marginBottom: '0.2rem', color: 'var(--text-secondary)' }}>
                {getT(sourceLang, 'settings.scoreGoalsDesc')}
              </p>
              <div className="goal-sliders">
                {targetLangs.map(code => {
                  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
                  const rawGoal = languageGoals[code];
                  const sliderGoal = (rawGoal === '' || rawGoal === undefined) ? 80 : rawGoal;
                  const sliderColor = lang?.textColor || 'var(--primary-color)';
                  const pct = sliderGoal;
                  return (
                    <div key={code} className="goal-slider-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', background: '#f8fafc', padding: '8px 12px', borderRadius: '12px' }}>
                      <span style={{ width: '72px', fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{lang?.name}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={sliderGoal}
                        className="custom-slider"
                        onChange={(e) => setLanguageGoals({ ...languageGoals, [code]: parseInt(e.target.value) })}
                        style={{ flex: 1, margin: '0 10px', '--slider-color': sliderColor, background: `linear-gradient(to right, ${sliderColor} ${pct}%, #e2e8f0 ${pct}%)` }}
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={rawGoal === '' ? '' : sliderGoal}
                        className="slider-value-input"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setLanguageGoals({ ...languageGoals, [code]: '' });
                          } else {
                            const v = Math.max(0, Math.min(100, parseInt(raw)));
                            if (!isNaN(v)) setLanguageGoals({ ...languageGoals, [code]: v });
                          }
                        }}
                        onBlur={() => {
                          if (rawGoal === '' || rawGoal === undefined) {
                            setLanguageGoals({ ...languageGoals, [code]: 80 });
                          }
                        }}
                        style={{ '--slider-color': sliderColor, color: sliderColor }}
                      />
                    </div>
                  );
                })}
                {targetLangs.length === 0 && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{getT(sourceLang, 'settings.noTarget')}</p>
                )}
              </div>
            </div>

            {/* [신규] 하루 학습 목표 카드 수 */}
            <div className="settings-group">
              <label className="settings-label">{getT(sourceLang, 'daily.settingsTitle')} 🎯</label>
              <p className="target-limit-msg" style={{ marginBottom: '0.4rem' }}>
                {getT(sourceLang, 'daily.settingsDesc')}
              </p>
              <div className="goal-slider-row" style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', padding: '8px 12px', borderRadius: '12px', opacity: tier === 'trial' ? 0.6 : 1 }}>
                <span style={{ width: '42px', fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{getT(sourceLang, 'daily.settingsLabel')}</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={tier === 'trial' ? TRIAL_DAILY_CARD_LIMIT : (dailyGoal === '' ? 10 : dailyGoal)}
                  className="custom-slider"
                  disabled={tier === 'trial'}
                  onChange={(e) => setDailyGoal(parseInt(e.target.value))}
                  style={{ flex: 1, margin: '0 10px', '--slider-color': '#6366f1', background: `linear-gradient(to right, #6366f1 ${tier === 'trial' ? TRIAL_DAILY_CARD_LIMIT : (dailyGoal === '' ? 10 : dailyGoal)}%, #e2e8f0 ${tier === 'trial' ? TRIAL_DAILY_CARD_LIMIT : (dailyGoal === '' ? 10 : dailyGoal)}%)` }}
                />
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={tier === 'trial' ? TRIAL_DAILY_CARD_LIMIT : (dailyGoal === '' ? '' : dailyGoal)}
                  className="slider-value-input"
                  disabled={tier === 'trial'}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setDailyGoal('');
                    } else {
                      const v = Math.max(1, Math.min(100, parseInt(raw)));
                      if (!isNaN(v)) setDailyGoal(v);
                    }
                  }}
                  onBlur={() => {
                    if (dailyGoal === '' || dailyGoal === undefined) setDailyGoal(10);
                  }}
                  style={{ '--slider-color': '#6366f1', color: '#6366f1' }}
                />
                <span style={{ marginLeft: '4px', fontWeight: '600', color: '#6366f1', fontSize: '0.85rem' }}>
                  {getT(sourceLang, 'daily.settingsUnit')}
                </span>
                {tier === 'trial' && (
                  <span style={{ fontSize: '0.65rem', color: '#ef4444', marginLeft: '4px', whiteSpace: 'nowrap' }}>Free</span>
                )}
              </div>
            </div>

            <button className="translate-btn" style={{ alignSelf: 'center' }} onClick={handleSaveSettings}>
              {getT(sourceLang, 'settings.saveReturn')}
            </button>

            {/* ── API 키 & 플랜 섹션 ───────────────────────────────────────── */}
            <div className="settings-group" style={{ marginTop: '4px' }}>
              <label className="settings-label">
                <Lock size={16} /> {getT(sourceLang, 'settings.mySubscription')}
              </label>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#f8fafc', borderRadius: '12px', padding: '12px 16px'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#1e293b' }}>
                    {{
                      trial: `🆓 ${getT(sourceLang, 'settings.tierTrial')}`,
                      admin: `🛡️ ${getT(sourceLang, 'settings.tierAdmin')}`,
                      silver: `🥈 ${getT(sourceLang, 'settings.tierSilver')}`,
                      pro: `⭐ ${getT(sourceLang, 'settings.tierPro')}`,
                      premium: `💎 ${getT(sourceLang, 'settings.tierPremium')}`,
                    }[tier] || `🆓 ${getT(sourceLang, 'settings.tierTrial')}`}
                  </span>
                  {tier === 'trial' && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      🃏 {getT(sourceLang, 'settings.usageCards')}: {todayCount}/{TRIAL_DAILY_CARD_LIMIT}/day<br />🎤 {getT(sourceLang, 'settings.usagePron')}: {todayPronCount}/{TRIAL_DAILY_PRON_LIMIT}/day
                    </span>
                  )}
                  {tier === 'pro' && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      🎤 {getT(sourceLang, 'settings.usagePron')}: {proPronCount}/{PRO_PRON_LIMIT}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {tier === 'trial' && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      style={{
                        padding: '8px 14px', background: '#00a884', color: 'white',
                        border: 'none', borderRadius: '8px', fontWeight: 'bold',
                        cursor: 'pointer', fontSize: '0.82rem'
                      }}
                    >
                      {getT(sourceLang, 'upgrade.btnLabel')}
                    </button>
                  )}
                  {tier === 'admin' && (
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
                  )}
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
                  onClick={() => { window.history.pushState({}, '', `/${mode}`); setViewMode(mode); }}
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
            {/* 앱 버전 / 업데이트 상태 */}
            <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
              <div style={{ color: '#475569', fontSize: '0.8rem', fontWeight: '600' }}>
                PronunFit{appVersion ? ` v${appVersion}` : ''}
                {bundleVersion ? <span style={{ color: '#94a3b8', fontWeight: '400', fontSize: '0.72rem' }}> (OTA {bundleVersion})</span> : null}
              </div>
              {updateStatus ? (
                <div style={{ marginTop: '4px', color: '#0ea5e9', fontSize: '0.72rem' }}>{updateStatus}</div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Stats 탭 (메인 탭) */}
        <div style={{ display: viewMode === 'stats' ? 'block' : 'none', width: '100%' }}>
          <StatsPage user={user} dailyGoal={dailyGoal} sourceLang={sourceLang} isActive={viewMode === 'stats'} />
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
      {showInstallBanner && !Capacitor.isNativePlatform() && (
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

      {/* 발음 목표 달성 팝업 */}
      {showProgressPopup && (
        <DailyProgressPopup
          todayCount={todayCount}
          dailyGoal={dailyGoal}
          weeklyData={weeklyData}
          onClose={() => setShowProgressPopup(false)}
          sourceLang={sourceLang}
        />
      )}

      {/* 비Library 탭 — 목표 달성 북마크 유도 팝업 */}
      {bookmarkPrompt && (
        <BookmarkPromptModal
          score={bookmarkPrompt.score}
          onDismiss={() => setBookmarkPrompt(null)}
          sourceLang={sourceLang}
        />
      )}

      {/* 하단 고정 nav 제거됨 — 좌측 햄버거 드로어로 대체 */}

      {/* 첫 방문 탭 튜토리얼 */}
      {tutorialTab && TAB_TUTORIALS[tutorialTab] && (
        <TabTutorial
          tab={tutorialTab}
          step={tutorialStep}
          total={TAB_TUTORIALS[tutorialTab].length}
          onNext={handleTutorialNext}
          onSkip={handleTutorialSkip}
          sourceLang={sourceLang}
        />
      )}

      {/* 탭 위치 표시 도트 인디케이터 */}
      {TAB_ORDER.includes(viewMode) && (
        <div className="tab-dots">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              className={`tab-dot ${viewMode === tab ? 'active' : ''}`}
              onClick={() => setViewMode(tab)}
              aria-label={tab}
            />
          ))}
        </div>
      )}

      {/* Trial 한도 도달 모달 */}
      {showTrialLimitModal && (
        <TrialLimitModal
          sourceLang={sourceLang}
          cardCount={todayCount}
          pronCount={todayPronCount}
          onClose={() => setShowTrialLimitModal(false)}
          onUpgrade={() => { setShowTrialLimitModal(false); setShowUpgradeModal(true); }}
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
          onRequestPhoneVerify={() => { setShowUpgradeModal(false); handleEditProfile(); }}
        />
      )}

      {/* 구독 만료 예정 알림 팝업 */}
      <RenewalReminderPopup
        sourceLang={sourceLang}
        onUpgrade={() => setShowUpgradeModal(true)}
      />

      {/* --- 프로필 수정 모달 (최상위 — 어느 탭에서든 표시) --- */}
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
              padding: '20px'
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
                <h2>{getT(sourceLang, 'auth.editProfile')}</h2>
                <p>{getT(sourceLang, 'auth.editSubtitle')}</p>
              </div>

              <form onSubmit={handleSaveProfile} className="auth-form">
                {/* 이메일 + 인증 상태 */}
                <div className="input-wrapper">
                  <label className="input-label">{getT(sourceLang, 'auth.email')}</label>
                  <div className="input-group">
                    <Mail size={18} className="input-icon" style={{ color: '#cbd5e1' }} />
                    <input
                      type="email"
                      value={user.email || ''}
                      disabled
                      style={{ background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed', borderColor: '#e2e8f0' }}
                    />
                  </div>
                  {user.emailVerified ? (
                    <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '600', marginLeft: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <CheckCircle2 size={13} /> {getT(sourceLang, 'auth.emailVerified')}
                    </span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px', marginTop: '2px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: '600' }}>⚠️ {getT(sourceLang, 'auth.emailNotVerified')}</span>
                      {emailVerifSent ? (
                        <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: '500' }}>✅ {getT(sourceLang, 'auth.verifEmailSent')}</span>
                      ) : (
                        <span
                          onClick={handleSendEmailVerification}
                          style={{ fontSize: '0.72rem', color: '#6366f1', cursor: 'pointer', fontWeight: '600', textDecoration: 'underline' }}
                        >
                          {getT(sourceLang, 'auth.sendVerifEmail')}
                        </span>
                      )}
                    </div>
                  )}
                  {!user.emailVerified && (
                    <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginLeft: '4px', marginTop: '1px' }}>
                      {getT(sourceLang, 'auth.verifEmailHint')}
                    </p>
                  )}
                </div>

                {/* 닉네임 */}
                <div className="input-wrapper">
                  <label className="input-label">{getT(sourceLang, 'auth.nickname')} <span className="required-star">*</span></label>
                  <div className="input-group">
                    <User size={18} className="input-icon" />
                    <input
                      type="text"
                      placeholder={getT(sourceLang, 'auth.nicknamePlaceholder')}
                      value={profileFormData.nickname}
                      onChange={(e) => setProfileFormData({ ...profileFormData, nickname: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* 전화번호 + SMS 인증 */}
                <div className="input-wrapper">
                  <label className="input-label">
                    {getT(sourceLang, 'auth.phone')}
                    {phoneVerifStep === 'verified' && (
                      <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 600, marginLeft: '6px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <CheckCircle2 size={12} /> {getT(sourceLang, 'auth.phoneVerified')}
                      </span>
                    )}
                  </label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                    <div className="input-group" style={{ gap: 0, flex: 1 }}>
                      <Phone size={18} className="input-icon" />
                      <select
                        value={profileFormData.phoneCountry}
                        onChange={(e) => {
                          setProfileFormData({ ...profileFormData, phoneCountry: e.target.value, phone: '' });
                          if (phoneVerifStep !== 'verified') { setPhoneVerifStep('idle'); setPhoneVerifMsg({ type: '', text: '' }); }
                        }}
                        className="phone-country-select"
                        disabled={phoneVerifStep === 'verified'}
                      >
                        {COUNTRY_PHONES.map(c => (
                          <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>
                        ))}
                      </select>
                      <input
                        type="tel"
                        placeholder={getT(sourceLang, 'auth.phonePlaceholder')}
                        value={profileFormData.phone}
                        onChange={(e) => {
                          setProfileFormData({ ...profileFormData, phone: formatPhoneByCountry(e.target.value, profileFormData.phoneCountry) });
                          if (phoneVerifStep !== 'verified') { setPhoneVerifStep('idle'); setPhoneVerifMsg({ type: '', text: '' }); }
                        }}
                        style={{ flex: 1 }}
                        disabled={phoneVerifStep === 'verified'}
                      />
                    </div>
                    {phoneVerifStep !== 'verified' && (
                      <button
                        type="button"
                        onClick={handleSendPhoneVerification}
                        disabled={phoneVerifStep === 'sending' || !profileFormData.phone.replace(/\D/g, '')}
                        style={{
                          padding: '0 12px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                          background: phoneVerifStep === 'sent' ? '#f0fdf4' : 'var(--primary-color)',
                          color: phoneVerifStep === 'sent' ? '#16a34a' : 'white',
                          fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap',
                          opacity: (phoneVerifStep === 'sending' || !profileFormData.phone.replace(/\D/g, '')) ? 0.5 : 1,
                          transition: 'all 0.2s'
                        }}
                      >
                        {phoneVerifStep === 'sending' ? '...' : phoneVerifStep === 'sent' ? getT(sourceLang, 'auth.phoneResend') : getT(sourceLang, 'auth.phoneSendCode')}
                      </button>
                    )}
                  </div>

                  {/* 인증 코드 입력 */}
                  {(phoneVerifStep === 'sent' || phoneVerifStep === 'verifying') && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <div className="input-group" style={{ flex: 1 }}>
                        <ShieldCheck size={18} className="input-icon" />
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder={getT(sourceLang, 'auth.phoneCodePlaceholder')}
                          value={phoneVerifCode}
                          onChange={(e) => setPhoneVerifCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleVerifyPhoneCode}
                        disabled={phoneVerifStep === 'verifying' || phoneVerifCode.length < 6}
                        style={{
                          padding: '0 14px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                          background: '#6366f1', color: 'white', fontSize: '0.8rem', fontWeight: 700,
                          opacity: (phoneVerifStep === 'verifying' || phoneVerifCode.length < 6) ? 0.5 : 1,
                          transition: 'all 0.2s'
                        }}
                      >
                        {phoneVerifStep === 'verifying' ? '...' : getT(sourceLang, 'auth.phoneVerify')}
                      </button>
                    </div>
                  )}

                  {/* 인증 메시지 */}
                  {phoneVerifMsg.text && phoneVerifStep !== 'verified' && (
                    <p style={{
                      fontSize: '0.72rem', marginLeft: '4px', marginTop: '3px', fontWeight: 500,
                      color: phoneVerifMsg.type === 'error' ? '#dc2626' : '#16a34a'
                    }}>
                      {phoneVerifMsg.type === 'error' ? '⚠️ ' : '✅ '}{phoneVerifMsg.text}
                    </p>
                  )}
                </div>

                {/* reCAPTCHA invisible container */}
                <div ref={recaptchaContainerRef} id="recaptcha-container" />

                <button type="submit" className="auth-submit-btn" style={{ marginTop: '6px' }}>
                  {getT(sourceLang, 'auth.saveChanges')}
                </button>
              </form>

              {/* 비밀번호 변경 섹션 (Email 가입자만) */}
              {!isGoogleUser && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                  {!pwChangeMode ? (
                    <button
                      onClick={() => setPwChangeMode(true)}
                      style={{
                        width: '100%', padding: '10px', background: 'none', border: '1.5px solid #e2e8f0',
                        borderRadius: '10px', color: '#64748b', fontSize: '0.85rem', fontWeight: '600',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                      }}
                    >
                      <Lock size={15} /> {getT(sourceLang, 'auth.changePassword')}
                    </button>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#4b5563', marginLeft: '4px' }}>{getT(sourceLang, 'auth.changePassword')}</label>
                      <div className="input-group">
                        <Lock size={18} className="input-icon" />
                        <input
                          type="password"
                          placeholder={getT(sourceLang, 'auth.currentPassword')}
                          value={pwForm.current}
                          onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                        />
                      </div>
                      <div className="input-group">
                        <Lock size={18} className="input-icon" />
                        <input
                          type="password"
                          placeholder={getT(sourceLang, 'auth.newPassword')}
                          value={pwForm.newPw}
                          onChange={(e) => setPwForm({ ...pwForm, newPw: e.target.value })}
                        />
                      </div>
                      <div className="input-group">
                        <Lock size={18} className="input-icon" />
                        <input
                          type="password"
                          placeholder={getT(sourceLang, 'auth.confirmNewPassword')}
                          value={pwForm.confirm}
                          onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                        />
                      </div>
                      {pwMsg.text && (
                        <div style={{
                          padding: '8px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '500',
                          background: pwMsg.type === 'error' ? '#fef2f2' : '#f0fdf4',
                          color: pwMsg.type === 'error' ? '#dc2626' : '#16a34a',
                          border: `1px solid ${pwMsg.type === 'error' ? '#fecaca' : '#bbf7d0'}`
                        }}>
                          {pwMsg.text}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => { setPwChangeMode(false); setPwMsg({ type: '', text: '' }); }}
                          style={{
                            flex: 1, padding: '9px', background: '#f1f5f9', border: 'none', borderRadius: '10px',
                            color: '#64748b', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer'
                          }}
                        >
                          {getT(sourceLang, 'auth.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={handleChangePassword}
                          style={{
                            flex: 1, padding: '9px', background: '#6366f1', border: 'none', borderRadius: '10px',
                            color: 'white', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer'
                          }}
                        >
                          {getT(sourceLang, 'auth.change')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 회원탈퇴 */}
              <div style={{ marginTop: '16px', borderTop: '1px solid #fecaca', paddingTop: '14px' }}>
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  style={{
                    width: '100%', padding: '10px', background: 'none', border: '1.5px solid #fca5a5',
                    borderRadius: '10px', color: '#dc2626', fontSize: '0.82rem', fontWeight: '600',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}
                >
                  {getT(sourceLang, 'auth.deleteAccount')}
                </button>
                <p style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center', marginTop: '6px' }}>
                  {getT(sourceLang, 'auth.deleteAccountDesc')}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 신규 유저 온보딩 팝업 */}
      {showOnboarding && (
        <OnboardingModal
          defaultSourceLang={sourceLang}
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* 회원탈퇴 확인 모달 */}
      {deleteConfirmStep === 1 && (
        <ConfirmModal
          title="PronunFit"
          message={getT(sourceLang, 'auth.deleteConfirm')}
          confirmText={getT(sourceLang, 'auth.deleteAccount')}
          cancelText={getT(sourceLang, 'auth.cancel')}
          danger
          onConfirm={() => setDeleteConfirmStep(2)}
          onCancel={() => setDeleteConfirmStep(0)}
        />
      )}
      {deleteConfirmStep === 2 && (
        <ConfirmModal
          title="PronunFit"
          message={getT(sourceLang, 'auth.deleteConfirm2')}
          confirmText={getT(sourceLang, 'auth.deleteAccount')}
          cancelText={getT(sourceLang, 'auth.cancel')}
          danger
          onConfirm={executeDeleteAccount}
          onCancel={() => setDeleteConfirmStep(0)}
        />
      )}

      {/* 모바일 Back 키 → 종료 토스트 */}
      {showExitToast && (
        <div style={{
          position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30,41,59,0.9)', color: 'white', padding: '12px 28px',
          borderRadius: '12px', fontSize: '0.85rem', fontWeight: 600,
          zIndex: 9999, whiteSpace: 'pre-line', textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          maxWidth: '85vw', width: 'max-content',
          animation: 'fadeInUp 0.25s ease-out',
        }}>
          {getT(sourceLang, 'exit.backToast') || '한 번 더 누르면 종료됩니다'}
        </div>
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
          {paymentToast === 'success' ? getT(sourceLang, 'upgrade.toastSuccess') : getT(sourceLang, 'upgrade.toastFail')}
        </div>
      )}
    </div>
  );
}

export default App;
