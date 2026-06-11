// 임시 진단(읽기 전용): Toss 자동갱신 cron이 실제로 돌았는지 확인
// - tierSource=toss 구독자 현황 + lastRenewedAt(cron 갱신 시 기록) 존재 여부
require('dotenv').config();
const admin = require('firebase-admin');
if (!admin.apps.length) {
    const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

(async () => {
    const snap = await db.collection('users').where('tierSource', '==', 'toss').get();
    console.log(`tierSource=toss 유저: ${snap.size}명`);
    const now = new Date();
    snap.forEach(d => {
        const v = d.data();
        const exp = v.subscriptionExpiresAt?.toDate?.();
        const renewed = v.lastRenewedAt?.toDate?.();
        console.log([
            `uid=${d.id.slice(0, 8)}…`,
            `tier=${v.tier}`,
            `autoRenew=${v.autoRenew}`,
            `planId=${v.planId || '-'}`,
            `expires=${exp ? exp.toISOString().slice(0, 10) : '-'}${exp && exp < now ? ' (만료됨)' : ''}`,
            `lastRenewedAt=${renewed ? renewed.toISOString().slice(0, 10) : '없음'}`,
            `started=${v.subscriptionStartedAt?.toDate?.()?.toISOString()?.slice(0, 10) || '-'}`,
        ].join(' | '));
    });

    // 과거 toss였다가 만료로 trial 된 유저(빌링키 보유)도 카운트
    const billing = await db.collection('users').where('autoRenew', '==', true).get();
    let tossActive = 0;
    billing.forEach(d => { if (d.data().tossBillingKey) tossActive++; });
    console.log(`\nautoRenew=true & tossBillingKey 보유: ${tossActive}명`);

    // orders 컬렉션에서 type=renewal 주문이 있는지 (cron이 돌았다면 존재해야 함)
    const renewals = await db.collection('orders').where('type', '==', 'renewal').limit(5).get();
    console.log(`orders type=renewal: ${renewals.size}건${renewals.size ? '' : ' — cron 갱신 결제가 실행된 적 없음'}`);
    renewals.forEach(d => {
        const v = d.data();
        console.log(`  - ${v.orderId} ${v.amount}${v.currency} ${v.approvedAt || ''}`);
    });
    process.exit(0);
})().catch(e => { console.error('error:', e.message); process.exit(1); });
