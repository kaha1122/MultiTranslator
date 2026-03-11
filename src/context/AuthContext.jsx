import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db, analytics } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc, increment } from 'firebase/firestore';
import { setUserId } from 'firebase/analytics';

const AuthContext = createContext();

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

                // Firestore에서 프로필 정보를 실시간으로 구독(onSnapshot)합니다.
                // 이렇게 하면 구글 가입 직후 데이터가 생겨나는 것도 즉시 감지하여 App.jsx로 전달합니다.
                const docRef = doc(db, 'users', authenticatedUser.uid);
                unsubscribeProfile = onSnapshot(docRef, (docSnap) => {
                    if (docSnap.exists()) {
                        setProfile(docSnap.data());
                    } else {
                        setProfile(null);
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
    const tier = profile?.tier || 'trial';
    const TRIAL_CARD_LIMIT = 10;
    const TRIAL_PRON_LIMIT = 30;

    // 번역 클릭 누적 횟수 (분석용 — 삭제해도 감소하지 않음)
    const trialCardCount = profile?.trialCardCount || 0;
    // Library 저장 누적 횟수 (Trial 한도 기준 — 삭제해도 감소하지 않음)
    const savedCardCount = profile?.savedCardCount || 0;
    // 발음 평가 누적 횟수
    const trialPronCount = profile?.trialPronCount || 0;

    const isTrialSavedCardLimitReached = tier === 'trial' && savedCardCount >= TRIAL_CARD_LIMIT;
    const isTrialPronLimitReached = tier === 'trial' && trialPronCount >= TRIAL_PRON_LIMIT;

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

    const incrementTrialPron = async () => {
        if (!user || tier !== 'trial') return;
        try {
            await updateDoc(doc(db, 'users', user.uid), { trialPronCount: increment(1) });
        } catch (e) { console.error("incrementTrialPron failed:", e); }
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

    // BYOK 키 저장 + tier를 'byok_free'로 전환
    const saveByokKeys = async (geminiKey, azureKey, azureRegion) => {
        if (!user) return;
        await updateUserProfile({
            byokGeminiKey: geminiKey,
            byokAzureKey: azureKey,
            byokAzureRegion: azureRegion || '',
            tier: 'byok_free',
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
            TRIAL_CARD_LIMIT, TRIAL_PRON_LIMIT,
            isTrialSavedCardLimitReached, isTrialPronLimitReached,
            incrementTrialCard, incrementSavedCard, incrementTrialPron,
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
