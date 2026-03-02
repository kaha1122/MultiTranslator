import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

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

    // 사용자 프로필 정보를 업데이트하는 함수 (중복 문서 생성 방지 및 완벽한 병합)
    const updateUserProfile = async (updates) => {
        if (!user) return;
        try {
            const docRef = doc(db, 'users', user.uid);
            await setDoc(docRef, updates, { merge: true });
            // onSnapshot이 활성화되어 있으므로 setProfile을 수동으로 호출할 필요가 없습니다.
        } catch (error) {
            console.error("Error updating profile:", error);
            throw error; // 에러 처리를 위해 던짐
        }
    };

    return (
        <AuthContext.Provider value={{ user, profile, loading, updateUserProfile }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
