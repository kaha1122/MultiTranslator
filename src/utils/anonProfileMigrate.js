import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

// 익명 profile 문서에서 실계정으로 이관해야 하는 필드들을 읽어 반환.
// 서버 /api/migrate-anonymous가 경쟁 조건(AuthContext onSnapshot가 먼저 target profile을
// 생성해 "기존 계정"으로 오판)으로 카운터만 합산하고 언어/온보딩 필드 복사를 놓치는
// 케이스를 클라이언트에서도 백업으로 보완하기 위함.
const FIELDS = [
    'sourceLang',
    'targetLang',
    'targetLangs',
    'defaultLevel',
    'userLevel',
    'hasCompletedOnboarding',
    'dailyGoal',
];

export async function readAnonProfileFields(anonUid) {
    if (!anonUid) return {};
    try {
        const snap = await getDoc(doc(db, 'users', anonUid));
        if (!snap.exists()) return {};
        const data = snap.data();
        const out = {};
        for (const key of FIELDS) {
            if (data[key] !== undefined && data[key] !== null) {
                out[key] = data[key];
            }
        }
        return out;
    } catch (e) {
        console.warn('[anonProfileMigrate] read failed:', e?.message);
        return {};
    }
}
