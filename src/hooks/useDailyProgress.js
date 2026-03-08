import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export const getToday = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// Returns Mon-Sun dates of the current week (ISO strings)
const getWeekDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun ... 6=Sat
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d.toISOString().slice(0, 10);
    });
};

export const useDailyProgress = (user, dailyGoal = 10) => {
    const [todayCount, setTodayCount] = useState(0);
    const [weeklyData, setWeeklyData] = useState([]);
    // Use ref for achievedKeysSet to avoid stale-closure issues in incrementAchievement
    const achievedKeysRef = useRef(new Set());
    const todayCountRef = useRef(0);

    // Sync refs whenever state changes
    useEffect(() => { todayCountRef.current = todayCount; }, [todayCount]);

    useEffect(() => {
        const uid = user?.uid;
        if (!uid) {
            setTodayCount(0);
            setWeeklyData([]);
            achievedKeysRef.current = new Set();
            todayCountRef.current = 0;
            return;
        }

        const loadData = async () => {
            try {
                const today = getToday();
                const weekDates = getWeekDates();

                // Load today's progress doc
                const todayRef = doc(db, 'users', uid, 'dailyProgress', today);
                const todaySnap = await getDoc(todayRef);
                if (todaySnap.exists()) {
                    const data = todaySnap.data();
                    const cnt = data.count || 0;
                    setTodayCount(cnt);
                    todayCountRef.current = cnt;
                    achievedKeysRef.current = new Set(data.achievedKeys || []);
                } else {
                    setTodayCount(0);
                    todayCountRef.current = 0;
                    achievedKeysRef.current = new Set();
                }

                // Load this week's docs
                const weekSnaps = await Promise.all(
                    weekDates.map(date => getDoc(doc(db, 'users', uid, 'dailyProgress', date)))
                );
                setWeeklyData(weekDates.map((date, i) => {
                    if (weekSnaps[i].exists()) {
                        const d = weekSnaps[i].data();
                        const cnt = d.count || 0;
                        const goal = d.dailyGoal || dailyGoal;
                        return { date, count: cnt, goal, achieved: cnt >= goal };
                    }
                    return { date, count: 0, goal: dailyGoal, achieved: false };
                }));
            } catch (e) {
                console.error('[useDailyProgress] Firestore 로드 실패 (보안 규칙 확인 필요):', e);
            }
        };

        loadData();
    }, [user?.uid]); // uid만 의존 — 토큰 갱신 시 user 객체 레퍼런스 변경으로 인한 재실행 방지

    const incrementAchievement = useCallback(async (key) => {
        if (!user?.uid) return false;
        // Deduplication: skip if this key was already counted today
        if (achievedKeysRef.current.has(key)) return false;

        const today = getToday();
        achievedKeysRef.current.add(key);
        const newCount = todayCountRef.current + 1;
        todayCountRef.current = newCount;
        setTodayCount(newCount);

        setWeeklyData(prev => prev.map(d =>
            d.date === today
                ? { ...d, count: newCount, goal: dailyGoal, achieved: newCount >= dailyGoal }
                : d
        ));

        try {
            await setDoc(
                doc(db, 'users', user.uid, 'dailyProgress', today),
                {
                    achievedKeys: Array.from(achievedKeysRef.current),
                    count: newCount,
                    dailyGoal,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
        } catch (e) {
            console.error('[useDailyProgress] Firestore 저장 실패:', e);
        }

        return true; // signals "first time this key achieved today" → trigger popup
    }, [user, dailyGoal]);

    return { todayCount, weeklyData, incrementAchievement };
};
