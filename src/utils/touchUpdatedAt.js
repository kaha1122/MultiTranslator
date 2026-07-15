import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

// [thermal-safe] users/{uid}.updatedAt 갱신 공용 헬퍼.
//   배경: updatedAt은 콜드 스타트(onAuthStateChanged)에서만 갱신돼, 앱이 메모리에 살아있는 채
//   백그라운드→포그라운드 복귀(resume)하는 가장 흔한 사용 패턴을 놓쳐 "최근 사용" 추적이 누락됐음.
//   resume 시점에도 이 헬퍼로 갱신해 갭을 메운다.
//
//   발열 안전성: updatedAt은 AuthContext PROFILE_VOLATILE_FIELDS에 포함 → onSnapshot 재발화해도
//   profileEssence 동일 판정으로 재렌더 0 (CLAUDE.md 규칙6의 users-write→render-storm 예외).
//   남는 비용은 네트워크 write 1회뿐 → 무시 가능.
//
//   가드: 디바이스별 localStorage 타임스탬프로 throttle(기본 5분). 여러 디바이스 동시 사용 시
//   가드는 무시되지만 영향 미미(write가 재렌더를 안 일으키므로). serverTimestamp는 서버 도달 시각으로
//   확정 — 그래서 백그라운드(suspend로 flush 실패→다음 resume 때 전송)에는 부정확, resume에 적합.
const TOUCH_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function touchUpdatedAt(uid) {
    if (!uid) return;
    const key = `pronunfit_lastUpdatedAt_${uid}`;
    try {
        const lastMs = parseInt(localStorage.getItem(key) || '0', 10);
        if (Date.now() - lastMs < TOUCH_MIN_INTERVAL_MS) return; // 가드 내 — skip
        updateDoc(doc(db, 'users', uid), { updatedAt: serverTimestamp() }).catch((e) =>
            console.error('[touchUpdatedAt] updatedAt refresh failed:', e)
        );
        localStorage.setItem(key, String(Date.now()));
    } catch {
        // localStorage 접근 실패 시 가드 없이 write (이전 동작 보존)
        updateDoc(doc(db, 'users', uid), { updatedAt: serverTimestamp() }).catch(() => {});
    }
}
