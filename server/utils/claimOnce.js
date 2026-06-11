// 원자적 1회 클레임 마커 — read-then-write TOCTOU(동시 병렬 요청이 중복 검사를 모두
// 통과해 이중 적립되던 패턴) 차단용. Firestore .create()는 문서가 이미 존재하면
// ALREADY_EXISTS로 throw하므로, grant 이전에 마커 선점 → 경합 시 한쪽만 성공.
// webhook.js의 pointPurchases/{txId}.create() 멱등 패턴을 일반화한 것.
const { admin, adminDb } = require('../config/firebase');

/**
 * 클레임 선점. true = 이번 호출이 최초(진행), false = 이미 클레임됨(거부).
 * @param {string} claimId  예: `${uid}_reviewBonus`, `${uid}_streak30`
 */
async function acquireClaim(claimId, meta = {}) {
    try {
        await adminDb.collection('bonusClaims').doc(claimId).create({
            ...meta,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
    } catch (e) {
        if (e.code === 6 || /already.?exists/i.test(e.message || '')) return false; // ALREADY_EXISTS
        throw e;
    }
}

/** 선점 해제 — grant가 skip(Pro 등)되어 "재시도 허용"이 기존 의미였던 경로에서만 사용. */
async function releaseClaim(claimId) {
    try {
        await adminDb.collection('bonusClaims').doc(claimId).delete();
    } catch (_) { /* best-effort */ }
}

module.exports = { acquireClaim, releaseClaim };
