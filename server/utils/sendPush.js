// FCM push 전송 유틸 — firebase-admin messaging 사용
// 토큰은 users/{uid}.fcmTokens 배열에 저장됨 (최신 기기 다중 지원)
// 유효하지 않은 토큰은 자동 정리
const { admin, adminDb } = require('../config/firebase');

// deviceLang → 10개 언어 지원. 그 외는 en fallback
const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh-CN', 'vi', 'fr', 'de', 'es', 'ru', 'pt-BR'];

function pickLang(deviceLang) {
    if (!deviceLang) return 'en';
    if (SUPPORTED_LANGS.includes(deviceLang)) return deviceLang;
    // zh → zh-CN, pt → pt-BR 등
    if (deviceLang.startsWith('zh')) return 'zh-CN';
    if (deviceLang.startsWith('pt')) return 'pt-BR';
    const short = deviceLang.split('-')[0];
    if (SUPPORTED_LANGS.includes(short)) return short;
    return 'en';
}

// 알림 템플릿 — 서버 측 10개 언어 번역
// 클라이언트의 src/locales와 분리 관리 (서버는 필요한 key만)
const PUSH_MESSAGES = {
    renewal: {
        'en':    { title: '✅ Subscription Renewed', body: 'Your subscription has been renewed. Thank you for your continued support.' },
        'ko':    { title: '✅ 구독 갱신 완료', body: '구독이 갱신되었습니다. 계속 이용해 주셔서 감사합니다.' },
        'ja':    { title: '✅ サブスク更新完了', body: 'サブスクリプションが更新されました。引き続きご利用いただきありがとうございます。' },
        'zh-CN': { title: '✅ 订阅已续订', body: '您的订阅已续订。感谢您的持续支持。' },
        'vi':    { title: '✅ Đã gia hạn gói đăng ký', body: 'Gói đăng ký của bạn đã được gia hạn. Cảm ơn bạn đã tiếp tục sử dụng.' },
        'fr':    { title: '✅ Abonnement renouvelé', body: 'Votre abonnement a été renouvelé. Merci pour votre fidélité.' },
        'de':    { title: '✅ Abo verlängert', body: 'Ihr Abonnement wurde verlängert. Vielen Dank für Ihre Treue.' },
        'es':    { title: '✅ Suscripción renovada', body: 'Tu suscripción se ha renovado. Gracias por tu continuo apoyo.' },
        'ru':    { title: '✅ Подписка продлена', body: 'Ваша подписка была продлена. Спасибо за вашу поддержку.' },
        'pt-BR': { title: '✅ Assinatura renovada', body: 'Sua assinatura foi renovada. Obrigado pela sua fidelidade.' },
    },
    expiration: {
        'en':    { title: '⚠️ Subscription Expired', body: 'Your subscription has expired. Renew to keep learning.' },
        'ko':    { title: '⚠️ 구독 만료', body: '구독이 만료되었습니다. 계속 학습하시려면 갱신이 필요합니다.' },
        'ja':    { title: '⚠️ サブスク期限切れ', body: 'サブスクリプションの有効期限が切れました。' },
        'zh-CN': { title: '⚠️ 订阅已到期', body: '您的订阅已到期，续订以继续学习。' },
        'vi':    { title: '⚠️ Gói đăng ký đã hết hạn', body: 'Hãy gia hạn để tiếp tục học tập.' },
        'fr':    { title: '⚠️ Abonnement expiré', body: 'Votre abonnement a expiré.' },
        'de':    { title: '⚠️ Abo abgelaufen', body: 'Ihr Abonnement ist abgelaufen.' },
        'es':    { title: '⚠️ Suscripción vencida', body: 'Renueva para seguir aprendiendo.' },
        'ru':    { title: '⚠️ Подписка истекла', body: 'Продлите, чтобы продолжить обучение.' },
        'pt-BR': { title: '⚠️ Assinatura expirada', body: 'Renove para continuar aprendendo.' },
    },
    billingIssue: {
        'en':    { title: '❗ Payment Issue', body: 'We couldn’t process your payment. Please update your payment method.' },
        'ko':    { title: '❗ 결제 문제 발생', body: '결제에 실패했습니다. 결제 수단을 확인해 주세요.' },
        'ja':    { title: '❗ 決済エラー', body: '決済に失敗しました。お支払い方法をご確認ください。' },
        'zh-CN': { title: '❗ 付款失败', body: '请更新您的付款方式。' },
        'vi':    { title: '❗ Lỗi thanh toán', body: 'Vui lòng cập nhật phương thức thanh toán.' },
        'fr':    { title: '❗ Problème de paiement', body: 'Veuillez mettre à jour votre moyen de paiement.' },
        'de':    { title: '❗ Zahlungsproblem', body: 'Bitte aktualisieren Sie Ihre Zahlungsmethode.' },
        'es':    { title: '❗ Problema de pago', body: 'Actualiza tu método de pago.' },
        'ru':    { title: '❗ Проблема с оплатой', body: 'Обновите способ оплаты.' },
        'pt-BR': { title: '❗ Problema no pagamento', body: 'Atualize sua forma de pagamento.' },
    },
    cancellation: {
        'en':    { title: 'ℹ️ Auto-renew Cancelled', body: 'You can keep using until the expiration date.' },
        'ko':    { title: 'ℹ️ 자동 갱신 해제', body: '만료일까지는 계속 이용하실 수 있습니다.' },
        'ja':    { title: 'ℹ️ 自動更新オフ', body: '有効期限までご利用いただけます。' },
        'zh-CN': { title: 'ℹ️ 已关闭自动续订', body: '到期前可继续使用。' },
        'vi':    { title: 'ℹ️ Đã tắt tự động gia hạn', body: 'Bạn có thể tiếp tục dùng đến ngày hết hạn.' },
        'fr':    { title: 'ℹ️ Renouvellement désactivé', body: 'Utilisable jusqu’à la date d’expiration.' },
        'de':    { title: 'ℹ️ Auto-Verlängerung aus', body: 'Nutzbar bis zum Ablaufdatum.' },
        'es':    { title: 'ℹ️ Renovación automática desactivada', body: 'Puedes usar hasta la fecha de vencimiento.' },
        'ru':    { title: 'ℹ️ Автопродление отключено', body: 'Использование до даты окончания подписки.' },
        'pt-BR': { title: 'ℹ️ Renovação automática desativada', body: 'Você pode usar até a data de expiração.' },
    },
};

function renderMessage(type, deviceLang) {
    const tpl = PUSH_MESSAGES[type];
    if (!tpl) return null;
    const lang = pickLang(deviceLang);
    return tpl[lang] || tpl['en'];
}

/**
 * 특정 유저에게 구독 이벤트 푸시 전송
 * @param {string} uid — Firestore users 문서 ID
 * @param {'renewal'|'expiration'|'billingIssue'|'cancellation'} type
 * @param {object} [dataExtras] — 클라이언트에 전달할 추가 데이터 (예: screen: 'subscription')
 */
async function sendSubscriptionPush(uid, type, dataExtras = {}) {
    if (!admin?.messaging || !adminDb) return { ok: false, reason: 'admin-not-init' };

    try {
        const snap = await adminDb.collection('users').doc(uid).get();
        if (!snap.exists) return { ok: false, reason: 'user-not-found' };
        const data = snap.data();

        // 사용자 opt-out 존중
        if (data.subscriptionAlertOptOut === true) {
            return { ok: false, reason: 'opted-out' };
        }

        const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens.filter(Boolean) : [];
        if (tokens.length === 0) return { ok: false, reason: 'no-tokens' };

        const msg = renderMessage(type, data.deviceLang);
        if (!msg) return { ok: false, reason: 'unknown-type' };

        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: { title: msg.title, body: msg.body },
            data: { type, screen: 'subscription', ...dataExtras },
            android: { priority: 'high' },
            apns: { payload: { aps: { sound: 'default' } } },
        });

        // 실패 토큰 정리 — 등록 해제된 기기의 오래된 토큰 제거
        const staleTokens = [];
        response.responses.forEach((r, i) => {
            if (!r.success) {
                const code = r.error?.code || '';
                if (code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token' ||
                    code === 'messaging/invalid-argument') {
                    staleTokens.push(tokens[i]);
                }
            }
        });
        if (staleTokens.length > 0) {
            const remaining = tokens.filter(t => !staleTokens.includes(t));
            await adminDb.collection('users').doc(uid).update({ fcmTokens: remaining });
            console.log(`[Push] ${uid} — cleaned ${staleTokens.length} stale tokens`);
        }

        console.log(`[Push] ${uid} ← ${type}: sent=${response.successCount}, failed=${response.failureCount}`);
        return { ok: true, sent: response.successCount, failed: response.failureCount };
    } catch (e) {
        console.warn('[Push] sendSubscriptionPush failed:', e.message);
        return { ok: false, reason: e.message };
    }
}

module.exports = { sendSubscriptionPush };
