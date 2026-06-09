import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Languages, Sparkles, Settings as SettingsIcon, ArrowLeft, CheckCircle2, LogOut, User, Mail, Phone, X, Lock, Youtube, Volume2, BookOpen, BarChart3 } from 'lucide-react';
// [중요] 새 아이콘은 별도 import — 기존 라인 수정 시 Rollup 번들 순서 변경으로 TDZ 오류 발생
import { Menu, HelpCircle, ChevronDown, ChevronRight, ShieldCheck, Home, CreditCard, Headphones, MessageCircle, MessageCircleMore, Target, Mic, Gem, Gift, Bell, Info } from 'lucide-react';
import { Camera } from 'lucide-react'; // [신규] 카메라 OCR 버튼 아이콘
import ReferralModal from './components/ReferralModal';
import ReviewBonusModal from './components/ReviewBonusModal';
import BonusCampaignAnnounceModal from './components/BonusCampaignAnnounceModal';
import EmailVerifyChangeModal from './components/EmailVerifyChangeModal';
import { motion, AnimatePresence } from 'framer-motion';
import TranslationCard from './components/TranslationCard';
import { Analytics } from '@vercel/analytics/react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import './App.css';
import './components/Auth/Auth.css'; // [추가] 모달창 디자인을 위해 Auth.css 활용

// Firebase & Auth
import { auth, db, RecaptchaVerifier } from './firebase/config';
import { PhoneAuthProvider } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, query, getDocs, getDocsFromServer, where, increment } from 'firebase/firestore';
// ↑ [버그 수정] where 추가: saveToFirebase 함수에서 중복 데이터 검사에 `where`를 사용하는데
//   import 목록에서 빠져있어서 "where is not defined" 런타임 에러가 발생, 카드 저장이 안 됐습니다.
import { useAuthState } from 'react-firebase-hooks/auth';
import { signOut, signInAnonymously, signInWithPopup, signInWithCredential, GoogleAuthProvider as FirebaseGoogleAuthProvider, FacebookAuthProvider as FirebaseFacebookAuthProvider, getAdditionalUserInfo, sendEmailVerification, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { googleProvider, facebookProvider } from './firebase/config';
import { setDoc, getDoc, doc, updateDoc } from 'firebase/firestore';
import { useAuth, setAccountDeletionFlag } from './context/AuthContext';
import Login from './components/Auth/Login';
import Library from './components/Library'; // [신규] 보관함 컴포넌트
import Signup from './components/Auth/Signup';
import { getT, useT } from './utils/i18n';
import { loadReminderPrefs, saveReminderPrefs } from './utils/localNotifications';
import { setStreakReminderAlertPref } from './utils/pushNotifications';
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
import ListeningTab from './components/ListeningTab';
import ScenePractice, { ScenePracticeCard } from './components/ScenePractice';
import FreeTalkingChat from './components/FreeTalkingChat';
import FreeTalkingAnnounceModal from './components/FreeTalkingAnnounceModal';
import FreeTalkingPreGuideModal, { FREETALK_PREGUIDE_KEY } from './components/FreeTalkingPreGuideModal';
import DailyProgressPopup from './components/DailyProgressPopup';
import StreakCelebrationModal from './components/StreakCelebrationModal';
import StreakIntroModal from './components/StreakIntroModal';
import StreakStatusPopup from './components/StreakStatusPopup';
import HomePage from './components/HomePage';
import OnboardingModal from './components/OnboardingModal';
import RenewalReminderPopup from './components/RenewalReminderPopup';
import StatsPage from './components/StatsPage';
import BookmarkPromptModal from './components/BookmarkPromptModal';
import { useDailyProgress, getToday } from './hooks/useDailyProgress';
import { useStreak } from './hooks/useStreak';
import { useAdMob, AD_UNITS, IS_TESTING } from './hooks/useAdMob';
import { resetIOSViewport } from './utils/resetIOSViewport';
import AppGuide from './components/AppGuide';
import LandingPage from './components/LandingPage';
import AdBanner from './components/AdBanner';
import CameraOCRModal from './components/CameraOCRModal'; // [신규] 카메라 OCR 모달
import NotificationSettings from './components/NotificationSettings';
import PushOptInModal from './components/PushOptInModal';
import StarGuideModal from './components/StarGuideModal';
import SubscriptionEventModal from './components/SubscriptionEventModal';
import { useFeatureSeen, supportsFeature } from './utils/featureSeen';
import { COUNTRY_PHONES, formatPhoneByCountry, getCountryByLang } from './utils/phoneFormat';
import { isBot } from './utils/isBot';
import { playSuccessSound } from './utils/soundEffects';
import { assignNextCardSerial } from './utils/cardSerial';
import { getCachedAudio, putCachedAudio } from './utils/ttsAudioCache';
import { stripAnnotations } from './utils/stripAnnotations';

// [신규] AdSense 승인을 위한 법적 페이지 컴포넌트 (Privacy Policy, Terms, Contact)
import { PrivacyPolicyPage, TermsOfServicePage, ContactPage } from './components/Legal/LegalPages';

// [신규] 스플래시 화면 - 앱 아이콘으로 열 때 처음 보이는 로딩 화면
import SplashScreen from './components/SplashScreen';

// 언어 목록 중앙 관리 모듈
import { SUPPORTED_LANGUAGES, EXTRA_LANGUAGES, ALL_LANGUAGES, getLangName, getLangInfo } from './config/languages';
import { resolveFlag } from './config/languageFlags';
import { useUserCountry } from './hooks/useUserCountry';

// 브라우저/기기 언어를 감지하여 지원 언어 코드로 변환
const detectBrowserSourceLang = () => {
  try {
    const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    if (browserLang.startsWith('zh')) return 'zh-CN';
    const matched = SUPPORTED_LANGUAGES.find(l => browserLang.startsWith(l.code.toLowerCase()));
    return matched?.code || 'en';
  } catch (e) { return 'en'; }
};

// source 언어에 따른 스마트 기본 target 설정
const getDefaultTargetLangs = (src) => src === 'en' ? ['ko'] : ['en'];

const languageNames = Object.fromEntries(ALL_LANGUAGES.map(l => [l.code, l.name]));

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
    proFreeTalkCount, proListenCount, PRO_FREETALK_LIMIT, PRO_LISTEN_LIMIT,
    isProFreeTalkLimitReached, isProListenLimitReached, isProPronLimitReached,
    incrementProFreeTalk, incrementProListen,
    TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, TRIAL_DAILY_LISTEN_LIMIT,
    isTrialPronLimitReached, isTrialFreeTalkLimitReached, isTrialListenLimitReached,
    setDailyTrialPronReached, setDailyTrialFreeTalkReached, setDailyTrialListenReached,
    incrementTrialCard, incrementSavedCard, incrementTotalFreeTalk,
    incrementSceneGenerate, incrementVocabGenerate, incrementListenGenerate,
    bonusPoints, hasBonusActive, consumeBonusPoints,
    freeTalkCredits, pronCredits, listenCredits, consumeFreeTalkCredits, consumePronCredits, consumeListenCredits,
    reviewBonusClaimed,
    byokGeminiKey, byokAzureKey, byokAzureRegion,
    ensureAnonymousUser,
  } = useAuth();

  // 사용자 국가 (언어별 국기 표시 변형용 — phoneCountry > navigator.language > geoCountry)
  const userCountry = useUserCountry();

  // 신규 기능 "알림" NEW 뱃지 — 사용자가 설정에서 토글 한 번이라도 건드릴 때까지 표시
  const { seen: notificationsSeen } = useFeatureSeen(user?.uid, 'notifications', profile);
  // 구독 성공 직후 push opt-in 모달 제어 (D)
  const [showPushOptIn, setShowPushOptIn] = useState(false);
  const prevTierRef = useRef(null);
  // 이번 세션에서 PushOptIn 모달이 한 번이라도 닫혔는지 — 같은 세션 내 재발화 차단
  // (Firestore serverTimestamp pending 시 toDate()=null로 7일 스누즈 검사 통과해버리는 race 방지)
  const pushPromptDismissedRef = useRef(false);

  // 구독 이벤트 팝업 (renewal/expiration/billingIssue/cancellation)
  const [subscriptionEvent, setSubscriptionEvent] = useState(null);
  const subscriptionSectionRef = useRef(null);

  // 이벤트당 1회만 표시 (eventId = `${type}.${tierUpdatedAt}` 기반 localStorage 기록)
  const tryShowSubscriptionEvent = useCallback((type) => {
    if (!['renewal', 'expiration', 'billingIssue', 'cancellation'].includes(type)) return;
    const ts = profile?.tierUpdatedAt;
    const millis = ts?.toMillis?.() ?? (ts?.seconds ? ts.seconds * 1000 : Date.now());
    const eventId = `${type}.${millis}`;
    try {
      if (localStorage.getItem(`pronunfit.shown.subEvent.${eventId}`) === '1') return;
      localStorage.setItem(`pronunfit.shown.subEvent.${eventId}`, '1');
    } catch {}
    setSubscriptionEvent({ type });
  }, [profile?.tierUpdatedAt]);

  // 로컬 알림 탭 리스너 — 매일 리마인더(id=1001) 탭 시 홈 탭으로 이동
  // (기본 Capacitor는 탭 시 앱을 foreground로 올리지만 "포그라운드에서 탭" 시엔 JS 이벤트만 fire)
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    let handle;
    (async () => {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        handle = await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
          console.log('[LocalNotif] tap:', action.notification?.id);
          if (action.notification?.id === 1001) {
            setViewMode('home');
            setSidebarOpen(false);
          }
        });
      } catch (e) {
        console.warn('[LocalNotif] listener setup failed:', e.message);
      }
    })();
    return () => { if (handle) handle.remove?.(); };
  }, []);

  // FCM 푸시 알림 전역 리스너 — 앱 시작 시 1회 등록
  // - Android: PushNotifications 'registration' → FCM token (기존 경로)
  // - iOS: FirebaseMessaging 'tokenReceived' → FCM token (2026-05-19 신규, APNs hex 회피)
  // - 'pushNotificationActionPerformed' → 탭 시 화면 이동 (subscription → 설정 탭)
  // 앱 열림은 Android/iOS가 기본 PendingIntent로 처리, 이 리스너는 "화면 라우팅"만 담당
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    const removers = [];
    const isIOS = Capacitor.getPlatform() === 'ios';
    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const { saveFcmTokenToFirestore, attachIOSFCMTokenListener, registerIOSFCM } = await import('./utils/pushNotifications');

        // Android: PushNotifications.registration이 FCM token 반환
        // iOS: PushNotifications.registration은 APNs hex(invalid) → 무시. FirebaseMessaging.tokenReceived로 대체
        const hReg = await PushNotifications.addListener('registration', async (token) => {
          if (isIOS) {
            console.log('[Push] iOS registration event ignored (APNs hex) — handled by FirebaseMessaging.tokenReceived');
            return;
          }
          const tk = token?.value;
          const uid = auth.currentUser?.uid;
          console.log('[Push] registration event fired:', { hasToken: !!tk, hasUid: !!uid });
          if (!tk || !uid) {
            console.warn('[Push] registration skipped — missing token or uid', { tk: !!tk, uid: !!uid });
            return;
          }
          const res = await saveFcmTokenToFirestore(uid, tk);
          console.log('[Push] global listener saveFcmTokenToFirestore:', res);
        });
        removers.push(hReg);

        // iOS 전용: FirebaseMessaging의 tokenReceived (초기 + refresh)
        if (isIOS) {
          const unsubIOS = await attachIOSFCMTokenListener(() => auth.currentUser?.uid);
          removers.push({ remove: unsubIOS });
        }

        const hAction = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('[Push] tap:', action.notification?.data);
          const pushType = action.notification?.data?.type;
          // 구독 이벤트 타입이면 팝업 표시 (eventId로 중복 방지)
          if (['renewal', 'expiration', 'billingIssue', 'cancellation'].includes(pushType)) {
            tryShowSubscriptionEvent(pushType);
          }
          // 학습 재참여 유도 push (streak_reminder / streak_risk / reengagement_starter / reengagement_engaged)
          // → 홈 + StarGuide 환영 팝업. 네 종류 모두 "다시 학습 시작" 동기 부여 메시지라 동일 동선.
          // 2026-05-23: 기존엔 streak_* 만 StarGuide 트리거하고 reengagement_* 는 홈 이동만 했는데
          // 두 카테고리 본질적으로 같은 의도라 통합 (단일 prefix-or 조건).
          if (typeof pushType === 'string' &&
              (pushType.startsWith('streak_') || pushType.startsWith('reengagement_'))) {
            console.log('[Push] learning re-entry push → setForceStarGuideFromPush(true)', { pushType });
            setViewMode('home');
            setForceStarGuideFromPush(true);
          }
        });
        removers.push(hAction);

        const hErr = await PushNotifications.addListener('registrationError', (err) => {
          console.warn('[Push] registrationError event:', {
            error: err?.error,
            raw: JSON.stringify(err),
          });
        });
        removers.push(hErr);

        // 리스너 중복 등록 방지 플래그 — 토글/모달/AuthContext가 재등록 안 하도록
        window.__pushListenersBound = true;

        // 권한 이미 부여된 경우 자동으로 토큰 최신화
        //   Android: PushNotifications.register() → 'registration' 이벤트
        //   iOS: registerIOSFCM() → FirebaseMessaging.getToken() 명시 호출 + Firestore 저장
        if (isIOS) {
          const uid = auth.currentUser?.uid;
          if (uid) {
            const r = await registerIOSFCM(uid);
            console.log('[Push-iOS] initial registerIOSFCM:', r);
          }
        } else {
          const perm = await PushNotifications.checkPermissions();
          if (perm.receive === 'granted') {
            await PushNotifications.register();
          }
        }
      } catch (e) {
        console.warn('[App] push listener setup failed:', e?.message);
      }
    })();
    return () => { removers.forEach(h => { try { h.remove?.(); } catch {} }); };
  }, []);

  // Web FCM foreground 메시지 리스너 — 네이티브가 아닐 때만 발화
  // 브라우저는 foreground 시 시스템 알림 자동 표시 안 함 → 수동으로 Notification 띄움
  // background 메시지는 firebase-messaging-sw.js가 처리
  useEffect(() => {
    if (Capacitor.isNativePlatform?.()) return;
    let unsub = null;
    (async () => {
      try {
        const { attachWebFCMForegroundListener } = await import('./utils/pushNotifications');
        unsub = await attachWebFCMForegroundListener((payload) => {
          const title = payload?.notification?.title || payload?.data?.title;
          const body = payload?.notification?.body || payload?.data?.body || '';
          if (!title) return;
          // 시스템 알림 직접 표시 (foreground UX — 사용자가 다른 탭을 보고 있을 수 있음)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification(title, { body, icon: '/icon-192.png' }); } catch {}
          }
        });
      } catch (err) {
        console.warn('[Push-Web] foreground listener setup failed:', err?.message);
      }
    })();
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // 네이티브 앱 버전 추적 — 앱 실행 시마다 users.currentNativeVersion + currentNativePlatform 업데이트
  // + 최초 1회 users.firstNativeVersion + firstNativePlatform 설정 (향후 feature launch 판정용)
  // iOS/Android 버전이 독립적으로 관리되므로 플랫폼 필드 함께 저장 (예: iOS v1.2.4 vs Android v1.2.7)
  // 웹은 네이티브 버전 없으므로 skip
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    if (!user?.uid || !profile) return;

    // ⚠ dynamic import 사용 금지 — 과거 hang 사례(memory/changes-0419-session3.md) 재발 방지.
    //   @capacitor/app, firebase/firestore, ./firebase/config는 모두 파일 상단에 이미 static import됨.
    //   여기서 또 await import(...) 하면 plugin 호출 hang 가능성 → 함수 영영 pending → updateDoc 미실행.
    (async () => {
      try {
        const info = await CapacitorApp.getInfo();
        const version = info?.version;
        const platform = Capacitor.getPlatform(); // 'android' | 'ios'
        if (!version) {
          console.warn('[Version] CapacitorApp.getInfo returned no version');
          return;
        }

        // 이미 동일 버전+플랫폼이 기록돼 있으면 skip (불필요 Firestore write 방지)
        if (profile.currentNativeVersion === version &&
            profile.currentNativePlatform === platform &&
            profile.firstNativeVersion) return;

        const updateData = {
          currentNativeVersion: version,
          currentNativePlatform: platform,
          currentNativeVersionUpdatedAt: serverTimestamp(),
        };
        if (!profile.firstNativeVersion) {
          updateData.firstNativeVersion = version;
          updateData.firstNativePlatform = platform;
          updateData.firstNativeVersionSetAt = serverTimestamp();
        }
        await updateDoc(doc(db, 'users', user.uid), updateData);
        console.log('[Version] tracked:', platform, version, 'first:', !profile.firstNativeVersion);
      } catch (e) {
        console.warn('[Version] tracking failed:', e?.message);
      }
    })();
    // !!profile 필수 — Strategy A 적용 후 user는 set, profile은 잠시 후 set이 됨.
    // 만약 profile.X 4개만 dep에 두면, profile이 null→object 전환 시 (모든 .X가 undefined→undefined)
    // 변화 감지 안 되어 effect가 재실행 안 됨 → 버전 필드 영영 미기록 + supportsFeature false →
    // 푸시 모달 안 뜸 + 신규 기능 발견 안 됨. !!profile은 이 전환을 명시적으로 잡아줌.
  }, [user?.uid, !!profile, profile?.currentNativeVersion, profile?.currentNativePlatform, profile?.firstNativeVersion]);

  // Tier 변경 감지 — PushOptIn 모달 (trial→paid) + SubscriptionEvent 팝업 (paid→trial)
  useEffect(() => {
    const curr = profile?.tier;
    const prev = prevTierRef.current;
    if (!prev) { prevTierRef.current = curr; return; }
    if (prev === curr) return;

    const becamePaid = (prev === 'trial' || prev === null) && (curr === 'pro' || curr === 'premium');
    const lostPaid = (prev === 'pro' || prev === 'premium') && curr === 'trial';
    prevTierRef.current = curr;

    if (becamePaid) {
      // PushOptIn 모달 트리거 (토큰 없고 7일 스누즈 아닐 때)
      if (Array.isArray(profile?.fcmTokens) && profile.fcmTokens.length > 0) return;
      // 버전 가드 — 네이티브 플러그인 미포함 버전 유저에겐 모달 표시 안 함 (에러 방지)
      if (!supportsFeature('notifications', profile)) return;
      try {
        const snoozedAt = parseInt(localStorage.getItem('pronunfit.pushOptIn.snoozedAt') || '0', 10);
        if (snoozedAt && (Date.now() - snoozedAt) < 7 * 24 * 60 * 60 * 1000) return;
      } catch {}
      const timer = setTimeout(() => setShowPushOptIn(true), 1500);
      return () => clearTimeout(timer);
    }

    if (lostPaid) {
      // Firestore subscriptionExpiresAt이 아직 유효하면 RC sync 일시 오탐 가능성 → 팝업 보류
      // (실제 만료는 서버 webhook → push 경로 또는 만기 후 재동기화에서 처리)
      const expiresAtRaw = profile?.subscriptionExpiresAt;
      const expiresAt = expiresAtRaw?.toDate?.()
        ?? (expiresAtRaw ? new Date(expiresAtRaw) : null);
      if (expiresAt && new Date() < expiresAt) return;
      // 만료/결제실패 → expiration 팝업 (push 못 받았거나 탭 놓친 유저 대상 fallback)
      tryShowSubscriptionEvent('expiration');
    }
  }, [profile?.tier, profile?.fcmTokens, profile?.subscriptionExpiresAt, tryShowSubscriptionEvent]);

  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  // 웹: 이미 앱에 진입한 적 있으면 랜딩 건너뜀 (anonymous 복원 시 재진입 방지)
  // 봇(AdSense/검색엔진)은 랜딩 우회 → 앱 콘텐츠 크롤링 허용
  // 랜딩 페이지는 웹 전용 — 네이티브 앱에서는 항상 건너뜀
  const [showLanding, setShowLanding] = useState(
    () => !window.Capacitor?.isNativePlatform?.() && !isBot() && localStorage.getItem('webAppEntered') !== '1'
  );
  const [showAccountUpgrade, setShowAccountUpgrade] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [showReviewBonusModal, setShowReviewBonusModal] = useState(false);
  const [showAnonGateModal, setShowAnonGateModal] = useState(false); // 익명 사용자 → 가입 안내
  const [showBonusCampaign, setShowBonusCampaign] = useState(false);
  // Streak 출시 안내 — 온보딩 직후 다음 세션부터, "다시 보지 않음" 체크 시 영구 종료
  const [showStreakIntro, setShowStreakIntro] = useState(false);
  // 일일 Streak 상태 안내 — Streak intro 영구 dismiss 이후, 매일 첫 접속 시 다른 팝업 다음에 마지막으로 표시
  const [showStreakStatus, setShowStreakStatus] = useState(false);
  // BonusCampaign "지금 추천하기" → 사이드바 자동 오픈 + 친구추천 버튼으로 스크롤·하이라이트
  const referralBtnRef = useRef(null);
  const [focusReferralPending, setFocusReferralPending] = useState(false);
  const [referralHighlight, setReferralHighlight] = useState(false);
  const [showEmailVerifyChange, setShowEmailVerifyChange] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAnonSignupPrompt, setShowAnonSignupPrompt] = useState(false);
  const [showExtraLangs, setShowExtraLangs] = useState(false);
  // 설정 화면 sub-screen (단계적 진입) — 'main' | 'account' | 'language' | 'learning' | 'notif' | 'subscription' | 'about'
  const [settingsScreen, setSettingsScreen] = useState('main');
  // 로그인 성공 시 모달 자동 닫기
  useEffect(() => {
    if (showLoginModal && user && !user.isAnonymous) setShowLoginModal(false);
  }, [user, showLoginModal]);

  // anonymous 유저: 날짜 바뀐 첫 방문 시 사이드바 + 가입 유도 팝업 자동 표시
  useEffect(() => {
    if (!user?.isAnonymous) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
  // showInAppWarning 삭제됨 (인앱 브라우저 경고 제거)

  // Free Talking (Sprint 1) — 카카오톡 스타일 풀스크린 채팅 모달
  const [freeTalkOpen, setFreeTalkOpen] = useState(false);
  const [freeTalkSetup, setFreeTalkSetup] = useState(null);
  const [freeTalkPreGuide, setFreeTalkPreGuide] = useState(null); // 채팅 진입 전 사전 안내 게이트(시나리오 args 보관)
  // Free Talking 신기능 안내 (Sprint 3-3) — 기존 사용자 한정 1회
  const [freeTalkAnnounceOpen, setFreeTalkAnnounceOpen] = useState(false);

  // Trial 한도 도달 모달 / BYOK API 키 설정 마법사
  const [showTrialLimitModal, setShowTrialLimitModal] = useState(false);
  // 2026-06-07: 한도 모달 사유 — 'cap'(하드캡 도달, 충전 무의미) / 'points'(포인트 부족, 충전 가능)
  const [trialLimitReason, setTrialLimitReason] = useState('cap');
  const [showApiKeyWizard, setShowApiKeyWizard] = useState(false);
  // 2026-05-07 v1.5.0: 카드 한도 폐기 — trialCardCurrentCount state 제거됨 (사용처 없음).

  // 업그레이드 모달 — false | 'pro' | 'premium' | true (전체 표시)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // TossPayments 빌링 성공 후 URL 파라미터 처리
  const [paymentToast, setPaymentToast] = useState(''); // 'success' | 'fail' | ''
  const [paymentSuccessModal, setPaymentSuccessModal] = useState(null); // null | { tier: 'pro'|'premium' }
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
        .then(async r => {
          const data = await r.json();
          if (r.status === 409) {
            alert(getT(sourceLang, 'upgrade.duplicateSubscription'));
            return;
          }
          if (data.success) {
            setPaymentSuccessModal({ tier: tierParam });
          } else {
            setPaymentToast('fail');
            setTimeout(() => setPaymentToast(''), 4000);
          }
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
  const [pendingUpgradeTier, setPendingUpgradeTier] = useState(null); // 인증 완료 후 구독 모달 복귀용

  // 익명 유저가 구독 시도 시 → 무료계정 생성 먼저 유도
  const requestUpgrade = (tier) => {
    if (user?.isAnonymous) {
      setPendingUpgradeTier(typeof tier === 'string' ? tier : 'pro');
      setShowAccountUpgrade(true);
      return;
    }
    setShowUpgradeModal(tier);
  };
  const closeProfileModal = () => {
    setShowProfileModal(false);
    if (pendingUpgradeTier) {
      setShowUpgradeModal(pendingUpgradeTier);
      setPendingUpgradeTier(null);
    }
  };

  // 언어별 목표 점수를 저장하는 상태 (기본값 80점)
  const [languageGoals, setLanguageGoals] = useState(() => {
    try {
      const saved = localStorage.getItem('languageGoals');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // [신규] 언어별 기본 학습 난이도 맵 ({ en:'advanced', ja:'basic', ... }).
  // languageGoals와 동일하게 localStorage 전용. 미설정 언어는 || userLevel || 'basic' 폴백.
  const [languageLevels, setLanguageLevels] = useState(() => {
    try {
      const saved = localStorage.getItem('languageLevels');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  // 하루 학습 목표 카드 수 (기본 3장 — 2026-05-05 retention 정책 변경: 10장 → 3장)
  // 1회성 강제 마이그레이션: 기존 유저의 localStorage 값(10장 default 또는 본인 설정값)도
  // 새 default(3장)로 reset. dailyGoalMigrated_v3 플래그로 1회만 실행 — 이후 사용자가
  // 슬라이더로 변경한 값은 그대로 보존됨.
  const [dailyGoal, setDailyGoal] = useState(() => {
    try {
      const MIGRATION_KEY = 'dailyGoalMigrated_v3_2026_05_05';
      if (!localStorage.getItem(MIGRATION_KEY)) {
        localStorage.setItem('dailyGoal', '3');
        localStorage.setItem(MIGRATION_KEY, '1');
        return 3;
      }
      return parseInt(localStorage.getItem('dailyGoal') || '3', 10);
    }
    catch (e) { return 3; }
  });

  // Daily progress hook
  const { todayCount, todaySaveCount, todayPronCount, todayListenCount, todayFreeTalkCount, weeklyData, incrementAchievement, incrementDailySave, incrementDailyPron, incrementDailyListen, incrementDailyGenerate, incrementDailyFreeTalk } = useDailyProgress(user, dailyGoal);

  // Streak 시스템 — 마일스톤 7/14/30/100일 자동 보너스 (Phase 1)
  const { streakCurrent, streakLongest, totalAchievedDays, earnedMilestones, nextMilestone, nextReward, daysToNext, celebration, dismissCelebration } = useStreak(user, weeklyData, dailyGoal, profile);

  // Phase 2 자동 reschedule useEffect: sourceLang TDZ 회피를 위해 sourceLang useState 선언
  // 이후 위치로 이동됨 (App.jsx 하단부). 여기서는 placeholder만.

  // Trial 일일 Free Talking 세션 한도 — AuthContext 의 TRIAL_FREETALK_DAILY_LIMIT (2회) 사용
  // Pro/Premium 은 무제한 (세션당 자유 발화 25/300턴 한도만 useConversation 내부 적용)
  // isTrialFreeTalkLimitReached / isTrialPronLimitReached 는 AuthContext 에서 주입 (hasBonusActive + credits 통합 판정).

  // 플랫폼 CSS 클래스 (React 렌더 시점 = Capacitor 브릿지 확실히 준비됨)
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const cls = `platform-${Capacitor.getPlatform()}`;
    document.documentElement.classList.add(cls, 'platform-native');
    document.body?.classList.add(cls, 'platform-native');
  }, []);

  // iOS WKWebView visual viewport zoom stuck 해결
  // — Apple/Google/Facebook OAuth dialog 또는 input focus가 dismiss될 때
  //   WKWebView가 zoom 상태로 stuck되는 알려진 버그.
  // — auth state(logout/login/anonymous 전환) 변경 시 viewport meta를 잠깐 lock해서
  //   WKWebView가 visual viewport를 강제 재평가하게 만든다.
  // — Android/Web은 유틸 내부 platform 체크로 즉시 return → 영향 0.
  React.useEffect(() => {
    resetIOSViewport();
  }, [user]);

  // AdMob 배너 광고 (네이티브 전용, Pro/Premium 제외)
  // profile 미로드 시 tier=null 전달 → useAdMob 내부 isReady 가드로 ATT/배너 보류.
  // (profile?.tier가 'trial' 폴백이라 Pro 유저 콜드스타트 시 ATT 깜빡임 발생하던 것 차단)
  // ATT 시스템 다이얼로그가 온보딩 도중 끼어드는 것을 막기 위해 AI Consent 완료 전에는 보류.
  // 이 게이트로 ATT는 항상 "온보딩 → AI Consent" 다음에 발화.
  const aiConsentReady = !!profile?.aiConsentAt
    || (typeof window !== 'undefined' && window.localStorage?.getItem('aiConsentAccepted') === '1');
  useAdMob(profile && aiConsentReady ? tier : null);

  // ATT(광고 추적) 승인 상태를 Firestore에 저장 (iOS, 1회)
  React.useEffect(() => {
    if (!user || Capacitor.getPlatform() !== 'ios') return;
    // useAdMob에서 ATT 결과를 window.__attStatus에 저장 → 여기서 Firestore에 기록
    const checkAtt = setInterval(() => {
      if (window.__attStatus) {
        clearInterval(checkAtt);
        const status = window.__attStatus;
        if (!profile?.attStatus || profile.attStatus !== status) {
          updateUserProfile({ attStatus: status, attUpdatedAt: new Date() }).catch(() => {});
        }
      }
    }, 1000);
    // 10초 후 폴링 중단 (ATT가 안 뜨는 경우 대비)
    const timeout = setTimeout(() => clearInterval(checkAtt), 10000);
    return () => { clearInterval(checkAtt); clearTimeout(timeout); };
  }, [user?.uid]);

  // RevenueCat 초기화 (네이티브 앱, 앱 시작 시 1회)
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !user) return;
    const rcApiKey = Capacitor.getPlatform() === 'ios'
      ? import.meta.env.VITE_REVENUECAT_IOS_KEY
      : import.meta.env.VITE_REVENUECAT_ANDROID_KEY;
    if (!rcApiKey) return;
    (async () => {
      try {
        const { Purchases, LOG_LEVEL } = await import('@revenuecat/purchases-capacitor');
        await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
        await Purchases.configure({ apiKey: rcApiKey, appUserID: user.uid });
        console.log('[RevenueCat] Configured for', user.uid);
        // 포인트 상품(소비성) 가격 조회 — 사이드바 구매 버튼 가격 표시용
        try {
          const { products } = await Purchases.getProducts({ productIdentifiers: [POINTS_PRODUCT_ID], type: 'INAPP' });
          if (products?.[0]?.priceString) setPointsPriceString(products[0].priceString);
        } catch (pe) { console.warn('[RevenueCat] points product fetch failed:', pe?.message); }
        // Google Play 구매 내역 복원 + Firestore 직접 동기화
        try {
          const { customerInfo } = await Purchases.restorePurchases();
          const active = customerInfo?.entitlements?.active || {};
          let rcTier = null;
          if (active['Premium']) rcTier = 'premium';
          else if (active['Pro']) rcTier = 'pro';

          if (rcTier) {
            // Toss 활성 구독이 있으면 RevenueCat으로 덮어쓰지 않음
            const currentDoc = await getDoc(doc(db, 'users', user.uid));
            const currentData = currentDoc.exists() ? currentDoc.data() : {};
            const tossExpires = currentData.subscriptionExpiresAt?.toDate
              ? currentData.subscriptionExpiresAt.toDate()
              : currentData.subscriptionExpiresAt ? new Date(currentData.subscriptionExpiresAt) : null;
            if (currentData.tierSource === 'toss' && currentData.autoRenew === true && tossExpires && tossExpires > new Date()) {
              console.log('[RevenueCat] SKIP sync — active Toss subscription');
            } else {
              const rcEnt = active['Premium'] || active['Pro'];
              const syncData = {
                tier: rcTier,
                tierSource: 'revenuecat',
                autoRenew: rcEnt?.willRenew || false,
                updatedAt: serverTimestamp(),
              };
              if (rcEnt?.expirationDate) {
                syncData.subscriptionExpiresAt = new Date(rcEnt.expirationDate);
              }
              if (rcEnt?.productIdentifier) {
                syncData.planId = rcEnt.productIdentifier;
                syncData.subscriptionMonths = rcEnt.productIdentifier.includes('_3') ? 3 : 1;
              }
              await setDoc(doc(db, 'users', user.uid), syncData, { merge: true });
              console.log(`[RevenueCat] Synced to Firestore: ${rcTier}`, syncData);
            }
          } else {
            // 활성 구독 없음 → 현재 pro/premium이면 다운그레이드
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const userData = userDoc.exists() ? userDoc.data() : {};
            if ((userData.tier === 'pro' || userData.tier === 'premium') && userData.tierSource === 'revenuecat') {
              // Firestore subscriptionExpiresAt이 아직 유효하면 RC 일시 miss / promo 미반영일 수 있으므로 다운그레이드 보류
              const expiresAtRaw = userData.subscriptionExpiresAt;
              const expiresAt = expiresAtRaw?.toDate?.()
                ?? (expiresAtRaw ? new Date(expiresAtRaw) : null);
              if (expiresAt && new Date() < expiresAt) {
                console.log('[RevenueCat] restore: no entitlement but Firestore expiry still valid — skip downgrade');
              } else {
                await setDoc(doc(db, 'users', user.uid), {
                  tier: 'trial',
                  autoRenew: false,
                  updatedAt: serverTimestamp(),
                }, { merge: true });
                console.log('[RevenueCat] No active entitlement → downgraded to trial');
              }
            }
          }
        } catch (restoreErr) {
          console.warn('[RevenueCat] Restore failed (non-blocking):', restoreErr?.message);
        }
      } catch (e) {
        console.error('[RevenueCat] Init failed:', e?.message);
      }
    })();
  }, [user?.uid]);

  // 2026-06-07 개편: 통합 포인트 풀(bonusPoints) 차감. 전면광고/AdPoint(localStorage) 시스템 제거.
  //   addAdPoints(points, {bonusCost}) → bonusCost(없으면 points)만큼 풀에서 차감(best-effort, Trial 전용).
  //   차단(게이팅)은 AuthContext isTrialXLimitReached(하드캡 OR 포인트 부족)가 담당 — 여기선 차감만.
  //   액션 비용: FreeTalk 10 / Listening 5 / Pron 2 / Vocab·Scene 1 / TTS 1 (호출처의 bonusCost 그대로).
  const addAdPoints = async (points, options = {}) => {
    if (tier !== 'trial') return;
    const cost = options.bonusCost ?? points;
    if (cost > 0) await consumeBonusPoints(cost);
  };

  // 구버전 키 정리 (1회)
  useEffect(() => {
    try { localStorage.removeItem('interstitialSaveCount'); } catch {}
  }, []);

  // 발음 평가 성공 핸들러 — 2026-06-07 개편: 하드캡 카운터 +1 + 통합 풀 2점 차감.
  //   진입 게이트(isTrialPronLimitReached = 하드캡 OR 포인트<2)가 useAudioRecorder 에서 사전 차단하므로
  //   여기 도달 = 허용된 발음. 항상 일일 카운터 증가(하드캡 집계) + 풀 차감(addAdPoints가 trial 가드).
  const onPronSuccess = useCallback(async () => {
    incrementDailyPron();
    addAdPoints(1, { bonusCost: 2 }); // 풀 -2 (Pron 비용)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incrementDailyPron]);

  // 2026-06-07: 한도 모달 호출 — feature별 하드캡 도달 여부로 사유 판정.
  //   하드캡 도달 → 'cap'(충전 무의미, 업그레이드만) / 그 외(=포인트 부족) → 'points'(충전 가능).
  const requestLimitModal = useCallback((feature) => {
    const capReached =
      feature === 'pron' ? todayPronCount >= TRIAL_DAILY_PRON_LIMIT :
      feature === 'freeTalk' ? todayFreeTalkCount >= TRIAL_FREETALK_DAILY_LIMIT :
      feature === 'listen' ? todayListenCount >= TRIAL_DAILY_LISTEN_LIMIT : false;
    setTrialLimitReason(capReached ? 'cap' : 'points');
    setShowTrialLimitModal(true);
  }, [todayPronCount, todayFreeTalkCount, todayListenCount, TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, TRIAL_DAILY_LISTEN_LIMIT]);

  // 2026-06-07: Pro 월별 한도 도달 모달 — "다음 달 리셋 + Premium 업셀"(Trial 'cap'/'points'와 별개).
  const requestProLimitModal = useCallback(() => {
    setTrialLimitReason('proMonthly');
    setShowTrialLimitModal(true);
  }, []);

  // 2026-06-07: TTS 신규 합성 1점 게이트 — true=허용(차감 완료/무료), false=차단(포인트부족 팝업).
  //   캐시 hit(메모리/IndexedDB/보존오디오)은 호출 전에 이미 return → 재청취는 무료.
  //   신규 합성(서버 fetch)에만 적용. Trial 0점 → 차단+팝업. Pro/Premium은 무료 통과.
  const tryConsumeTtsPoint = useCallback(() => {
    if (tier !== 'trial') return true;
    if (bonusPoints < 1) { requestLimitModal('tts'); return false; }
    consumeBonusPoints(1);
    return true;
  }, [tier, bonusPoints, consumeBonusPoints, requestLimitModal]);

  // ── 보상형 광고 (Trial 전용, Firestore 영구 적립) ─────────────────────────
  // 2026-05-07 v1.5.0: rewardBonus_{date} localStorage 시스템 폐기.
  //   freeTalks 광고 → freeTalkCredits +2 (영구), prons 광고 → pronCredits +5 (영구).
  //   사용할 때까지 Firestore 에 보관, 자정 리셋 없음 → 미사용분 손실 X.
  //   2026-05-19: pronCredits +10 → +5 (Azure 비용 vs 광고 eCPM break-even 회복)
  const [rewardAdLoading, setRewardAdLoading] = useState(false);
  // 2026-06-07: 인앱 포인트 구매(소비성, +200) — 가격 표시 + 구매 진행 상태
  const POINTS_PRODUCT_ID = 'pronunfit_points_200';
  const [pointsPriceString, setPointsPriceString] = useState('');
  const [buyingPoints, setBuyingPoints] = useState(false);

  // 인앱 포인트 구매 — RC StoreProduct 구매 → 서버 webhook(NON_RENEWING_PURCHASE)이 +200 적립(멱등).
  //   클라는 결제 dialog만 띄우고, 적립은 webhook → Firestore onSnapshot 으로 자동 반영.
  const handleBuyPoints = async () => {
    if (!window.Capacitor?.isNativePlatform?.() || !user || buyingPoints) return;
    setBuyingPoints(true);
    try {
      const { Purchases } = await import('@revenuecat/purchases-capacitor');
      const { products } = await Purchases.getProducts({ productIdentifiers: [POINTS_PRODUCT_ID], type: 'INAPP' });
      const product = products?.[0];
      if (!product) throw new Error('point product not found');
      await Purchases.purchaseStoreProduct({ product });
      // 성공 — 적립은 webhook(async). 안내만.
      alert(getT(sourceLang, 'reward.buySuccess') || '구매 완료! 곧 200포인트가 반영됩니다.');
    } catch (e) {
      if (!e?.userCancelled) {
        console.error('[BuyPoints] 실패:', e);
        alert(getT(sourceLang, 'reward.buyFail') || '구매에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setBuyingPoints(false);
    }
  };

  // 2026-06-07 개편: 보상광고 시청 → 통합 포인트 풀 +5 (서버 검증 경유, 클라 직접 increment 금지).
  //   type 인자 제거 — 단일 "보너스 충전" 버튼. AdMob unit은 기존 rewardedCards 재사용.
  const handleRewardedAd = async () => {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    if (!user) return;
    setRewardAdLoading(true);
    const handles = [];
    try {
      const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob');
      const adId = AD_UNITS.rewardedCards;

      await new Promise(async (resolve, reject) => {
        // 리스너를 prepare 전에 먼저 등록
        handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, async () => {
          // 서버 검증 엔드포인트 경유 +5 충전 (쿨다운/일일상한 가드). 클라 직접 increment 금지(위변조).
          try {
            const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            await authFetch(`${SERVER_URL}/api/bonus/ad-reward`, { method: 'POST' });
          } catch (e) { console.error('[RewardedAd] 충전 실패:', e); }
          resolve();
        }));
        handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          // 보상광고 dismiss 시 별도 처리 없음. (과거 v1.5.82 triggerForcedIdle 강제
          // idle 호출은 진입 애니메이션을 멈춰 UX 회귀를 일으켜 폐기됐고, idle 로직 제거됨.)
          resolve();
        }));
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

  // Trial 일간 제한 동기화 — daily 한도(점수와 무관) + credits 보유 여부는 AuthContext 가 통합 판정.
  // 2026-05-07 v1.5.0: 카드 한도 폐기. 발음/FT 만 동기화.
  useEffect(() => {
    if (tier === 'trial') {
      setDailyTrialPronReached(todayPronCount >= TRIAL_DAILY_PRON_LIMIT);
      setDailyTrialFreeTalkReached(todayFreeTalkCount >= TRIAL_FREETALK_DAILY_LIMIT);
      setDailyTrialListenReached(todayListenCount >= TRIAL_DAILY_LISTEN_LIMIT);
    } else {
      setDailyTrialPronReached(false);
      setDailyTrialFreeTalkReached(false);
      setDailyTrialListenReached(false);
    }
  }, [tier, todayPronCount, todayFreeTalkCount, todayListenCount, TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, TRIAL_DAILY_LISTEN_LIMIT, setDailyTrialPronReached, setDailyTrialFreeTalkReached, setDailyTrialListenReached]);

  // 발음 목표 달성 팝업 상태
  const [showProgressPopup, setShowProgressPopup] = useState(false);

  // 북마크 유도 팝업 상태 (비Library 탭에서 목표 달성 시)
  const [bookmarkPrompt, setBookmarkPrompt] = useState(null); // { score, saveFn }

  // 별표 안내 팝업 (첫 카드 생성 시 1회)
  const [showStarGuide, setShowStarGuide] = useState(false);
  // 학습 재참여 push (streak_* + reengagement_*) 진입 시 StarGuide 강제 발화
  // (count/session/dismissedV2 가드 우회).
  // 2026-05-23: streak_reminder + streak_risk + reengagement_starter + reengagement_engaged
  // 네 종류 모두 학습 동기 부여 메시지라 분기 없이 통합.
  const [forceStarGuideFromPush, setForceStarGuideFromPush] = useState(false);

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

  // [v1.5.86+ thermal] 탭 lazy-mount 추적 — 한번 방문한 탭만 마운트, 방문 후엔 계속 유지.
  //   미방문 탭의 useEffect/YouTube iframe/오디오/이벤트 리스너가 아예 실행되지 않아
  //   Home/Translation만 쓰는 유저의 idle 발열 contributor를 원천 제거.
  //   방문 후 유지하므로 생성 콘텐츠(VocabTab.words / ListeningTab.passage / Scene.generated) 손실 없음.
  //   (Library는 onSnapshot 재구독 의도로 별도 조건부 마운트 — 이 패턴과 무관.)
  //   render마다 idempotent하게 현재 탭 등록 (Set.add는 부수효과 없음, lazy-init 패턴).
  const visitedTabsRef = useRef(new Set(['home']));
  visitedTabsRef.current.add(viewMode);

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
  const [videoDetailOpen, setVideoDetailOpen] = useState(false); // 동영상 상세뷰 열림 상태

  // ── 앱 버전 / Capgo 번들 버전 / 업데이트 상태 ──
  const [appVersion, setAppVersion] = useState('');      // 네이티브 versionName
  const [bundleVersion, setBundleVersion] = useState(''); // Capgo OTA 버전 (있을 때만)
  const [updateStatus, setUpdateStatus] = useState('');
  const [showNativeUpdate, setShowNativeUpdate] = useState(false); // Play Store 업데이트 팝업

  // 버전 비교: "1.1.0" < "1.1.5" → true
  const isVersionOlder = (current, required) => {
    const c = current.split('.').map(Number);
    const r = required.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((c[i] || 0) < (r[i] || 0)) return true;
      if ((c[i] || 0) > (r[i] || 0)) return false;
    }
    return false;
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // 네이티브 앱 버전 (build.gradle versionName) + Firestore에서 최신 버전 조회
    CapacitorApp.getInfo().then(async (info) => {
      setAppVersion(info.version);
      // Firestore config/app 문서에서 플랫폼별 최신 네이티브 버전 조회
      try {
        const configDoc = await getDoc(doc(db, 'config', 'app'));
        const configData = configDoc.data() || {};
        const platform = Capacitor.getPlatform(); // 'ios' | 'android'
        // 플랫폼별 전용 필드만 사용 — 공통 폴백 제거 (iOS/Android 버전 체계가 다름)
        const latestVersion = platform === 'ios'
          ? configData.latestIOSVersion
          : (configData.latestAndroidVersion || configData.latestNativeVersion);
        if (latestVersion && info.version && isVersionOlder(info.version, latestVersion)) {
          // 지역 배포 지연으로 스토어에서 못 받고 돌아온 사용자가 같은 세션에서 무한 반복 노출되는 문제 차단
          let dismissed = false;
          try { dismissed = sessionStorage.getItem('nativeUpdateDismissed') === '1'; } catch (e) {}
          if (!dismissed) setShowNativeUpdate(true);
        }
      } catch (e) {
        console.log('[UpdateCheck] config fetch failed:', e);
      }
    }).catch(() => { });
    // Capgo OTA 번들 정보 — iOS/Android 공통 (2026-05-07 iOS 재활성화 이후)
    // 표시용으로만 조회. 실제 다운로드/적용은 main.jsx (iOS=autoUpdate, Android=manual).
    CapacitorUpdater.current().then(info => {
      const v = info?.bundle?.version;
      if (v && v !== 'builtin') setBundleVersion(v);
    }).catch(() => { });
    // 이벤트 리스너 — 양 플랫폼 동일
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
  const videoReaderRef = useRef(null);
  // 설정 sub-screen 최신 값을 hardware back handler에서 stale closure 없이 참조하기 위한 ref
  const settingsScreenRef = useRef('main');
  useEffect(() => { settingsScreenRef.current = settingsScreen; }, [settingsScreen]);

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

        // 동영상 상세뷰가 열려있으면 목록으로 복귀
        if (videoReaderRef.current?.isDetailOpen?.()) {
          videoReaderRef.current.closeDetail();
          return;
        }

        // 설정 sub-screen이 열려있으면 main으로 복귀 (단계적 진입 뒤로가기)
        const currentViewMode = viewModeHistoryRef.current[viewModeHistoryRef.current.length - 1];
        if (currentViewMode === 'settings' && settingsScreenRef.current !== 'main') {
          setSettingsScreen('main');
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

  // ── 앱 백그라운드/포그라운드 전환 처리 (iOS + Android) ──
  // 백그라운드: 녹음 중단 + 마이크 리소스 해제 (App Store 필수)
  // 포그라운드: 필요시 상태 갱신
  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener = null;
    listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        // 백그라운드 진입 → 모든 활성 recorder에 중단 신호
        console.log('[App] 백그라운드 진입 → 녹음 자동 중단 신호');
        window.dispatchEvent(new Event('app-background'));
      }
    });
    return () => {
      if (listener) listener.then(l => l.remove());
    };
  }, []);

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

  // 메인 탭 순서 — 하단 nav + 상단 타이틀바 양쪽이 참조
  const TAB_ORDER = ['home', 'vocab', 'scene', 'listening', 'translation', 'video', 'library', 'stats'];
  // 2026-05-04: emoji → lucide-react 컴포넌트로 통일 (사이드바와 일관성 + CSS color 토글 가능)
  // 2026-05-08: scene 아이콘 → MessageCircle + amber #f59e0b (Free Talking NEW 강조, 사이드바와 동일)
  const TAB_STYLE = {
    home:        { Icon: Home,          color: '#00a884' },
    vocab:       { Icon: BookOpen,      color: '#059669' },
    scene:       { Icon: MessageCircle, color: '#f59e0b' },
    listening:   { Icon: Headphones,    color: '#7c3aed' },
    translation: { Icon: Languages,     color: '#d97706' },
    video:       { Icon: Youtube,       color: '#e11d48' },
    library:     { Icon: Sparkles,      color: '#0891b2' },
    stats:       { Icon: BarChart3,     color: '#6366f1' },
  };
  // nav.* 라벨에서 "00." / "01." 등 번호 prefix 제거 (legacy — 5/4 i18n 정리 후 no-op이지만 안전망)
  const stripNavPrefix = (s) => (s ? String(s).replace(/^\d{1,2}\.\s*/, '') : s);

  // 사용자가 입력한 번역할 텍스트
  const [inputText, setInputText] = useState(() => {
    try {
      // 새로고침해도 글자가 남아있도록 브라우저 저장소(localStorage)에서 읽어옵니다.
      return localStorage.getItem('inputText') || '';
    } catch (e) {
      return '';
    }
  });

  // 기본 학습 레벨 (온보딩에서 선택, 각 탭 초기값으로 사용)
  const [userLevel, setUserLevel] = useState(() => {
    try {
      const saved = localStorage.getItem('userLevel');
      return ['basic', 'intermediate', 'advanced'].includes(saved) ? saved : 'basic';
    } catch (e) { return 'basic'; }
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

  // i18n — 다른 컴포넌트와 동일하게 t('key') 패턴 사용
  const t = useT(sourceLang);

  // AI가 자동 감지한 입력 언어 코드 (A: sourceLang과 동일 / B: targetLangs 포함 / C: 그 외 지원 언어 / '' 또는 'other': 감지 실패)
  const [detectedLang, setDetectedLang] = useState('');
  const [sourceTranslation, setSourceTranslation] = useState('');
  const [detectionFailed, setDetectionFailed] = useState(false);

  // 번역해서 보고 싶은 언어들 (도착어, 최대 3개)
  const [targetLangs, setTargetLangs] = useState(() => {
    try {
      const saved = localStorage.getItem('targetLangs');
      if (!saved) return getDefaultTargetLangs(detectBrowserSourceLang());
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return getDefaultTargetLangs(detectBrowserSourceLang());
      // 지원되는 언어 코드만 필터링 (기존 10개 + 추가 28개 포함)
      return parsed.filter(code => ALL_LANGUAGES.some(l => l.code === code));
    } catch (e) {
      return getDefaultTargetLangs(detectBrowserSourceLang());
    }
  });

  // 옵션 C (2026-05-13 → 2026-05-18 개편): 첫 앱 진입 시 알림 권한 자동 prompt + FCM 등록
  // 2026-05-18: streak reminder를 LocalNotifications 12:30 → 서버 cron FCM 13:00으로 전환.
  //   - LocalNotifications.schedule() 호출 제거 (이제 메시지는 서버 cron이 13:00에 personalize 발송)
  //   - 권한 grant + FCM 등록은 유지 (서버 cron이 보내는 FCM을 받아야 함)
  //   - 권한 grant 시 streakReminderOptOut: false Firestore 미러 (서버 cron이 검사)
  useEffect(() => {
    if (!user?.uid || !Capacitor.isNativePlatform?.()) return;
    if (localStorage.getItem('notifAutoPromptedV2') === '1') return;
    const timer = setTimeout(async () => {
      try {
        const mod = await import('@capacitor/local-notifications');
        const plugin = mod.LocalNotifications;
        const perm = await plugin.requestPermissions();
        const granted = perm.display === 'granted';
        if (granted) {
          const prefs = loadReminderPrefs();
          saveReminderPrefs({ ...prefs, enabled: true });
          // streakReminderOptOut: false 미러 — 서버 13:00 cron 발송 대상으로 등록
          try { await setStreakReminderAlertPref(user.uid, true); } catch {}
          // Android: POST_NOTIFICATIONS grant 시 FCM도 자동 등록
          if (Capacitor.getPlatform() === 'android') {
            try {
              const pushMod = await import('@capacitor/push-notifications');
              await pushMod.PushNotifications.register();
            } catch (err) {
              console.warn('[StreakReminder] push register failed:', err?.message);
            }
          }
        } else {
          saveReminderPrefs({ ...loadReminderPrefs(), enabled: false });
        }
        localStorage.setItem('notifAutoPromptedV2', '1');
      } catch (err) {
        console.warn('[StreakReminder] first prompt failed:', err?.message);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [user?.uid]);

  // 2026-05-18: 기존 디바이스의 LocalNotifications 12:30 chain 잔존분 정리 (1회).
  // 12:30 로컬 + 13:00 FCM 매일 두 번 발화하던 회귀 차단. mount 시점에 cancel(id=1001)
  // 호출하면 OS chain이 끊겨 더 이상 발화 안 함. localStorage flag로 1회만 실행.
  useEffect(() => {
    if (!Capacitor.isNativePlatform?.()) return;
    if (localStorage.getItem('localNotif12_30_cleaned_v1') === '1') return;
    (async () => {
      try {
        const mod = await import('@capacitor/local-notifications');
        await mod.LocalNotifications.cancel({ notifications: [{ id: 1001 }] }).catch(() => {});
        localStorage.setItem('localNotif12_30_cleaned_v1', '1');
      } catch (err) {
        console.warn('[StreakReminder] legacy chain cleanup failed:', err?.message);
      }
    })();
  }, []);

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

  // Translation 탭 — 단어일 때 Gemini가 생성한 예문 { langCode: { example, exampleTranslation } }
  const [translationExamples, setTranslationExamples] = useState({});

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
  // 'beforeinstallprompt' 이벤트는 engagement 조건을 이미 충족한 재방문 사용자에게는
  // 페이지 로드 직후 즉시 발생할 수 있어 React 마운트 전에 놓치기 쉽다.
  // index.html의 early listener가 window.__deferredInstallPrompt에 캡처해두면
  // 여기서 회수하고, 마운트 후 발생하는 이벤트는 직접 listener로 잡는다.
  useEffect(() => {
    // (a) HTML early listener가 잡아둔 이벤트 회수
    if (window.__deferredInstallPrompt) {
      setDeferredPrompt(window.__deferredInstallPrompt);
      setShowInstallBanner(true);
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    // (b) HTML early listener가 마운트 직후에 캡처한 경우 알림
    const handleEarlyReady = () => {
      if (window.__deferredInstallPrompt) {
        setDeferredPrompt(window.__deferredInstallPrompt);
        setShowInstallBanner(true);
      }
    };

    // 이미 설치된 경우에는 배너를 숨깁니다
    const handleAppInstalled = () => {
      setShowInstallBanner(false);
      setDeferredPrompt(null);
      window.__deferredInstallPrompt = null;
      console.log('[PWA] 앱이 설치되었습니다!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('__deferredPromptReady', handleEarlyReady);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('__deferredPromptReady', handleEarlyReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // [설치] 버튼을 눌렀을 때 실행
  // deferredPrompt 유무로 "이미 설치"를 단정하면 안 됨 — iOS Safari/Chrome은 영구 null,
  // Android Chrome도 prompt 발생 전·Play Store 앱 설치됨 등 여러 사유로 null 가능.
  // 실제 설치 여부는 standalone 실행 모드로만 판정.
  const handleInstallClick = async () => {
    // 1) 진짜 설치 여부 (standalone 모드로 실행 중)
    const isStandalone =
      (typeof window !== 'undefined' && window.matchMedia &&
       window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator?.standalone === true;
    if (isStandalone) {
      alert(getT(sourceLang, 'install.alreadyInstalled'));
      return;
    }

    // 1-b) 일반 브라우저 탭에서 보고 있어도 PWA 설치 여부 감지
    // (manifest의 related_applications에 자기 자신을 webapp으로 등록한 덕에 가능)
    try {
      if (navigator.getInstalledRelatedApps) {
        const installedRelated = await navigator.getInstalledRelatedApps();
        if (installedRelated.length > 0) {
          alert(getT(sourceLang, 'install.alreadyInstalled'));
          return;
        }
      }
    } catch {}

    // 2) Android Chrome 등 — beforeinstallprompt prompt 사용 가능
    // state OR HTML early listener 캡처본 모두 체크 (race-safe)
    const promptEvent = deferredPrompt || window.__deferredInstallPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      console.log('[PWA] 사용자 선택:', outcome);
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        window.__deferredInstallPrompt = null;
        setShowInstallBanner(false);
      }
      return;
    }

    // 3) iOS — LandingPage에서 Download 버튼 자체를 비노출하고 자동 슬라이드로
    //    안내하므로 여기까지 도달할 일은 없음. 안전망으로 무동작 처리.
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return;
    }

    // 4) Android Chrome 인데 prompt 부재 — Chrome 메뉴 안내
    alert(getT(sourceLang, 'install.androidMenuHint'));
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
      localStorage.setItem('inputType', inputType); // [신규] 타입 저장
      localStorage.setItem('targetLangs', JSON.stringify(targetLangs));
      localStorage.setItem('translations', JSON.stringify(translations));
      localStorage.setItem('learningTips', JSON.stringify(learningTips));
      localStorage.setItem('pronunciations', JSON.stringify(pronunciations));
      localStorage.setItem('languageGoals', JSON.stringify(languageGoals)); // [신규] 언어 목표 점수 자동 저장
      localStorage.setItem('languageLevels', JSON.stringify(languageLevels)); // [신규] 언어별 난이도 자동 저장
      localStorage.setItem('dailyGoal', String(dailyGoal)); // [신규] 일일 학습 목표 자동 저장
    } catch (e) {
      console.warn("데이터를 저장하지 못했습니다:", e);
    }
  }, [inputText, sourceLang, inputType, targetLangs, translations, learningTips, pronunciations, languageGoals, languageLevels, dailyGoal]);

  // Translation 탭을 벗어나면 inputText를 비워줍니다 (카드 내역은 유지)
  useEffect(() => {
    if (viewMode !== 'translation') {
      setInputText('');
    }
  }, [viewMode]);

  // 화면이 바뀔 때 스크롤을 맨 위로 올려주는 효과
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewMode]);

  // AI 데이터 처리 동의 (App Store/Play Store 필수 — 모든 플랫폼에서 동일하게 표시)
  // Firestore users/{uid}.aiConsentAt 을 정본으로, localStorage는 빠른 캐시
  const [showAiConsent, setShowAiConsent] = useState(false);

  // email 미등록 유저 감지 (소셜 로그인 후 email 없는 경우)
  const [showEmailRegister, setShowEmailRegister] = useState(false);
  const [emailRegInput, setEmailRegInput] = useState('');
  const [emailRegError, setEmailRegError] = useState('');
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    if (!user.email) {
      setShowEmailRegister(true);
    } else {
      setShowEmailRegister(false);
    }
  }, [user?.uid, user?.email]);

  const handleEmailRegister = async () => {
    if (!emailRegInput || !emailRegInput.includes('@')) {
      setEmailRegError(getT(sourceLang, 'upgrade.invalidEmail'));
      return;
    }
    try {
      await updateEmail(auth.currentUser, emailRegInput);
      // Firestore에도 저장
      await setDoc(doc(db, 'users', user.uid), { email: emailRegInput, updatedAt: serverTimestamp() }, { merge: true });
      setShowEmailRegister(false);
      setEmailRegError('');
    } catch (e) {
      if (e.code === 'auth/too-many-requests') {
        setEmailRegError(getT(sourceLang, 'upgrade.emailTooMany'));
      } else if (e.code === 'auth/email-already-in-use') {
        setEmailRegError(getT(sourceLang, 'auth.emailInUse'));
      } else {
        setEmailRegError(getT(sourceLang, 'upgrade.emailSendFailed'));
      }
    }
  };
  // 학습 알림 + 구독 알림 통합 동의 모달 — A1 카피 (2026-05-03 변경)
  // 신규/dismissed 유저 모두 대상. 7일 스누즈 + 최대 3회 dismiss cap.
  // 영구 플래그 subscriptionAlertPromptShown 사용 안 함 → fcmTokenUpdatedAt 기반 판정
  // (한 번이라도 등록 성공하면 fcmTokens listener가 fcmTokenUpdatedAt set → 다음에 안 뜸)
  const [showSubscriptionPrompt, setShowSubscriptionPrompt] = useState(false);

  const shouldShowSubscriptionPrompt = (p) => {
    if (!p) return false;
    // 같은 세션 내 한 번 닫혔으면 재발화 금지 (serverTimestamp pending race 차단)
    if (pushPromptDismissedRef.current) return false;
    if (Array.isArray(p.fcmTokens) && p.fcmTokens.length > 0) return false;
    if (p.fcmTokenUpdatedAt) return false; // 한 번이라도 등록 성공한 유저는 영영 안 띄움
    if (p.hasCompletedOnboarding !== true && localStorage.getItem('deviceOnboardingDone') !== '1') return false;
    // AI Consent 먼저 → AI Consent 완료 전에는 푸시 모달 보류
    if (!p.aiConsentAt && localStorage.getItem('aiConsentAccepted') !== '1') return false;
    // 누적 dismiss cap (spam 방지)
    if ((p.pushOptInDismissCount || 0) >= 3) return false;
    // 7일 스누즈 — 새 시스템에서 표시된 적 있으면 7일 대기
    const last = p.pushOptInLastShownAt?.toDate?.()?.getTime() || 0;
    if (last > 0 && Date.now() - last < 7 * 24 * 60 * 60 * 1000) return false;

    // 플랫폼별 지원 가드
    if (Capacitor.isNativePlatform?.()) {
      // 네이티브: 플러그인 통합 버전 가드 (Android 1.2.7+, iOS 1.3.0+) — 깨진 UI 방지
      if (!supportsFeature('notifications', p)) return false;
    } else {
      // Web: Notification API + serviceWorker + VAPID 가드.
      // 모달 띄워도 토큰 발급 불가능한 환경(iOS Safari 일반탭, 카카오/인스타 인앱브라우저, 시크릿모드, VAPID 미설정)은 silent skip.
      // → 사용자에게 헛된 권한 요청 안 함 (UX + Apple/Google 신뢰도 보호)
      if (typeof Notification === 'undefined') return false;
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
      if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) return false;
      // 브라우저 영구 거부 상태면 재요청 불가 → 모달 무용
      if (Notification.permission === 'denied') return false;
    }
    return true;
  };

  // AI Consent — 온보딩 완료 직후 즉시 발화 (PushOptIn보다 먼저)
  useEffect(() => {
    if (!user || !profile) return;
    // Firestore에 이미 동의 기록이 있으면 스킵 + localStorage 동기화
    if (profile.aiConsentAt) {
      localStorage.setItem('aiConsentAccepted', '1');
      return;
    }
    // localStorage 캐시 체크 (Firestore 읽기 전 빠른 패스)
    if (localStorage.getItem('aiConsentAccepted') === '1') return;
    // 온보딩이 안 끝났으면 온보딩 먼저 → 온보딩 완료 후 이 effect가 재평가됨
    if (profile.hasCompletedOnboarding !== true && localStorage.getItem('deviceOnboardingDone') !== '1') return;
    setShowAiConsent(true);
  }, [user?.uid, !!profile, profile?.hasCompletedOnboarding, profile?.aiConsentAt]);

  // PushOptIn 구독 알림 — AI Consent 완료 후 발화
  // 의존성에 aiConsentAt을 포함하여 동의 직후 자동 재평가됨
  useEffect(() => {
    if (!user || !profile) return;
    if (shouldShowSubscriptionPrompt(profile)) {
      setShowSubscriptionPrompt(true);
    }
  }, [user?.uid, !!profile, profile?.hasCompletedOnboarding, profile?.aiConsentAt, profile?.fcmTokens, profile?.fcmTokenUpdatedAt, profile?.pushOptInLastShownAt, profile?.pushOptInDismissCount]);

  // 보너스 캠페인 출시 안내 — lifecycleStage 있는 사용자에게 1회 표시
  // 옵션 D: 이번 세션 시작 시 lifecycleStage 이미 있었어야 노출 (mid-session 전이 시 노출 X)
  // → 신규 유저는 첫 Generate 후 앱 재시작 시 다음 세션에서 자연스럽게 노출
  // → 기존 활성 유저(OTA 받은 시점)는 다음 앱 시작 시 즉시 노출
  const initialLifecycleStageRef = useRef(undefined);
  useEffect(() => {
    if (!profile) return;
    if (initialLifecycleStageRef.current === undefined) {
      // profile 첫 로드 — 이번 세션 시작 시점의 stage 캡처
      initialLifecycleStageRef.current = profile.lifecycleStage || null;
    }
  }, [!!profile]);

  // Streak 출시 안내 effect 는 showOnboarding 선언 이후로 이동됨 — TDZ 회피 + 신규 유저 Step 6 직후 발화 (아래 참조)

  useEffect(() => {
    if (!user?.uid || !profile) return;
    if (!profile.lifecycleStage) return;
    if (profile.bonusCampaignSeenAt) return;
    // 옵션 D 게이트: 세션 시작 시점에 stage 없었으면 다음 세션 기다림
    if (!initialLifecycleStageRef.current) return;
    // Streak intro가 아직 영구 dismiss 되지 않았으면 그쪽 먼저 — BonusCampaign은 streakIntroDismissed=true 이후 노출
    if (profile.streakIntroDismissed !== true) return;
    const timer = setTimeout(() => setShowBonusCampaign(true), 1500);
    return () => clearTimeout(timer);
  }, [user?.uid, profile?.lifecycleStage, profile?.bonusCampaignSeenAt, profile?.streakIntroDismissed]);

  // (일일 Streak 상태 안내 useEffect는 showOnboarding 선언 이후로 이동 — TDZ 방지)

  // BonusCampaign "지금 추천하기" → 사이드바 자동 오픈 후 친구추천 버튼으로 스크롤·하이라이트.
  // VocabTab/NotificationSettings 패턴 참조: requestAnimationFrame + retry + getBoundingClientRect로
  // .sidebar 스크롤 컨테이너 직접 계산 (Android WebView에서 scrollIntoView 불안정).
  useEffect(() => {
    if (!sidebarOpen || !focusReferralPending) return;

    const tryFocus = (attempt = 0) => {
      const btn = referralBtnRef.current;
      if (!btn) {
        if (attempt < 5) setTimeout(() => tryFocus(attempt + 1), 100);
        return;
      }
      const container = btn.closest('.sidebar');
      if (!container) {
        // fallback — 사이드바 컨테이너 못 찾으면 표준 scrollIntoView
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const btnRect = btn.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (btnRect.height === 0 && attempt < 5) {
          setTimeout(() => tryFocus(attempt + 1), 100);
          return;
        }
        const target = container.scrollTop
          + (btnRect.top - containerRect.top)
          - (containerRect.height / 2)
          + (btnRect.height / 2);
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
      // 하이라이트 펄스 — 2.5초 후 원복
      setReferralHighlight(true);
      setTimeout(() => setReferralHighlight(false), 2500);
      setFocusReferralPending(false);
    };

    requestAnimationFrame(() => tryFocus(0));
  }, [sidebarOpen, focusReferralPending]);

  // 캠페인 모달 dismiss — Firestore에 표시 완료 시각 기록
  const dismissBonusCampaign = useCallback(async () => {
    setShowBonusCampaign(false);
    if (!user?.uid) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        bonusCampaignSeenAt: serverTimestamp(),
      });
    } catch (e) { console.error('[BonusCampaign] dismiss save failed:', e); }
  }, [user?.uid]);

  // Streak intro 일시 닫기 — 이번 세션만 숨기고 Firestore는 기록 안 함 (다음 세션 재노출)
  const closeStreakIntro = useCallback(() => {
    setShowStreakIntro(false);
  }, []);

  // Streak intro 영구 종료 — Firestore streakIntroDismissed=true 기록
  const permanentlyDismissStreakIntro = useCallback(async () => {
    setShowStreakIntro(false);
    if (!user?.uid) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        streakIntroDismissed: true,
        streakIntroDismissedAt: serverTimestamp(),
      });
    } catch (err) { console.error('[StreakIntro] dismiss save failed:', err); }
  }, [user?.uid]);

  // 일일 Streak 상태 팝업 닫기 — Firestore lastStreakStatusPopupAt에 오늘 날짜 기록
  const dismissStreakStatus = useCallback(async () => {
    setShowStreakStatus(false);
    if (!user?.uid) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        lastStreakStatusPopupAt: getToday(),
      });
    } catch (err) { console.error('[StreakStatus] dismiss save failed:', err); }
  }, [user?.uid]);

  const handleAiConsentAccept = () => {
    localStorage.setItem('aiConsentAccepted', '1');
    setShowAiConsent(false);
    // Firestore에 동의 시각 기록 (기기 간 동기화 + 법적 감사 추적)
    if (user) {
      updateUserProfile({ aiConsentAt: new Date() }).catch(() => {});
    }
  };

  // 신규 유저 첫 ��그인 시 온보딩 팝업 표시
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!user || !profile) return;
    if (profile.hasCompletedOnboarding === true) return;
    // 이 기기에서 이미 온보딩을 마쳤으면 신규 anonymous여도 다시 묻지 않음
    if (localStorage.getItem('deviceOnboardingDone') === '1') return;
    // Firestore에 언어 설정이 이미 있으면 = 과거 온보딩 통과자 (앱 업그레이드 후 LS 손실/필드 누락 방어)
    if (profile.sourceLang && Array.isArray(profile.targetLangs) && profile.targetLangs.length > 0) return;
    setShowOnboarding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, !!profile]);

  // Streak 출시 안내 — 신규 유저는 Step 6 (PushOptIn) 닫힌 직후 마지막 팝업으로, 기존 유저는 다음 세션 진입 시 노출
  // "다시 보지 않음" 영구 dismiss 전까진 매 세션 재노출 (StreakIntroModal 내부 동작)
  // showOnboarding 등 선행 모달 deps 사용 → TDZ 회피를 위해 showOnboarding 선언 이후에 위치
  // 2026-05-23 fix: profile.aiConsentAt Timestamp 객체가 매 snapshot 마다 새 reference 라
  //   effect 가 generate 마다 재실행 → 세션 가드 + boolean 안정화로 1회만 발화 보장.
  useEffect(() => {
    if (!user?.uid || !profile) return;
    // 2026-06-07: Trial 가드 제거 — Streak 마일스톤(7/14/30/100)이 보너스포인트를 지급하므로
    //   Trial 유저에게도 Streak 안내를 노출해 streak 유지(=리텐션) 동기 부여.
    if (profile.streakIntroDismissed === true) return;
    // 온보딩 미통과면 보류 (PushOptIn 이후로 순차 흐름 유지)
    if (!profile.hasCompletedOnboarding) return;
    // AI Consent 미완료면 보류 (AI Consent 모달이 먼저)
    if (!profile.aiConsentAt && localStorage.getItem('aiConsentAccepted') !== '1') return;
    // 선행 자동 팝업 표시 중이면 대기 — 닫히면 이 effect 재실행
    if (showOnboarding || showAiConsent || showSubscriptionPrompt || showPushOptIn) return;
    // 세션당 1회 가드 — 닫은 뒤 generate 등으로 profile snapshot 이 바뀌어도 재발화 차단.
    // 다음 세션(브라우저 탭 새로 열기 / 앱 재시작) 에선 sessionStorage 비어있어 정상 재노출.
    if (sessionStorage.getItem('streakIntroShownThisSession') === '1') return;
    const timer = setTimeout(() => {
      // 타이머 콜백 내부에서 마킹 — effect cleanup 으로 timer 가 취소되면 sessionStorage 도
      // 설정되지 않아 다음 dep settle 에서 정상 재시도 가능.
      sessionStorage.setItem('streakIntroShownThisSession', '1');
      setShowStreakIntro(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [
    user?.uid,
    profile?.hasCompletedOnboarding,
    !!profile?.aiConsentAt,        // Timestamp 객체 → boolean 안정화 (snapshot 마다 새 instance 회피)
    profile?.streakIntroDismissed,
    tier,
    showOnboarding,
    showAiConsent,
    showSubscriptionPrompt,
    showPushOptIn,
  ]);

  // 일일 Streak 상태 안내 — 다른 모든 자동 팝업이 닫힌 뒤 마지막으로 1.5초 지연 후 표시 (하루 1회)
  // showOnboarding이 위에서 선언된 뒤로 위치해야 TDZ 회피
  // 2026-05-23 fix: dismissStreakStatus 의 updateDoc 이 async 라 Firestore 반영 전
  //   다른 dep 변경(다른 onSnapshot delivery 등) 으로 effect 가 재실행되면 게이트가 통과해
  //   1.5초 후 재발화하던 회귀 — StreakIntro 와 동일 패턴 sessionStorage 세션 가드로 차단.
  //   다음 세션(앱 재시작/브라우저 탭 재오픈) 에선 sessionStorage 비어있고, 같은 날이면
  //   Firestore lastStreakStatusPopupAt === today 게이트가 매일 1회 정책을 cross-session 보장.
  useEffect(() => {
    if (!user?.uid || !profile) return;
    // 2026-06-07: Trial 가드 제거 — Streak 보너스포인트 동기로 Trial도 일수 안내 노출.
    if (profile.streakIntroDismissed !== true) return;
    if (!initialLifecycleStageRef.current) return;
    // 다른 자동 팝업 표시 중이면 대기 — 닫히면 이 effect 재실행
    if (showOnboarding || showStreakIntro || showBonusCampaign) return;
    const today = getToday();
    if (profile.lastStreakStatusPopupAt === today) return; // 오늘 이미 노출됨 (cross-session)
    // 같은 세션 안에서는 한 번 열린 적 있으면 재발화 차단 (Firestore async race 회피)
    if (sessionStorage.getItem('streakStatusShownThisSession') === '1') return;
    const timer = setTimeout(() => {
      // 타이머 콜백 내부에서 마킹 — effect cleanup 으로 timer 가 취소되면 sessionStorage 도
      // 설정 안 됨 → 다음 dep settle 에서 정상 재시도 가능.
      sessionStorage.setItem('streakStatusShownThisSession', '1');
      setShowStreakStatus(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [user?.uid, profile?.streakIntroDismissed, profile?.lastStreakStatusPopupAt, tier, showOnboarding, showStreakIntro, showBonusCampaign]);

  // Free Talking 신기능 안내 — 이미 온보딩 통과한 기존 사용자에게만 1회 표시
  // 조건: deviceOnboardingDone='1' (기존 유저) AND announce_seen 미존재 AND 온보딩 모달 미진행
  useEffect(() => {
    if (!user) return;
    if (showOnboarding) return;
    if (typeof window === 'undefined') return;
    try {
      const onboarded = localStorage.getItem('deviceOnboardingDone') === '1';
      const seen = localStorage.getItem('pronunfit_freetalk_announce_seen') === '1';
      if (onboarded && !seen) {
        // 다른 모달과 충돌 방지를 위해 약간 지연 후 표시
        const t = setTimeout(() => setFreeTalkAnnounceOpen(true), 800);
        return () => clearTimeout(t);
      }
    } catch (e) { /* noop */ }
  }, [user?.uid, showOnboarding]);

  const handleFreeTalkAnnounceLater = () => {
    try { localStorage.setItem('pronunfit_freetalk_announce_seen', '1'); } catch (e) { /* noop */ }
    setFreeTalkAnnounceOpen(false);
  };
  const handleFreeTalkAnnounceStart = () => {
    try { localStorage.setItem('pronunfit_freetalk_announce_seen', '1'); } catch (e) { /* noop */ }
    setFreeTalkAnnounceOpen(false);
    setViewMode('scene');  // Scene 탭으로 자동 이동 (사용자가 즉시 시도 가능)
  };

  const handleOnboardingComplete = (src, tgts, lvl, aiConsented) => {
    setSourceLang(src);
    setTargetLangs(tgts);
    if (lvl) {
      setUserLevel(lvl);
      localStorage.setItem('userLevel', lvl);
    }
    localStorage.setItem('sourceLang', src);
    localStorage.setItem('targetLangs', JSON.stringify(tgts));
    localStorage.setItem('deviceOnboardingDone', '1'); // 이 기기에서 온보딩 완료 표시
    // 신규 사용자는 처음부터 Free-Talking을 정상 동선으로 만남 → 기존 사용자 대상 announce 모달 skip
    localStorage.setItem('pronunfit_freetalk_announce_seen', '1');
    // AI Consent를 온보딩 마지막 step에 통합 — 별도 모달 안 뜨도록 즉시 캐시
    if (aiConsented) {
      localStorage.setItem('aiConsentAccepted', '1');
    }
    setShowOnboarding(false);
    setViewMode('home');
    updateUserProfile({
      hasCompletedOnboarding: true,
      sourceLang: src,
      targetLang: tgts[0] || null,
      targetLangs: tgts,
      defaultLevel: lvl || 'basic',
      ...(aiConsented ? { aiConsentAt: new Date() } : {}),
    }).catch(() => { });
  };

  // 별표 안내 팝업 — 두 발화 경로:
  //   (1) Streak Reminder push 진입 강제 발화 — count/session/dismissedV2 가드 모두 우회, 선행 모달 닫힐 때까지만 대기.
  //   (2) 첫 generate 이후 매 세션 1회 노출 — "다시 보지 않음" 체크 시 영구 차단(starGuideDismissedV2).
  // localStorage 키 starGuideDismissedV2 사용 (기존 starGuideDone 은 dead key — 기존 사용자에게도 1회 자동 재노출)
  // 세션 폭주 방지: sessionStorage 가드로 같은 세션 안에서는 1회만
  useEffect(() => {
    if (!profile) return;
    // 2026-06-07: Trial 가드 제거 — Streak 보너스포인트 동기로 Trial도 StarGuide(별표→발음→Streak 안내) 노출.

    // (1) Streak Reminder push 강제 발화 — 선행 모달이 차있으면 대기 (닫히면 effect 재실행)
    if (forceStarGuideFromPush) {
      if (showOnboarding || showAiConsent || showSubscriptionPrompt || showPushOptIn || showStreakIntro) return;
      setForceStarGuideFromPush(false);
      sessionStorage.setItem('starGuideShownThisSession', '1');
      setShowStarGuide(true);
      return;
    }

    // (2) 기본 트리거 — 첫 generate 후 매 세션 1회
    const count = profile.totalGenerateCount || 0;
    if (count < 1) return;
    if (localStorage.getItem('starGuideDismissedV2') === '1') return;
    if (sessionStorage.getItem('starGuideShownThisSession') === '1') return;
    sessionStorage.setItem('starGuideShownThisSession', '1');
    setShowStarGuide(true);
  }, [
    profile?.totalGenerateCount,
    tier,
    forceStarGuideFromPush,
    showOnboarding,
    showAiConsent,
    showSubscriptionPrompt,
    showPushOptIn,
    showStreakIntro,
  ]);

  // Profile 자가치유(self-heal): 익명→실계정 전환 과정의 race condition 등으로
  // profile에 sourceLang/targetLangs/tier/deviceLang/platform이 누락된 기존 사용자를 발견 즉시 복원.
  // 현재 기기의 localStorage/navigator.language/Capacitor 상태 기반 폴백 값을 Firestore에 저장.
  useEffect(() => {
    if (!user || !profile || user.isAnonymous) return;
    const missing = {};
    if (!profile.sourceLang && sourceLang) missing.sourceLang = sourceLang;
    if ((!profile.targetLangs || profile.targetLangs.length === 0) && targetLangs?.length) {
      missing.targetLangs = targetLangs;
      missing.targetLang = targetLangs[0];
    }
    if (!profile.defaultLevel) missing.defaultLevel = userLevel || 'basic';
    if (!profile.tier) missing.tier = 'trial';
    // 디바이스/언어 — 마이그레이션 직후 익명 doc에 있던 값이 target에 미반영된 케이스 대비
    if (!profile.deviceLang) {
      missing.deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
    }
    if (!profile.platform) {
      missing.platform = window.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
    }
    // 온보딩 통과자(sourceLang + targetLangs 보유) 백필 — 앱 업그레이드 후 hasCompletedOnboarding 미백필 사고 방어
    if (profile.hasCompletedOnboarding !== true
        && profile.sourceLang
        && Array.isArray(profile.targetLangs) && profile.targetLangs.length > 0) {
      missing.hasCompletedOnboarding = true;
    }
    if (Object.keys(missing).length > 0) {
      console.log('[ProfileHeal] restoring missing fields:', Object.keys(missing));
      updateUserProfile(missing).catch(() => {});
    }
    // localStorage 백필 — LS 손실 시 다른 모달 트리거들(FreeTalk 안내 등)도 일괄 정상화
    try {
      if (profile.sourceLang && Array.isArray(profile.targetLangs) && profile.targetLangs.length > 0) {
        if (localStorage.getItem('deviceOnboardingDone') !== '1') {
          localStorage.setItem('deviceOnboardingDone', '1');
          // FreeTalk 안내가 다시 뜨지 않도록 함께 set (기존 사용자는 이미 알고 있음)
          if (!localStorage.getItem('pronunfit_freetalk_announce_seen')) {
            localStorage.setItem('pronunfit_freetalk_announce_seen', '1');
          }
        }
        if (!localStorage.getItem('sourceLang')) localStorage.setItem('sourceLang', profile.sourceLang);
        if (!localStorage.getItem('targetLangs')) localStorage.setItem('targetLangs', JSON.stringify(profile.targetLangs));
      }
    } catch (err) { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, profile?.sourceLang, profile?.tier, profile?.deviceLang, profile?.platform]);

  // [신규] 비동기 self-heal — geoCountry, fcmTokens
  // anonymous→linked 마이그레이션 또는 과거 데이터 누락으로 비어있는 케이스 자동 복원.
  // 가드: user 변경 시 리셋, 세션당 각 항목 1회만 시도 (재시도 storm 방지).
  const asyncHealRef = useRef({ uid: null, geo: false, fcm: false });
  useEffect(() => {
    if (!user || !profile || user.isAnonymous) return;
    if (asyncHealRef.current.uid !== user.uid) {
      asyncHealRef.current = { uid: user.uid, geo: false, fcm: false };
    }

    // 지오 정보: IP 기반 1회 채움
    if (!profile.geoCountry && !asyncHealRef.current.geo) {
      asyncHealRef.current.geo = true;
      import('./utils/detectCountry').then(({ detectGeoInfo }) => detectGeoInfo())
        .then(info => {
          if (info?.country) {
            console.log('[ProfileHeal] restoring geo:', info.country);
            const updates = {
              geoCountry: info.country,
              geoCity: info.city || '',
              geoRegion: info.region || '',
            };
            if (!profile.phoneCountry) updates.phoneCountry = info.country;
            updateUserProfile(updates).catch(() => {});
          }
        }).catch(() => {});
    }

    // FCM 토큰: 네이티브 + 권한 granted + 토큰 배열 비어있을 때 재등록
    //   Android: PushNotifications.register() → 'registration' 이벤트 → 전역 리스너 저장
    //   iOS: registerIOSFCM(uid) → FirebaseMessaging.getToken() + Firestore 직접 저장 (2026-05-19)
    const hasTokens = Array.isArray(profile.fcmTokens) && profile.fcmTokens.length > 0;
    if (!hasTokens && !asyncHealRef.current.fcm) {
      asyncHealRef.current.fcm = true;
      (async () => {
        try {
          if (Capacitor.isNativePlatform?.()) {
            if (Capacitor.getPlatform() === 'ios') {
              const { registerIOSFCM } = await import('./utils/pushNotifications');
              console.log('[ProfileHeal] FCM tokens empty — re-registering (iOS)');
              const r = await registerIOSFCM(user.uid);
              console.log('[ProfileHeal] registerIOSFCM:', r);
            } else {
              const { PushNotifications } = await import('@capacitor/push-notifications');
              const perm = await PushNotifications.checkPermissions();
              if (perm.receive === 'granted') {
                console.log('[ProfileHeal] FCM tokens empty — re-registering (Android)');
                await PushNotifications.register();
              }
            }
          } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            // Web: 이전에 권한을 받아둔 적이 있으면 (브라우저 영구 기억) 토큰 재발급 시도.
            // 권한 prompt는 발화 안 함 (사용자 액션 없이 reqestPermission 호출 금지).
            console.log('[ProfileHeal] FCM tokens empty — re-registering (web)');
            const { registerWebFCM } = await import('./utils/pushNotifications');
            await registerWebFCM(user.uid);
          }
        } catch (err) {
          console.warn('[ProfileHeal] FCM re-register failed:', err.message);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, profile?.geoCountry, profile?.fcmTokens?.length]);

  // 설정 언어 변경 → Firestore 자동 동기화 (debounce 500ms).
  // 설정 메뉴에서 sourceLang/targetLangs 변경 시 auto-sync가 localStorage만 저장하던
  // 한계를 보완 — 다른 기기/재설치에서도 동일 설정 유지.
  useEffect(() => {
    if (!user || !profile || user.isAnonymous) return;
    const sameSource = profile.sourceLang === sourceLang;
    const sameTargets = JSON.stringify(profile.targetLangs || []) === JSON.stringify(targetLangs || []);
    if (sameSource && sameTargets) return;
    const timer = setTimeout(() => {
      updateUserProfile({
        sourceLang,
        targetLang: targetLangs[0] || null,
        targetLangs,
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, sourceLang, JSON.stringify(targetLangs)]);

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
      closeProfileModal();
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

      // 네이티브: Capacitor Firebase Auth로 SMS 발송 (reCAPTCHA 불필요)
      // signInWithPhoneNumber은 네이티브 인증 상태 불필요 → 익명/Google 사용자 모두 동작
      // verificationId만 받아서 웹 SDK의 updatePhoneNumber으로 연결
      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        // 기존 리스너 정리
        await FirebaseAuthentication.removeAllListeners();
        await new Promise((resolve, reject) => {
          let resolved = false;
          // 자동 인증 완료 (Android instant verification — 같은 기기 번호 등)
          FirebaseAuthentication.addListener('phoneVerificationCompleted', (event) => {
            if (resolved) return;
            resolved = true;
            console.log('[PhoneVerif] native auto-verified, code:', event.verificationCode);
            setPhoneConfirmResult({ type: 'auto', verificationId: event.verificationId, verificationCode: event.verificationCode });
            setPhoneVerifStep('sent');
            setPhoneVerifMsg({ type: 'success', text: getT(sourceLang, 'auth.phoneCodeSent') });
            resolve();
          });
          // SMS 발송 완료 → verificationId 수신
          FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
            if (resolved) return;
            resolved = true;
            console.log('[PhoneVerif] native code sent, verificationId:', event.verificationId);
            setPhoneConfirmResult({ type: 'sms', verificationId: event.verificationId });
            setPhoneVerifStep('sent');
            setPhoneVerifMsg({ type: 'success', text: getT(sourceLang, 'auth.phoneCodeSent') });
            resolve();
          });
          // 인증 실패
          FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
            if (resolved) return;
            resolved = true;
            console.error('[PhoneVerif] native verification failed:', event.message);
            reject(new Error(event.message));
          });
          // SMS 발송 — signInWithPhoneNumber (네이티브 로그인 상태 불필요)
          FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: fullPhone }).catch(reject);
          // 타임아웃 (60초)
          setTimeout(() => { if (!resolved) { resolved = true; reject(new Error('timeout')); } }, 60000);
        });
      } else {
        // 웹: reCAPTCHA 초기화
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
      }
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
    const isAutoVerified = Capacitor.isNativePlatform() && phoneConfirmResult?.type === 'auto';
    if ((!phoneVerifCode.trim() && !isAutoVerified) || !phoneConfirmResult) return;
    try {
      setPhoneVerifStep('verifying');

      // 네이티브/웹 공통: 웹 SDK의 PhoneAuthProvider.credential + updatePhoneNumber 사용
      // 네이티브에서도 verificationId는 Firebase 서버가 발급하므로 웹 SDK와 호환됨
      const verId = Capacitor.isNativePlatform()
        ? (phoneConfirmResult.type === 'auto' ? phoneConfirmResult.verificationId : phoneConfirmResult.verificationId)
        : phoneConfirmResult;
      const code = Capacitor.isNativePlatform() && phoneConfirmResult.type === 'auto'
        ? (phoneConfirmResult.verificationCode || phoneVerifCode)
        : phoneVerifCode;

      const credential = PhoneAuthProvider.credential(verId, code);
      try {
        const { updatePhoneNumber } = await import('firebase/auth');
        await updatePhoneNumber(auth.currentUser, credential);
      } catch (phoneErr) {
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
  // 설정 즉시 반영 — sourceLang/targetLangs/languageGoals 변경 시 localStorage 자동 sync
  // (기존 handleSaveSettings의 명시적 저장 패턴 대체. 단계적 진입 설정에서 백 버튼만으로 자연스럽게 저장됨)
  useEffect(() => {
    try {
      localStorage.setItem('sourceLang', sourceLang);
      localStorage.setItem('targetLangs', JSON.stringify(targetLangs));
      localStorage.setItem('languageGoals', JSON.stringify(languageGoals));
      localStorage.setItem('languageLevels', JSON.stringify(languageLevels));
    } catch (err) {
      console.warn('언어 설정 로컬 저장 실패:', err);
    }
  }, [sourceLang, targetLangs, languageGoals, languageLevels]);

  // [신규] 기존 유저 시드: languageLevels에 없는 targetLang은 현재 defaultLevel(userLevel)로 채움.
  // (언어별 난이도 도입 전 유저가 설정 화면에서 '현재 난이도'를 그대로 보고 조정할 수 있게)
  useEffect(() => {
    if (!Array.isArray(targetLangs) || targetLangs.length === 0) return;
    const base = userLevel || 'basic';
    setLanguageLevels(prev => {
      let changed = false;
      const next = { ...prev };
      for (const code of targetLangs) {
        if (!next[code]) { next[code] = base; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [targetLangs, userLevel]);

  // --- 3. 비즈니스 로직 (핵심 기능) ---

  // '번역' 버튼을 눌렀을 때 실행되는 메인 함수
  // AI가 입력 언어를 자동 감지한 뒤 38개 언어 중 적절한 타겟으로 번역합니다.
  const handleTranslate = async (retryCount = 0) => {
    if (!inputText.trim()) return;

    setIsTranslating(true);
    setIsGeneratingTips(true);
    setLearningTips({});
    setSavedLangCodes(new Set()); // 새 번역 시 별 저장 상태 초기화
    setPronunciations({});
    setPracticeResults({});
    setTranslationExamples({});
    setDetectedLang('');
    setSourceTranslation('');
    setDetectionFailed(false);

    try {
      const sourceLangName = getLangName(sourceLang);
      const targetLangNames = targetLangs.map(code => getLangName(code));
      const supportedCodes = ALL_LANGUAGES.map(l => l.code);

      const prompt = `
        You are a professional multilingual translator and language tutor.

        [ABSOLUTE OUTPUT RULE — READ FIRST, APPLIES TO ALL TASKS BELOW]
        All explanatory text inside these fields MUST be written 100% in ${sourceLangName} (language code "${sourceLang}"), the user's native language:
          - every string in "tips"
          - every string in "detectedLangTip"
          - every "exampleTranslation"
        Target-language phrases/words may be quoted verbatim inside those strings, but ALL SURROUNDING EXPLANATION MUST BE ${sourceLangName}. Never write an entire tip in a target language. Never mix languages mid-sentence. If uncertain, default to ${sourceLangName}.

        Example — sourceLang="ko" (Korean), targetLang="ja" (Japanese):
          ✅ CORRECT (explanation in Korean, Japanese only quoted):
             "「主要な点」은 '주요한 점'이라는 뜻으로, 회의의 핵심 요지를 가리킬 때 씁니다."
          ❌ WRONG (explanation in Japanese — FORBIDDEN):
             "「主要な点（しゅうようなてん）」は「main points」の訳で、文脈から「会議の要点」などを指します。"
        The same principle applies to every sourceLang/targetLang pair: explanation stays in ${sourceLangName}; only the quoted foreign phrase is in the target language.

        [Context]
        - User's native language: ${sourceLangName} (code: ${sourceLang})
        - Source text: "${inputText}"
        - Target languages (in order): ${targetLangNames.join(', ')} (codes: ${targetLangs.join(', ')})
        - Supported language codes: ${supportedCodes.join(', ')}

        [Task 0: Input Language Detection]
        Detect the language of the source text and return as "detectedLang".
        It MUST be one of the supported codes above.
        If the text is ambiguous, numeric, emoji-only, or not a natural language, return "other".

        [Task 1: Translation]
        Translate the source text into each target language listed above.
        If a target language equals detectedLang, copy the source text as-is.

        [Task 2: Input Type]
        Classify as "word" (single word/idiom) or "sentence".

        [Task 3: Educational Tips]
        "tips" is an ordered array of length ${targetLangs.length}, one entry per target language in the same order as listed above.
        Each entry is an array of 2-3 tip strings — ALL written in ${sourceLangName} per the ABSOLUTE OUTPUT RULE above.
        - sentence type: 2-3 grammar/nuance/usage notes explaining how the translation in that target language works.
        - word type: (1) Meaning & Part of Speech (2) Synonyms/Antonyms (3) Example sentence.
        Self-check before returning: if any tip string reads as if written in the target language (Japanese, Chinese, etc.), rewrite it in ${sourceLangName}.

        [Task 4: Pronunciation — applies to BOTH "pronunciation" and "examplePronunciation" fields]
        en: IPA / ja: Hiragana / zh-CN: Pinyin / ru: Rewrite with accent marks (´) on stressed vowels per standard Russian dictionary stress (ё and single-syllable words excluded) / others: Romanization
        **CRITICAL: For zh-CN/zh/ja/ru, the "pronunciation" and "examplePronunciation" fields MUST be non-empty strings. For other languages, may be empty string ''. An empty value for zh-CN/zh/ja/ru makes the response invalid.**
        examplePronunciation = pronunciation rendering of the "example" sentence (skip if type=sentence and no example present).

        [Task 5: Difficulty Classification]
        Classify the source text difficulty as one of: "basic", "intermediate", "advanced".
        - "basic": simple everyday words/phrases a beginner would learn first
        - "intermediate": natural daily expressions, moderate vocabulary
        - "advanced": complex structures, idioms, nuanced or specialized language

        [Task 6: Example Sentence (word type only)]
        If type is "word", generate ONE natural example sentence for each target language using the translated word.
        Also provide a translation of that example sentence in ${sourceLangName}.
        If type is "sentence", omit the "example" and "exampleTranslation" fields from each entry.

        [Task 7: Source-Side Translation — conditional]
        If detectedLang is a supported code AND detectedLang !== "${sourceLang}",
        translate the source text into ${sourceLangName} and return as top-level "sourceTranslation".
        Otherwise omit the "sourceTranslation" field entirely.

        [Task 8: Detected-Language Extra Card — conditional]
        If detectedLang is a supported code AND detectedLang !== "${sourceLang}" AND detectedLang is NOT in [${targetLangs.join(', ')}],
        also return:
        - "detectedLangData": { "translation": "<the original source text, verbatim>", "pronunciation": "<per Task 4 rule for detectedLang>", "example": "<word type only>", "exampleTranslation": "<word type only>", "examplePronunciation": "<per Task 4, word type only>" }
        - "detectedLangTip": [ 2-3 tips about detectedLang grammar/usage for the source text, each string written in ${sourceLangName} (code "${sourceLang}") — DO NOT write in detectedLang or any other language ]
        Otherwise omit both "detectedLangData" and "detectedLangTip" fields entirely.

        [Output — valid JSON only, no markdown]
        {
          "detectedLang": "<code or 'other'>",
          "type": "word" | "sentence",
          "difficulty": "basic" | "intermediate" | "advanced",
          "tips": [
            ${targetLangNames.map(name => `["<explanation in ${sourceLangName} about how the ${name} translation works>", "<another explanation in ${sourceLangName}>"]`).join(',\n            ')}
          ],
          "data": {
            ${targetLangs.map(code => `"${code}": { "translation": "...", "pronunciation": "<per Task 4>", "example": "...", "exampleTranslation": "...", "examplePronunciation": "<per Task 4 for example sentence>" }`).join(',\n            ')}
          }
          // Optional: "sourceTranslation", "detectedLangData", "detectedLangTip" per Tasks 7 & 8
        }
      `;

      const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      const idToken = await user?.getIdToken();
      const response = await fetch(`${SERVER_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idToken && { Authorization: `Bearer ${idToken}` }) },
        body: JSON.stringify({ prompt, byokGeminiKey })
      });

      if (!response.ok) {
        if (response.status === 429 && retryCount < 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return handleTranslate(retryCount + 1);
        }
        throw new Error(`AI service connection error (${response.status})`);
      }

      const data = await response.json();
      const jsonString = data.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(jsonString);

      if (result.type) {
        setInputType(result.type.toLowerCase() === 'word' ? 'W' : 'S');
      }
      if (result.difficulty) {
        setTranslationDifficulty(result.difficulty);
      } else {
        setTranslationDifficulty('basic');
      }

      // ── detectedLang 분기 판정 ──
      const rawDetected = (result.detectedLang || '').trim();
      const detectedIsValid = rawDetected && rawDetected !== 'other' && supportedCodes.includes(rawDetected);
      const isNative = !detectedIsValid || rawDetected === sourceLang;
      const inTargets = detectedIsValid && targetLangs.includes(rawDetected);
      const isCaseC = detectedIsValid && !isNative && !inTargets;

      // 감지 실패(숫자/이모지/식별불가)만 배너 표시 (진짜 감지 시도가 실패한 경우)
      setDetectionFailed(rawDetected === 'other');
      // 모든 카드에 부가 표시할 sourceLang 번역값 — 저장/재학습용
      // 케이스 A (감지 = sourceLang): 입력 텍스트 자체가 모국어 번역
      // 케이스 B/C: Gemini가 반환한 sourceTranslation
      setDetectedLang(isNative ? '' : rawDetected);
      setSourceTranslation(isNative ? inputText : (result.sourceTranslation || ''));

      const newTranslations = {};
      const newTips = {};
      const newProns = {};
      const newExamples = {};
      // targetLangs 순회 — 기존과 동일
      if (result.data) {
        targetLangs.forEach(langCode => {
          const entry = result.data[langCode];
          if (entry) {
            // Gemini가 rule을 무시하고 주입한 furigana/핀인 주석 제거 (보험)
            newTranslations[langCode] = stripAnnotations(entry.translation, langCode) || inputText;
            newProns[langCode] = entry.pronunciation;
            if (entry.example) {
              newExamples[langCode] = {
                example: stripAnnotations(entry.example, langCode),
                exampleTranslation: entry.exampleTranslation || '',
                examplePronunciation: entry.examplePronunciation || '',
              };
            }
          }
        });
      }
      // 케이스 C: 감지 언어 카드 데이터 병합 (targetLangs에 없는 새 카드)
      if (isCaseC && result.detectedLangData) {
        const entry = result.detectedLangData;
        newTranslations[rawDetected] = stripAnnotations(entry.translation, rawDetected) || inputText;
        newProns[rawDetected] = entry.pronunciation || '';
        if (entry.example) {
          newExamples[rawDetected] = {
            example: stripAnnotations(entry.example, rawDetected),
            exampleTranslation: entry.exampleTranslation || '',
            examplePronunciation: entry.examplePronunciation || '',
          };
        }
      }

      // tips 파싱 — 배열 인덱스로 targetLangs에 매핑 (키 없음 → 언어 연상 차단)
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
      // 케이스 C: 감지 언어 tip 병합
      if (isCaseC) {
        newTips[rawDetected] = Array.isArray(result.detectedLangTip) ? result.detectedLangTip : [];
      }

      setTranslations(newTranslations);
      setLearningTips(newTips);
      setPronunciations(newProns);
      setTranslationExamples(newExamples);
      incrementTrialCard(); // 번역 클릭 누적 (분석용, 모든 tier에서 기록)
      incrementDailyGenerate('translation'); // 일일 분석용

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
    // Strategy A: 부팅 시점 백그라운드 사인인이 보통 끝나 있지만, race 케이스 대비
    const u = user || await ensureAnonymousUser();
    if (!u) {
      alert("Login required to use library.");
      return { status: "error" };
    }

    try {
      // 2026-05-07 v1.5.0: 카드 daily 한도 폐기 — 점수 차감(addAdPoints)이 단일 게이트.

      // 2. 중복 데이터 검사 쿼리
      const q = query(
        collection(db, "savedCards"),
        where("userId", "==", u.uid),
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
        userId: u.uid,
        userEmail: u.email,
        language: getLangName(langCode),
        langCode: langCode,
        sourceText: inputText,
        sourceLang: sourceLang, // 모국어 (UI 기준 언어)
        inputLang: detectedLang || sourceLang,   // AI 감지 언어 (폴백: sourceLang)
        inputType: inputType,   // [신규] 'W' (Word) 또는 'S' (Sentence)
        translatedText: translations[langCode],
        sourceTranslation: (langCode !== sourceLang && sourceTranslation) ? sourceTranslation : '',
        learningTip: learningTips[langCode] || [],
        pronunciation: pronunciations[langCode] || "",
        pronunciationScore: practiceResults[langCode]?.pronunciationScore || null,
        pronunciationAudioUrl: practiceResults[langCode]?.audioUrl || null,
        geminiKeySource: byokGeminiKey ? 'byok' : 'app', // 어떤 Gemini 키로 번역했는지
        sourceType: 'translation',
        difficulty: translationDifficulty,
        example: translationExamples[langCode]?.example || '',
        exampleTranslation: translationExamples[langCode]?.exampleTranslation || '',
        examplePronunciation: translationExamples[langCode]?.examplePronunciation || '',
        createdAt: serverTimestamp()
      };

      const serialNumber = await assignNextCardSerial(u.uid);
      const docRef = await addDoc(collection(db, "savedCards"), { ...cardData, serialNumber });
      incrementSavedCard(); // 저장 누적 카운터 증가 (Trial 한도 산정용)
      // 2026-06-07: 카드 저장 무과금 (학습 핵심 행동) — addAdPoints 제거
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

      // 🔧 BUGFIX 2026-05-07: 발음 점수가 목표 달성하면 daily achievement 카운터 +1.
      //   다른 탭(Vocab/Scene/Listening/Video/Library)들은 모두 같은 패턴이 있는데
      //   Translation Tab만 누락되어 있어 "오늘 3장 중 X장 달성" 카운터가 안 늘어나던 결함 수정.
      //   key는 docRef.id 기반(`library-${id}`)으로 다른 save 함수들과 통일.
      const score = practiceResults[langCode]?.pronunciationScore;
      const goal = languageGoals[langCode] || 80;
      if (score != null && score >= goal && result.id) {
        const wasNew = await incrementAchievement(`library-${result.id}`);
        if (wasNew) setShowProgressPopup(true);
      }

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
    const u = user || await ensureAnonymousUser();
    if (!u) { alert(getT(sourceLang, 'video.loginRequired')); return; }
    const langInfo = getLangInfo(langCode);
    try {
      const serialNumber = await assignNextCardSerial(u.uid);
      const docRef = await addDoc(collection(db, "savedCards"), {
        userId: u.uid,
        userEmail: u.email,
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
        serialNumber,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      // 2026-06-07: 카드 저장 무과금 (학습 핵심 행동) — addAdPoints 제거
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
  const saveSceneCard = async ({ sentence, translation, langCode, scene, category = 'locations', sceneHint, learningTip, pronunciationScore = null, difficulty = 'basic', selectedEmotion = '', interactionType = '', sourceType = 'scene' }) => {
    const u = user || await ensureAnonymousUser();
    if (!u) { alert(getT(sourceLang, 'scene.loginRequired')); return; }
    // 중복 체크: 같은 문장이 이미 저장되어 있으면 기존 ID 반환
    try {
      const dupQ = query(
        collection(db, "savedCards"),
        where("userId", "==", u.uid),
        where("translatedText", "==", sentence),
        where("sourceType", "==", sourceType)
      );
      const dupSnap = await getDocs(dupQ);
      const active = dupSnap.docs.find(d => !d.data().isDeleted);
      if (active) return null; // 이미 저장됨 → 중복 방지
    } catch (e) { console.error("Scene duplicate check failed:", e); }

    const langInfo = getLangInfo(langCode);
    try {
      const serialNumber = await assignNextCardSerial(u.uid);
      const docRef = await addDoc(collection(db, "savedCards"), {
        userId: u.uid,
        userEmail: u.email,
        sourceText: sceneHint || scene || '',
        translatedText: sentence,
        langCode,
        language: langInfo?.name || langCode,
        inputLang: langCode,
        inputType: 'S',
        sourceLang,
        sourceType,
        difficulty,
        scene,
        category,
        learningTip: learningTip ? [{ type: 'tip', content: learningTip }] : [],
        pronunciation: '',
        pronunciationScore,
        selectedEmotion,
        interactionType,
        serialNumber,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      // 2026-06-07: 카드 저장 무과금 (학습 핵심 행동) — addAdPoints 제거
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

  // 6.5. Free Talking 메시지를 Library에 저장 (sourceType='conversation_message') — saveSceneCard 패턴 차용
  const saveConversationMessage = async ({ message, langCode, sourceLang: srcLang, scene, category = 'locations', difficulty = 'basic', speechStyle, scenarioMeta, pronunciationScore = null }) => {
    const u = user || await ensureAnonymousUser();
    if (!u) { alert(getT(sourceLang, 'scene.loginRequired')); return; }
    const sentence = message?.fullText || message?.text || '';
    if (!sentence) return null;
    try {
      const dupQ = query(
        collection(db, "savedCards"),
        where("userId", "==", u.uid),
        where("translatedText", "==", sentence),
        where("sourceType", "==", "conversation_message")
      );
      const dupSnap = await getDocs(dupQ);
      const active = dupSnap.docs.find(d => !d.data().isDeleted);
      if (active) return null;
    } catch (e) { console.error("ConversationMessage duplicate check failed:", e); }

    const langInfo = getLangInfo(langCode);
    try {
      const serialNumber = await assignNextCardSerial(u.uid);
      const docRef = await addDoc(collection(db, "savedCards"), {
        userId: u.uid,
        userEmail: u.email,
        sourceText: message?.scene_hint || scenarioMeta?.scene_summary_en || scene || '',
        translatedText: sentence,
        langCode,
        language: langInfo?.name || langCode,
        inputLang: langCode,
        inputType: 'C',  // C = Conversation
        sourceLang: srcLang || sourceLang,
        sourceType: 'conversation_message',
        conversationRole: message?.role || 'ai',  // 'user_auto' | 'user_free' | 'ai'
        difficulty,
        speechStyle: speechStyle || '',
        scene,
        category,
        responderRole: scenarioMeta?.responder_role || '',
        learningTip: message?.learning_tip ? [{ type: 'tip', content: message.learning_tip }] : [],
        pronunciation: message?.pronunciation || '',
        pronunciationScore,
        selectedEmotion: message?.selected_emotion || '',
        interactionType: message?.interaction_type || '',
        serialNumber,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      // 2026-06-07: 카드 저장 무과금 (학습 핵심 행동) — addAdPoints 제거
      const goal = languageGoals[langCode] || 80;
      if (pronunciationScore != null && pronunciationScore >= goal) {
        const wasNew = await incrementAchievement(`library-${docRef.id}`);
        if (wasNew) setShowProgressPopup(true);
      }
      return docRef.id;
    } catch (error) {
      console.error("ConversationMessage 카드 저장 오류:", error);
      return null;
    }
  };

  // 6.6. Free Talking 세션 종료 후 핵심 표현 일괄 저장 (saveConversationMessage 패턴 차용)
  // selectedPhrases: [{phrase, translation, why_useful, source_role, pronunciation}]
  // sourceType='conversation_summary' 로 분리 (개별 메시지 저장과 구분)
  const saveConversationSummaryPhrases = async ({ selectedPhrases, langCode, sourceLang: srcLang, scene, category = 'locations', difficulty = 'basic', speechStyle, scenarioMeta }) => {
    console.log('[SaveSummary] start:', { count: selectedPhrases?.length, phrases: selectedPhrases?.map(p => p?.phrase) });
    const u = user || await ensureAnonymousUser();
    if (!u) {
      console.error('[SaveSummary] no user — aborting');
      alert(getT(sourceLang, 'scene.loginRequired'));
      return { saved: 0, skipped: 0, errors: ['no-user'] };
    }
    // 2026-05-07 v1.5.0: 카드 daily 한도 폐기 — 점수 차감(addAdPoints)이 단일 게이트.
    const langInfo = getLangInfo(langCode);
    let saved = 0, skipped = 0;
    const errors = [];
    // 2026-05-07 v1.5.0: 카드 daily 한도 폐기 — 점수 시스템(addAdPoints) 단일 게이트.
    //   루프 도중 한도 체크 제거. addAdPoints(1) 가 0점 도달 시 광고 트리거로 자연 차단.
    for (const p of selectedPhrases) {
      const phrase = (p?.phrase || '').trim();
      if (!phrase) { console.warn('[SaveSummary] empty phrase, skipping'); skipped += 1; continue; }

      console.log('[SaveSummary] processing:', phrase);

      // 중복 체크 (분리된 try — query 실패 시 swallow 하지 않고 저장은 시도)
      let isDuplicate = false;
      try {
        const dupQ = query(
          collection(db, "savedCards"),
          where("userId", "==", u.uid),
          where("translatedText", "==", phrase),
          where("sourceType", "==", "conversation_summary")
        );
        const dupSnap = await getDocs(dupQ);
        const active = dupSnap.docs.find(d => !d.data().isDeleted);
        if (active) {
          console.log('[SaveSummary] duplicate found, skipping:', phrase, 'existingId:', active.id);
          isDuplicate = true;
        }
      } catch (dupErr) {
        // dup 체크 실패는 swallow — 저장은 시도 (Firestore index 미등록 시에도 진행)
        console.warn('[SaveSummary] dup check failed (continuing to save anyway):', dupErr?.message);
      }
      if (isDuplicate) { skipped += 1; errors.push(`dup:${phrase.slice(0, 30)}`); continue; }

      // 실제 저장
      try {
        const serialNumber = await assignNextCardSerial(u.uid);
        const docRef = await addDoc(collection(db, "savedCards"), {
          userId: u.uid,
          userEmail: u.email,
          sourceText: p.why_useful || scenarioMeta?.scene_summary_en || scene || '',
          translatedText: phrase,
          langCode,
          language: langInfo?.name || langCode,
          inputLang: langCode,
          inputType: 'C',
          sourceLang: srcLang || sourceLang,
          sourceType: 'conversation_summary',
          conversationRole: p.source_role === 'partner' ? 'ai' : 'user_free',
          difficulty,
          speechStyle: speechStyle || '',
          scene,
          category,
          responderRole: scenarioMeta?.responder_role || '',
          learningTip: p.why_useful ? [{ type: 'tip', content: p.why_useful }] : [],
          pronunciation: p.pronunciation || '',
          pronunciationScore: null,
          selectedEmotion: '',
          interactionType: '',
          serialNumber,
          createdAt: serverTimestamp(),
        });
        console.log('[SaveSummary] saved OK:', phrase, 'docId:', docRef.id);
        saved += 1;
        incrementSavedCard();
        incrementDailySave();
        // 2026-06-07: 카드 저장 무과금 (학습 핵심 행동) — addAdPoints 제거
      } catch (e) {
        console.error('[SaveSummary] save FAILED for phrase:', phrase, 'error:', e?.code, e?.message, e);
        skipped += 1;
        errors.push(`save:${e?.code || e?.message || 'unknown'}`);
      }
    }
    console.log('[SaveSummary] final:', { saved, skipped, errors });
    return { saved, skipped, errors };
  };

  // 7. Vocab 카드를 Library에 저장하는 함수
  const saveVocabCard = async ({ word, meaning, example, exampleTranslation, examplePronunciation, pronunciation, learningTip, langCode, topic, categoryId = 'custom', topicId = 'custom', difficulty = 'basic', pronunciationScore = null, sourceType = 'vocab' }) => {
    const u = user || await ensureAnonymousUser();
    if (!u) { alert(getT(sourceLang, 'scene.loginRequired')); return; }
    // 중복 체크: 같은 단어가 이미 저장되어 있으면 기존 ID 반환 (2026-05-18 fix)
    // 옛 코드는 dup 발견 시 null 반환 → VocabTab.handleSave가 silent fail로 처리되어
    // 사용자 입장에서 "별표 눌렀는데 반응 없음" 사고 (5장 중 첫째 카드 자주 발생).
    // 코멘트 의도대로 기존 cardId 반환 + 새 점수 있으면 갱신(최신 실력 반영).
    try {
      const dupQ = query(
        collection(db, "savedCards"),
        where("userId", "==", u.uid),
        where("translatedText", "==", word),
        where("sourceType", "==", sourceType)
      );
      const dupSnap = await getDocs(dupQ);
      const active = dupSnap.docs.find(d => !d.data().isDeleted);
      if (active) {
        if (pronunciationScore != null) {
          try { await updateDoc(active.ref, { pronunciationScore }); }
          catch (e) { console.error('Vocab dup score update failed:', e); }
        }
        return active.id; // 기존 cardId — VocabTab이 별표 채움 + onNavigateToLibrary 작동
      }
    } catch (e) { console.error("Vocab duplicate check failed:", e); }

    const langInfo = getLangInfo(langCode);
    try {
      const serialNumber = await assignNextCardSerial(u.uid);
      const docRef = await addDoc(collection(db, "savedCards"), {
        userId: u.uid,
        userEmail: u.email,
        sourceText: meaning,          // 뜻 (모국어)
        translatedText: word,         // 단어 (학습 언어)
        langCode,
        language: langInfo?.name || langCode,
        inputLang: langCode,
        inputType: 'W',               // 단어
        sourceLang,
        sourceType,
        difficulty,
        categoryId,
        topicId,
        scene: topic || '',
        learningTip: learningTip || [],
        example: example || '',
        exampleTranslation: exampleTranslation || '',
        examplePronunciation: examplePronunciation || '',
        pronunciation: pronunciation || '',
        pronunciationScore,
        serialNumber,
        createdAt: serverTimestamp(),
      });
      incrementSavedCard();
      incrementDailySave();
      // 2026-06-07: 카드 저장 무과금 (학습 핵심 행동) — addAdPoints 제거
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
    const langInfo = getLangInfo(langCode);
    const utterance = new SpeechSynthesisUtterance(text);
    if (langInfo) utterance.lang = langInfo.tts;
    window.speechSynthesis.speak(utterance);
  };

  // Azure Neural TTS — 모든 탭 공용 (실패 시 Web Speech API로 폴백)
  // TTS 음성 캐시: 동일 텍스트+언어 반복 재생 시 서버 호출 없이 캐시에서 재생
  const ttsCacheRef = useRef(new Map());
  const TTS_CACHE_MAX = 30; // 최대 캐시 항목 수

  // 빠른 연속 클릭 race 방지 — 같은 패턴이 ListeningTab에 이미 적용됨
  // (memory/changes-0416.md "Listening TTS race 근본해결: AbortController+세대토큰+탭이탈정지")
  // 콜드 스타트/네트워크 지연 시 사용자가 무반응 보고 다시 누르면 두 음성이 시차 두고 동시 재생되던 문제 해결.
  const ttsAbortRef = useRef(null); // 진행 중인 fetch 중단용
  const ttsAudioRef = useRef(null); // 현재 재생 중인 Audio (새 요청 시 중지)
  const ttsGenRef = useRef(0);      // 세대 토큰 — 응답 도착 시점에 stale 검출
  // 네이티브 TTS "텍스트당 1회만 차감" — 이미 차감한 text+lang 키 집합(세션 내, Azure 캐시 무료-반복 동작과 동일)
  const ttsChargedRef = useRef(new Set());

  // [TTS 비용 절감 2026-06-09] 절충안 라우팅 — Web Speech(기기 내장/네트워크) 우선, "진짜 실패"만 Azure 폴백.
  //   목적: Azure Neural TTS 비용(5월 ₩25,498, 전체 63%) 절감.
  //   적용 범위(native 시도): Vocab 단어·예문·발음해부도, Listening 핵심단어·에세이 문장.
  //     (Listening 지문·대화 문장 = Azure 멀티보이스 유지 / Translation·Scene·Library·FreeTalking = Azure 유지)
  //   음성 선택: 해당 언어 매칭 중 네트워크(localService===false, 보통 Google/Apple 고품질) 우선 → 기본 → 첫 매칭.
  //   Azure 폴백 트리거(진짜 실패): 엔진 없음 / 해당 언어 음성 0개 / onerror. ("나쁘지만 재생되는" 음성은
  //     폴백 불가 — 저가폰 잔존 리스크는 target 제외로 합의 2026-06-09)
  //   차감: 엔진 무관 항상 1점(Trial, tryConsumeTtsPoint). onerror→Azure 폴백은 이미 차감됨 → _skipGate.
  //   웹 전용 — 네이티브 앱(Capacitor)은 Capgo 별도 배포 전까지 전부 Azure.
  const pickNativeVoice = (ttsLang) => {
    let voices = [];
    try { voices = window.speechSynthesis?.getVoices?.() || []; } catch { return null; }
    if (!voices.length) return undefined; // 아직 미로드 — 호출부가 voiceschanged 대기
    const want = String(ttsLang || '').toLowerCase();
    const prefix = want.slice(0, 2);
    const matches = voices.filter(v => {
      const l = v.lang?.toLowerCase() || '';
      return l === want || (prefix && l.startsWith(prefix));
    });
    if (!matches.length) return null; // 해당 언어 음성 없음 → Azure
    return matches.find(v => v.localService === false) // 네트워크(고품질) 우선
        || matches.find(v => v.default)
        || matches[0];
  };

  // TTS 라우팅 텔레메트리 비콘 (fire-and-forget) — native/azure-fallback portion 측정용 (서버 [TTSRoute] 로그)
  const beaconTtsRoute = (source, engine, langCode, extra = {}) => {
    try {
      const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      authFetch(`${SERVER_URL}/api/tts/route-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          source: source || 'tts',
          engine,
          lang: langCode,
          platform: (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web',
          ...extra,
        }),
      }).catch(() => {});
    } catch { /* 텔레메트리 실패 무시 */ }
  };

  const handleSpeakSmart = (text, langCode, emotion, opts = {}) => {
    if (!text) return;
    // 진행 중 Azure 요청/재생 + 네이티브 음성 즉시 중단 (handleSpeak와 동일 race 패턴)
    ttsGenRef.current++;
    if (ttsAbortRef.current) { try { ttsAbortRef.current.abort(); } catch {} ttsAbortRef.current = null; }
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.pause(); ttsAudioRef.current.currentTime = 0; } catch {}
      ttsAudioRef.current = null;
    }
    try { window.speechSynthesis?.cancel?.(); } catch {}

    const langInfo = getLangInfo(langCode);
    const ttsLang = langInfo?.tts || langCode;
    const src = opts.source;

    // [2026-06-10] Android: System WebView가 Web Speech(speechSynthesis) 미노출(Chromium #487255)
    //   → 네이티브 TTS 플러그인(@capacitor-community/text-to-speech, Android TextToSpeech 엔진) 사용.
    //   iOS WKWebView·웹은 Web Speech 정상이라 아래 기존 경로 유지.
    //   플러그인 실패 시 Azure 폴백(=현재 동작 = 리스크 하한). 차감은 텍스트당 1회(Web 경로와 동일 규칙).
    if (Capacitor.getPlatform() === 'android') {
      const chargeKey = `${ttsLang}:${text}`;
      if (!ttsChargedRef.current.has(chargeKey)) {
        if (!byokAzureKey && !tryConsumeTtsPoint()) return; // 신규 텍스트 0점이면 차단+팝업
        ttsChargedRef.current.add(chargeKey);
        beaconTtsRoute(src, 'native', langCode, { voice: 'android-plugin', localService: true });
      }
      try { TextToSpeech.stop(); } catch { /* 진행 중 재생 없음 */ }
      TextToSpeech.speak({ text, lang: ttsLang || 'en' }).catch(() => {
        // 플러그인 실패 → Azure 폴백 (이미 차감됨 → _skipGate 로 재과금 방지)
        beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'plugin-error' });
        handleSpeak(text, langCode, emotion, { ...opts, _skipGate: true });
      });
      return;
    }

    // 엔진 미지원 → Azure (Android는 위에서 처리됨 — 이 경로는 주로 web/iOS의 비정상 케이스)
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'no-engine' });
      handleSpeak(text, langCode, emotion, opts);
      return;
    }

    const speakWith = (voice) => {
      // 텍스트당 1회만 차감 — 같은 text+lang 첫 재생만 1점(Trial), 이후 반복 재생은 무료.
      //   (Azure 캐시 무료-반복과 동일 / 네이티브는 우리 비용 $0지만 신규 텍스트 사용량 게이트는 유지)
      //   (2026-06-09: "누를 때마다 매번 차감" → "텍스트당 1회만 차감"으로 수정)
      const chargeKey = `${ttsLang}:${text}`;
      if (!ttsChargedRef.current.has(chargeKey)) {
        if (!byokAzureKey && !tryConsumeTtsPoint()) return; // 신규 텍스트 0점이면 차단+팝업
        ttsChargedRef.current.add(chargeKey);
        // 텔레메트리 비콘은 과금(첫 재생) 시 1회만 — 반복 재생은 로그 생략(portion 노이즈 제거)
        beaconTtsRoute(src, 'native', langCode, { voice: voice?.name, localService: voice?.localService });
      }
      const u = new SpeechSynthesisUtterance(text);
      if (ttsLang) u.lang = ttsLang;
      if (voice) u.voice = voice;
      // 네이티브 합성 에러 → Azure 폴백 (차감은 이미 됨 → _skipGate)
      u.onerror = () => {
        beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'onerror' });
        handleSpeak(text, langCode, emotion, { ...opts, _skipGate: true });
      };
      try { window.speechSynthesis.speak(u); }
      catch {
        beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'speak-throw' });
        handleSpeak(text, langCode, emotion, { ...opts, _skipGate: true });
      }
    };

    const v = pickNativeVoice(ttsLang);
    if (v) { speakWith(v); return; }                                      // 가용 voice 있음 → native
    if (v === null) {                                                     // 언어 음성 없음 → Azure
      beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'no-voice' });
      handleSpeak(text, langCode, emotion, opts);
      return;
    }

    // v === undefined: voices 아직 미로드 → 1회 대기 후 재시도 (안전망 타임아웃 포함)
    let settled = false;
    const finish = () => {
      if (settled) return;
      const v2 = pickNativeVoice(ttsLang);
      if (v2 === undefined) return; // 아직 미로드 — 계속 대기 (타임아웃이 최종 처리)
      settled = true;
      try { window.speechSynthesis.removeEventListener('voiceschanged', finish); } catch {}
      if (v2) { speakWith(v2); }
      else { beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'no-voice' }); handleSpeak(text, langCode, emotion, opts); }
    };
    try { window.speechSynthesis.addEventListener('voiceschanged', finish); } catch {}
    // voiceschanged가 안 오는 브라우저 대비 (setTimeout은 Date 미사용 → 허용)
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { window.speechSynthesis.removeEventListener('voiceschanged', finish); } catch {}
      const v3 = pickNativeVoice(ttsLang);
      if (v3) { speakWith(v3); }
      else { beaconTtsRoute(src, 'azure-fallback', langCode, { reason: 'voices-unloaded' }); handleSpeak(text, langCode, emotion, opts); } // Azure 안전
    }, 600);
  };

  const handleSpeak = async (text, langCode, emotion, opts = {}) => {
    if (!text) return;

    // ⭐ 이전 요청/재생 즉시 중단 — "돌림노래" 방지
    if (ttsAbortRef.current) { try { ttsAbortRef.current.abort(); } catch {} ttsAbortRef.current = null; }
    if (ttsAudioRef.current) {
      try { ttsAudioRef.current.pause(); ttsAudioRef.current.currentTime = 0; } catch {}
      ttsAudioRef.current = null;
    }
    try { window.speechSynthesis?.cancel(); } catch {}

    const myGen = ++ttsGenRef.current;
    const isStale = () => myGen !== ttsGenRef.current;
    const cacheKey = `${langCode}:${emotion || ''}:${text}`;

    // 캐시 히트 — 서버 호출 없이 즉시 재생
    if (ttsCacheRef.current.has(cacheKey)) {
      const cachedUrl = ttsCacheRef.current.get(cacheKey);
      try {
        const audio = new Audio(cachedUrl);
        ttsAudioRef.current = audio;
        audio.onended = () => { if (ttsAudioRef.current === audio) ttsAudioRef.current = null; };
        audio.onerror = () => { if (!isStale()) handleSpeakFallback(text, langCode); };
        const p = audio.play();
        if (p) p.catch(() => document.addEventListener('click', () => { if (!isStale()) audio.play(); }, { once: true }));
        return;
      } catch { /* 캐시 URL 만료 시 아래로 진행 */ }
    }

    // 영속 캐시(IndexedDB) 조회 — 저장 카드(opts.saved)만 대상. 앱 재시작·날짜 변경 후에도 유지.
    // 단어장에 저장한 카드를 매일 다시 들어도 같은 오디오면 Azure 호출 0. (BYOK·일반 생성 카드는 제외)
    if (opts.saved && !byokAzureKey) {
      try {
        const idbBlob = await getCachedAudio(cacheKey);
        if (idbBlob && !isStale()) {
          const url = URL.createObjectURL(idbBlob);
          // 세션 메모리에도 승격 (LRU 상한 유지)
          if (ttsCacheRef.current.size >= TTS_CACHE_MAX) {
            const oldestKey = ttsCacheRef.current.keys().next().value;
            URL.revokeObjectURL(ttsCacheRef.current.get(oldestKey));
            ttsCacheRef.current.delete(oldestKey);
          }
          ttsCacheRef.current.set(cacheKey, url);
          const audio = new Audio(url);
          ttsAudioRef.current = audio;
          audio.onended = () => { if (ttsAudioRef.current === audio) ttsAudioRef.current = null; };
          audio.onerror = () => { if (!isStale()) handleSpeakFallback(text, langCode); };
          const p = audio.play();
          if (p) p.catch(() => document.addEventListener('click', () => { if (!isStale()) audio.play(); }, { once: true }));
          return;
        }
      } catch { /* IndexedDB 실패 → 네트워크로 진행 */ }
    }

    // 2026-06-07: 신규 합성(서버 fetch) 전 포인트 게이트 — 캐시 hit은 위에서 이미 return(무료).
    //   Trial 0점이면 차단 + 포인트부족 팝업. BYOK는 자기 키라 통과. Pro/Premium 무료 통과.
    //   2026-06-09: _skipGate = handleSpeakSmart의 native→Azure onerror 폴백 (이미 native에서 1점 차감됨).
    if (!opts._skipGate && !byokAzureKey && !tryConsumeTtsPoint()) return;

    const ac = new AbortController();
    ttsAbortRef.current = ac;

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
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Azure TTS ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // 캐시에 저장 (LRU: 오래된 항목 제거) — stale이어도 캐시는 저장(다음 호출에서 재사용)
      if (ttsCacheRef.current.size >= TTS_CACHE_MAX) {
        const oldestKey = ttsCacheRef.current.keys().next().value;
        const oldUrl = ttsCacheRef.current.get(oldestKey);
        URL.revokeObjectURL(oldUrl);
        ttsCacheRef.current.delete(oldestKey);
      }
      ttsCacheRef.current.set(cacheKey, url);

      // 영속 캐시(IndexedDB)에도 저장 — 저장 카드만. 재시작·날짜 변경 후 재청취 시 Azure 0. fire-and-forget.
      if (opts.saved && !byokAzureKey) putCachedAudio(cacheKey, blob);

      // ⭐ 응답 도착 시점에 stale이면 재생 skip (사용자가 그동안 다른 버튼 눌렀음)
      if (isStale()) return;

      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => { if (ttsAudioRef.current === audio) ttsAudioRef.current = null; };
      // 캐시된 URL은 revokeObjectURL 안 함 (재사용 위해)
      audio.onerror = (err) => {
        console.warn('[TTS] Audio play error:', err);
        if (!isStale()) handleSpeakFallback(text, langCode);
      };
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          document.addEventListener('click', () => { if (!isStale()) audio.play(); }, { once: true });
        });
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // 의도적 중단 — 무시
      if (isStale()) return;
      console.warn('[TTS] Azure failed:', e.message);
      handleSpeakFallback(text, langCode);
    } finally {
      if (ttsAbortRef.current === ac) ttsAbortRef.current = null;
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
      localStorage.removeItem('webAppEntered'); // 로그아웃 시 웹 진입 플래그 제거 → 랜딩 다시 표시
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

  // ── 네이티브 앱 업데이트 필요 팝업 ──────────────────────────────────────────
  const nativeUpdatePopup = showNativeUpdate && (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--modal-overlay-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 'var(--z-modal)', padding: 20,
    }}>
      <div style={{
        background: 'var(--modal-card-bg)', borderRadius: 'var(--modal-radius)', padding: '28px 24px',
        maxWidth: 340, width: '100%', textAlign: 'center',
        boxShadow: 'var(--modal-shadow)',
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔄</div>
        <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
          {getT(sourceLang, 'update.title') !== 'update.title' ? getT(sourceLang, 'update.title') : '앱 업데이트 필요'}
        </h3>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5 }}>
          {getT(sourceLang, 'update.desc') !== 'update.desc' ? getT(sourceLang, 'update.desc') : '새로운 기능과 버그 수정이 포함된 최신 버전이 있습니다. 업데이트 후 이용해 주세요.'}
        </p>
        <button
          onClick={() => {
            const storeUrl = Capacitor.getPlatform() === 'ios'
              ? 'https://apps.apple.com/app/pronunfit/id6761342764'
              : 'https://play.google.com/store/apps/details?id=com.arigems.pronunfit';
            window.open(storeUrl, '_system');
            try { sessionStorage.setItem('nativeUpdateDismissed', '1'); } catch (e) {}
            setShowNativeUpdate(false);
          }}
          style={{
            width: '100%', padding: '13px 0', border: 'none', borderRadius: 'var(--modal-btn-radius)',
            background: 'var(--brand-primary)', color: 'var(--text-on-brand)', fontSize: '0.95rem',
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          {getT(sourceLang, 'update.btn') !== 'update.btn' ? getT(sourceLang, 'update.btn') : (Capacitor.getPlatform() === 'ios' ? 'App Store에서 업데이트' : 'Play Store에서 업데이트')}
        </button>
      </div>
    </div>
  );

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
    const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
    const idToken = result.credential?.idToken;
    if (idToken) {
      const credential = FirebaseGoogleAuthProvider.credential(idToken);
      const cred = await signInWithCredential(auth, credential);
      const info = getAdditionalUserInfo(cred);
      const platform = window.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
      const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
      const profileData = { uid: cred.user.uid, email: cred.user.email, platform, deviceLang, updatedAt: serverTimestamp() };
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
      const platform = 'web';
      const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
      const profileData = { uid: cred.user.uid, email: cred.user.email, platform, deviceLang, updatedAt: serverTimestamp() };
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

  // 네이티브 Facebook Sign-In (Capacitor Firebase Auth 플러그인)
  const handleNativeFacebookLogin = async () => {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithFacebook();
    const accessToken = result.credential?.accessToken;
    if (accessToken) {
      const credential = FirebaseFacebookAuthProvider.credential(accessToken);
      const cred = await signInWithCredential(auth, credential);
      const info = getAdditionalUserInfo(cred);
      const platform = window.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
      const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
      const profileData = { uid: cred.user.uid, email: cred.user.email, platform, deviceLang, updatedAt: serverTimestamp() };
      if (info?.isNewUser) {
        profileData.displayName = cred.user.displayName || 'Facebook User';
        profileData.hasCompletedOnboarding = false;
        profileData.createdAt = serverTimestamp();
      }
      await setDoc(doc(db, 'users', cred.user.uid), profileData, { merge: true });
    }
  };

  const handleFacebookLoginFromLanding = async () => {
    if (isNativePlatform) {
      try { await handleNativeFacebookLogin(); } catch (err) { console.error('Native Facebook login error:', err); }
      return;
    }
    const ua = navigator.userAgent || '';
    const isInApp = /KAKAOTALK|KAKAO|Instagram|NAVER|Line\/|FBAN|FBAV/i.test(ua)
      || (/Android/.test(ua) && /wv\)/.test(ua))
      || (/iPhone|iPad/.test(ua) && !/Safari/.test(ua));
    if (isInApp) { setShowLanding(false); return; }
    try {
      const cred = await signInWithPopup(auth, facebookProvider);
      const info = getAdditionalUserInfo(cred);
      const platform = 'web';
      const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
      const profileData = { uid: cred.user.uid, email: cred.user.email, platform, deviceLang, updatedAt: serverTimestamp() };
      if (info?.isNewUser) {
        profileData.displayName = cred.user.displayName || 'Facebook User';
        profileData.hasCompletedOnboarding = false;
        profileData.createdAt = serverTimestamp();
      }
      await setDoc(doc(db, 'users', cred.user.uid), profileData, { merge: true });
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') console.error('Facebook login error:', err);
    }
  };

  // ── 진입 분기 ────────────────────────────────────────────────────────────────

  // [Strategy A 적용] 자동 익명 사인인이 백그라운드로 전환되어
  // 네이티브 부팅 직후 user가 잠시 null인 케이스가 정상 흐름에 추가됨.
  //   - 명시적 로그아웃 → Login (기존 유지)
  //   - 웹 첫 방문(showLanding) → LandingPage (기존 유지)
  //   - 웹 그 외 user=null → Login (기존 폴백 유지)
  //   - 네이티브 + 백그라운드 사인인 진행 중 → home으로 fall through (NEW)
  if (!user) {
    const isNativeBootingUser = window.Capacitor?.isNativePlatform?.()
      && localStorage.getItem('didExplicitLogout') !== '1';

    if (showLanding) {
      const handleStartFreeFromLanding = async () => {
        localStorage.removeItem('didExplicitLogout');
        // ⚠ webAppEntered는 signInAnonymously 성공 후 설정
        // 먼저 설정하면 AuthContext의 needsLanding 가드가 해제되어 2중 채번 위험
        try {
          await signInAnonymously(auth);
          localStorage.setItem('webAppEntered', '1');
        } catch (e) { console.error(e); }
        setShowLanding(false);
      };
      return (
        <>
          <LandingPage
            onGoogleLogin={handleGoogleLoginFromLanding}
            onFacebookLogin={handleFacebookLoginFromLanding}
            onStartFree={window.Capacitor?.isNativePlatform?.() ? undefined : handleStartFreeFromLanding}
            onLogin={() => { setShowLanding(false); setAuthMode('login'); }}
            onSignup={() => { setShowLanding(false); setAuthMode('signup'); }}
            onInstall={handleInstallClick}
            showInstall={showInstallBanner}
            onSpeak={handleSpeak}
            onPrivacy={() => setViewMode('privacy')}
            onTerms={() => setViewMode('terms')}
            onContact={() => setViewMode('contact')}
          />
        </>
      );
    }

    // 네이티브 + 비-로그아웃: 백그라운드 사인인이 곧 user를 채워줌 → home 렌더 허용
    // (early return 안 함 → 본 렌더 분기로 진입. user 없는 동안 useEffect 16곳은 자연 skip)
    if (!isNativeBootingUser) {
      return authMode === 'login' ? (
        <Login onSwitchToSignup={() => setAuthMode('signup')} sourceLang={sourceLang} />
      ) : (
        <Signup onSwitchToLogin={() => setAuthMode('login')} sourceLang={sourceLang} />
      );
    }
  }

  // [Web] 익명 유저 + 랜딩 미완료 → 랜딩페이지
  if (!isNativePlatform && user?.isAnonymous && showLanding) {
    return (
      <>
        <LandingPage
          onGoogleLogin={handleGoogleLoginFromLanding}
          onFacebookLogin={handleFacebookLoginFromLanding}
          onStartFree={() => { localStorage.setItem('webAppEntered', '1'); setShowLanding(false); }}
          onLogin={() => { setShowLanding(false); setShowAccountUpgrade(true); }}
          onSignup={() => { setShowLanding(false); setShowAccountUpgrade(true); }}
          onInstall={handleInstallClick}
          showInstall={showInstallBanner}
          onSpeak={handleSpeak}
          onPrivacy={() => setViewMode('privacy')}
          onTerms={() => setViewMode('terms')}
          onContact={() => setViewMode('contact')}
        />
      </>
    );
  }

  // 메인 앱 화면
  return (
    <div className="app-container">
      {nativeUpdatePopup}
      {/* Vercel 분석 도구 */}
      <Analytics />

      {/* 익명→실계정 업그레이드 모달 */}
      {showAccountUpgrade && (
        <AccountUpgradeModal
          sourceLang={sourceLang}
          onClose={() => { setShowAccountUpgrade(false); setPendingUpgradeTier(null); }}
          onSuccess={() => {
            setShowAccountUpgrade(false);
            if (pendingUpgradeTier) {
              setShowUpgradeModal(pendingUpgradeTier);
              setPendingUpgradeTier(null);
            }
          }}
          fromSubscription={!!pendingUpgradeTier}
        />
      )}

      {/* 친구 추천 모달 */}
      <ReferralModal
        open={showReferralModal}
        onClose={() => setShowReferralModal(false)}
        sourceLang={sourceLang}
        phoneCountry={profile?.phoneCountry}
        onSuccess={() => {
          // 성공 후 잠시 후 닫기 (사용자가 메시지 볼 시간 확보)
          setTimeout(() => setShowReferralModal(false), 2000);
        }}
      />

      {/* 리뷰 보상 모달 */}
      <ReviewBonusModal
        open={showReviewBonusModal}
        onClose={() => setShowReviewBonusModal(false)}
        sourceLang={sourceLang}
        alreadyClaimed={reviewBonusClaimed}
        onSuccess={() => {
          setTimeout(() => setShowReviewBonusModal(false), 2000);
        }}
      />

      {/* Streak 출시 안내 모달 — 친구초대/리뷰 캠페인보다 먼저 노출 */}
      <StreakIntroModal
        open={showStreakIntro}
        onClose={closeStreakIntro}
        onPermanentDismiss={permanentlyDismissStreakIntro}
        onCta={() => {
          closeStreakIntro();
          setViewMode('stats');
        }}
        sourceLang={sourceLang}
      />

      {/* 보너스 캠페인 출시 안내 모달 — 1회만 표시 */}
      <BonusCampaignAnnounceModal
        open={showBonusCampaign}
        onClose={dismissBonusCampaign}
        onCta={() => {
          dismissBonusCampaign();
          setSidebarOpen(true);
          // 사이드바 마운트 후 친구추천 버튼으로 스크롤 + 하이라이트 (useEffect가 처리)
          setFocusReferralPending(true);
        }}
        sourceLang={sourceLang}
      />

      {/* 일일 Streak 상태 안내 — 모든 일일 팝업의 마지막에 표시 (하루 1회) */}
      <StreakStatusPopup
        open={showStreakStatus}
        streakCurrent={streakCurrent}
        nextMilestone={nextMilestone}
        daysToNext={daysToNext}
        nextReward={nextReward}
        sourceLang={sourceLang}
        onClose={dismissStreakStatus}
      />

      {/* 이메일 인증/변경 통합 모달 */}
      <EmailVerifyChangeModal
        open={showEmailVerifyChange}
        onClose={() => setShowEmailVerifyChange(false)}
        currentEmail={user?.email}
        isVerified={!!user?.emailVerified}
        sourceLang={sourceLang}
      />

      {/* 익명 사용자 → 가입 안내 모달 */}
      {showAnonGateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
          background: 'var(--modal-overlay-bg)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '16px',
        }} onClick={() => setShowAnonGateModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--modal-card-bg)', borderRadius: 'var(--modal-radius)', padding: '24px',
            maxWidth: '380px', width: '100%', boxShadow: 'var(--modal-shadow)',
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 700, color: '#1d4ed8' }}>
              {getT(sourceLang, 'bonus.referral.needLoginTitle') || 'Sign-up required'}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: '#475569', lineHeight: 1.5 }}>
              {getT(sourceLang, 'bonus.referral.needLoginDesc') || 'Referral feature is available after creating a free account.'}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowAnonGateModal(false)} style={{
                flex: 1, padding: '10px', borderRadius: '8px',
                background: 'white', border: '1px solid #e2e8f0',
                color: '#64748b', fontWeight: 600, cursor: 'pointer',
              }}>
                {getT(sourceLang, 'bonus.referral.cancel') || 'Cancel'}
              </button>
              <button onClick={() => {
                setShowAnonGateModal(false);
                setShowAccountUpgrade(true);
              }} style={{
                flex: 1, padding: '10px', borderRadius: '8px',
                background: 'var(--brand-primary)', border: 'none',
                color: 'var(--text-on-brand)', fontWeight: 700, cursor: 'pointer',
              }}>
                {getT(sourceLang, 'bonus.referral.signupBtn') || 'Create free account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 기존 계정 로그인 모달 (이메일/구글 모두 지원) */}
      {showLoginModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
          background: 'var(--modal-overlay-bg)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          padding: 'var(--modal-overlay-padding)',
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
          position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--modal-overlay-bg)',
          padding: 'var(--modal-overlay-padding)',
        }} onClick={() => setShowAnonSignupPrompt(false)}>
          <div style={{
            width: 'calc(100% - 48px)', maxWidth: '360px',
            background: 'var(--modal-card-bg)', borderRadius: '24px',
            padding: '28px 24px 24px',
            boxShadow: 'var(--modal-shadow)',
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
                {getT(sourceLang, 'upgrade.nextTime') || '다음에'}
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
                  <p className="sidebar-user-email" style={{ fontSize: '0.68rem', color: '#94a3b8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email || (user?.isAnonymous ? user.uid : '')}</p>
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

              <button className={`sidebar-nav-item ${viewMode === 'vocab' ? 'active' : ''}`}
                onClick={() => { setViewMode('vocab'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><BookOpen size={16} /></span>
                {getT(sourceLang, 'nav.vocab')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'scene' ? 'active' : ''}`}
                onClick={() => { setViewMode('scene'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><MessageCircle size={16} color="#f59e0b" /></span>
                {getT(sourceLang, 'nav.scene')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'listening' ? 'active' : ''}`}
                onClick={() => { setViewMode('listening'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><Headphones size={16} /></span>
                {getT(sourceLang, 'nav.listening')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'translation' ? 'active' : ''}`}
                onClick={() => { setViewMode('translation'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><Languages size={16} /></span>
                {getT(sourceLang, 'nav.translation')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'video' ? 'active' : ''}`}
                onClick={() => { setViewMode('video'); setSidebarOpen(false); }}>
                <span className="sidebar-nav-icon"><Youtube size={16} /></span>
                {getT(sourceLang, 'nav.video')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'library' ? 'active' : ''}`}
                onClick={() => { setViewMode('library'); setSidebarOpen(false); setDictBackTo(null); setLibraryBackTo(null); }}>
                <span className="sidebar-nav-icon"><Sparkles size={16} /></span>
                {getT(sourceLang, 'nav.library')}
              </button>

              <button className={`sidebar-nav-item ${viewMode === 'stats' ? 'active' : ''}`}
                onClick={() => { setViewMode('stats'); setSidebarOpen(false); }}>
                <span className="sidebar-nav-icon"><BarChart3 size={16} /></span>
                {getT(sourceLang, 'nav.stats')}
              </button>

              {/* 보너스포인트 충전 (Trial 전용 + 네이티브) — 2026-06-07 개편: 단일 충전 버튼 */}
              {tier === 'trial' && window.Capacitor?.isNativePlatform?.() && (
                <div style={{ padding: '8px 12px 4px' }}>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, margin: '0 0 6px 4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {getT(sourceLang, 'nav.studyMore') || (['ko', 'ja', 'zh-CN'].includes(sourceLang) ? '추가 학습' : 'Study More')}
                  </p>
                  <button
                    onClick={() => handleRewardedAd()}
                    disabled={rewardAdLoading}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', marginBottom: '4px', borderRadius: '12px',
                      background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
                      border: '1px solid #bbf7d0', cursor: 'pointer', textAlign: 'left',
                    }}>
                    <span style={{ fontSize: '1.2rem' }}>🎬</span>
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534' }}>
                        {getT(sourceLang, 'reward.topUpBonus') || '보너스포인트 (광고) +10'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#4ade80' }}>
                        {getT(sourceLang, 'reward.topUpBonusDesc') || '광고 시청 후 포인트 +10'}
                      </div>
                    </div>
                  </button>
                  {rewardAdLoading && (
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', margin: '4px 0 4px' }}>
                      {getT(sourceLang, 'reward.loading') || '광고 로딩 중...'}
                    </p>
                  )}
                  {/* 보너스포인트 구매 (+200, 인앱 결제) — 가격 조회 성공 시에만 표시 */}
                  {pointsPriceString && (
                    <button
                      onClick={handleBuyPoints}
                      disabled={buyingPoints}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '10px 12px', borderRadius: '12px',
                        background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                        border: '1px solid #bfdbfe', cursor: buyingPoints ? 'default' : 'pointer',
                        opacity: buyingPoints ? 0.6 : 1, textAlign: 'left',
                      }}>
                      <span style={{ fontSize: '1.2rem' }}>🪙</span>
                      <div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e40af' }}>
                          {getT(sourceLang, 'reward.buyBonus') || '보너스포인트 (구매) +200'}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#60a5fa' }}>
                          {buyingPoints ? (getT(sourceLang, 'reward.buying') || '구매 처리 중...') : pointsPriceString}
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              )}

              {/* 구독 플랜 섹션 */}
              <div style={{ padding: '8px 12px 4px' }}>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, margin: '0 0 6px 4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {getT(sourceLang, 'nav.subscriptionTitle') || 'Subscribe'}
                </p>
                {/* Pro */}
                <button
                  onClick={() => { setSidebarOpen(false); requestUpgrade('pro'); }}
                  style={{
                    width: '100%', display: 'block', padding: '10px 12px', marginBottom: '6px',
                    borderRadius: '12px', background: 'linear-gradient(135deg, #fefce8, #fef9c3)',
                    border: '1px solid #fde68a', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>🌟 Pro</span>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#92400e', background: '#fde68a', borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap' }}>
                      {getT(sourceLang, 'subscription.noAds') || '광고 없음'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#b45309' }}>
                    {getT(sourceLang, 'subscription.proDesc') || '카드 무제한 · 발음 1,500회/월'}
                  </div>
                </button>
                {/* Premium */}
                <button
                  onClick={() => { setSidebarOpen(false); requestUpgrade('premium'); }}
                  style={{
                    width: '100%', display: 'block', padding: '10px 12px', marginBottom: '4px',
                    borderRadius: '12px', background: 'linear-gradient(135deg, #fdf4ff, #fae8ff)',
                    border: '1px solid #e9d5ff', cursor: 'pointer', textAlign: 'left',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6b21a8' }}>👑 Premium</span>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#6b21a8', background: '#e9d5ff', borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap' }}>
                      {getT(sourceLang, 'subscription.noAds') || '광고 없음'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9333ea' }}>
                    {getT(sourceLang, 'subscription.premiumDesc') || '카드 · 발음 무제한'}
                  </div>
                </button>

              </div>

              {/* 보너스 섹션 — 구독 섹션과 동일한 회색톤 헤더, 활성 시만 카드 표시 */}
              <div style={{ padding: '8px 12px 4px' }}>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, margin: '0 0 6px 4px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {getT(sourceLang, 'nav.bonusTitle') || 'Bonus'}
                </p>
                {hasBonusActive && (
                  <div style={{
                    width: '100%', display: 'block', padding: '4px 4px 8px', marginBottom: '4px',
                    textAlign: 'left',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1d4ed8' }}>
                        🎁 {getT(sourceLang, 'bonus.label') || 'Bonus'} {bonusPoints}pt
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {getT(sourceLang, 'bonus.noInterstitialAd') || 'No interstitial ad'}
                    </div>
                  </div>
                )}

                {/* 친구 추천 — 핑크 그라데이션 + +100pt 뱃지 + 부제목 (Pro/Premium 카드 스타일 패턴) */}
                <button
                  ref={referralBtnRef}
                  onClick={() => {
                    setSidebarOpen(false);
                    if (user?.isAnonymous) {
                      setShowAnonGateModal(true);
                    } else {
                      setShowReferralModal(true);
                    }
                  }}
                  style={{
                    width: '100%', display: 'block', padding: '10px 12px', marginBottom: '6px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #fdf2f8, #fce7f3)',
                    border: '1px solid #f9a8d4', cursor: 'pointer', textAlign: 'left',
                    transition: 'transform 0.25s ease, box-shadow 0.25s ease',
                    boxShadow: referralHighlight ? '0 0 0 3px rgba(99, 102, 241, 0.6), 0 6px 20px rgba(99, 102, 241, 0.4)' : 'none',
                    transform: referralHighlight ? 'scale(1.03)' : 'scale(1)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#9d174d' }}>
                      {getT(sourceLang, 'bonus.referralBtn') || '🤝 Refer a friend'}
                    </span>
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700, color: '#9d174d',
                      background: '#fbcfe8', borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap',
                    }}>
                      +100pt
                    </span>
                  </div>
                </button>

                {/* 리뷰 보상 — 오렌지 그라데이션 + +100pt 뱃지 (iOS는 Apple 5.6.1 정책상 비노출) */}
                {Capacitor.getPlatform() !== 'ios' && (
                  <button
                    onClick={() => {
                      setSidebarOpen(false);
                      if (user?.isAnonymous) {
                        setShowAnonGateModal(true);
                      } else {
                        setShowReviewBonusModal(true);
                      }
                    }}
                    style={{
                      width: '100%', display: 'block', padding: '10px 12px', marginBottom: '4px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
                      border: '1px solid #fdba74', cursor: 'pointer', textAlign: 'left',
                      opacity: reviewBonusClaimed ? 0.5 : 1,
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#9a3412' }}>
                        {getT(sourceLang, 'bonus.reviewBtn') || '🌟 Google Play review'}
                      </span>
                      {!reviewBonusClaimed && (
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 700, color: '#9a3412',
                          background: '#fed7aa', borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap',
                        }}>
                          +100pt
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#c2410c' }}>
                      {reviewBonusClaimed
                        ? `✓ ${getT(sourceLang, 'bonus.review.alreadyClaimed') || 'Already claimed'}`
                        : (getT(sourceLang, 'bonus.reviewSubtitle') || 'One-time only')}
                    </div>
                  </button>
                )}
              </div>

              <div className="sidebar-divider" />

              {/* 설정 */}
              <button className={`sidebar-nav-item sidebar-nav-util ${viewMode === 'settings' ? 'active' : ''}`}
                onClick={() => { setViewMode('settings'); setSettingsScreen('main'); setSidebarOpen(false); }}>
                <span className="sidebar-nav-icon">
                  <SettingsIcon size={16} />
                  {!notificationsSeen && supportsFeature('notifications', profile) && <span className="nav-new-dot" />}
                </span>
                {getT(sourceLang, 'nav.settings')}
              </button>

              {/* Q&A 서브메뉴 */}
              <button className="sidebar-nav-item sidebar-nav-util"
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
          {/* 좌측 그룹 (flex:1): 햄버거 + 보너스 숫자 — 보너스는 햄버거~로고 사이 공간의 중앙 */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Menu">
              <Menu size={26} strokeWidth={2.5} />
            </button>
            {tier === 'trial' && (
              <span style={{
                flex: 1,
                color: '#dc2626', fontWeight: 700, fontSize: '0.75rem',
                textAlign: 'center', userSelect: 'none',
              }}>
                🎁 {bonusPoints}
              </span>
            )}
          </div>

          {/* 로고: 좌/우 컨테이너가 동일한 flex:1 이므로 자연스럽게 정중앙 */}
          <h1 className="main-logo-3d" style={{ flex: '0 0 auto' }}>
            {"PronunFit".split("").map((char, index) => (
              <span key={index} className="logo-char">{char}</span>
            ))}
          </h1>

          {/* 우측 그룹 (flex:1): 홈 버튼 등 — 좌측과 대칭으로 동일 너비 */}
          <div style={{ flex: 1, display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' }}>

            {viewMode === 'library' && libraryBackTo && (
              <button className="header-dict-btn" onClick={() => { setViewMode(libraryBackTo); setLibraryBackTo(null); }}>
                Back
              </button>
            )}
            {/* 동영상 상세뷰 back 버튼 */}
            {viewMode === 'video' && videoDetailOpen && (
              <button className="header-dict-btn" onClick={() => videoReaderRef.current?.closeDetail()}>
                Back
              </button>
            )}
            {/* 홈 버튼 (홈이 아닐 때 항상 표시) */}
            {viewMode === 'home' ? (
              <div className="header-spacer" />
            ) : (
              <button className="header-home-btn" onClick={() => setViewMode('home')} aria-label="Home">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10.5L12 3l9 7.5" />
                  <path d="M5 9.5V19a1 1 0 001 1h12a1 1 0 001-1V9.5" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 2026-05-04: 탭 상단 고정바(tab-title-bar) 제거 — 하단 탭 활성 색상으로 현재 위치 시각화 대체 */}

        {/* 상단 고정바: TODAY · WEEK · STREAK 3분할 (시간축) — 홈에서는 StreakHero가 대체 */}
        {user && viewMode !== 'home' && (() => {
          const today = getToday();
          // 상단 고정바 WEEK 컬럼은 좁아서 1자 약어 사용 (홈/통계는 daily.days 그대로 3자리 유지)
          const dayLabels = getT(sourceLang, 'daily.daysShort').split(',');
          const isTrialTier = tier === 'trial';
          const isProTier = tier === 'pro';

          // 2026-06-07: 상단바 게이지 = Trial(일일 하드캡 3종) / Pro(월 한도 3종) / Premium 등(무제한→없음).
          //   목표달성(Target) 게이지는 홈 "오늘의 진도"에 있으므로 상단바에서 제거.
          //   순서: 💬 FreeTalk / 🎤 발음 / 🎧 Listening (Pro도 동일 아이콘, 월 카운트/캡).
          const gauges = isTrialTier
            ? [
                { icon: MessageCircleMore, cur: todayFreeTalkCount, lim: TRIAL_FREETALK_DAILY_LIMIT },
                { icon: Mic,               cur: todayPronCount,     lim: TRIAL_DAILY_PRON_LIMIT },
                { icon: Headphones,        cur: todayListenCount,   lim: TRIAL_DAILY_LISTEN_LIMIT },
              ]
            : isProTier
            ? [
                { icon: MessageCircleMore, cur: proFreeTalkCount, lim: PRO_FREETALK_LIMIT },
                { icon: Mic,               cur: proPronCount,     lim: PRO_PRON_LIMIT },
                { icon: Headphones,        cur: proListenCount,   lim: PRO_LISTEN_LIMIT },
              ]
            : []; // Premium 등 무제한 → 게이지 없음

          const streakZero = streakCurrent === 0;
          const daysUnit = getT(sourceLang, 'streak.daysUnit') || '일';
          const daysUnitShort = getT(sourceLang, 'streak.daysUnitShort') || daysUnit;
          const daysLeftUnit = getT(sourceLang, 'streak.daysLeftUnit') || 'D';

          return (
            <div className="top-status-bar">
              {/* TODAY */}
              <div className="tsb-col">
                <div className="tsb-label">{getT(sourceLang, 'topbar.today') || '오늘'}</div>
                {gauges.length > 0 ? (
                  <div className="tsb-gauges">
                    {gauges.map((g, i) => {
                      const full = g.cur >= g.lim;
                      const ratio = Math.min((g.cur / g.lim) * 100, 100);
                      const Icon = g.icon;
                      return (
                        <div className="tsb-gauge" key={i}>
                          <span className="tsb-gauge-icon" aria-hidden><Icon size={11} strokeWidth={2.25} /></span>
                          <div className="tsb-gauge-bar">
                            <div className={`tsb-gauge-fill ${full ? 'is-full' : 'is-warn'}`} style={{ width: `${ratio}%` }} />
                          </div>
                          <span className="tsb-gauge-text">{g.cur}/{g.lim}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="tsb-unlimited" aria-hidden>∞ Premium</div>
                )}
              </div>

              {/* STREAK (가운데) */}
              <div className={`tsb-col tsb-streak${streakZero ? ' is-zero' : ''}`}>
                <div className="tsb-label">{getT(sourceLang, 'topbar.streak') || '연속'}</div>
                <div className="tsb-streak-headline">
                  <Gem size={14} strokeWidth={2.25} className="tsb-streak-icon" aria-hidden />
                  <span className="tsb-streak-num">{streakCurrent}</span>
                  <span className="tsb-streak-unit">{daysUnit}</span>
                </div>
                {nextMilestone && !streakZero && (
                  <div className="tsb-streak-next" title={`${nextMilestone}${daysUnitShort} · ${daysToNext}${daysLeftUnit}`}>
                    <Gift size={10} strokeWidth={2.25} aria-hidden />
                    {nextMilestone}{daysUnitShort} · {daysToNext}{daysLeftUnit}
                  </div>
                )}
              </div>

              {/* WEEK (오른쪽) — 통계 탭과 동일 시각 양식 */}
              <div className="tsb-col">
                <div className="tsb-label">{getT(sourceLang, 'topbar.week') || '이번 주'}</div>
                <div className="tsb-week">
                  {weeklyData.map((d, i) => {
                    const isToday = d.date === today;
                    const isFuture = d.date > today;
                    const achieved = d.achieved;
                    const count = d.count || 0;
                    const missed = !isFuture && !achieved && d.date < today;
                    const classes = ['tsb-week-day'];
                    if (achieved) classes.push('is-done');
                    else if (missed && count > 0) classes.push('is-partial');
                    if (isFuture) classes.push('is-future');
                    if (isToday) classes.push('is-today');
                    let mark;
                    if (isFuture) mark = '';
                    else if (achieved) mark = '✅';
                    else if (d.date < today) mark = count > 0 ? '🌙' : '·';
                    else mark = '○';
                    return (
                      <div key={d.date} className={classes.join(' ')}>
                        <span className="tsb-week-dow">{dayLabels[i] || ''}</span>
                        <span className="tsb-week-mark" aria-hidden>{mark}</span>
                      </div>
                    );
                  })}
                </div>
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
            todaySaveCount={todaySaveCount}
            todayPronCount={todayPronCount}
            todayListenCount={todayListenCount}
            todayFreeTalkCount={todayFreeTalkCount}
            dailyGoal={dailyGoal}
            dailyPronLimit={TRIAL_DAILY_PRON_LIMIT}
            dailyFreeTalkLimit={TRIAL_FREETALK_DAILY_LIMIT}
            dailyListenLimit={TRIAL_DAILY_LISTEN_LIMIT}
            sourceLang={sourceLang}
            onNavigate={(tab) => setViewMode(tab)}
            isActive={viewMode === 'home'}
          />
        </div>

        {/* 번역 탭 */}
        <div style={{ display: viewMode === 'translation' ? 'block' : 'none', width: '100%' }}>
          <>
            <div className="primary-sentence-container">
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
                  placeholder={t('translate.placeholder')}
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

            {/* 감지 실패 안내 배너 — 숫자/이모지/식별불가 입력 */}
            {detectionFailed && (
              <div style={{
                margin: '8px 0',
                padding: '10px 14px',
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                color: '#92400e',
                fontSize: '0.85rem',
                lineHeight: 1.4,
              }}>
                {t('translate.detectionFailed')}
              </div>
            )}

            {/* 번역 결과 카드들이 나오는 영역 */}
            <div className="cards-grid">
              {(() => {
                // 케이스 C: 감지 언어가 targetLangs에 없으면 맨 앞에 추가
                const displayLangs = (detectedLang && !targetLangs.includes(detectedLang))
                  ? [detectedLang, ...targetLangs]
                  : targetLangs;
                return displayLangs.map((langCode) => {
                const lang = getLangInfo(langCode);
                const practiceResult = practiceResults[langCode];
                const goal = languageGoals[langCode] || 80;
                // 모국어(sourceLang)가 아닌 모든 카드에 sourceLang 번역 부가 표시
                const showSourceTranslation = langCode !== sourceLang && sourceTranslation;
                return (
                  <div key={langCode} className="library-card-wrapper">
                    <TranslationCard
                      language={lang?.name}
                      langCode={langCode}
                      sourceLangCode={sourceLang}
                      text={translations[langCode]}
                      pronunciation={pronunciations[langCode]}
                      learningTip={learningTips[langCode]}
                      example={translationExamples[langCode]?.example || ''}
                      exampleTranslation={translationExamples[langCode]?.exampleTranslation || ''}
                      examplePronunciation={translationExamples[langCode]?.examplePronunciation || ''}
                      sourceTranslation={showSourceTranslation ? sourceTranslation : ''}
                      badgeColor={lang?.color}
                      badgeTextColor={lang?.textColor}
                      onSpeak={() => handleSpeak(translations[langCode], langCode)}
                      onSpeakText={handleSpeak}
                      onSave={() => handleStarSave(langCode)}
                      isSaved={savedLangCodes.has(langCode)}
                      savedCardId={savedCardIds[langCode]}
                      onPracticeResult={handlePracticeResult}
                      onTrialLimitReached={() => { if (isProPronLimitReached) requestProLimitModal(); else requestLimitModal('pron'); }}
                      onPronSuccess={onPronSuccess}
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
              });
              })()}
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
          {visitedTabsRef.current.has('vocab') && (
          <VocabTab
            isActive={viewMode === 'vocab'}
            sourceLang={sourceLang}
            targetLangs={targetLangs}
            userLevel={userLevel}
            languageLevels={languageLevels}
            onTrialLimitReached={() => { if (isProPronLimitReached) requestProLimitModal(); else requestLimitModal('pron'); }}
            onPronSuccess={onPronSuccess}
            onSaveToLibrary={saveVocabCard}
            onSpeak={handleSpeakSmart}
            languageGoals={languageGoals}
            onBookmarkPrompt={handleBookmarkPrompt}
            onGenerate={() => { incrementVocabGenerate(); incrementDailyGenerate('vocab'); addAdPoints(1); }}
            onNavigateToLibrary={(cardId) => {
              setFocusCardId(cardId);
              setLibraryBackTo('vocab');
              setViewMode('library');
            }}
          />
          )}
          <AdBanner slot="TODO" style={{ margin: '8px 0 4px' }} />
        </div>

        {/* Listening 탭 — 듣기 학습 */}
        <div style={{ display: viewMode === 'listening' ? 'block' : 'none', width: '100%' }}>
          {visitedTabsRef.current.has('listening') && (
          <ListeningTab
            isActive={viewMode === 'listening'}
            sourceLang={sourceLang}
            targetLangs={targetLangs}
            userLevel={userLevel}
            languageLevels={languageLevels}
            isTrialListenLimitReached={isTrialListenLimitReached || isProListenLimitReached}
            onTrialLimitReached={() => { if (isProListenLimitReached) requestProLimitModal(); else requestLimitModal('listen'); }}
            onPronSuccess={onPronSuccess}
            onSaveToLibrary={(params) => saveVocabCard({ ...params, sourceType: 'listening' })}
            onSpeak={handleSpeakSmart}
            onTtsGate={tryConsumeTtsPoint}
            ScenePracticeCardComp={ScenePracticeCard}
            onSaveSentence={({ sentence, translation, learningTip, langCode, scene, pronunciationScore }) =>
              saveSceneCard({ sentence, translation, learningTip, langCode, scene, sceneHint: scene, pronunciationScore, sourceType: 'listening' })}
            languageGoals={languageGoals}
            onBookmarkPrompt={handleBookmarkPrompt}
            onGenerate={() => {
              // 2026-06-07 개편: 진입 게이트(isTrialListenLimitReached = 하드캡 OR 포인트<5)가 사전 차단.
              //   여기 도달 = 허용된 생성. 항상 일일 카운터 +1(하드캡 집계) + 풀 5점 차감.
              incrementListenGenerate();
              incrementDailyListen();
              incrementProListen(); // Pro 월 카운트(+1) — 함수 내부 tier==='pro' 가드, 그 외 no-op
              addAdPoints(5); // 풀 -5 (Listening 생성 비용, trial만)
            }}
            onFirstPlay={() => {}}
            onNavigateToLibrary={(cardId) => {
              setFocusCardId(cardId);
              setLibraryBackTo('listening');
              setViewMode('library');
            }}
          />
          )}
        </div>

        {/* Video 탭 — 다국어 YouTube 동영상 학습 */}
        <div style={{ display: viewMode === 'video' ? 'block' : 'none', width: '100%', height: '100%' }}>
          {visitedTabsRef.current.has('video') && (
          <VideoReader
            ref={videoReaderRef}
            sourceLang={sourceLang}
            onTrialLimitReached={() => { if (isProPronLimitReached) requestProLimitModal(); else requestLimitModal('pron'); }}
            onPronSuccess={onPronSuccess}
            onSaveToLibrary={saveVideoCard}
            onDetailChange={setVideoDetailOpen}
            onBookmarkPrompt={handleBookmarkPrompt}
            languageGoals={languageGoals}
            targetLangs={targetLangs}
            onSendToTranslation={(text) => {
              setInputText(text);
              pendingTranslateRef.current = true;
              setViewMode('translation');
            }}
          />
          )}
        </div>

        {/* Scene 탭 */}
        <div style={{ display: viewMode === 'scene' ? 'block' : 'none', width: '100%' }}>
          {visitedTabsRef.current.has('scene') && (
          <ScenePractice
            sourceLang={sourceLang}
            targetLangs={targetLangs}
            userLevel={userLevel}
            languageLevels={languageLevels}
            onTrialLimitReached={() => { if (isProPronLimitReached) requestProLimitModal(); else requestLimitModal('pron'); }}
            onPronSuccess={onPronSuccess}
            onSaveToLibrary={saveSceneCard}
            onSpeak={handleSpeak}
            languageGoals={languageGoals}
            onBookmarkPrompt={handleBookmarkPrompt}
            onGenerate={() => { incrementSceneGenerate(); incrementDailyGenerate('scene'); addAdPoints(1); }}
            onNavigateToLibrary={(cardId) => {
              setFocusCardId(cardId);
              setLibraryBackTo('scene');
              setViewMode('library');
            }}
            onFreeTalkStart={async (args) => {
              if (isProFreeTalkLimitReached) {
                requestProLimitModal();
                return;
              }
              if (isTrialFreeTalkLimitReached) {
                requestLimitModal('freeTalk');
                return;
              }
              // 2026-05-21: 카운트/credits/점수 차감은 FreeTalkingChat의 onSessionStarted
              // 콜백에서 처리(서버 200 응답 받은 직후). 503/500 등으로 startSession 실패 시
              // 카운트가 보존되어 사용자가 [다시 시도] 버튼으로 같은 1회를 재사용 가능.
              // 2026-06-06: Free Talking 화면 default 난이도는 선택 언어의 languageLevels 값을
              //   따름 (ScenePractice difficulty 가 languageLevels[selectedLang] 로 초기화/동기화).
              //   사용자가 화면에서 명시적으로 변경한 args.difficulty 는 그대로 존중.
              // 사전 안내 게이트 — 영구 dismiss 전이면 PreGuide 먼저, onStart 후 채팅 진입.
              let preGuideDismissed = false;
              try { preGuideDismissed = !!localStorage.getItem(FREETALK_PREGUIDE_KEY); } catch (e) { /* noop */ }
              if (!preGuideDismissed) {
                setFreeTalkPreGuide(args);
                return;
              }
              setFreeTalkSetup(args);
              setFreeTalkOpen(true);
            }}
          />
          )}
          {/* 광고: Scene 탭 하단 — slot은 AdSense 심사 통과 후 채우세요 */}
          <AdBanner slot="TODO" style={{ margin: '8px 0 4px' }} />
        </div>

        {/* Library 탭 */}
        {/* [v1.5.77+ thermal-ios] Library만 조건부 마운트로 전환.
         * 이전엔 display:none으로 항시 마운트되어 savedCards onSnapshot이 다른 탭에서도
         * Firestore long-polling keepalive 유지 → iOS 네트워크 subsystem이 깨어 있어
         * 5분 idle 발열의 잔존 contributor로 의심됨.
         * unmount 시 onSnapshot useEffect cleanup이 자동 호출 → Firestore 구독 해제.
         * focusCardId 흐름: 별표 저장 → setFocusCardId + setViewMode('library') React batch →
         *   Library 새 마운트 시점에 prop으로 전달, [focusCardId] effect 정상 fire,
         *   onSnapshot 첫 snapshot 도착 후 scroll 시도 (race 보호 ref 유지).
         * Trade-off: 다른 탭 갔다 돌아오면 filter/search/limitCount(무한 스크롤 위치)
         *   state 초기화 — 발열 회복 우선이라 수용.
         * AdBanner는 display:none div 안에 그대로 두어 광고 재요청 회피. */}
        <div style={{ display: viewMode === 'library' ? 'block' : 'none', width: '100%' }}>
          {/* 광고: 라이브러리 목록 상단 — slot은 AdSense 심사 통과 후 채우세요 */}
          <AdBanner slot="TODO" style={{ margin: '0 0 8px' }} />
          {viewMode === 'library' && (
            <Library
              user={user}
              sourceLang={sourceLang}
              onSpeak={(t, l, e) => handleSpeak(t, l, e, { saved: true })}
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
              onTrialLimitReached={() => { if (isProPronLimitReached) requestProLimitModal(); else requestLimitModal('pron'); }}
              onPronSuccess={onPronSuccess}
            />
          )}
        </div>

        {/* Settings 탭 */}
        <div style={{ display: viewMode === 'settings' ? 'block' : 'none', width: '100%' }}>
          <div className="settings-container" style={{ position: 'relative' }}>

            {/* ─────────────────────────────────────────────────────────────────
                메인 설정 화면 (단계적 진입 — 카드 6개 그룹)
            ───────────────────────────────────────────────────────────────── */}
            {settingsScreen === 'main' && (
              <div className="settings-main">
                {/* 프로필 카드 (Logout 없음 — 맨 하단으로 이동) */}
                <div className="settings-profile-card">
                  <div className="user-avatar">
                    <User size={20} color="var(--primary-color)" />
                  </div>
                  <div className="settings-profile-card-text">
                    <p className="settings-profile-name">
                      {profile?.displayName || user?.displayName || 'User'}
                      <span className="settings-profile-edit" onClick={handleEditProfile}>Edit</span>
                    </p>
                    <p className="settings-profile-email">{user?.email}</p>
                  </div>
                  <span className="settings-profile-tier">{{
                    trial: 'Free Trial',
                    admin: 'Admin',
                    byok_free: 'BYOK Free',
                    silver: 'Silver',
                    pro: 'Pro',
                    premium: 'Premium',
                  }[tier] || 'Free Trial'}</span>
                </div>

                {/* 카드 그룹 1: 언어 · 학습 · 알림 */}
                <div className="settings-card-group">
                  <button className="settings-card-item" onClick={() => setSettingsScreen('language')}>
                    <span className="settings-card-icon"><Languages size={20} /></span>
                    <span className="settings-card-text">
                      <span className="settings-card-title">{getT(sourceLang, 'settings.groupLanguage')}</span>
                      <span className="settings-card-summary">
                        {getT(sourceLang, `langNames.${sourceLang}`)}
                        {targetLangs.length > 0 && ` → ${targetLangs.map(c => getT(sourceLang, `langNames.${c}`) || c).join(' · ')}`}
                      </span>
                    </span>
                    <ChevronRight size={18} className="settings-card-chevron" />
                  </button>
                  <button className="settings-card-item" onClick={() => setSettingsScreen('learning')}>
                    <span className="settings-card-icon"><Target size={20} /></span>
                    <span className="settings-card-text">
                      <span className="settings-card-title">{getT(sourceLang, 'settings.groupLearning')}</span>
                      <span className="settings-card-summary">
                        {getT(sourceLang, `scene.diff${(userLevel || 'basic').charAt(0).toUpperCase() + (userLevel || 'basic').slice(1)}`)}
                        {' · '}
                        {getT(sourceLang, 'daily.settingsLabel')} {dailyGoal || 3}{getT(sourceLang, 'daily.settingsUnit')}
                      </span>
                    </span>
                    <ChevronRight size={18} className="settings-card-chevron" />
                  </button>
                  <button className="settings-card-item" onClick={() => setSettingsScreen('notif')}>
                    <span className="settings-card-icon"><Bell size={20} /></span>
                    <span className="settings-card-text">
                      <span className="settings-card-title">{getT(sourceLang, 'settings.groupNotif')}</span>
                    </span>
                    <ChevronRight size={18} className="settings-card-chevron" />
                  </button>
                </div>

                {/* 카드 그룹 2: 구독 */}
                <div className="settings-card-group">
                  <button className="settings-card-item" onClick={() => setSettingsScreen('subscription')}>
                    <span className="settings-card-icon"><Gem size={20} /></span>
                    <span className="settings-card-text">
                      <span className="settings-card-title">{getT(sourceLang, 'settings.groupSubscription')}</span>
                      <span className="settings-card-summary">{{
                        trial: getT(sourceLang, 'settings.tierTrial') || 'Free Trial',
                        admin: getT(sourceLang, 'settings.tierAdmin') || 'Admin',
                        silver: getT(sourceLang, 'settings.tierSilver') || 'Silver',
                        pro: getT(sourceLang, 'settings.tierPro') || 'Pro',
                        premium: getT(sourceLang, 'settings.tierPremium') || 'Premium',
                      }[tier] || 'Free Trial'}</span>
                    </span>
                    <ChevronRight size={18} className="settings-card-chevron" />
                  </button>
                </div>

                {/* 카드 그룹 3: 앱 정보 */}
                <div className="settings-card-group">
                  <button className="settings-card-item" onClick={() => setSettingsScreen('about')}>
                    <span className="settings-card-icon"><Info size={20} /></span>
                    <span className="settings-card-text">
                      <span className="settings-card-title">{getT(sourceLang, 'settings.groupAbout')}</span>
                      <span className="settings-card-summary">
                        PronunFit{appVersion ? ` v${appVersion}` : ''}{bundleVersion ? ` (OTA ${bundleVersion})` : ''}
                      </span>
                    </span>
                    <ChevronRight size={18} className="settings-card-chevron" />
                  </button>
                </div>

                {/* 하단: Logout */}
                <div className="settings-logout-row">
                  <button className="settings-logout-btn-bottom" onClick={handleLogout}>
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                서브 화면: 언어 (모국어 + 학습 언어 + 기타 28개)
            ───────────────────────────────────────────────────────────────── */}
            {settingsScreen === 'language' && (
              <>
                <div className="settings-back-header">
                  <button className="settings-back-btn" onClick={() => setSettingsScreen('main')} aria-label="Back">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="settings-back-title">{getT(sourceLang, 'settings.groupLanguage')}</span>
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
                    <span className="lang-flag">{resolveFlag(lang.code, userCountry, lang.flag)}</span>
                    {getT(sourceLang, `langNames.${lang.code}`) || lang.name}
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
                    <span className="lang-flag">{resolveFlag(lang.code, userCountry, lang.flag)}</span>
                    {getT(sourceLang, `langNames.${lang.code}`) || lang.name}
                    {targetLangs.includes(lang.code) && (
                      <span className="lang-order-badge">{targetLangs.indexOf(lang.code) + 1}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* 기타 언어 (Gemini Tier 1 추가 28개) */}
              <div
                onClick={() => setShowExtraLangs(!showExtraLangs)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', marginTop: '10px', cursor: 'pointer',
                  background: '#f8f5ff', borderRadius: '10px', border: '1px solid #e9e0f7',
                }}
              >
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#7B2D8E' }}>
                  {getT(sourceLang, 'settings.extraLangs') || 'Other Languages'} ({EXTRA_LANGUAGES.length})
                  {targetLangs.some(c => EXTRA_LANGUAGES.some(l => l.code === c)) &&
                    <span style={{ marginLeft: 6, color: '#059669', fontSize: '0.8rem' }}>
                      ({targetLangs.filter(c => EXTRA_LANGUAGES.some(l => l.code === c)).length} selected)
                    </span>
                  }
                </span>
                <span style={{ fontSize: '1.1rem', color: '#7B2D8E', transition: 'transform 0.2s', transform: showExtraLangs ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
              </div>
              {showExtraLangs && (
                <div className="lang-grid" style={{ marginTop: '8px' }}>
                  {EXTRA_LANGUAGES.map((lang) => (
                    <div
                      key={lang.code}
                      className={`lang-option ${targetLangs.includes(lang.code) ? 'selected' : ''} ${!targetLangs.includes(lang.code) && targetLangs.length >= 3 ? 'disabled' : ''}`}
                      onClick={() => toggleTargetLang(lang.code)}
                    >
                      {targetLangs.includes(lang.code) && <CheckCircle2 size={16} />}
                      <span className="lang-flag">{resolveFlag(lang.code, userCountry, lang.flag)}</span>
                      {getT(sourceLang, `langNames.${lang.code}`) || lang.name}
                      {targetLangs.includes(lang.code) && (
                        <span className="lang-order-badge">{targetLangs.indexOf(lang.code) + 1}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
              </>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                서브 화면: 학습 설정 (목표 점수 + 난이도 + 하루 카드 수)
            ───────────────────────────────────────────────────────────────── */}
            {settingsScreen === 'learning' && (
              <>
                <div className="settings-back-header">
                  <button className="settings-back-btn" onClick={() => setSettingsScreen('main')} aria-label="Back">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="settings-back-title">{getT(sourceLang, 'settings.groupLearning')}</span>
                </div>

            {/* [신규] 언어별 목표 점수 관리 UI (슬라이더 방식) */}
            <div className="settings-group">
              <label className="settings-label">{getT(sourceLang, 'settings.scoreGoals')} 🎯</label>
              <p className="target-limit-msg" style={{ marginBottom: '0.2rem', color: 'var(--text-secondary)' }}>
                {getT(sourceLang, 'settings.scoreGoalsDesc')}
              </p>
              <div className="goal-sliders">
                {targetLangs.map(code => {
                  const lang = getLangInfo(code);
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

            {/* 기본 학습 난이도 — 언어별 설정 (목표 점수 UI와 동일 레이아웃) */}
            <div className="settings-group">
              <label className="settings-label">{t('settings.defaultLevel')} 📊</label>
              <p className="target-limit-msg" style={{ marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                {getT(sourceLang, 'settings.defaultLevelDesc')}
              </p>
              <div className="goal-sliders">
                {targetLangs.map(code => {
                  const lang = getLangInfo(code);
                  const lvl = languageLevels[code] || userLevel || 'basic';
                  return (
                    <div key={code} className="lang-level-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', background: '#f8fafc', padding: '8px 12px', borderRadius: '12px', gap: '8px' }}>
                      <span style={{ width: '72px', fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '0.85rem', flexShrink: 0 }}>{lang?.name}</span>
                      <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                        {['basic', 'intermediate', 'advanced'].map(lv => (
                          <button
                            key={lv}
                            className={`vocab-level-btn ${lvl === lv ? 'active' : ''}`}
                            onClick={() => setLanguageLevels({ ...languageLevels, [code]: lv })}
                            style={{ flex: 1, padding: '6px 4px', fontSize: '0.76rem' }}
                          >
                            {t(`scene.diff${lv.charAt(0).toUpperCase() + lv.slice(1)}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* [신규] 하루 학습 목표 카드 수 */}
            <div className="settings-group">
              <label className="settings-label">{getT(sourceLang, 'daily.settingsTitle')} 🎯</label>
              <p className="target-limit-msg" style={{ marginBottom: '0.4rem' }}>
                {getT(sourceLang, 'daily.settingsDesc')}
              </p>
              {/* 2026-05-05: Trial 강제(TRIAL_DAILY_CARD_LIMIT 표시) 제거 — 모든 tier 자유 설정.
                   default 10 → 3 (retention 정책 변경). Trial 한도(10장 카드 저장)는 별개 메커니즘. */}
              <div className="goal-slider-row" style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', padding: '8px 12px', borderRadius: '12px' }}>
                <span style={{ width: '42px', fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{getT(sourceLang, 'daily.settingsLabel')}</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={dailyGoal === '' ? 3 : dailyGoal}
                  className="custom-slider"
                  onChange={(e) => setDailyGoal(parseInt(e.target.value))}
                  style={{ flex: 1, margin: '0 10px', '--slider-color': '#6366f1', background: `linear-gradient(to right, #6366f1 ${dailyGoal === '' ? 3 : dailyGoal}%, #e2e8f0 ${dailyGoal === '' ? 3 : dailyGoal}%)` }}
                />
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={dailyGoal === '' ? '' : dailyGoal}
                  className="slider-value-input"
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
                    if (dailyGoal === '' || dailyGoal === undefined) setDailyGoal(3);
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
              </>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                서브 화면: 알림
            ───────────────────────────────────────────────────────────────── */}
            {settingsScreen === 'notif' && (
              <>
                <div className="settings-back-header">
                  <button className="settings-back-btn" onClick={() => setSettingsScreen('main')} aria-label="Back">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="settings-back-title">{getT(sourceLang, 'settings.groupNotif')}</span>
                </div>

                <NotificationSettings
                  sourceLang={sourceLang}
                  uid={user?.uid}
                  profile={profile}
                  active={viewMode === 'settings' && settingsScreen === 'notif'}
                  streakCurrent={streakCurrent}
                />
              </>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                서브 화면: 구독
            ───────────────────────────────────────────────────────────────── */}
            {settingsScreen === 'subscription' && (
              <>
                <div className="settings-back-header">
                  <button className="settings-back-btn" onClick={() => setSettingsScreen('main')} aria-label="Back">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="settings-back-title">{getT(sourceLang, 'settings.groupSubscription')}</span>
                </div>

                <div className="settings-group" style={{ marginTop: '4px' }} ref={subscriptionSectionRef}>
              <label className="settings-label">
                <Lock size={16} /> {getT(sourceLang, 'settings.mySubscription')}
              </label>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#f8fafc', borderRadius: '12px', padding: '12px 16px'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#16a34a' }}>
                    {{
                      trial: `🆓 ${getT(sourceLang, 'settings.tierTrial')}`,
                      admin: `🛡️ ${getT(sourceLang, 'settings.tierAdmin')}`,
                      silver: `🥈 ${getT(sourceLang, 'settings.tierSilver')}`,
                      pro: `⭐ ${getT(sourceLang, 'settings.tierPro')}`,
                      premium: `💎 ${getT(sourceLang, 'settings.tierPremium')}`,
                    }[tier] || `🆓 ${getT(sourceLang, 'settings.tierTrial')}`}
                  </span>
                  {/* 상품명 (Pro/Premium 구독자) — planId 파싱으로 i18n 표시 */}
                  {(tier === 'pro' || tier === 'premium') && profile?.planId && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      📦 {(() => { const id = profile.planId.toLowerCase(); const isPremium = id.includes('premium'); const is3 = id.includes('_3') || id.includes('3month'); return getT(sourceLang, `settings.${isPremium ? (is3 ? 'planPremium3' : 'planPremium1') : (is3 ? 'planPro3' : 'planPro1')}`); })()}
                    </span>
                  )}
                  {/* 만기예정일 (Pro/Premium 구독자, 미래 만기일만 표시) */}
                  {(tier === 'pro' || tier === 'premium') && profile?.subscriptionExpiresAt && (() => {
                    const d = profile.subscriptionExpiresAt.toDate ? profile.subscriptionExpiresAt.toDate() : new Date(profile.subscriptionExpiresAt);
                    return d > new Date();
                  })() && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      📅 {getT(sourceLang, 'settings.expiryDate')}: {(() => { const d = profile.subscriptionExpiresAt.toDate ? profile.subscriptionExpiresAt.toDate() : new Date(profile.subscriptionExpiresAt); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; })()}
                    </span>
                  )}
                  {/* 발음 사용량 (Pro) */}
                  {tier === 'pro' && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      🎤 {getT(sourceLang, 'settings.usagePron')}: {proPronCount}/{PRO_PRON_LIMIT}
                    </span>
                  )}
                  {/* 일일 사용량 (Trial) — 2026-05-07 v1.5.0: 카드 한도 폐기, FT/발음만 표시 */}
                  {tier === 'trial' && (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      🗣️ {getT(sourceLang, 'settings.usageFreeTalk') || 'Free Talking'}: {todayFreeTalkCount}/{TRIAL_FREETALK_DAILY_LIMIT}/day<br />
                      🎤 {getT(sourceLang, 'settings.usagePron')}: {todayPronCount}/{TRIAL_DAILY_PRON_LIMIT}/day
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {tier === 'trial' && (
                    <button
                      onClick={() => requestUpgrade(true)}
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
              </>
            )}

            {/* ─────────────────────────────────────────────────────────────────
                서브 화면: 앱 정보 (Legal links + 버전)
            ───────────────────────────────────────────────────────────────── */}
            {settingsScreen === 'about' && (
              <>
                <div className="settings-back-header">
                  <button className="settings-back-btn" onClick={() => setSettingsScreen('main')} aria-label="Back">
                    <ArrowLeft size={20} />
                  </button>
                  <span className="settings-back-title">{getT(sourceLang, 'settings.groupAbout')}</span>
                </div>

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              paddingTop: '8px',
              flexWrap: 'wrap'
            }}>
              {[
                { label: getT(sourceLang, 'nav.privacy'), mode: 'privacy' },
                { label: getT(sourceLang, 'nav.terms'), mode: 'terms' },
                { label: getT(sourceLang, 'nav.contact'), mode: 'contact' },
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
              </>
            )}
          </div>
        </div>

        {/* Stats 탭 (메인 탭) */}
        <div style={{ display: viewMode === 'stats' ? 'block' : 'none', width: '100%' }}>
          {visitedTabsRef.current.has('stats') && (
          <StatsPage user={user} dailyGoal={dailyGoal} sourceLang={sourceLang} isActive={viewMode === 'stats'}
            streakCurrent={streakCurrent} streakLongest={streakLongest} totalAchievedDays={totalAchievedDays}
            nextMilestone={nextMilestone} nextReward={nextReward} daysToNext={daysToNext} earnedMilestones={earnedMilestones} />
          )}
        </div>
      </main>

      {/* 인앱 브라우저 안내 팝업 삭제됨 */}

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
          zIndex: 'var(--z-dropdown)',
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

      {/* Streak 마일스톤 달성 축하 모달 (7/14/30/100일) */}
      {celebration && (
        <StreakCelebrationModal
          milestone={celebration.milestone}
          reward={celebration.reward}
          sourceLang={sourceLang}
          onClose={dismissCelebration}
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

      {/* 별표 안내 팝업 — 첫 generate 이후 매 세션 1회 (다시 보지 않음 미체크 시) */}
      <StarGuideModal
        open={showStarGuide}
        sourceLang={sourceLang}
        onClose={() => setShowStarGuide(false)}
        onPermanentDismiss={() => {
          localStorage.setItem('starGuideDismissedV2', '1');
          setShowStarGuide(false);
        }}
      />

      {/* 하단 고정 nav 제거됨 — 좌측 햄버거 드로어로 대체 */}

      {/* 하단 탭 바로가기 nav (도트 인디케이터 대체) */}
      {TAB_ORDER.includes(viewMode) && (
        <nav className="tab-nav" aria-label="primary">
          {TAB_ORDER.map((tab) => {
            const s = TAB_STYLE[tab];
            const active = viewMode === tab;
            const label = stripNavPrefix(getT(sourceLang, `nav.${tab}`)) || tab;
            const TabIcon = s.Icon;
            return (
              <button
                key={tab}
                type="button"
                className={`tab-nav__btn ${active ? 'is-active' : ''}`}
                style={{ '--tab-color': s.color }}
                onClick={() => setViewMode(tab)}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                title={label}
              >
                <span className="tab-nav__icon" aria-hidden="true"><TabIcon size={20} strokeWidth={2} /></span>
                <span className="tab-nav__dot" aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      )}

      {/* Trial 한도 도달 모달 */}
      {showTrialLimitModal && (
        <TrialLimitModal
          sourceLang={sourceLang}
          pronCount={todayPronCount}
          freeTalkCount={todayFreeTalkCount}
          listenCount={todayListenCount}
          onClose={() => setShowTrialLimitModal(false)}
          onUpgrade={() => { setShowTrialLimitModal(false); requestUpgrade(true); }}
          reason={trialLimitReason}
          bonusPoints={bonusPoints}
          onCharge={handleRewardedAd}
          rewardAdLoading={rewardAdLoading}
          onBuyPoints={handleBuyPoints}
          buyingPoints={buyingPoints}
          pointsPriceString={pointsPriceString}
        />
      )}

      {/* Free Talking 신기능 안내 — 기존 사용자 한정 1회 (Sprint 3-3) */}
      <FreeTalkingAnnounceModal
        open={freeTalkAnnounceOpen}
        onLater={handleFreeTalkAnnounceLater}
        onStart={handleFreeTalkAnnounceStart}
        t={(key) => getT(sourceLang, key)}
      />

      {/* Free Talking — 카카오톡 스타일 풀스크린 모달 (Sprint 1+2+3) */}
      <FreeTalkingChat
        open={freeTalkOpen}
        setupArgs={freeTalkSetup}
        sourceLang={sourceLang}
        tier={tier}
        ScenePracticeCardComp={ScenePracticeCard}
        onSaveConversationMessage={saveConversationMessage}
        onSaveConversationSummary={saveConversationSummaryPhrases}
        onSpeak={handleSpeak}
        onTrialLimitReached={() => { if (isProPronLimitReached) requestProLimitModal(); else requestLimitModal('pron'); }}
        onPronSuccess={onPronSuccess}
        onBookmarkPrompt={handleBookmarkPrompt}
        languageGoals={languageGoals}
        onSessionStarted={() => { /* 2026-06-07 레이어1: opener 표시 신호만. 차감·카운트는 첫 발화(onFirstUserTurn)로 이동 — 열고 안 쓰고 닫으면 0점. */ }}
        onFirstUserTurn={() => {
          // 2026-06-07 레이어1: 첫 free turn(실제 발화 1회 성공) 시점에만 차감·카운트.
          //   오프너만 보고 닫으면(freeTurnCount 0) 차감 0 — 신규 유저 포인트 낭비 방지.
          //   게이트(onFreeTalkStart의 isTrial/ProFreeTalkLimitReached)는 열기 시점에 이미 검사됨.
          incrementDailyFreeTalk();
          incrementProFreeTalk(); // Pro 월 카운트(+1) — tier==='pro' 가드, 그 외 no-op
          addAdPoints(10); // 풀 -10 (FreeTalk 세션 비용, trial만)
          incrementTotalFreeTalk(); // 분석용 평생 누적(engaged 기준)
        }}
        onClose={() => {
          setFreeTalkOpen(false);
          setFreeTalkSetup(null);
        }}
      />

      {/* FreeTalking 사전 안내 — 채팅 진입 전 게이트 (기존 .ftc-first-guide 대체) */}
      <FreeTalkingPreGuideModal
        open={!!freeTalkPreGuide}
        scenarioName={freeTalkPreGuide?.scene}
        scenarioCategory={freeTalkPreGuide?.sceneI18nLabel}
        scenarioIcon={freeTalkPreGuide?.sceneIcon}
        sourceLang={sourceLang}
        onStart={() => {
          const args = freeTalkPreGuide;
          setFreeTalkPreGuide(null);
          if (!args) return;
          setFreeTalkSetup(args);
          setFreeTalkOpen(true);
        }}
        onClose={() => setFreeTalkPreGuide(null)}
      />


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
          onRequestPhoneVerify={() => { const tier = typeof showUpgradeModal === 'string' ? showUpgradeModal : 'pro'; setPendingUpgradeTier(tier); setShowUpgradeModal(false); handleEditProfile(); }}
          initialTier={typeof showUpgradeModal === 'string' ? showUpgradeModal : undefined}
        />
      )}

      {/* 구독 만료 예정 알림 팝업 */}
      <RenewalReminderPopup
        sourceLang={sourceLang}
        onUpgrade={() => requestUpgrade(true)}
      />

      {/* --- 프로필 수정 모달 (최상위 — 어느 탭에서든 표시) --- */}
      <AnimatePresence>
        {showProfileModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeProfileModal}
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
                onClick={closeProfileModal}
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
                {/* 이메일 + 인증/변경 통합 버튼 */}
                <div className="input-wrapper">
                  <label className="input-label">{getT(sourceLang, 'auth.email')}</label>
                  <div className="input-group" style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Mail size={18} className="input-icon" style={{ color: '#cbd5e1' }} />
                      <input
                        type="email"
                        value={user.email || ''}
                        disabled
                        style={{ background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed', borderColor: '#e2e8f0', width: '100%' }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowEmailVerifyChange(true)}
                      style={{
                        padding: '0 14px', borderRadius: '8px',
                        background: user.emailVerified ? 'white' : '#2563eb',
                        color: user.emailVerified ? '#2563eb' : 'white',
                        border: user.emailVerified ? '1px solid #2563eb' : 'none',
                        fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {user.emailVerified
                        ? getT(sourceLang, 'auth.changeEmailBtn')
                        : getT(sourceLang, 'auth.verifyOrChangeBtn')}
                    </button>
                  </div>
                  {user.emailVerified ? (
                    <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '600', marginLeft: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <CheckCircle2 size={13} /> {getT(sourceLang, 'auth.emailVerified')}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: '600', marginLeft: '4px' }}>
                      ⚠️ {getT(sourceLang, 'auth.emailNotVerified')}
                    </span>
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

      {/* email 미등록 유저 — 이메일 등록 모달 */}
      {showEmailRegister && !showOnboarding && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 'var(--z-modal)', padding: '20px 20px calc(20px + max(env(safe-area-inset-bottom, 0px), var(--admob-bottom, 0px)))'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: '20px', padding: '28px 24px',
              width: '100%', maxWidth: '360px', textAlign: 'center',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }}
          >
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%', background: '#fef2f2',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
              fontSize: '24px'
            }}>
              <Mail size={24} style={{ color: '#dc2626' }} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>
              {getT(sourceLang, 'upgrade.noEmailTitle')}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.6, textAlign: 'left' }}>
              {getT(sourceLang, 'upgrade.noEmailDesc')}
            </p>
            {emailRegError && (
              <p style={{ fontSize: '0.8rem', color: '#dc2626', margin: '0 0 12px' }}>{emailRegError}</p>
            )}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="email"
                value={emailRegInput}
                onChange={(e) => setEmailRegInput(e.target.value)}
                placeholder={getT(sourceLang, 'auth.email')}
                style={{
                  flex: 1, padding: '12px 14px', borderRadius: '10px',
                  border: '1.5px solid #d1d5db', fontSize: '0.9rem', outline: 'none'
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleEmailRegister()}
              />
              <button
                onClick={handleEmailRegister}
                style={{
                  padding: '12px 20px', borderRadius: '10px', border: 'none',
                  background: '#dc2626', color: 'white', fontSize: '0.9rem',
                  fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'
                }}
              >
                {getT(sourceLang, 'upgrade.addEmail')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 데이터 처리 사전 고지 모달 */}
      {showAiConsent && !showOnboarding && (
        <div
          onClick={handleAiConsentAccept}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 'var(--z-modal)', padding: '20px 20px calc(20px + max(env(safe-area-inset-bottom, 0px), var(--admob-bottom, 0px)))'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: '20px', padding: '28px 24px',
              width: '100%', maxWidth: '360px', textAlign: 'center',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }}
          >
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%', background: '#eff6ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
              fontSize: '24px'
            }}>
              {'🤖'}
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>
              {getT(sourceLang, 'aiConsent.title')}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.6, textAlign: 'left' }}>
              {getT(sourceLang, 'aiConsent.body')}
            </p>
            <a
              href="https://pronunfit.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.78rem', color: '#6366f1', display: 'block', marginBottom: '16px' }}
            >
              {getT(sourceLang, 'aiConsent.privacyLink')}
            </a>
            <button
              onClick={handleAiConsentAccept}
              style={{
                width: '100%', padding: '13px', borderRadius: '12px', border: 'none',
                background: '#4f46e5', color: 'white', fontSize: '0.9rem', fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {getT(sourceLang, 'aiConsent.accept')}
            </button>
          </div>
        </div>
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
          zIndex: 'var(--z-toast)', whiteSpace: 'pre-line', textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          maxWidth: '85vw', width: 'max-content',
          animation: 'fadeInUp 0.25s ease-out',
        }}>
          {getT(sourceLang, 'exit.backToast') || '한 번 더 누르면 종료됩니다'}
        </div>
      )}

      {/* 결제 성공 팝업 모달 */}
      {paymentSuccessModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'var(--modal-overlay-bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 'var(--z-modal)', padding: '20px',
        }}>
          <div style={{
            background: 'var(--modal-card-bg)', borderRadius: 'var(--modal-radius)', padding: '32px 24px',
            maxWidth: '340px', width: '100%', textAlign: 'center',
            boxShadow: 'var(--modal-shadow)',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>
              {paymentSuccessModal.tier === 'premium' ? '👑' : '🌟'}
            </div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
              {getT(sourceLang, 'upgrade.toastSuccess') || '결제가 완료되었습니다!'}
            </h2>
            <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0 0 24px', lineHeight: 1.5 }}>
              {getT(sourceLang, 'upgrade.thankYou') || '구독해 주셔서 감사합니다.'}
            </p>
            <button
              onClick={() => {
                setPaymentSuccessModal(null);
                window.location.reload();
              }}
              style={{
                width: '100%', padding: '14px', borderRadius: 'var(--modal-btn-radius)',
                background: 'var(--brand-primary)',
                color: 'var(--text-on-brand)', border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: '1rem',
              }}
            >
              {getT(sourceLang, 'common.confirm') || '확인'}
            </button>
          </div>
        </div>
      )}

      {/* 결제 성공 직후 push opt-in 모달 — becamePaid 트리거 (1.4.x~) */}
      {showPushOptIn && !showSubscriptionPrompt && (
        <PushOptInModal
          sourceLang={sourceLang}
          uid={user?.uid}
          onClose={(arg) => {
            pushPromptDismissedRef.current = true;
            setShowPushOptIn(false);
            const result = arg?.result || 'dismissed';
            const update = { pushOptInLastShownAt: serverTimestamp() };
            if (result !== 'registered') update.pushOptInDismissCount = increment(1);
            updateUserProfile(update).catch(() => {});
          }}
        />
      )}

      {/* 신규/dismissed 유저 첫/재 실행 시 학습+구독 알림 동의 (A1, 2026-05-03) */}
      {/* 'registered': fcmTokenUpdatedAt set → 다음에 안 뜸 / 'denied'·'dismissed': 7일 스누즈 + dismissCount cap */}
      {/* showAiConsent와 동시에 뜨지 않도록 명시 가드 (AI Consent 먼저) */}
      {showSubscriptionPrompt && !showOnboarding && !showAiConsent && (
        <PushOptInModal
          sourceLang={sourceLang}
          uid={user?.uid}
          onClose={(arg) => {
            pushPromptDismissedRef.current = true;
            setShowSubscriptionPrompt(false);
            const result = arg?.result || 'dismissed';
            const update = { pushOptInLastShownAt: serverTimestamp() };
            if (result !== 'registered') update.pushOptInDismissCount = increment(1);
            updateUserProfile(update).catch(() => {});
          }}
        />
      )}

      {/* 구독 이벤트 팝업 — push 탭 / tier 변경 감지 시 표시 */}
      {subscriptionEvent && (
        <SubscriptionEventModal
          type={subscriptionEvent.type}
          sourceLang={sourceLang}
          onClose={() => setSubscriptionEvent(null)}
          onAction={(action) => {
            setSubscriptionEvent(null);
            if (action === 'renew') {
              // 갱신하기 → UpgradeModal 열기
              setShowUpgradeModal(true);
            } else if (action === 'retry') {
              // 재결제 → 설정 탭 + 구독 섹션 스크롤
              setViewMode('settings');
              setSidebarOpen(false);
              setTimeout(() => {
                subscriptionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 300);
            }
          }}
        />
      )}

      {/* 결제 실패 토스트 */}
      {paymentToast && (
        <div style={{
          position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
          background: '#64748b',
          color: 'white', padding: '12px 24px', borderRadius: '20px',
          fontWeight: '700', fontSize: '0.9rem', zIndex: 'var(--z-toast)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)', whiteSpace: 'nowrap'
        }}>
          {getT(sourceLang, 'upgrade.toastFail')}
        </div>
      )}
    </div>
  );
}

export default App;
