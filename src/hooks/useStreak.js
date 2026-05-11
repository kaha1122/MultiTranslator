// Streak 계산 + Firestore 영속화 + 마일스톤 보너스 클레임 (Option B)
// - weeklyData(현재 주만) 외 전체 dailyProgress를 일회 로드해서 streak/longest 계산
// - users.streakCurrent / streakLongest / earnedMilestones[] 영속화
// - 7/14/30/100일 도달 시 클라가 즉시 /api/streak/claim 호출
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, getDocs } from 'firebase/firestore';
import { authFetch } from '../utils/authFetch';

export const MILESTONES = [7, 14, 30, 100];
export const MILESTONE_REWARDS = { 7: 100, 14: 200, 30: 500, 100: 1000 };

const toLocalDateStr = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const subDays = (date, n) => {
    const d = new Date(date);
    d.setDate(d.getDate() - n);
    return d;
};

// achievedSet(Set of YYYY-MM-DD): 오늘부터 역순으로 연속된 길이
const calcStreakFromSet = (achievedSet, todayStr) => {
    if (!achievedSet || achievedSet.size === 0) return 0;
    const today = new Date(todayStr + 'T00:00:00');
    let count = 0;
    // 오늘 미달성이면 어제부터 카운트 시작 (자정~오늘 미달성 시점에도 어제 streak는 유효)
    const startOffset = achievedSet.has(todayStr) ? 0 : 1;
    for (let i = startOffset; i < 365; i++) {
        const dateStr = toLocalDateStr(subDays(today, i));
        if (achievedSet.has(dateStr)) count++;
        else break;
    }
    return count;
};

// achievedSet 전체에서 가장 긴 연속 구간
const calcLongestFromSet = (achievedSet) => {
    if (!achievedSet || achievedSet.size === 0) return 0;
    const sorted = Array.from(achievedSet).sort();
    let longest = 1;
    let current = 1;
    for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1] + 'T00:00:00');
        const curr = new Date(sorted[i] + 'T00:00:00');
        const diffDays = Math.round((curr - prev) / 86400000);
        if (diffDays === 1) {
            current++;
            if (current > longest) longest = current;
        } else {
            current = 1;
        }
    }
    return longest;
};

const API_URL = import.meta.env.VITE_API_URL || '';

export const useStreak = (user, weeklyData, dailyGoal = 3) => {
    const [streakCurrent, setStreakCurrent] = useState(0);
    const [streakLongest, setStreakLongest] = useState(0);
    const [totalAchievedDays, setTotalAchievedDays] = useState(0);
    const [earnedMilestones, setEarnedMilestones] = useState([]);
    const [celebration, setCelebration] = useState(null); // { milestone, reward }
    const achievedSetRef = useRef(new Set());
    const lastPersistedRef = useRef({ current: -1, longest: -1 });
    const claimingRef = useRef(false);

    // 초기 로드 — 전체 dailyProgress 1회 fetch + user 문서 메타
    useEffect(() => {
        const uid = user?.uid;
        if (!uid) {
            setStreakCurrent(0);
            setStreakLongest(0);
            setTotalAchievedDays(0);
            setEarnedMilestones([]);
            achievedSetRef.current = new Set();
            lastPersistedRef.current = { current: -1, longest: -1 };
            return;
        }

        const load = async () => {
            try {
                const [progressSnap, userSnap] = await Promise.all([
                    getDocs(query(collection(db, 'users', uid, 'dailyProgress'))),
                    getDoc(doc(db, 'users', uid)),
                ]);
                const set = new Set();
                progressSnap.forEach(docSnap => {
                    const d = docSnap.data();
                    const goal = d.dailyGoal || dailyGoal;
                    if ((d.count || 0) >= goal || d.goalAchievedToday === true) {
                        set.add(docSnap.id);
                    }
                });
                achievedSetRef.current = set;
                setTotalAchievedDays(set.size);

                const todayStr = toLocalDateStr(new Date());
                const cur = calcStreakFromSet(set, todayStr);
                const lng = Math.max(calcLongestFromSet(set), cur);
                setStreakCurrent(cur);
                setStreakLongest(lng);

                const userData = userSnap.data() || {};
                setEarnedMilestones(Array.isArray(userData.earnedMilestones) ? userData.earnedMilestones : []);
            } catch (e) {
                console.error('[useStreak] load failed:', e);
            }
        };
        load();
    }, [user?.uid, dailyGoal]);

    // weeklyData가 변할 때 (오늘 달성 → 클라 즉시 반영) achievedSet 동기화
    useEffect(() => {
        if (!user?.uid || !Array.isArray(weeklyData)) return;
        const set = achievedSetRef.current;
        let changed = false;
        weeklyData.forEach(d => {
            if (d.achieved && !set.has(d.date)) {
                set.add(d.date);
                changed = true;
            }
        });
        if (!changed) return;

        const todayStr = toLocalDateStr(new Date());
        const cur = calcStreakFromSet(set, todayStr);
        const lng = Math.max(calcLongestFromSet(set), cur);
        setStreakCurrent(cur);
        setStreakLongest(lng);
        setTotalAchievedDays(set.size);
    }, [weeklyData, user?.uid]);

    // streakCurrent / streakLongest Firestore 영속화 (변동 시만)
    useEffect(() => {
        const uid = user?.uid;
        if (!uid) return;
        if (streakCurrent === lastPersistedRef.current.current && streakLongest === lastPersistedRef.current.longest) return;
        lastPersistedRef.current = { current: streakCurrent, longest: streakLongest };
        setDoc(doc(db, 'users', uid), {
            streakCurrent,
            streakLongest,
            streakUpdatedAt: serverTimestamp(),
        }, { merge: true }).catch(e => console.error('[useStreak] persist failed:', e));
    }, [streakCurrent, streakLongest, user?.uid]);

    // 마일스톤 도달 시 자동 claim (Option B)
    useEffect(() => {
        if (!user?.uid || streakCurrent === 0) return;
        const reached = MILESTONES.find(m => streakCurrent >= m && !earnedMilestones.includes(`streak${m}`));
        if (!reached) return;
        if (claimingRef.current) return;
        claimingRef.current = true;

        const claim = async () => {
            try {
                const resp = await authFetch(`${API_URL}/api/streak/claim`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ milestone: reached }),
                });
                const data = await resp.json().catch(() => ({}));
                if (resp.ok && data.success) {
                    setEarnedMilestones(prev => [...prev, `streak${reached}`]);
                    setCelebration({ milestone: reached, reward: data.granted });
                } else if (data.skipped || data.error === 'already_claimed') {
                    setEarnedMilestones(prev => prev.includes(`streak${reached}`) ? prev : [...prev, `streak${reached}`]);
                } else {
                    console.warn('[useStreak] claim failed:', data);
                }
            } catch (e) {
                console.error('[useStreak] claim error:', e);
            } finally {
                claimingRef.current = false;
            }
        };
        claim();
    }, [streakCurrent, earnedMilestones, user?.uid]);

    // 다음 마일스톤 계산
    const nextMilestone = useMemo(() => {
        return MILESTONES.find(m => streakCurrent < m) || null;
    }, [streakCurrent]);

    const dismissCelebration = useCallback(() => setCelebration(null), []);

    return {
        streakCurrent,
        streakLongest,
        totalAchievedDays,
        earnedMilestones,
        nextMilestone,
        nextReward: nextMilestone ? MILESTONE_REWARDS[nextMilestone] : null,
        daysToNext: nextMilestone ? Math.max(0, nextMilestone - streakCurrent) : 0,
        celebration,
        dismissCelebration,
    };
};
