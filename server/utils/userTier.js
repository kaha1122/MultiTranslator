// 서버 권위 tier 조회 — custom(직접입력) 생성이 Pro 전용임을 서버에서 강제하기 위함.
// 클라 잠금만으론 우회되고, custom은 per-user(공유 X)라 무방비 시 Trial이 비싼 Gemini/Azure를
// 무한 호출할 수 있으므로 서버 차단이 필수.
const { adminDb } = require('../config/firebase');

const PRO_TIERS = new Set(['pro', 'premium', 'admin']);

// users/{uid}.tier 조회. adminDb 미초기화(로컬)·읽기 실패 시 null 반환(판정 불가 → 호출측이 허용 처리).
async function getTier(uid) {
    if (!adminDb || !uid) return null;
    try {
        const snap = await adminDb.collection('users').doc(uid).get();
        return (snap.exists ? snap.data().tier : null) || 'trial';
    } catch (e) {
        console.error('[userTier] read failed:', e.message);
        return null;
    }
}

const isProTier = (tier) => PRO_TIERS.has(tier);

module.exports = { getTier, isProTier, PRO_TIERS };
