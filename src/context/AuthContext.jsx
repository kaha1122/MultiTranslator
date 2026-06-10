import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { auth, db, analytics } from '../firebase/config';
import { onAuthStateChanged, signInAnonymously, linkWithCredential } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, increment, serverTimestamp, getDoc, runTransaction } from 'firebase/firestore';
import { setUserId } from 'firebase/analytics';
import { Capacitor } from '@capacitor/core';
import { isBot } from '../utils/isBot';
import { authFetch } from '../utils/authFetch';
import { detectGeoInfo } from '../utils/detectCountry';
import { getToday } from '../hooks/useDailyProgress';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const AuthContext = createContext();

// 회원탈퇴 진행 중 플래그 (onSnapshot이 문서를 재생성하지 않도록)
let accountDeletionInProgress = false;
export const setAccountDeletionFlag = (v) => { accountDeletionInProgress = v; };

// 익명 로그인 중복 실행 방지 플래그
let anonSignInInProgress = false;


export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    // 포인트 차감 등에서 항상 "최신" profile을 읽기 위한 미러 ref.
    //   consumeBonusPoints가 stale 클로저(예: useCallback deps 누락된 onPronSuccess)에 갇혀도
    //   차감 시점의 실제 잔액을 보장 — 2026-06-10 신규유저 발음 9회 0차감 누수 사고 대응.
    const profileRef = useRef(profile);
    useEffect(() => { profileRef.current = profile; }, [profile]);

    // 최종 안전장치: 어떤 코드 경로에서든 loading이 10초 이상 지속되면 강제 해제
    // (Strategy A 적용 후엔 onAuthStateChanged의 정상 경로에서 loading=false가 즉시 풀리므로
    //  실제로 이 타이머가 발화하는 경우는 거의 없음 — 디펜스 인 뎁스로 유지)
    useEffect(() => {
        if (!loading) return;
        const safetyTimer = setTimeout(() => {
            console.warn('[AuthContext] 로딩 10초 초과 — 강제 해제');
            if (auth.currentUser) {
                setUser(auth.currentUser);
            }
            setLoading(false);
        }, 10000);
        return () => clearTimeout(safetyTimer);
    }, [loading]);

    useEffect(() => {
        let unsubscribeProfile;

        const unsubscribeAuth = onAuthStateChanged(auth, async (authenticatedUser) => {
            if (authenticatedUser) {
                // 로그인 성공 시 명시적 로그아웃 플래그 제거
                if (!authenticatedUser.isAnonymous) {
                    localStorage.removeItem('didExplicitLogout');
                }
                setUser(authenticatedUser);
                if (analytics) setUserId(analytics, authenticatedUser.uid);

                const docRef = doc(db, 'users', authenticatedUser.uid);

                // 익명 유저: 최소 Firestore 문서 생성 후 onSnapshot 연결
                let docJustCreated = false;
                if (authenticatedUser.isAnonymous) {
                    try {
                        const snap = await getDoc(docRef);
                        if (!snap.exists()) {
                            const platform = window.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
                            const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                            await setDoc(docRef, {
                                uid: authenticatedUser.uid,
                                isAnonymous: true,
                                tier: 'trial',
                                platform,
                                deviceLang,
                                createdAt: serverTimestamp(),
                                updatedAt: serverTimestamp(),
                                // 첫날 일일충전(+30)을 문서 생성과 동시에 동기 부여.
                                //   비동기 claimDailyTopUp이 도착하기 전 첫 액션이 bonusPoints=0을
                                //   읽어 차감이 통째로 누락되던 race 창 제거. lastTopUpDate=오늘로
                                //   당일 재충전은 claimDailyTopUp 가드가 자동 skip(이중충전 없음).
                                bonusPoints: 30,
                                firstTopUpDone: true,
                                lastTopUpDate: getToday(),
                            });
                            docJustCreated = true;
                            // 위치 정보 비동기 저장 (문서 생성 블로킹하지 않음)
                            // phoneCountry도 함께 기록 — 결제 통화 결정 기본값 (프로필 편집 전까지)
                            detectGeoInfo().then(info => {
                                if (info.country) {
                                    updateDoc(docRef, {
                                        geoCountry: info.country,
                                        geoCity: info.city || '',
                                        geoRegion: info.region || '',
                                        phoneCountry: info.country,
                                    }).catch(() => {});
                                }
                            }).catch(() => {});
                        }
                    } catch (e) {
                        console.error('[AuthContext] Anonymous user doc creation failed:', e);
                        // onSnapshot fallback(line 56-64)이 재시도하므로 계속 진행
                    }
                }

                // [v1.5.84+ thermal-ios] 앱 재실행 시 updatedAt 갱신 — 5분 가드 추가
                // Why: updatedAt write → onSnapshot 발화 → setProfile → AuthProvider 재렌더
                //   cascade가 매 앱 실행마다 발생. v1.5.83 useMemo로 consumer 재렌더는
                //   차단됐지만 profile reference 자체가 새로워져 useMemo deps 비교 실패 →
                //   value 재생성 → consumer 재렌더. 따라서 write 빈도 자체를 줄이는 게
                //   효과적. 4차 mobile-production-guardian Fix 3.
                // localStorage 가드: 디바이스별 추적, 5분 이내 재실행 시 write skip.
                // 다른 디바이스에서 동일 계정 사용 시는 가드 무시되지만 영향 미미
                // (re-engagement push의 lastActiveAt 별도 추적).
                if (!docJustCreated) {
                    try {
                        const lastUpdatedKey = `pronunfit_lastUpdatedAt_${authenticatedUser.uid}`;
                        const lastUpdatedMs = parseInt(localStorage.getItem(lastUpdatedKey) || '0', 10);
                        const FIVE_MIN_MS = 5 * 60 * 1000;
                        if (Date.now() - lastUpdatedMs >= FIVE_MIN_MS) {
                            updateDoc(docRef, { updatedAt: serverTimestamp() }).catch(e =>
                                console.error('[AuthContext] updatedAt refresh failed:', e)
                            );
                            localStorage.setItem(lastUpdatedKey, String(Date.now()));
                        }
                    } catch (e) {
                        // localStorage 접근 실패 시 fallback — 가드 없이 write (이전 동작)
                        updateDoc(docRef, { updatedAt: serverTimestamp() }).catch(() => {});
                    }
                }

                // Push 토큰 재등록은 App.jsx mount에서 전역 리스너가 처리
                // (여기서는 별도 처리 불필요 — App.jsx가 checkPermissions + register 자동 수행)

                unsubscribeProfile = onSnapshot(docRef, async (docSnap) => {
                    if (docSnap.exists()) {
                        setProfile(docSnap.data());
                        setLoading(false);
                        return;
                    }
                    // 회원탈퇴 중이면 문서 재생성 방지
                    if (accountDeletionInProgress) return;
                    // 🚨 false-positive "문서 없음" 방어 (앱 업그레이드 직후 IndexedDB 재구축 중 cache miss
                    //    또는 listener attach 직후 cached 빈 결과로 인해 기존 displayName/hasCompletedOnboarding
                    //    이 덮어쓰여지던 데이터-파괴적 경로 차단)
                    if (docSnap.metadata.fromCache) return; // cache 결과는 신뢰 안 함, server confirm 대기
                    try {
                        const verifySnap = await getDoc(docRef); // server-first 재확인
                        if (verifySnap.exists()) {
                            setProfile(verifySnap.data());
                            setLoading(false);
                            return;
                        }
                    } catch (err) {
                        console.warn('[AuthContext] verify getDoc failed:', err?.message);
                        return; // 확신 없으면 destructive write 금지
                    }
                    // 진짜 신규 — destructive default 제거 (null/empty로 기존 값 덮어쓰지 않도록 truthy일 때만 set)
                    const platform = window.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
                    const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                    const newDoc = {
                        uid: authenticatedUser.uid,
                        platform,
                        deviceLang,
                        tier: 'trial',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        // 첫날 일일충전(+30) 동기 부여 — 메인 생성 경로와 동일(차감 누락 race 차단).
                        //   merge:true라도 신규 문서(verifySnap 부재 확인 후 도달)이므로 안전.
                        bonusPoints: 30,
                        firstTopUpDone: true,
                        lastTopUpDate: getToday(),
                    };
                    if (authenticatedUser.email) newDoc.email = authenticatedUser.email;
                    if (authenticatedUser.displayName) newDoc.displayName = authenticatedUser.displayName;
                    await setDoc(docRef, newDoc, { merge: true });
                    // 위치 정보 비동기 저장
                    // phoneCountry도 함께 기록 — 결제 통화 결정 기본값 (프로필 편집 전까지)
                    detectGeoInfo().then(info => {
                        if (info.country) {
                            updateDoc(docRef, {
                                geoCountry: info.country,
                                geoCity: info.city || '',
                                geoRegion: info.region || '',
                                phoneCountry: info.country,
                            }).catch(() => {});
                        }
                    }).catch(() => {});
                    // setDoc 후 onSnapshot이 다시 호출되어 setLoading(false) 처리됨
                }, (error) => {
                    console.error("Error fetching user profile:", error);
                    setProfile(null);
                    setLoading(false);
                });

            } else {
                // 네이티브(Capacitor) 환경: 네이티브 Firebase에 로그인된 유저가 있으면
                // 웹 SDK 동기화를 기다려야 함 — 즉시 signInAnonymously 호출 금지
                if (window.Capacitor?.isNativePlatform?.()) {
                    try {
                        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
                        const result = await FirebaseAuthentication.getCurrentUser();
                        if (result.user) {
                            // ⭐ Strategy A: 네이티브에 유저 있음 → loading 즉시 해제하여 home이 user=null로 렌더되게 함
                            //   (웹 SDK 동기화 완료 시 onAuthStateChanged가 다시 발화하여 user 채워짐)
                            //   pending-ios-fixes.md 항목 1 — 다음 iOS 빌드 시 실기기 검증 필요
                            setUser(null);
                            setProfile(null);
                            setLoading(false);
                            // ⚠️ Phase 1-A (2026-05-05): 5초 익명 폴백 제거.
                            //   네이티브 세션이 살아있는데 웹 SDK 동기화가 늦으면 새 익명 UID를 만들어
                            //   기존 실계정을 덮어버리던 데이터-파괴적 경로였음 (Play Store 업그레이드 후 재현).
                            //   웹 SDK는 IndexedDB가 복원되면 onAuthStateChanged가 재발화하여 자연 회복.
                            //   사용자가 즉시 인증 필요한 동작을 하면 ensureAnonymousUser가 lazy 처리.
                            return;
                        }
                    } catch (e) {
                        // 플러그인 오류 시 기존 로직으로 폴백
                    }
                }

                // 명시적 로그아웃 후 또는 웹 첫 방문(랜딩 표시 대상):
                // anonymous 자동 생성 건너뜀 → Landing에서 "시작하기" 클릭 시에만 생성
                const isNative = window.Capacitor?.isNativePlatform?.();
                // 봇(AdSense/검색엔진)은 랜딩 게이트 우회 → 앱 콘텐츠 크롤링 허용
                const needsLanding = !isNative && !isBot() && localStorage.getItem('webAppEntered') !== '1';
                if (localStorage.getItem('didExplicitLogout') === '1' || needsLanding) {
                    setUser(null);
                    setProfile(null);
                    setLoading(false);
                    return;
                }

                // ⭐ Strategy A: 자동 익명 사인인을 백그라운드(fire-and-forget)로 전환
                //   - loading을 즉시 해제하여 home이 user=null 상태로 첫 페인트 가능
                //   - 사인인 완료 시 onAuthStateChanged가 다시 발화하여 user/profile 자동 채워짐
                //   - useEffect 16곳이 user?.uid 의존이라 자연스럽게 catch-up됨
                //   - 1회차 콜드 스타트 첫 페인트가 네트워크 RTT(3-6초)에 막히지 않음

                // 첫 진입 즉시 home 렌더 허용 (이미 진행 중이거나 currentUser 있어도 동일하게 처리)
                setUser(null);
                setProfile(null);
                setLoading(false);

                if (anonSignInInProgress) return;
                anonSignInInProgress = true;

                // IndexedDB 복원 + 사인인은 비동기 백그라운드
                (async () => {
                    try {
                        // Phase 1-B (2026-05-05): 5s → 20s.
                        //   업그레이드 직후 첫 부팅에서 IndexedDB 인덱스 재구축이 5초 초과하는 케이스 흡수.
                        //   UI는 위에서 이미 setLoading(false)로 해제됨 — 사용자 체감 영향 없음.
                        await Promise.race([
                            auth.authStateReady(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('authStateReady timeout')), 20000))
                        ]);
                        if (auth.currentUser) return; // 복원된 유저 있음 — onAuthStateChanged가 다시 발화함
                        await signInAnonymously(auth);
                    } catch (e) {
                        console.error('Anonymous sign-in failed or timeout (background):', e);
                        // 타임아웃이든 실패든, 익명 로그인 재시도 (1회)
                        try {
                            await signInAnonymously(auth);
                        } catch (e2) {
                            console.error('Anonymous sign-in retry failed:', e2);
                            // user=null 상태 유지 — 사용자가 Generate 시도하면 ensureAnonymousUser가 다시 시도
                        }
                    } finally {
                        anonSignInInProgress = false;
                    }
                })();
            }
        });

        return () => {
            unsubscribeAuth();
            if (unsubscribeProfile) unsubscribeProfile();
        };
    }, []);

    // 사용자 프로필 정보를 업데이트하는 함수
    const updateUserProfile = async (updates) => {
        if (!user) return;
        try {
            const docRef = doc(db, 'users', user.uid);
            await setDoc(docRef, updates, { merge: true });
        } catch (error) {
            console.error("Error updating profile:", error);
            throw error;
        }
    };

    // ⭐ Strategy A: Generate 같은 사용자 액션 직전에 호출 — 익명 UID 보장
    //   - 이미 user 있으면 즉시 반환
    //   - 백그라운드 사인인 진행 중이면 polling으로 완료 대기 (최대 10초)
    //   - 아예 미시작이면 여기서 사인인 시작
    //   - 실패 시 null 반환 → 호출 측에서 alert 등 처리
    const ensureAnonymousUser = async () => {
        if (auth.currentUser) return auth.currentUser;
        // 진행 중 — onAuthStateChanged listener로 완료 대기 (최대 10초)
        // Why: 50ms setInterval 폴링은 iOS 26 WKWebView에서 P-코어 wake 빈도가 높아 발열 유발
        if (anonSignInInProgress) {
            return new Promise((resolve) => {
                let settled = false;
                let timer;
                const finish = (val) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    unsubscribe();
                    resolve(val);
                };
                const unsubscribe = onAuthStateChanged(auth, (u) => {
                    if (u) finish(u);
                });
                timer = setTimeout(() => finish(auth.currentUser || null), 10000);
            });
        }
        anonSignInInProgress = true;
        try {
            const cred = await signInAnonymously(auth);
            return cred.user;
        } catch (e) {
            console.error('ensureAnonymousUser failed:', e);
            return null;
        } finally {
            anonSignInInProgress = false;
        }
    };

    // ── 익명 → 실계정 업그레이드 ──────────────────────────────────────────────
    // credential: GoogleAuthProvider.credential(idToken) 또는 EmailAuthProvider.credential(email, pw)
    const upgradeAnonymous = async (credential) => {
        if (!user || !user.isAnonymous) return;
        try {
            // 기존 익명 유저의 displayName 보존
            const existingName = profile?.displayName;
            const result = await linkWithCredential(auth.currentUser, credential);
            // Firestore 문서에 실계정 정보 병합 (uid는 그대로 유지됨)
            // 기존 닉네임이 있으면 유지, 없으면 Google/provider 이름 사용
            await setDoc(doc(db, 'users', result.user.uid), {
                email: result.user.email,
                displayName: existingName || result.user.displayName || result.user.email?.split('@')[0] || 'User',
                isAnonymous: false,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            return result;
        } catch (error) {
            console.error('upgradeAnonymous failed:', error);
            throw error;
        }
    };

    // ── Tier / Trial 관리 ─────────────────────────────────────────────────────
    // byok_free → admin 하위호환 매핑
    const rawTier = profile?.tier || 'trial';
    const tier = rawTier === 'byok_free' ? 'admin' : rawTier;

    // 2026-05-07 v1.5.0: 카드 daily 한도 제거 — 점수 시스템(15점)이 단일 게이트.
    //   카드 저장은 점수 차감(-1)으로만 관리. TRIAL_DAILY_CARD_LIMIT 상수 폐기.
    const TRIAL_DAILY_PRON_LIMIT = 10;        // Free Trial: 하루 발음 10회 (+ pronCredits 영구) — 2026-05-19 20→10 (Azure 비용 절감)
    const TRIAL_FREETALK_DAILY_LIMIT = 2;     // Free Trial: 하루 Free-Talking 세션 2회 (+ freeTalkCredits 영구)
    const TRIAL_DAILY_LISTEN_LIMIT = 3;       // Free Trial: 하루 Listening passage 3회 (2026-05-23 신설) — Gemini + Azure TTS 비용 가드
    const PRO_PRON_LIMIT = 1000;              // Pro: 월 발음 1000회 (2026-06-07 1500→1000)
    const PRO_FREETALK_LIMIT = 100;           // Pro: 월 Free-Talking 100회 (2026-06-07 신설 — 무제한→월캡, Azure 꼬리위험 차단)
    const PRO_LISTEN_LIMIT = 200;             // Pro: 월 Listening 생성 200회 (2026-06-07 신설). Premium은 무제한.

    // 하위호환: 기존 필드 유지 (분석용)
    const trialCardCount = profile?.trialCardCount || 0;
    const savedCardCount = profile?.savedCardCount || 0;
    const trialPronCount = profile?.trialPronCount || 0;
    // Pro 월별 횟수 — proPronResetMonth 를 공통 월 앵커로 3종 동시 리셋
    const proPronCount = profile?.proPronCount || 0;
    const proFreeTalkCount = profile?.proFreeTalkCount || 0;
    const proListenCount = profile?.proListenCount || 0;
    const proPronResetMonth = profile?.proPronResetMonth || '';
    // Free Talking 평생 누적 세션 시작 횟수 (분석용 — 사용자별 generate 빈도 측정)
    const totalFreeTalkCount = profile?.totalFreeTalkCount || 0;

    // 보너스 포인트 — 캠페인 보상 (리뷰/추천/스트릭). 활성 시: 일일 한도 해제 + 인터스티셜 면제, 배너는 유지
    const bonusPoints = profile?.bonusPoints || 0;
    const hasBonusActive = bonusPoints > 0;

    // 2026-05-07 v1.5.0 신규: 보상광고 영구 적립 자산 (Firestore — 사용할 때까지 보관)
    //   freeTalkCredits: 광고 1회 시청 → +2 (Free Talking 추가 세션, 영구)
    //   pronCredits:     광고 1회 시청 → +5 (발음 평가 추가 횟수, 영구) — 2026-05-19 +10→+5
    //   기존 rewardBonus_{date} localStorage 시스템 폐기 (당일 리셋이라 미사용분 손실)
    const freeTalkCredits = profile?.freeTalkCredits || 0;
    const pronCredits = profile?.pronCredits || 0;
    const listenCredits = profile?.listenCredits || 0;  // 2026-05-23: Listening 광고 보상권 (영구 적립)

    // ⚠ Trial 일간 제한 동기화 — todayPronCount/todayFreeTalkCount/todayListenCount는 App.jsx에서 주입
    const [dailyTrialPronReached, setDailyTrialPronReached] = useState(false);
    const [dailyTrialFreeTalkReached, setDailyTrialFreeTalkReached] = useState(false);
    const [dailyTrialListenReached, setDailyTrialListenReached] = useState(false);

    // 2026-06-07 개편: 하드캡 절대(일일 한도 초과 불가) + 통합 포인트 풀(bonusPoints) 게이트.
    //   "한도 도달(하드캡)" 또는 "포인트 부족(< 액션 비용)" 중 하나라도면 차단. credits/bonus 우회 제거.
    //   포인트 부족이면 사이드바 보상광고 충전(+5)으로 회복, 하드캡이면 Tier 변경만.
    const POINT_COST = { freeTalk: 10, listen: 5, pron: 2 };
    const isTrialPronLimitReached = tier === 'trial' && (dailyTrialPronReached || bonusPoints < POINT_COST.pron);
    const isTrialFreeTalkLimitReached = tier === 'trial' && (dailyTrialFreeTalkReached || bonusPoints < POINT_COST.freeTalk);
    const isTrialListenLimitReached = tier === 'trial' && (dailyTrialListenReached || bonusPoints < POINT_COST.listen);
    const isProPronLimitReached = tier === 'pro' && proPronCount >= PRO_PRON_LIMIT;
    const isProFreeTalkLimitReached = tier === 'pro' && proFreeTalkCount >= PRO_FREETALK_LIMIT;
    const isProListenLimitReached = tier === 'pro' && proListenCount >= PRO_LISTEN_LIMIT;

    // 보너스 포인트 차감 — 2026-06-07: 트랜잭션 → updateDoc(increment) 으로 단순화.
    //   트랜잭션은 같은 user 문서 동시 쓰기(markActiveDay 등)와 낙관적 락 충돌(failed-precondition)
    //   을 일으켜 콘솔 폭주 + 재시도 낭비 → increment 는 서버 원자 연산이라 경합해도 실패 없음.
    //   음수 방지: 클라 보유분(profile.bonusPoints)으로 clamp. 게이트가 사전에 pool>=cost 보장하므로
    //   gated 액션은 음수 불가, best-effort(TTS/Vocab 등)도 clamp 로 0 미만 차감 안 함.
    const consumeBonusPoints = useCallback(async (amount) => {
        if (!user?.uid || amount <= 0) return 0;
        // profileRef로 "차감 시점"의 최신 잔액을 읽음 — render 클로저의 stale profile 회피.
        //   (메모이즈된 핸들러가 옛 bonusPoints=0 스냅샷에 갇혀 조용히 0차감하던 누수 차단)
        const current = profileRef.current?.bonusPoints || 0;
        const consumed = Math.min(current, amount);
        if (consumed <= 0) return 0;
        try {
            await updateDoc(doc(db, 'users', user.uid), { bonusPoints: increment(-consumed) });
            return consumed;
        } catch (e) {
            return 0;
        }
    }, [user?.uid]);

    // 2026-06-07 개편: 일일 포인트 충전 — 1일차 30점, 2일차+ 매일 +10점(reset 아닌 누적).
    //   (2026-06-09 +15 상향했다가 차감을 "텍스트당 1회"로 완화 → 2026-06-10 +10 원복)
    //   날짜-키 트랜잭션 가드(markActiveDay 패턴)로 멀티기기 이중충전 차단. Trial 전용.
    const claimDailyTopUp = async () => {
        if (!user?.uid) return;
        const today = getToday();
        if (profile?.lastTopUpDate === today) return; // 빠른 우회
        try {
            await runTransaction(db, async (tx) => {
                const ref = doc(db, 'users', user.uid);
                const snap = await tx.get(ref);
                const d = snap.data() || {};
                if (d.lastTopUpDate === today) return; // race 가드
                const amount = d.firstTopUpDone ? 10 : 30;
                tx.update(ref, {
                    bonusPoints: increment(amount),
                    lastTopUpDate: today,
                    firstTopUpDone: true,
                });
            });
        } catch (e) {
            // 충전 실패는 다음 진입에서 재시도 (날짜 게이트 유지)
        }
    };

    // freeTalkCredits 차감 — 광고로 적립한 영구 FT 추가권 1회 소비
    const consumeFreeTalkCredits = async (amount) => {
        if (!user?.uid || amount <= 0) return 0;
        try {
            let consumed = 0;
            await runTransaction(db, async (tx) => {
                const ref = doc(db, 'users', user.uid);
                const snap = await tx.get(ref);
                const current = snap.data()?.freeTalkCredits || 0;
                consumed = Math.min(current, amount);
                if (consumed > 0) {
                    tx.update(ref, { freeTalkCredits: increment(-consumed) });
                }
            });
            return consumed;
        } catch (e) {
            return 0;
        }
    };

    // pronCredits 차감 — 광고로 적립한 영구 발음 추가권 1회 소비
    const consumePronCredits = async (amount) => {
        if (!user?.uid || amount <= 0) return 0;
        try {
            let consumed = 0;
            await runTransaction(db, async (tx) => {
                const ref = doc(db, 'users', user.uid);
                const snap = await tx.get(ref);
                const current = snap.data()?.pronCredits || 0;
                consumed = Math.min(current, amount);
                if (consumed > 0) {
                    tx.update(ref, { pronCredits: increment(-consumed) });
                }
            });
            return consumed;
        } catch (e) {
            return 0;
        }
    };

    // listenCredits 차감 — 광고로 적립한 영구 Listening 추가권 1회 소비 (2026-05-23 신설)
    const consumeListenCredits = async (amount) => {
        if (!user?.uid || amount <= 0) return 0;
        try {
            let consumed = 0;
            await runTransaction(db, async (tx) => {
                const ref = doc(db, 'users', user.uid);
                const snap = await tx.get(ref);
                const current = snap.data()?.listenCredits || 0;
                consumed = Math.min(current, amount);
                if (consumed > 0) {
                    tx.update(ref, { listenCredits: increment(-consumed) });
                }
            });
            return consumed;
        } catch (e) {
            return 0;
        }
    };

    // phoneCountry 자동 보완 — 기존 null 유저(~96%) 대응
    // 결제 통화 판정은 phoneCountry === 'KR' 기준이므로 null이면 USD로 오탐
    // 다음 로그인 시 geoCountry/sourceLang 기반 추론해서 자동 세팅 (사용자는 이후에도 수정 가능)
    useEffect(() => {
        if (!user?.uid || !profile) return;
        if (profile.phoneCountry) return; // 이미 있으면 skip
        const inferred = profile.geoCountry
            || (profile.sourceLang === 'ko' ? 'KR' : null);
        if (!inferred) return;
        updateDoc(doc(db, 'users', user.uid), { phoneCountry: inferred }).catch(() => {});
    }, [user?.uid, profile?.phoneCountry, profile?.geoCountry, profile?.sourceLang]);

    // Pro 월별 카운터 리셋
    useEffect(() => {
        if (!user || tier !== 'pro') return;
        // 로컬 타임존 기준 YYYY-MM — UTC 면 월말/월초 경계가 어긋남
        const _now = new Date();
        const currentMonth = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
        if (proPronResetMonth && proPronResetMonth === currentMonth) return;
        // 2026-06-07: 월 바뀌면 Pro 3종 카운트(발음/FreeTalk/Listening) 동시 리셋. proPronResetMonth가 공통 앵커.
        updateDoc(doc(db, 'users', user.uid), {
            proPronCount: 0,
            proFreeTalkCount: 0,
            proListenCount: 0,
            proPronResetMonth: currentMonth,
        }).catch(e => console.error("Pro monthly reset failed:", e));
    }, [user, tier, proPronResetMonth]);

    // 2026-06-07 개편: Trial 일일 포인트 충전 (1일차 30 / 2일차+ +10). 날짜 바뀌면 1회 실행.
    //   게이팅(isTrialXLimitReached)이 평가되기 전에 잔액이 채워지도록 profile 로드 직후 실행.
    useEffect(() => {
        if (!user?.uid || !profile || tier !== 'trial') return;
        if (profile.lastTopUpDate === getToday()) return;
        claimDailyTopUp();
        // deps: !!profile(로드 시점 1회 트리거) + lastTopUpDate(충전 후 가드 재평가).
        //   profile 객체 전체를 deps로 두면 매 snapshot마다 재실행돼 동시 트랜잭션 충돌(failed-precondition)
        //   폭주 → !!profile 로 "로드 1회"만 트리거. 트랜잭션 가드로 이중충전 차단.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, !!profile, profile?.lastTopUpDate, tier]);

    // 구독 만료 체크
    useEffect(() => {
        if (!user || !profile?.subscriptionExpiresAt) return;
        if (tier !== 'pro' && tier !== 'premium') return;
        const expiresAt = profile.subscriptionExpiresAt.toDate ? profile.subscriptionExpiresAt.toDate() : new Date(profile.subscriptionExpiresAt);
        if (new Date() <= expiresAt) return; // 아직 만기 전

        // Toss 결제 중 autoRenew: 서버 cron이 갱신 처리하므로 skip (24시간 여유)
        if (profile?.autoRenew === true && profile?.tierSource !== 'revenuecat') {
            const graceMs = 24 * 60 * 60 * 1000; // 24시간 grace period
            if (new Date() - expiresAt < graceMs) return;
        }

        // 만기 + 갱신 안 됨 → trial 다운그레이드 (구독 필드만 초기화, 나머지 보존)
        // subscriptionExpiresAt/subscriptionMonths는 이력 보존을 위해 유지 (null 설정 시 Firestore 필드 삭제됨)
        updateDoc(doc(db, 'users', user.uid), {
            tier: 'trial',
            autoRenew: false,
            planId: null,
            tierUpdatedAt: new Date(),
        }).catch(e => console.error("Subscription expiry downgrade failed:", e));
    }, [user, tier, profile?.subscriptionExpiresAt, profile?.autoRenew]);

    // ── RevenueCat entitlement → Firestore tier 동기화 (네이티브 앱 전용) ──
    useEffect(() => {
        if (!Capacitor.isNativePlatform() || !user || !profile) return;
        let cancelled = false;
        (async () => {
            try {
                const { Purchases } = await import('@revenuecat/purchases-capacitor');
                const { customerInfo } = await Purchases.getCustomerInfo();
                const active = customerInfo?.entitlements?.active || {};
                if (cancelled) return;

                // RevenueCat entitlement 기준 tier 결정
                let rcTier = null;
                if (active['Premium']) rcTier = 'premium';
                else if (active['Pro']) rcTier = 'pro';

                // 활성 entitlement에서 productId 추출
                const rcEntitlement = active['Premium'] || active['Pro'];
                const rcProductId = rcEntitlement?.productIdentifier || null;

                // Firestore tier와 다르면 동기화
                const currentTier = profile?.tier || 'trial';
                const needsExpirySync = rcTier && !profile?.subscriptionExpiresAt;
                if (rcTier && (rcTier !== currentTier || needsExpirySync)) {
                    const syncData = {
                        tier: rcTier,
                        tierUpdatedAt: serverTimestamp(),
                        tierSource: 'revenuecat',
                    };
                    if (rcProductId) {
                        syncData.planId = rcProductId;
                        syncData.subscriptionMonths = rcProductId.includes('_3') ? 3 : 1;
                    }
                    // 만기일 + 자동갱신 동기화
                    const expiresDateStr = rcEntitlement?.expirationDate;
                    if (expiresDateStr) {
                        syncData.subscriptionExpiresAt = new Date(expiresDateStr);
                    }
                    const willRenew = rcEntitlement?.willRenew;
                    if (willRenew !== undefined) {
                        syncData.autoRenew = willRenew;
                    }
                    await updateDoc(doc(db, 'users', user.uid), syncData);
                    console.log(`[RevenueCat] tier synced: ${currentTier} → ${rcTier} (${rcProductId}), expires: ${expiresDateStr}`);
                } else if (!rcTier && (currentTier === 'pro' || currentTier === 'premium') && profile?.tierSource === 'revenuecat') {
                    // Firestore subscriptionExpiresAt이 아직 유효하면 RC 일시 miss / promo 미반영일 수 있으므로 다운그레이드 보류
                    // 실제 만기는 line 308 '구독 만료 체크' useEffect이 처리
                    const expiresAtRaw = profile?.subscriptionExpiresAt;
                    const expiresAt = expiresAtRaw?.toDate?.()
                        ?? (expiresAtRaw ? new Date(expiresAtRaw) : null);
                    if (expiresAt && new Date() < expiresAt) {
                        console.log('[RevenueCat] no entitlement but Firestore expiry still valid — skip downgrade');
                        return;
                    }
                    await updateDoc(doc(db, 'users', user.uid), {
                        tier: 'trial',
                        autoRenew: false,
                        planId: null,
                        tierUpdatedAt: serverTimestamp(),
                    });
                    console.log(`[RevenueCat] entitlement expired → trial`);
                }
            } catch (e) {
                console.error('[RevenueCat] getCustomerInfo failed:', e?.message);
            }
        })();
        return () => { cancelled = true; };
        // profile 로드 후 실행 + tier/expiry 변경 시 재동기화
    }, [user?.uid, profile?.tier, !!profile?.subscriptionExpiresAt]);

    // ── 웹에서 RevenueCat 구독 상태 서버 경유 확인 ──────────────────────────
    useEffect(() => {
        if (Capacitor.isNativePlatform() || !user || !profile) return;
        // RevenueCat 구독인데 웹에서 접속한 경우만
        if (profile?.tierSource !== 'revenuecat') return;
        if (tier !== 'pro' && tier !== 'premium') return;

        let cancelled = false;
        (async () => {
            try {
                const resp = await authFetch(`${API_URL}/api/check-subscription`, { method: 'POST' });
                if (cancelled) return;
                const data = await resp.json();
                if (data.success) {
                    console.log(`[Web RC Check] tier: ${data.tier}, expires: ${data.expiresDate}`);
                }
            } catch (e) {
                console.warn('[Web RC Check] failed:', e.message);
            }
        })();
        return () => { cancelled = true; };
    }, [user?.uid, profile?.tierSource]);

    // lifecycleStage 'starter' 전이 — null/undefined일 때만 set, 상위 stage는 보존
    // 트랜잭션으로 race-safe (engaged/subscriber 다운그레이드 방지)
    const advanceToStarter = async () => {
        if (!user?.uid) return;
        if (profile?.lifecycleStage) return; // 빠른 우회: 이미 stage 있으면 트랜잭션 생략
        try {
            const userRef = doc(db, 'users', user.uid);
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(userRef);
                if (!snap.data()?.lifecycleStage) {
                    tx.update(userRef, { lifecycleStage: 'starter' });
                }
            });
        } catch (e) { console.error('advanceToStarter:', e); }
    };

    // 번역 클릭 카운터 (분석용)
    const incrementTrialCard = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                trialCardCount: increment(1),
                translationGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
            advanceToStarter();
        } catch (e) { console.error("incrementTrialCard failed:", e); }
    };

    // Library 저장 누적 카운터
    const incrementSavedCard = async () => {
        if (!user || tier !== 'trial') return;
        try {
            await updateDoc(doc(db, 'users', user.uid), { savedCardCount: increment(1) });
        } catch (e) { console.error("incrementSavedCard failed:", e); }
    };

    // Free Talking 평생 누적 세션 카운터 (분석용 — tier 무관, 모든 사용자 측정)
    // 일일 카운트는 useDailyProgress 의 freeTalkCount 가 별도로 관리 (자정 리셋, Trial 한도용)
    const incrementTotalFreeTalk = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                totalFreeTalkCount: increment(1),
                totalGenerateCount: increment(1),  // 기존 generate 누적 통계와 합류
            });
        } catch (e) { console.error("incrementTotalFreeTalk failed:", e); }
    };

    // 발음 평가 카운터
    const incrementPronCount = async () => {
        if (!user) return;
        try {
            if (tier === 'trial') {
                await updateDoc(doc(db, 'users', user.uid), { trialPronCount: increment(1) });
            } else if (tier === 'pro') {
                await updateDoc(doc(db, 'users', user.uid), { proPronCount: increment(1) });
            }
        } catch (e) { console.error("incrementPronCount failed:", e); }
    };

    // 2026-06-07: Pro 월별 FreeTalk/Listening 카운터 (Premium은 무제한이라 미증가)
    const incrementProFreeTalk = async () => {
        if (!user || tier !== 'pro') return;
        try {
            await updateDoc(doc(db, 'users', user.uid), { proFreeTalkCount: increment(1) });
        } catch (e) { console.error("incrementProFreeTalk failed:", e); }
    };
    const incrementProListen = async () => {
        if (!user || tier !== 'pro') return;
        try {
            await updateDoc(doc(db, 'users', user.uid), { proListenCount: increment(1) });
        } catch (e) { console.error("incrementProListen failed:", e); }
    };

    // Scene 생성 카운터
    const incrementSceneGenerate = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                sceneGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
            advanceToStarter();
        } catch (e) { console.error("incrementSceneGenerate failed:", e); }
    };

    // Vocab 생성 카운터
    const incrementVocabGenerate = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                vocabGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
            advanceToStarter();
        } catch (e) { console.error("incrementVocabGenerate failed:", e); }
    };

    // Listening 생성 카운터
    const incrementListenGenerate = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                listenGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
            advanceToStarter();
        } catch (e) { console.error("incrementListenGenerate failed:", e); }
    };

    // Admin 전용: BYOK 키 저장
    const saveByokKeys = async (geminiKey, azureKey, azureRegion) => {
        if (!user) return;
        await updateUserProfile({
            byokGeminiKey: geminiKey,
            byokAzureKey: azureKey,
            byokAzureRegion: azureRegion || '',
            tier: 'admin',
        });
    };

    const byokGeminiKey  = profile?.byokGeminiKey  || null;
    const byokAzureKey   = profile?.byokAzureKey   || null;
    const byokAzureRegion = profile?.byokAzureRegion || '';

    // [v1.5.83+ thermal-ios] Context value useMemo wrap — render storm 차단.
    // mobile-production-guardian 4차 분석에서 식별된 진짜 root cause.
    // 이전엔 매 렌더마다 새 value 객체 생성 → 모든 consumer(App.jsx 5728라인 +
    // 50+ 자식 컴포넌트, React.memo 사용 0) 통째로 재렌더 → iOS WKWebView
    // 발열 임계점 누적 돌파. useMemo로 value reference를 안정시켜 차단.
    //
    // Deps 전략: user/profile/loading + 별도 useState 3개만 포함. 함수들(17개)은
    // 매번 새 reference로 만들어지지만 deps 비교에서 제외(eslint-disable).
    // Stale closure 위험: 모든 함수가 closure로 참조하는 state(user/profile/
    // dailyTrial*Reached)는 deps에 포함됨 → state 변경 시 value 재생성 → 새 함수
    // closure 사용. 함수가 의존하지 않는 외부 reference(db/auth/setProfile 등)는
    // React 보장 stable. 따라서 stale closure 0%.
    //
    // 파생값(tier/counts/credits/bonusPoints/byok*)은 profile 기반이라 profile
    // deps만으로 자동 재계산됨.
    const contextValue = useMemo(() => ({
        user, profile, loading, updateUserProfile,
        tier,
        trialCardCount, savedCardCount, trialPronCount, totalFreeTalkCount,
        proPronCount, PRO_PRON_LIMIT,
        proFreeTalkCount, proListenCount, PRO_FREETALK_LIMIT, PRO_LISTEN_LIMIT,
        TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT, TRIAL_DAILY_LISTEN_LIMIT,
        isTrialPronLimitReached, isTrialFreeTalkLimitReached, isTrialListenLimitReached,
        setDailyTrialPronReached, setDailyTrialFreeTalkReached, setDailyTrialListenReached,
        isProPronLimitReached, isProFreeTalkLimitReached, isProListenLimitReached,
        incrementTrialCard, incrementSavedCard, incrementPronCount, incrementTotalFreeTalk,
        incrementProFreeTalk, incrementProListen,
        incrementSceneGenerate, incrementVocabGenerate, incrementListenGenerate,
        bonusPoints, hasBonusActive, consumeBonusPoints, POINT_COST,
        freeTalkCredits, pronCredits, listenCredits, consumeFreeTalkCredits, consumePronCredits, consumeListenCredits,
        reviewBonusClaimed: !!profile?.reviewBonusClaimedAt,
        saveByokKeys,
        byokGeminiKey, byokAzureKey, byokAzureRegion,
        upgradeAnonymous,
        ensureAnonymousUser,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [user, profile, loading, dailyTrialPronReached, dailyTrialFreeTalkReached, dailyTrialListenReached]);

    return (
        <AuthContext.Provider value={contextValue}>
            {loading ? (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100vh', background: '#f8fafc', flexDirection: 'column', gap: '12px'
                }}>
                    <div style={{
                        width: '36px', height: '36px', border: '4px solid #e2e8f0',
                        borderTop: '4px solid #00a884', borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite'
                    }} />
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>Loading…</p>
                </div>
            ) : children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
