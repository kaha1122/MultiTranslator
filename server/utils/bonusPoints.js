// 보너스 포인트 부여 유틸리티 — 캠페인 (review/referral/streak) 공통 진입점
// 사용자 문서의 bonusPoints 필드를 atomic increment + 이력은 bonusEvents 서브컬렉션에 기록
const admin = require('firebase-admin');

const VALID_SOURCES = new Set([
    'reviewBonus',
    'referralWelcome',     // B (피추천인) 환영 보너스
    'referralReferrer',    // A (추천인) 보상
    'streak7',
    'streak30',
    'admin_manual',        // 어드민 수동 부여
    'admin_test',          // 테스트
]);

/**
 * 보너스 포인트 부여
 * @param {object} params
 * @param {string} params.uid - 부여 대상 사용자 uid
 * @param {number} params.amount - 점수 (양수)
 * @param {string} params.source - 캠페인 소스 (VALID_SOURCES 중 하나)
 * @param {object} [params.meta] - 추가 메타 (campaignId, referredUid 등)
 */
async function grantBonusPoints({ uid, amount, source, meta = {} }) {
    if (!uid) throw new Error('uid required');
    if (typeof amount !== 'number' || amount <= 0) throw new Error('amount must be positive number');
    if (!VALID_SOURCES.has(source)) throw new Error(`invalid source: ${source}`);

    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const eventRef = userRef.collection('bonusEvents').doc();

    const batch = db.batch();
    batch.update(userRef, {
        bonusPoints: admin.firestore.FieldValue.increment(amount),
        bonusLastGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(eventRef, {
        source,
        amount,
        meta,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    console.log(`[Bonus] +${amount}pt to ${uid} (source=${source})`);
    return { success: true, amount, source };
}

module.exports = { grantBonusPoints, VALID_SOURCES };
