// ── 웹 보너스포인트 일회성 구매 창 (2026-09-28) ────────────────────────────────
// 국내(KR) = 토스페이먼츠 결제창(카드, 일반결제) → successUrl(?points=success) 복귀 후 App이 승인 요청.
// 해외     = PayPal Orders 버튼 → 승인 즉시 서버 capture.
// 상품·가격·가용 여부는 서버 /api/points/web/status가 유일한 출처(클라에 가격 하드코딩 없음).
// 심사 기간(키 미설정·테스트 키)에는 상품·가격·환불 규정·사업자 정보만 보이고 버튼은 "결제 준비 중".
// 웹 전용 — 앱은 인앱결제(handleBuyPoints)를 쓴다.
import { useEffect, useState, lazy, Suspense } from 'react';
import { X, Coins } from 'lucide-react';
import { getT } from '../utils/i18n';
import { authFetch } from '../utils/authFetch';
import BusinessInfo from './BusinessInfo';
import './WebPointsModal.css';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const PayPalPointsButton = lazy(() => import('./PayPalPointsButton'));

export const WEB_POINTS_RETURN_PARAM = 'points';

export default function WebPointsModal({ sourceLang, user, profile, onClose, onCreateAccount, onOpenTerms, onPurchased }) {
  const t = (k, fb) => getT(sourceLang, `webPoints.${k}`) || fb || k;
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'err', text }

  useEffect(() => {
    let cancelled = false;
    authFetch(`${SERVER_URL}/api/points/web/status`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((j) => { if (!cancelled) setStatus(j); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, []);

  // 국내 판정: 구독과 같은 기준(가입 전화번호 국가). 번호가 없으면 UI 언어가 한국어일 때 국내로 본다.
  const isKR = profile?.phoneCountry ? profile.phoneCountry === 'KR' : sourceLang === 'ko';
  const info = status ? (isKR ? status.toss : status.paypal) : null;
  const isGuest = user?.isAnonymous || status?.guest;
  const price = info
    ? (info.currency === 'KRW' ? `₩${Number(info.amount).toLocaleString('ko-KR')}` : `$${info.amount}`)
    : '';

  const handleToss = async () => {
    if (!info?.available || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await authFetch(`${SERVER_URL}/api/points/toss/prepare`, { method: 'POST' });
      const order = await r.json();
      if (!r.ok) throw new Error(order?.error || 'prepare failed');
      const { loadTossPayments, ANONYMOUS } = await import('@tosspayments/tosspayments-sdk');
      const toss = await loadTossPayments(info.clientKey);
      const payment = toss.payment({ customerKey: ANONYMOUS });
      const base = `${window.location.origin}/`;
      // 성공 시 Toss가 paymentKey·orderId·amount를 쿼리로 붙여 이 주소로 돌려보낸다 → App의 복귀 처리 effect가 승인 요청.
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: order.amount },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${base}?${WEB_POINTS_RETURN_PARAM}=success`,
        failUrl: `${base}?${WEB_POINTS_RETURN_PARAM}=fail`,
        ...(user?.email ? { customerEmail: user.email } : {}),
      });
    } catch (e) {
      // 사용자가 결제창을 닫은 경우(USER_CANCEL)는 조용히 복귀
      if (e?.code !== 'USER_CANCEL') setMessage({ kind: 'err', text: t('fail') });
      setBusy(false);
    }
  };

  return (
    <div className="wpm-overlay" onClick={onClose}>
      <div className="wpm-card" role="dialog" aria-modal="true" aria-label={t('title')} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="wpm-close" onClick={onClose} aria-label="Close"><X size={20} /></button>

        <h2 className="wpm-title">{t('title')}</h2>
        <p className="wpm-desc">{t('desc')}</p>

        {loadError ? (
          <p className="wpm-msg wpm-msg--err">{t('loadError')}</p>
        ) : !info ? (
          <p className="wpm-msg">…</p>
        ) : (
          <>
            <div className="wpm-product">
              <Coins size={26} className="wpm-product-icon" aria-hidden />
              <span className="wpm-product-name">{t('product').replace('{n}', Number(info.points).toLocaleString())}</span>
              <span className="wpm-product-price">{price}</span>
            </div>

            <ul className="wpm-notices">
              <li>{t('noticeInstant')}</li>
              <li>{t('noticeNoExpiry')}</li>
              <li>{t('noticeRefund')}</li>
            </ul>
            <button type="button" className="wpm-terms-link" onClick={onOpenTerms}>{t('termsLink')}</button>

            {isGuest ? (
              <>
                <p className="wpm-msg">{t('guestDesc')}</p>
                <button type="button" className="wpm-pay-btn" onClick={onCreateAccount}>
                  {getT(sourceLang, 'upgrade.sidebarBtn') || 'Create free account'}
                </button>
              </>
            ) : !info.available ? (
              <button type="button" className="wpm-pay-btn" disabled>{t('comingSoon')}</button>
            ) : isKR ? (
              <button type="button" className="wpm-pay-btn" onClick={handleToss} disabled={busy}>
                {busy ? t('processing') : t('payBtn').replace('{price}', price)}
                {info.test && <span className="wpm-test-badge">{t('testBadge')}</span>}
              </button>
            ) : (
              <div className="wpm-paypal">
                {info.test && <span className="wpm-test-badge wpm-test-badge--block">{t('testBadge')}</span>}
                <Suspense fallback={<p className="wpm-msg">…</p>}>
                  <PayPalPointsButton
                    clientId={info.clientId}
                    serverUrl={SERVER_URL}
                    onSuccess={(points) => {
                      setMessage({ kind: 'ok', text: t('success').replace('{n}', Number(points).toLocaleString()) });
                      onPurchased?.(points);
                    }}
                    onError={() => setMessage({ kind: 'err', text: t('fail') })}
                  />
                </Suspense>
              </div>
            )}

            {message && <p className={`wpm-msg ${message.kind === 'ok' ? 'wpm-msg--ok' : 'wpm-msg--err'}`}>{message.text}</p>}
          </>
        )}

        <div className="wpm-biz">
          <p className="wpm-biz-title">{t('bizTitle')}</p>
          <BusinessInfo sourceLang={sourceLang} compact />
        </div>
      </div>
    </div>
  );
}
