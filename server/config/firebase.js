const admin = require('firebase-admin');

if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(
            Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8')
        );
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('[Firebase Admin] Initialized successfully');
    } catch (e) {
        console.warn('[Firebase Admin] Init skipped (no FIREBASE_SERVICE_ACCOUNT_BASE64):', e.message);
    }
}

const adminDb = admin.apps.length ? admin.firestore() : null;

module.exports = { admin, adminDb };
