import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, analytics } from '../firebase/config';
import { onAuthStateChanged, signInAnonymously, linkWithCredential } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, increment, serverTimestamp, getDoc } from 'firebase/firestore';
import { setUserId } from 'firebase/analytics';

const AuthContext = createContext();

// 회원탈퇴 진행 중 플래그 (onSnapshot이 문서를 재생성하지 않도록)
let accountDeletionInProgress = false;
export const setAccountDeletionFlag = (v) => { accountDeletionInProgress = v; };


export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let unsubscribeProfile;

        const unsubscribeAuth = onAuthStateChanged(auth, async (authenticatedUser) => {
            if (authenticatedUser) {
                setUser(authenticatedUser);
                if (analytics) setUserId(analytics, authenticatedUser.uid);

                const docRef = doc(db, 'users', authenticatedUser.uid);

                // 익명 유저: 최소 Firestore 문서 생성 후 onSnapshot 연결
                if (authenticatedUser.isAnonymous) {
                    const snap = await getDoc(docRef);
                    if (!snap.exists()) {
                        await setDoc(docRef, {
                            uid: authenticatedUser.uid,
                            isAnonymous: true,
                            tier: 'trial',
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });
                    }
                }

                unsubscribeProfile = onSnapshot(docRef, async (docSnap) => {
                    if (docSnap.exists()) {
                        setProfile(docSnap.data());
                    } else {
                        // 회원탈퇴 중이면 문서 재생성 방지
                        if (accountDeletionInProgress) return;
                        // 실계정 유저: 문서가 없으면 자동 생성
                        await setDoc(docRef, {
                            uid: authenticatedUser.uid,
                            email: authenticatedUser.email,
                            displayName: authenticatedUser.displayName || 'Google User',
                            hasCompletedOnboarding: false,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });
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
                            // 네이티브에 유저 있음 → 웹 SDK가 곧 동기화됨, 익명 로그인 건너뜀
                            // 안전장치: 5초 후에도 웹 SDK 동기화 안 되면 익명 로그인으로 폴백
                            setTimeout(async () => {
                                if (!auth.currentUser) {
                                    console.warn('[AuthContext] 네이티브 sync 타임아웃 → signInAnonymously 폴백');
                                    try { await signInAnonymously(auth); } catch (e) {
                                        setUser(null); setProfile(null); setLoading(false);
                                    }
                                }
                            }, 5000);
                            return;
                        }
                    } catch (e) {
                        // 플러그인 오류 시 기존 로직으로 폴백
                    }
                }

                // 비로그인 → 익명으로 자동 로그인 시도
                try {
                    await signInAnonymously(auth);
                } catch (e) {
                    console.error('Anonymous sign-in failed:', e);
                    setUser(null);
                    setProfile(null);
                    setLoading(false);
                }
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

    // ── 익명 → 실계정 업그레이드 ──────────────────────────────────────────────
    // credential: GoogleAuthProvider.credential(idToken) 또는 EmailAuthProvider.credential(email, pw)
    const upgradeAnonymous = async (credential) => {
        if (!user || !user.isAnonymous) return;
        try {
            const result = await linkWithCredential(auth.currentUser, credential);
            // Firestore 문서에 실계정 정보 병합 (uid는 그대로 유지됨)
            await setDoc(doc(db, 'users', result.user.uid), {
                email: result.user.email,
                displayName: result.user.displayName || result.user.email?.split('@')[0] || 'User',
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

    const TRIAL_DAILY_CARD_LIMIT = 10;   // Free Trial: 하루 카드 10개
    const TRIAL_DAILY_PRON_LIMIT = 20;   // Free Trial: 하루 발음 20회
    const PRO_PRON_LIMIT = 1500;         // Pro: 월 1500회

    // 하위호환: 기존 필드 유지 (분석용)
    const trialCardCount = profile?.trialCardCount || 0;
    const savedCardCount = profile?.savedCardCount || 0;
    const trialPronCount = profile?.trialPronCount || 0;
    // Pro 발음 평가 월별 횟수
    const proPronCount = profile?.proPronCount || 0;
    const proPronResetMonth = profile?.proPronResetMonth || '';

    // ⚠ Trial 제한은 이제 일간 — todayCount/todayPronCount는 App.jsx에서 주입
    const [dailyTrialCardReached, setDailyTrialCardReached] = useState(false);
    const [dailyTrialPronReached, setDailyTrialPronReached] = useState(false);

    const isTrialSavedCardLimitReached = tier === 'trial' && dailyTrialCardReached;
    const isTrialPronLimitReached = tier === 'trial' && dailyTrialPronReached;
    const isProPronLimitReached = tier === 'pro' && proPronCount >= PRO_PRON_LIMIT;

    // Pro 월별 카운터 리셋
    useEffect(() => {
        if (!user || tier !== 'pro') return;
        const currentMonth = new Date().toISOString().slice(0, 7);
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
        if (profile?.autoRenew === true) return;
        const expiresAt = profile.subscriptionExpiresAt.toDate ? profile.subscriptionExpiresAt.toDate() : new Date(profile.subscriptionExpiresAt);
        if (new Date() > expiresAt) {
            updateDoc(doc(db, 'users', user.uid), {
                tier: 'trial',
                autoRenew: false,
                planId: null,
                subscriptionMonths: null,
                tossBillingKey: null,
                tossCustomerKey: null,
                subscriptionExpiresAt: null,
                tierUpdatedAt: new Date(),
            }).catch(e => console.error("Subscription expiry downgrade failed:", e));
        }
    }, [user, tier, profile?.subscriptionExpiresAt, profile?.autoRenew]);

    // 번역 클릭 카운터 (분석용)
    const incrementTrialCard = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                trialCardCount: increment(1),
                translationGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
        } catch (e) { console.error("incrementTrialCard failed:", e); }
    };

    // Library 저장 누적 카운터
    const incrementSavedCard = async () => {
        if (!user || tier !== 'trial') return;
        try {
            await updateDoc(doc(db, 'users', user.uid), { savedCardCount: increment(1) });
        } catch (e) { console.error("incrementSavedCard failed:", e); }
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
        } catch (e) { console.error("incrementVocabGenerate failed:", e); }
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
            trialCardCount, savedCardCount, trialPronCount,
            proPronCount, PRO_PRON_LIMIT,
            TRIAL_DAILY_CARD_LIMIT, TRIAL_DAILY_PRON_LIMIT,
            isTrialSavedCardLimitReached, isTrialPronLimitReached,
            setDailyTrialCardReached, setDailyTrialPronReached,
            isProPronLimitReached,
            incrementTrialCard, incrementSavedCard, incrementPronCount,
            incrementSceneGenerate, incrementVocabGenerate,
            saveByokKeys,
            byokGeminiKey, byokAzureKey, byokAzureRegion,
            upgradeAnonymous,
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
