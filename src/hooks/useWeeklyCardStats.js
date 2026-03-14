import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';

const getMonday = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * 이번 주 savedCards를 sourceType(scene/vocab) × difficulty(basic/intermediate/high)로 집계
 * Returns: { scene: { basic: n, intermediate: n, high: n }, vocab: { basic: n, intermediate: n, high: n }, loading }
 */
export const useWeeklyCardStats = (user) => {
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user?.uid) { setLoading(false); return; }
        const load = async () => {
            try {
                const snap = await getDocs(
                    query(collection(db, 'savedCards'), where('userId', '==', user.uid))
                );
                const arr = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    if (d.isDeleted) return;
                    arr.push({
                        sourceType: d.sourceType,
                        difficulty: d.difficulty || 'basic',
                        createdAt: d.createdAt?.toDate?.() || null,
                    });
                });
                setCards(arr);
            } catch (e) {
                console.error('[useWeeklyCardStats] Load failed:', e);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [user?.uid]);

    const { weekly, monthly } = useMemo(() => {
        const weekStart = getMonday(new Date());
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const w = {
            scene: { basic: 0, intermediate: 0, high: 0 },
            vocab: { basic: 0, intermediate: 0, high: 0 },
        };
        const m = {
            scene: { basic: 0, intermediate: 0, high: 0 },
            vocab: { basic: 0, intermediate: 0, high: 0 },
        };

        cards.forEach(c => {
            if (!c.createdAt || c.createdAt > now) return;
            const type = c.sourceType === 'scene' ? 'scene' : c.sourceType === 'vocab' ? 'vocab' : null;
            if (!type) return;
            const diff = ['basic', 'intermediate', 'high'].includes(c.difficulty) ? c.difficulty : 'basic';
            if (c.createdAt >= weekStart) w[type][diff]++;
            if (c.createdAt >= monthStart) m[type][diff]++;
        });

        return { weekly: w, monthly: m };
    }, [cards]);

    // 목표: 주간 scene 105, vocab 80 / 월간 ×4
    const weeklyTargets = { scene: 105, vocab: 80 };
    const monthlyTargets = { scene: 420, vocab: 320 };

    return { stats: weekly, monthly, targets: weeklyTargets, monthlyTargets, loading };
};
