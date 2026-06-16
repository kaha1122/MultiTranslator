import React, { useState } from 'react';
import { X } from 'lucide-react';
import { getT } from '../utils/i18n';

// TTS 광고 프롬프트 모달 — 무료 듣기(캐시 재생) 누적 후 광고 시청 유도.
//   긴 광고(Rewarded) → +20 포인트 / 짧은 광고(Interstitial) → 보너스 없음.
//   X 닫기 → 인터스티셜 강제 발화(빠져나갈 수 없음, onClose 가 처리).
//   PushOptInModal 패턴 따름: .modal-overlay / .modal-card / .modal-btn-* / --z-critical.
export default function TtsAdPromptModal({ sourceLang, onWatchLong, onWatchShort, onClose }) {
    const t = (key) => getT(sourceLang, key);
    const [busy, setBusy] = useState(false);

    const run = async (fn) => {
        if (busy) return;
        setBusy(true);
        try { await fn?.(); } finally { setBusy(false); }
    };

    return (
        <div className="modal-overlay" style={{ zIndex: 'var(--z-critical)' }}>
            <div className="modal-card" style={{ textAlign: 'center' }}>
                {/* X 닫기 — escape 가 아니라 '짧은 광고 강제' 경로 */}
                <button
                    type="button"
                    className="modal-close"
                    onClick={() => run(onClose)}
                    disabled={busy}
                    aria-label={t('common.close') || 'Close'}
                >
                    <X size={20} />
                </button>

                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📺</div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}>
                    {t('ttsAdPrompt.title') || 'An ad keeps the app running'}
                </h2>
                <p style={{ fontSize: '0.88rem', color: '#64748b', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {t('ttsAdPrompt.body') || "You've enjoyed a lot of free listening. Please watch a short ad to keep it free."}
                </p>

                <button
                    type="button"
                    className="modal-btn-primary"
                    onClick={() => run(onWatchLong)}
                    disabled={busy}
                    style={{ marginBottom: '10px' }}
                >
                    {busy ? '...' : (t('ttsAdPrompt.longAd') || 'Watch long ad  (+20 points)')}
                </button>
                <button
                    type="button"
                    className="modal-btn-secondary"
                    onClick={() => run(onWatchShort)}
                    disabled={busy}
                >
                    {busy ? '...' : (t('ttsAdPrompt.shortAd') || 'Watch short ad')}
                </button>
            </div>
        </div>
    );
}
