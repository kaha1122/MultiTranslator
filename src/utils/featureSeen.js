// 신규 기능 "확인 여부" 추적 — localStorage(즉시) + Firestore(크로스기기) 하이브리드
// 사용 예: const { seen, markSeen } = useFeatureSeen(uid, 'notifications');
import { useCallback, useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

const LS_PREFIX = 'pronunfit.featureSeen.';

function readLocal(key) {
    try {
        return localStorage.getItem(LS_PREFIX + key) === 'true';
    } catch {
        return false;
    }
}

function writeLocal(key, value) {
    try {
        localStorage.setItem(LS_PREFIX + key, value ? 'true' : 'false');
    } catch {}
}

/**
 * @param {string|null} uid — Firebase UID (없으면 localStorage만 사용)
 * @param {string} featureKey — 예: 'notifications'
 * @param {object} [profile] — AuthContext의 profile 객체 (featuresSeen 필드 참조)
 * @returns {{ seen: boolean, markSeen: () => Promise<void> }}
 */
export function useFeatureSeen(uid, featureKey, profile) {
    const [seen, setSeen] = useState(() => readLocal(featureKey));

    // Firestore profile 동기화 — 다른 기기에서 본 경우 반영
    useEffect(() => {
        if (profile?.featuresSeen?.[featureKey] === true && !seen) {
            writeLocal(featureKey, true);
            setSeen(true);
        }
    }, [profile?.featuresSeen, featureKey, seen]);

    const markSeen = useCallback(async () => {
        if (seen) return;
        setSeen(true);
        writeLocal(featureKey, true);
        if (uid) {
            try {
                await updateDoc(doc(db, 'users', uid), {
                    [`featuresSeen.${featureKey}`]: true,
                });
            } catch (e) {
                // Firestore 실패해도 로컬은 유지 — 다음 로그인에서 재시도됨
                console.warn('[featureSeen] Firestore write failed:', e.message);
            }
        }
    }, [seen, uid, featureKey]);

    return { seen, markSeen };
}
