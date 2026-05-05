import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp, increment, runTransaction } from 'firebase/firestore';

// 로컬 타임존 기준 YYYY-MM-DD — toISOString()은 UTC 라 자정 경계에서 어긋남
const toLocalDateStr = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

export const getToday = () => toLocalDateStr(new Date());

// Returns Mon-Sun dates of the current week (local date strings)
const getWeekDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun ... 6=Sat
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return toLocalDateStr(d);
    });
};

export const useDailyProgress = (user, dailyGoal = 3) => {
    const [todayCount, setTodayCount] = useState(0);       // 목표 달성 횟수 (score >= goal)
    const [todaySaveCount, setTodaySaveCount] = useState(0); // 카드 저장 횟수 (Trial 게이지용)
    const [todayPronCount, setTodayPronCount] = useState(0);
    const [todayListenCount, setTodayListenCount] = useState(0);
    const [todayFreeTalkCount, setTodayFreeTalkCount] = useState(0);  // Free Talking 세션 시작 횟수 (Trial 한도 2회)
    const [weeklyData, setWeeklyData] = useState([]);
    const achievedKeysRef = useRef(new Set());
    const todayCountRef = useRef(0);
    const todaySaveCountRef = useRef(0);
    const todayPronCountRef = useRef(0);
    const todayListenCountRef = useRef(0);
    const todayFreeTalkCountRef = useRef(0);
    const lastMarkedActiveDayRef = useRef(null); // 그날 activeDayCount 증가 처리 완료한 YYYY-MM-DD

    useEffect(() => { todayCountRef.current = todayCount; }, [todayCount]);
    useEffect(() => { todaySaveCountRef.current = todaySaveCount; }, [todaySaveCount]);
    useEffect(() => { todayPronCountRef.current = todayPronCount; }, [todayPronCount]);
    useEffect(() => { todayListenCountRef.current = todayListenCount; }, [todayListenCount]);
    useEffect(() => { todayFreeTalkCountRef.current = todayFreeTalkCount; }, [todayFreeTalkCount]);

    useEffect(() => {
        const uid = user?.uid;
        if (!uid) {
            setTodayCount(0);
            setTodaySaveCount(0);
            setTodayPronCount(0);
            setTodayListenCount(0);
            setTodayFreeTalkCount(0);
            setWeeklyData([]);
            achievedKeysRef.current = new Set();
            todayCountRef.current = 0;
            todaySaveCountRef.current = 0;
            todayPronCountRef.current = 0;
            todayListenCountRef.current = 0;
            todayFreeTalkCountRef.current = 0;
            lastMarkedActiveDayRef.current = null;
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
                    const saveCnt = data.saveCount || 0;
                    const pronCnt = data.pronCount || 0;
                    const listenCnt = data.listenCount || 0;
                    const freeTalkCnt = data.freeTalkCount || 0;
                    setTodayCount(cnt);
                    setTodaySaveCount(saveCnt);
                    setTodayPronCount(pronCnt);
                    setTodayListenCount(listenCnt);
                    setTodayFreeTalkCount(freeTalkCnt);
                    todayCountRef.current = cnt;
                    todaySaveCountRef.current = saveCnt;
                    todayPronCountRef.current = pronCnt;
                    todayListenCountRef.current = listenCnt;
                    todayFreeTalkCountRef.current = freeTalkCnt;
                    achievedKeysRef.current = new Set(data.achievedKeys || []);
                } else {
                    setTodayCount(0);
                    setTodaySaveCount(0);
                    setTodayPronCount(0);
                    setTodayListenCount(0);
                    setTodayFreeTalkCount(0);
                    todayCountRef.current = 0;
                    todaySaveCountRef.current = 0;
                    todayPronCountRef.current = 0;
                    todayListenCountRef.current = 0;
                    todayFreeTalkCountRef.current = 0;
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

    // 그날 첫 활동 시 user 문서의 activeDayCount += 1 + engaged 전이
    // - lastActiveDay 필드로 멀티 디바이스/세션/자정 경계 모두 idempotent 보장
    // - activeDayCount === 2 도달 + 현재 stage가 engaged/subscriber 아닐 때만 'engaged'로 advance
    const markActiveDayIfFirst = useCallback(async () => {
        if (!user?.uid) return;
        const today = getToday();
        if (lastMarkedActiveDayRef.current === today) return; // 같은 세션 내 중복 방지
        lastMarkedActiveDayRef.current = today;

        const userRef = doc(db, 'users', user.uid);
        try {
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(userRef);
                const data = snap.data() || {};
                if (data.lastActiveDay === today) return; // 다른 디바이스/탭이 이미 처리

                const newCount = (data.activeDayCount || 0) + 1;
                const updates = {
                    activeDayCount: increment(1),
                    lastActiveDay: today,
                    lastActiveAt: serverTimestamp(),
                };
                const stage = data.lifecycleStage;
                if (newCount >= 2 && stage !== 'engaged' && stage !== 'subscriber') {
                    updates.lifecycleStage = 'engaged';
                }
                tx.update(userRef, updates);
            });
        } catch (e) {
            console.error('[useDailyProgress] markActiveDay transaction 실패:', e);
            lastMarkedActiveDayRef.current = null; // 다음 액션 시 재시도 가능하게 롤백
        }
    }, [user?.uid]);

    const incrementAchievement = useCallback(async (key) => {
        if (!user?.uid) return false;
        // Deduplication: skip if this key was already counted today
        if (achievedKeysRef.current.has(key)) return false;

        markActiveDayIfFirst();

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

        // 2026-05-05: dailyProgress.goalAchievedToday Y/N 플래그 + users.totalGoalAchievedDays 누적
        // - 트랜잭션으로 race-safe (멀티 디바이스/탭 동시 발음 통과 시 중복 +1 방지)
        // - 한 번 goalAchievedToday=true 마킹된 날은 false로 안 됨 (idempotent)
        // - totalGoalAchievedDays는 false→true 전이 시 정확히 1번만 +1
        const progressRef = doc(db, 'users', user.uid, 'dailyProgress', today);
        const userRef = doc(db, 'users', user.uid);
        try {
            await runTransaction(db, async (tx) => {
                const progressSnap = await tx.get(progressRef);
                const wasAlreadyAchieved = progressSnap.exists() && progressSnap.data()?.goalAchievedToday === true;
                const isNowAchieved = newCount >= dailyGoal;

                tx.set(progressRef, {
                    achievedKeys: Array.from(achievedKeysRef.current),
                    count: newCount,
                    dailyGoal,
                    goalAchievedToday: isNowAchieved || wasAlreadyAchieved,
                    updatedAt: serverTimestamp(),
                }, { merge: true });

                if (!wasAlreadyAchieved && isNowAchieved) {
                    tx.update(userRef, {
                        totalGoalAchievedDays: increment(1),
                    });
                }
            });
        } catch (e) {
            console.error('[useDailyProgress] Firestore 저장 실패:', e);
        }

        return true; // signals "first time this key achieved today" → trigger popup
    }, [user, dailyGoal]);

    // 카드 저장 일간 카운터 증가 (Trial 게이지용 — 발음 점수 무관)
    const incrementDailySave = useCallback(async () => {
        if (!user?.uid) return;
        markActiveDayIfFirst();
        const today = getToday();
        const newSaveCount = todaySaveCountRef.current + 1;
        todaySaveCountRef.current = newSaveCount;
        setTodaySaveCount(newSaveCount);
        try {
            await setDoc(
                doc(db, 'users', user.uid, 'dailyProgress', today),
                { saveCount: newSaveCount, updatedAt: serverTimestamp() },
                { merge: true }
            );
        } catch (e) {
            console.error('[useDailyProgress] saveCount 저장 실패:', e);
        }
    }, [user]);

    // 발음 연습 일간 카운터 증가
    const incrementDailyPron = useCallback(async () => {
        if (!user?.uid) return;
        markActiveDayIfFirst();
        const today = getToday();
        const newPronCount = todayPronCountRef.current + 1;
        todayPronCountRef.current = newPronCount;
        setTodayPronCount(newPronCount);

        try {
            await setDoc(
                doc(db, 'users', user.uid, 'dailyProgress', today),
                { pronCount: newPronCount, updatedAt: serverTimestamp() },
                { merge: true }
            );
        } catch (e) {
            console.error('[useDailyProgress] pronCount 저장 실패:', e);
        }
    }, [user]);

    // Listening 지문 조회 일간 카운터 증가
    const incrementDailyListen = useCallback(async () => {
        if (!user?.uid) return;
        markActiveDayIfFirst();
        const today = getToday();
        const newListenCount = todayListenCountRef.current + 1;
        todayListenCountRef.current = newListenCount;
        setTodayListenCount(newListenCount);

        try {
            await setDoc(
                doc(db, 'users', user.uid, 'dailyProgress', today),
                { listenCount: newListenCount, updatedAt: serverTimestamp() },
                { merge: true }
            );
        } catch (e) {
            console.error('[useDailyProgress] listenCount 저장 실패:', e);
        }
    }, [user]);

    // Free Talking 세션 시작 — Trial 일일 한도 2회 체크용 (state + Firestore)
    const incrementDailyFreeTalk = useCallback(async () => {
        if (!user?.uid) return;
        markActiveDayIfFirst();
        const today = getToday();
        const next = todayFreeTalkCountRef.current + 1;
        todayFreeTalkCountRef.current = next;
        setTodayFreeTalkCount(next);
        try {
            await setDoc(
                doc(db, 'users', user.uid, 'dailyProgress', today),
                { freeTalkCount: next, updatedAt: serverTimestamp() },
                { merge: true }
            );
        } catch (e) {
            console.error('[useDailyProgress] freeTalkCount 저장 실패:', e);
        }
    }, [user]);

    // 분석 전용 일일 Generate 카운터 — UI 미표시, Firestore atomic increment (state/ref 불필요)
    // kind: 'translation' | 'scene' | 'vocab' (Listening은 기존 listenCount로 추적)
    const incrementDailyGenerate = useCallback(async (kind) => {
        if (!user?.uid) return;
        if (kind !== 'translation' && kind !== 'scene' && kind !== 'vocab') return;
        markActiveDayIfFirst();
        const today = getToday();
        const field = `${kind}GenCount`;
        try {
            await setDoc(
                doc(db, 'users', user.uid, 'dailyProgress', today),
                { [field]: increment(1), updatedAt: serverTimestamp() },
                { merge: true }
            );
        } catch (e) {
            console.error(`[useDailyProgress] ${field} 저장 실패:`, e);
        }
    }, [user]);

    return { todayCount, todaySaveCount, todayPronCount, todayListenCount, todayFreeTalkCount, weeklyData, incrementAchievement, incrementDailySave, incrementDailyPron, incrementDailyListen, incrementDailyGenerate, incrementDailyFreeTalk };
};
