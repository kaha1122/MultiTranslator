import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';

// 유저 문서의 cardSerialMax를 원자적으로 +1 하고 새 번호를 반환.
// 카드 저장 시 이 번호를 serialNumber 필드에 박아두면 삭제/재정렬과 무관하게 고정.
export async function assignNextCardSerial(uid) {
    if (!uid) throw new Error('uid required');
    const userRef = doc(db, 'users', uid);
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists()) {
            // 이론상 항상 존재 (AuthContext가 생성). 드문 경우 방어적 초기화.
            tx.set(userRef, { cardSerialMax: 1 }, { merge: true });
            return 1;
        }
        const current = snap.data().cardSerialMax || 0;
        const next = current + 1;
        tx.update(userRef, { cardSerialMax: next });
        return next;
    });
}
