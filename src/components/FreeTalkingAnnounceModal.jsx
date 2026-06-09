import { X, MessagesSquare, Mic, Gem } from 'lucide-react';
import './FreeTalkingAnnounceModal.css';

/**
 * 기능 소개 모달 — 기존 사용자에게 새로운 Free-Talking 기능을 1회 알림.
 *
 * 표시 조건 (App.jsx 측):
 *   - localStorage 'pronunfit_freetalk_announce_seen' 미존재
 *   - localStorage 'deviceOnboardingDone' === '1' (이미 온보딩 통과한 기존 사용자)
 *   → 신규 사용자는 OnboardingModal 통과 시점에 announce_seen='1' 자동 set 되어
 *     이 모달을 보지 않음 (이 모달은 기존 사용자 대상 1회 안내용)
 */
export default function FreeTalkingAnnounceModal({ open, onStart, onLater, t }) {
    if (!open) return null;

    return (
        <div className="ftam-overlay" role="dialog" aria-modal="true">
            <div className="ftam-window" onClick={(e) => e.stopPropagation()}>
                <button className="ftam-close" onClick={onLater} aria-label="Close">
                    <X size={20} />
                </button>

                <div className="ftam-hero">
                    <div className="ftam-emoji">🎉</div>
                    <h2 className="ftam-title">{t?.('announceFreetalk.title') || 'New: Free-Talking'}</h2>
                    <p className="ftam-subtitle">{t?.('announceFreetalk.subtitle') || 'Now you can chat with AI in real time!'}</p>
                </div>

                <div className="ftam-steps">
                    <div className="ftam-step">
                        <div className="ftam-step-icon"><MessagesSquare size={18} /></div>
                        <div className="ftam-step-text">
                            <strong>{t?.('announceFreetalk.step1Title') || 'Pick a place'}</strong>
                            <span>{t?.('announceFreetalk.step1Desc') || '21 scenes — airport, hotel, restaurant...'}</span>
                        </div>
                    </div>
                    <div className="ftam-step">
                        <div className="ftam-step-icon"><Mic size={18} /></div>
                        <div className="ftam-step-text">
                            <strong>{t?.('announceFreetalk.step2Title') || 'Chat with AI'}</strong>
                            <span>{t?.('announceFreetalk.step2Desc') || 'KakaoTalk-style chat. Press [Talk] to speak.'}</span>
                        </div>
                    </div>
                    <div className="ftam-step">
                        <div className="ftam-step-icon"><Gem size={18} /></div>
                        <div className="ftam-step-text">
                            <strong>{t?.('announceFreetalk.step3Title') || 'Save key expressions'}</strong>
                            <span>{t?.('announceFreetalk.step3Desc') || '[💎 Make Cards] auto-saves the best phrases.'}</span>
                        </div>
                    </div>
                </div>

                <div className="ftam-buttons">
                    <button className="ftam-later-btn" onClick={onLater}>
                        {t?.('announceFreetalk.later') || 'Later'}
                    </button>
                    <button className="ftam-start-btn" onClick={onStart}>
                        💬 {t?.('announceFreetalk.tryNow') || 'Try Free-Talking Now'}
                    </button>
                </div>
            </div>
        </div>
    );
}
