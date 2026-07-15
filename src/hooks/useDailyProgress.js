import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp, increment, runTransaction } from 'firebase/firestore';
import { W_TARGET, P_TARGET } from '../config/learningPath.js';

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

// 첫 로그인 시 Firestore 7-doc round-trip이 끝나기 전 UI가 7-dot 자리를 잡도록
// achieved:false placeholder를 미리 채워둠 — load 완료되면 setWeeklyData로 덮어씀.
const makePlaceholderWeek = (goal) =>
    getWeekDates().map(date => ({ date, count: 0, goal, achieved: false, topicProgress: false }));

// onDailySave: 카드 저장(off→on) 1건당 1회 호출되는 콜백 — 포인트 차감 hook(기능2).
//   incrementDailySave 는 신규 저장 성공에서만 호출(중복/해제 경로는 호출 안 함)되므로
//   여기에 거는 것이 "저장에서만 -1pt, 해제·환불 없음"을 보장하는 단일 chokepoint.
export const useDailyProgress = (user, dailyGoal = 10, onDailySave) => {
    const [todayCount, setTodayCount] = useState(0);       // 목표 달성 횟수 (score >= goal)
    const [todaySaveCount, setTodaySaveCount] = useState(0); // 카드 저장 횟수 (Trial 게이지용)
    const [todayPronCount, setTodayPronCount] = useState(0);
    const [todayPronBonus, setTodayPronBonus] = useState(0); // #4: 오늘 광고로 추가한 발음 허용량(+10/회)
    const [todayListenCount, setTodayListenCount] = useState(0);
    const [todayFreeTalkCount, setTodayFreeTalkCount] = useState(0);  // Free Talking 세션 시작 횟수 (Trial 한도 2회)
    const [weeklyData, setWeeklyData] = useState(() => makePlaceholderWeek(dailyGoal));
    const achievedKeysRef = useRef(new Set());
    const todayCountRef = useRef(0);
    const todaySaveCountRef = useRef(0);
    const todayPronCountRef = useRef(0);
    const todayListenCountRef = useRef(0);
    const todayFreeTalkCountRef = useRef(0);
    const lastMarkedActiveDayRef = useRef(null); // 그날 activeDayCount 증가 처리 완료한 YYYY-MM-DD
    const lastTopicProgressDayRef = useRef(null); // 그날 topicProgressToday 마킹 완료한 YYYY-MM-DD (중복 write 차단)
    const wordPassRef = useRef(0);     // #4: 오늘 단어 통과 수(Streak 판정용)
    const passagePassRef = useRef(0);  // #4: 오늘 지문 통과 수
    const loadedDayRef = useRef(getToday()); // 현재 ref/state가 어느 날짜 기준인지 — 자정 경과 감지용

    useEffect(() => { todayCountRef.current = todayCount; }, [todayCount]);
    useEffect(() => { todaySaveCountRef.current = todaySaveCount; }, [todaySaveCount]);
    useEffect(() => { todayPronCountRef.current = todayPronCount; }, [todayPronCount]);
    useEffect(() => { todayListenCountRef.current = todayListenCount; }, [todayListenCount]);
    useEffect(() => { todayFreeTalkCountRef.current = todayFreeTalkCount; }, [todayFreeTalkCount]);

    // merge=true: 자정 rollover 직후 재로드용 — 로컬에서 이미 증가한 카운트와 Firestore 값을
    // max-merge 해서, 재로드 도중 들어온 증가분이 0으로 덮이지 않게 함 (uid 변경 로드는 merge=false 덮어쓰기)
    const loadData = useCallback(async ({ merge = false } = {}) => {
        const uid = user?.uid;
        if (!uid) return;
        try {
            const today = getToday();
            loadedDayRef.current = today;
            const weekDates = getWeekDates();

            // Load today's progress doc
            const todayRef = doc(db, 'users', uid, 'dailyProgress', today);
            const todaySnap = await getDoc(todayRef);
            const data = todaySnap.exists() ? todaySnap.data() : {};
            const apply = (ref, setter, val) => {
                const next = merge ? Math.max(ref.current, val) : val;
                ref.current = next;
                setter(next);
            };
            apply(todayCountRef, setTodayCount, data.count || 0);
            apply(todaySaveCountRef, setTodaySaveCount, data.saveCount || 0);
            apply(todayPronCountRef, setTodayPronCount, data.pronCount || 0);
            // pronBonus: 광고 추가분 — merge 시에도 서버값 우선(단조 증가, 클라가 증가 안 함)
            setTodayPronBonus(data.pronBonus || 0);
            // #4 Streak: 오늘 단어/지문 통과 수(merge 시 max 보존)
            wordPassRef.current = merge ? Math.max(wordPassRef.current, data.wordPassToday || 0) : (data.wordPassToday || 0);
            passagePassRef.current = merge ? Math.max(passagePassRef.current, data.passagePassToday || 0) : (data.passagePassToday || 0);
            apply(todayListenCountRef, setTodayListenCount, data.listenCount || 0);
            apply(todayFreeTalkCountRef, setTodayFreeTalkCount, data.freeTalkCount || 0);
            achievedKeysRef.current = merge
                ? new Set([...achievedKeysRef.current, ...(data.achievedKeys || [])])
                : new Set(data.achievedKeys || []);

            // Load this week's docs
            const weekSnaps = await Promise.all(
                weekDates.map(date => getDoc(doc(db, 'users', uid, 'dailyProgress', date)))
            );
            setWeeklyData(weekDates.map((date, i) => {
                if (weekSnaps[i].exists()) {
                    const d = weekSnaps[i].data();
                    const cnt = d.count || 0;
                    const goal = d.dailyGoal || dailyGoal;
                    return { date, count: cnt, goal, achieved: cnt >= goal, topicProgress: d.topicProgressToday === true };
                }
                return { date, count: 0, goal: dailyGoal, achieved: false, topicProgress: false };
            }));
        } catch (e) {
            console.error('[useDailyProgress] Firestore 로드 실패 (보안 규칙 확인 필요):', e);
        }
    }, [user?.uid, dailyGoal]); // uid만 의존 — 토큰 갱신 시 user 객체 레퍼런스 변경으로 인한 재실행 방지

    // 자정 경과 감지 — ref/state가 어제 날짜 기준이면 즉시 0으로 동기 리셋 후 백그라운드 재로드.
    // 앱이 백그라운드/포그라운드로 살아있는 채 날짜가 바뀌면 Capacitor는 reload하지 않으므로,
    // 이 가드가 없으면 ① 어제 한도 도달 상태가 다음날 종일 유지 ② 어제 카운트+1이 새 날 문서에
    // 기록되는 오염이 발생함 (2026-06-11 점검에서 발견).
    const rolloverIfNeeded = useCallback(() => {
        if (!user?.uid) return false;
        if (loadedDayRef.current === getToday()) return false;
        loadedDayRef.current = getToday();
        achievedKeysRef.current = new Set();
        todayCountRef.current = 0;
        todaySaveCountRef.current = 0;
        todayPronCountRef.current = 0;
        todayListenCountRef.current = 0;
        todayFreeTalkCountRef.current = 0;
        wordPassRef.current = 0;
        passagePassRef.current = 0;
        setTodayCount(0);
        setTodaySaveCount(0);
        setTodayPronCount(0);
        setTodayPronBonus(0);
        setTodayListenCount(0);
        setTodayFreeTalkCount(0);
        loadData({ merge: true }); // 다른 디바이스가 이미 쓴 오늘 카운트 + 주간 데이터 반영
        return true;
    }, [user?.uid, loadData]);

    useEffect(() => {
        const uid = user?.uid;
        if (!uid) {
            setTodayCount(0);
            setTodaySaveCount(0);
            setTodayPronCount(0);
            setTodayPronBonus(0);
            setTodayListenCount(0);
            setTodayFreeTalkCount(0);
            setWeeklyData(makePlaceholderWeek(dailyGoal));
            achievedKeysRef.current = new Set();
            todayCountRef.current = 0;
            todaySaveCountRef.current = 0;
            todayPronCountRef.current = 0;
            todayListenCountRef.current = 0;
            todayFreeTalkCountRef.current = 0;
            wordPassRef.current = 0;
            passagePassRef.current = 0;
            lastMarkedActiveDayRef.current = null;
            lastTopicProgressDayRef.current = null;
            return;
        }
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]); // uid만 의존 — 토큰 갱신 시 user 객체 레퍼런스 변경으로 인한 재실행 방지

    // 포그라운드 복귀/분 단위로 날짜 변경 체크 — 백그라운드에 두었다 다음날 열거나,
    // 포그라운드인 채 자정을 넘기는 케이스 양쪽 커버 (web/Android WebView/iOS WKWebView 공통)
    useEffect(() => {
        if (!user?.uid) return;
        const onVisible = () => {
            if (document.visibilityState === 'visible') rolloverIfNeeded();
        };
        document.addEventListener('visibilitychange', onVisible);
        const interval = setInterval(rolloverIfNeeded, 60 * 1000);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            clearInterval(interval);
        };
    }, [user?.uid, rolloverIfNeeded]);

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
        rolloverIfNeeded(); // 자정 경과 시 어제 카운트/키가 새 날에 합산되는 것 차단
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
    }, [user, dailyGoal, markActiveDayIfFirst, rolloverIfNeeded]);

    // 카드 저장 일간 카운터 증가 (Trial 게이지용 — 발음 점수 무관)
    const incrementDailySave = useCallback(async () => {
        if (!user?.uid) return;
        onDailySave?.(); // 기능2: 카드 저장(off→on) -1pt 차감 (해제·중복은 이 경로 안 탐 → 차감/환불 없음)
        rolloverIfNeeded();
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
    }, [user, markActiveDayIfFirst, rolloverIfNeeded, onDailySave]);

    // 발음 연습 일간 카운터 증가
    const incrementDailyPron = useCallback(async () => {
        if (!user?.uid) return;
        rolloverIfNeeded();
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
    }, [user, markActiveDayIfFirst, rolloverIfNeeded]);

    // Listening 지문 조회 일간 카운터 증가
    const incrementDailyListen = useCallback(async () => {
        if (!user?.uid) return;
        rolloverIfNeeded();
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
    }, [user, markActiveDayIfFirst, rolloverIfNeeded]);

    // Free Talking 세션 시작 — Trial 일일 한도 2회 체크용 (state + Firestore)
    const incrementDailyFreeTalk = useCallback(async () => {
        if (!user?.uid) return;
        rolloverIfNeeded();
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
    }, [user, markActiveDayIfFirst, rolloverIfNeeded]);

    // 그날 토픽 진척(단어/지문 통과 1회 이상) 마킹 — Streak 판정 기준(2026-06-14 개편).
    // recordPass 성공 시 App에서 호출. weeklyData.topicProgress 낙관 갱신 → useStreak 즉시 반영.
    // 반환: true=이번 호출이 '그날 첫 토픽 진척' 마킹(=오늘 Streak 달성), false=이미 마킹됨/무효
    // #4(2026-06-16): Streak 달성 = 오늘 단어 통과 ≥ W_TARGET AND 지문 통과 ≥ P_TARGET (phase 인자로 집계).
    //   첫 발음 1회로는 부족 → 실질 학습(단어 2 + 지문 2)을 해야 Streak 기록.
    const markTopicProgressToday = useCallback(async (phase) => {
        if (!user?.uid) return false;
        rolloverIfNeeded();
        const today = getToday();
        // phase별 통과 수 집계(로컬 + Firestore atomic increment, dailyProgress 서브컬렉션)
        const isPassage = phase === 'passage';
        if (isPassage) passagePassRef.current += 1; else wordPassRef.current += 1;
        markActiveDayIfFirst();
        setDoc(
            doc(db, 'users', user.uid, 'dailyProgress', today),
            { [isPassage ? 'passagePassToday' : 'wordPassToday']: increment(1), updatedAt: serverTimestamp() },
            { merge: true }
        ).catch((e) => console.error('[useDailyProgress] pass 카운트 저장 실패:', e));

        if (lastTopicProgressDayRef.current === today) return false; // 이미 오늘 Streak 달성
        // 단어·지문 둘 다 목표 도달해야 Streak 달성
        if (wordPassRef.current < W_TARGET || passagePassRef.current < P_TARGET) return false;
        lastTopicProgressDayRef.current = today;
        setWeeklyData(prev => prev.map(d => (d.date === today ? { ...d, topicProgress: true } : d)));
        setDoc(
            doc(db, 'users', user.uid, 'dailyProgress', today),
            { topicProgressToday: true, updatedAt: serverTimestamp() },
            { merge: true }
        ).catch((e) => {
            console.error('[useDailyProgress] topicProgressToday 저장 실패:', e);
            lastTopicProgressDayRef.current = null; // 실패 시 재시도 가능하게 롤백
        });
        return true;
    }, [user, markActiveDayIfFirst, rolloverIfNeeded]);

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
    }, [user, markActiveDayIfFirst]);

    return { todayCount, todaySaveCount, todayPronCount, todayPronBonus, todayListenCount, todayFreeTalkCount, weeklyData, incrementAchievement, incrementDailySave, incrementDailyPron, incrementDailyListen, incrementDailyGenerate, incrementDailyFreeTalk, markTopicProgressToday, reloadDaily: loadData };
};
