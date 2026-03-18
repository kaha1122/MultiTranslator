import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, analytics } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
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

        const unsubscribeAuth = onAuthStateChanged(auth, (authenticatedUser) => {
            if (authenticatedUser) {
                setUser(authenticatedUser);
                if (analytics) setUserId(analytics, authenticatedUser.uid);

                const docRef = doc(db, 'users', authenticatedUser.uid);
                unsubscribeProfile = onSnapshot(docRef, async (docSnap) => {
                    if (docSnap.exists()) {
                        setProfile(docSnap.data());
                    } else {
                        // 회원탈퇴 중이면 문서 재생성 방지
                        if (accountDeletionInProgress) return;
                        // 문서가 없는 기존 유저 → 자동 생성 (onSnapshot이 재실행되어 profile 설정됨)
                        await setDoc(docRef, {
                            uid: authenticatedUser.uid,
                            email: authenticatedUser.email,
                            displayName: authenticatedUser.displayName || 'Google User',
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp(),
                        });
                        return; // setDoc 후 onSnapshot이 다시 호출되므로 여기서 리턴
                    }
                    setLoading(false);
                }, (error) => {
                    console.error("Error fetching user profile:", error);
                    setProfile(null);
                    setLoading(false);
                });

            } else {
                setUser(null);
                setProfile(null);
                if (analytics) setUserId(analytics, null);
                if (unsubscribeProfile) {
                    unsubscribeProfile();
                }
                setLoading(false);
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
    // AuthContext는 플래그만 제공하고, 실제 체크는 dailyProgress 기반으로 App에서 수행
    const [dailyTrialCardReached, setDailyTrialCardReached] = useState(false);
    const [dailyTrialPronReached, setDailyTrialPronReached] = useState(false);

    const isTrialSavedCardLimitReached = tier === 'trial' && dailyTrialCardReached;
    const isTrialPronLimitReached = tier === 'trial' && dailyTrialPronReached;
    const isProPronLimitReached = tier === 'pro' && proPronCount >= PRO_PRON_LIMIT;

    // Pro 월별 카운터 리셋: 현재 월이 저장된 월과 다르면 리셋
    useEffect(() => {
        if (!user || tier !== 'pro') return;
        const currentMonth = new Date().toISOString().slice(0, 7); // "2026-03"
        if (proPronResetMonth && proPronResetMonth === currentMonth) return;
        updateDoc(doc(db, 'users', user.uid), {
            proPronCount: 0,
            proPronResetMonth: currentMonth,
        }).catch(e => console.error("Pro pron reset failed:", e));
    }, [user, tier, proPronResetMonth]);

    // 구독 만료 체크: autoRenew가 false이고 만료일이 지나면 trial로 복귀
    // autoRenew가 true면 서버 cron이 재결제 처리하므로 클라이언트에서 다운그레이드하지 않음
    useEffect(() => {
        if (!user || !profile?.subscriptionExpiresAt) return;
        if (tier !== 'pro' && tier !== 'premium') return;
        if (profile?.autoRenew === true) return; // cron이 처리
        const expiresAt = profile.subscriptionExpiresAt.toDate ? profile.subscriptionExpiresAt.toDate() : new Date(profile.subscriptionExpiresAt);
        if (new Date() > expiresAt) {
            // 빌링키 폐기는 서버에서 처리되므로 클라이언트는 Firestore만 정리
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

    // 번역 클릭 카운터 (분석용, 모든 tier에서 기록)
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

    // Library 저장 누적 카운터 (Trial 한도 산정용)
    const incrementSavedCard = async () => {
        if (!user || tier !== 'trial') return;
        try {
            await updateDoc(doc(db, 'users', user.uid), { savedCardCount: increment(1) });
        } catch (e) { console.error("incrementSavedCard failed:", e); }
    };

    // 발음 평가 카운터: trial이면 trialPronCount, pro이면 proPronCount 증가
    const incrementPronCount = async () => {
        if (!user) return;
        try {
            if (tier === 'trial') {
                await updateDoc(doc(db, 'users', user.uid), { trialPronCount: increment(1) });
            } else if (tier === 'pro') {
                await updateDoc(doc(db, 'users', user.uid), { proPronCount: increment(1) });
            }
            // premium, admin은 카운터 없음 (무제한)
        } catch (e) { console.error("incrementPronCount failed:", e); }
    };

    // Scene 생성 카운터 (분석용, 모든 tier에서 기록 — Question/Answer 각각 +1)
    const incrementSceneGenerate = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                sceneGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
        } catch (e) { console.error("incrementSceneGenerate failed:", e); }
    };

    // Vocab 생성 카운터 (분석용, 모든 tier에서 기록)
    const incrementVocabGenerate = async () => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                vocabGenerateCount: increment(1),
                totalGenerateCount: increment(1),
            });
        } catch (e) { console.error("incrementVocabGenerate failed:", e); }
    };

    // Admin 전용: BYOK 키 저장 + tier를 'admin'으로 전환
    const saveByokKeys = async (geminiKey, azureKey, azureRegion) => {
        if (!user) return;
        await updateUserProfile({
            byokGeminiKey: geminiKey,
            byokAzureKey: azureKey,
            byokAzureRegion: azureRegion || '',
            tier: 'admin',
        });
    };

    // BYOK 키 읽기
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
