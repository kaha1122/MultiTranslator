// ── PayPal 일회성 결제 버튼 (웹 포인트 구매 전용, 지연 로드) ─────────────────────
// 구독(UpgradeModal)은 intent:'subscription' Provider를 쓰므로 섞지 않고 capture 전용 Provider를 따로 띄운다.
// 주문 생성·캡처는 서버(/api/points/paypal/*)가 하고, 금액은 서버 가격표가 권위다.
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { authFetch } from '../utils/authFetch';

export default function PayPalPointsButton({ clientId, serverUrl, onSuccess, onError }) {
  return (
    <PayPalScriptProvider options={{ 'client-id': clientId, currency: 'USD', intent: 'capture' }}>
      <PayPalButtons
        style={{ layout: 'vertical', label: 'pay', height: 44 }}
        createOrder={async () => {
          const r = await authFetch(`${serverUrl}/api/points/paypal/create-order`, { method: 'POST' });
          const j = await r.json();
          if (!r.ok || !j.id) throw new Error(j?.error || 'create-order failed');
          return j.id;
        }}
        onApprove={async (data) => {
          const r = await authFetch(`${serverUrl}/api/points/paypal/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.success) onSuccess?.(j.points);
          else onError?.(j?.error);
        }}
        onError={(err) => { console.warn('[PayPalPoints] error', err); onError?.(err?.message); }}
      />
    </PayPalScriptProvider>
  );
}
