import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, analytics } from '../firebase/config';
import { onAuthStateChanged, signInAnonymously, linkWithCredential } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, increment, serverTimestamp, getDoc, runTransaction } from 'firebase/firestore';
import { setUserId } from 'firebase/analytics';
import { Capacitor } from '@capacitor/core';
import { isBot } from '../utils/isBot';
import { authFetch } from '../utils/authFetch';
import { detectGeoInfo } from '../utils/detectCountry';

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

                // 앱 재실행 시 updatedAt 갱신 (방금 문서를 생성한 경우는 제외)
                if (!docJustCreated) {
                    updateDoc(docRef, { updatedAt: serverTimestamp() }).catch(e =>
                        console.error('[AuthContext] updatedAt refresh failed:', e)
                    );
                }

                // Push 토큰 재등록은 App.jsx mount에서 전역 리스너가 처리
                // (여기서는 별도 처리 불필요 — App.jsx가 checkPermissions + register 자동 수행)

                unsubscribeProfile = onSnapshot(docRef, async (docSnap) => {
                    if (docSnap.exists()) {
                        setProfile(docSnap.data());
                    } else {
                        // 회원탈퇴 중이면 문서 재생성 방지
                        if (accountDeletionInProgress) return;
                        // 실계정 유저: 문서가 없으면 자동 생성
                        const platform = window.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
                        const deviceLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0];
                        await setDoc(docRef, {
                            uid: authenticatedUser.uid,
                            email: authenticatedUser.email,
                            displayName: authenticatedUser.displayName || 'User',
                            hasCompletedOnboarding: false,
                            platform,
                            deviceLang,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        }, { merge: true });
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
                        return; // setDoc 후 onSnapshot이 다시 호출됨
                    }
                    setLoading(false);
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
                            // 안전장치: 5초 후에도 웹 SDK 동기화 안 되면 익명 로그인으로 폴백 (백그라운드)
                            setTimeout(() => {
                                if (auth.currentUser) return; // 웹 SDK 동기화 완료됨 — 추가 작업 불필요
                                if (anonSignInInProgress) return;
                                anonSignInInProgress = true;
                                console.warn('[AuthContext] 네이티브 sync 타임아웃 → signInAnonymously 폴백');
                                signInAnonymously(auth)
                                    .catch(e => console.error('Native sync timeout fallback failed:', e))
                                    .finally(() => { anonSignInInProgress = false; });
                            }, 5000);
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
                        await Promise.race([
                            auth.authStateReady(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('authStateReady timeout')), 5000))
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
        // 진행 중 — onAuthStateChanged가 user를 채울 때까지 대기
        if (anonSignInInProgress) {
            return new Promise((resolve) => {
                const start = Date.now();
                const tick = setInterval(() => {
                    if (auth.currentUser) { clearInterval(tick); resolve(auth.currentUser); }
                    else if (Date.now() - start > 10000) { clearInterval(tick); resolve(null); }
                }, 50);
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

    const TRIAL_DAILY_CARD_LIMIT = 10;        // Free Trial: 하루 카드 10개
    const TRIAL_DAILY_PRON_LIMIT = 20;        // Free Trial: 하루 발음 20회
    const TRIAL_FREETALK_DAILY_LIMIT = 2;     // Free Trial: 하루 Free-Talking 세션 2회
    const PRO_PRON_LIMIT = 1500;              // Pro: 월 1500회

    // 하위호환: 기존 필드 유지 (분석용)
    const trialCardCount = profile?.trialCardCount || 0;
    const savedCardCount = profile?.savedCardCount || 0;
    const trialPronCount = profile?.trialPronCount || 0;
    // Pro 발음 평가 월별 횟수
    const proPronCount = profile?.proPronCount || 0;
    const proPronResetMonth = profile?.proPronResetMonth || '';
    // Free Talking 평생 누적 세션 시작 횟수 (분석용 — 사용자별 generate 빈도 측정)
    const totalFreeTalkCount = profile?.totalFreeTalkCount || 0;

    // 보너스 포인트 — 캠페인 보상 (리뷰/추천/스트릭). 활성 시: 일일 한도 해제 + 인터스티셜 면제, 배너는 유지
    const bonusPoints = profile?.bonusPoints || 0;
    const hasBonusActive = bonusPoints > 0;

    // ⚠ Trial 제한은 이제 일간 — todayCount/todayPronCount는 App.jsx에서 주입
    const [dailyTrialCardReached, setDailyTrialCardReached] = useState(false);
    const [dailyTrialPronReached, setDailyTrialPronReached] = useState(false);

    // 보너스 활성 시 일일 한도 우회
    const isTrialSavedCardLimitReached = tier === 'trial' && !hasBonusActive && dailyTrialCardReached;
    const isTrialPronLimitReached = tier === 'trial' && !hasBonusActive && dailyTrialPronReached;
    const isProPronLimitReached = tier === 'pro' && proPronCount >= PRO_PRON_LIMIT;

    // 보너스 포인트 차감 — 트랜잭션으로 멀티 디바이스 race 방지
    // 가능한 만큼 차감하고 실제 차감량을 number로 반환 (부족하면 잔여만큼만)
    const consumeBonusPoints = async (amount) => {
        if (!user?.uid || amount <= 0) return 0;
        try {
            let consumed = 0;
            await runTransaction(db, async (tx) => {
                const ref = doc(db, 'users', user.uid);
                const snap = await tx.get(ref);
                const current = snap.data()?.bonusPoints || 0;
                consumed = Math.min(current, amount);
                if (consumed > 0) {
                    tx.update(ref, { bonusPoints: increment(-consumed) });
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
        updateDoc(doc(db, 'users', user.uid), {
            proPronCount: 0,
            proPronResetMonth: currentMonth,
        }).catch(e => console.error("Pro pron reset failed:", e));
    }, [user, tier, proPronResetMonth]);

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

    return (
        <AuthContext.Provider value={{
            user, profile, loading, updateUserProfile,
            tier,
            trialCardCount, savedCardCount, trialPronCount, totalFreeTalkCount,
            proPronCount, PRO_PRON_LIMIT,
            TRIAL_DAILY_CARD_LIMIT, TRIAL_DAILY_PRON_LIMIT, TRIAL_FREETALK_DAILY_LIMIT,
            isTrialSavedCardLimitReached, isTrialPronLimitReached,
            setDailyTrialCardReached, setDailyTrialPronReached,
            isProPronLimitReached,
            incrementTrialCard, incrementSavedCard, incrementPronCount, incrementTotalFreeTalk,
            incrementSceneGenerate, incrementVocabGenerate, incrementListenGenerate,
            bonusPoints, hasBonusActive, consumeBonusPoints,
            reviewBonusClaimed: !!profile?.reviewBonusClaimedAt,
            saveByokKeys,
            byokGeminiKey, byokAzureKey, byokAzureRegion,
            upgradeAnonymous,
            ensureAnonymousUser,
        }}>
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
