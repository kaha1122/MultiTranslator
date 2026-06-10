import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { getT } from '../utils/i18n';

// FreeTalking 사전 안내 모달 — 시나리오 진입 전 역할/미션 안내 (기존 .ftc-first-guide 대체)
// 트리거: App.jsx onFreeTalkStart에서 localStorage FREETALK_PREGUIDE_KEY 미존재 시 표시.
//   onStart → 채팅 진입 / onClose(X·백드롭) → 시나리오 선택 화면 복귀(채팅 진입 안 함).
//   "다시 보지 않음" 체크 후 시작 → 영구 dismiss(키 set).
export const FREETALK_PREGUIDE_KEY = 'pronunfit.freeTalkingPreGuide.dismissedAt';

export default function FreeTalkingPreGuideModal({
    open, onStart, onClose,
    scenarioName, scenarioCategory, scenarioIcon,
    sourceLang = 'ko',
}) {
    const t = (k) => getT(sourceLang, k);
    const [dontShow, setDontShow] = useState(false);

    if (!open) return null;

    const handleStart = () => {
        if (dontShow) {
            try { localStorage.setItem(FREETALK_PREGUIDE_KEY, new Date().toISOString()); } catch (e) { /* noop */ }
        }
        onStart?.();
    };

    // 영문/현지화 라벨이 같으면(소스=영어) 카테고리 줄 생략
    const showCategory = scenarioCategory && scenarioCategory !== scenarioName;

    const roles = [
        { emoji: '🎬', text: t('freeTalk.preGuide.role1') || '먼저 상황과 예시 대화를 들려드려요' },
        { emoji: '👂', text: t('freeTalk.preGuide.role2') || '그 대화를 차근히 듣고, 무엇을 말할지 정해요' },
        { emoji: '🎤', text: t('freeTalk.preGuide.role3') || '준비되면 [말하기]로 대화를 이어가세요' },
    ];
    const missions = [
        t('freeTalk.preGuide.mission1') || '예시 대화의 흐름과 표현 파악하기',
        t('freeTalk.preGuide.mission2') || 'AI의 답에서 핵심 표현 한 가지 골라 기억하기',
        t('freeTalk.preGuide.mission3') || '다음 한 마디를 자연스럽게 이어가기',
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-card"
                style={{ maxWidth: 380, textAlign: 'left' }}
                onClick={(e) => e.stopPropagation()}
            >
                <button className="modal-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>

                {/* 1. 헤더 — 시나리오 이름 동적 표시 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 28, marginBottom: 10 }}>
                    {scenarioIcon && <span style={{ fontSize: '1.8rem', lineHeight: 1, flexShrink: 0 }}>{scenarioIcon}</span>}
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#1e293b', lineHeight: 1.25 }}>
                            {scenarioName}
                        </div>
                        {showCategory && (
                            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 1 }}>{scenarioCategory}</div>
                        )}
                    </div>
                </div>

                {/* 2. 환영문 */}
                <p style={{ margin: '0 0 14px', fontSize: '0.86rem', color: '#475569', lineHeight: 1.5 }}>
                    {t('freeTalk.preGuide.welcome')
                        || 'FreeTalking은 AI와의 자유 대화 연습이에요. 먼저 예시 대화를 듣고, 차근히 생각해서 이어가는 방식이에요.'}
                </p>

                {/* 3. 역할 안내 카드 — muted accent(인디고) 단색 톤 */}
                <div style={{
                    background: 'color-mix(in srgb, var(--brand-accent) 12%, transparent)',
                    borderRadius: 14, padding: '12px 14px', marginBottom: 12,
                    display: 'flex', flexDirection: 'column', gap: 9,
                }}>
                    {roles.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <span style={{ fontSize: '1.05rem', lineHeight: 1, flexShrink: 0 }}>{r.emoji}</span>
                            <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600, lineHeight: 1.35 }}>{r.text}</span>
                        </div>
                    ))}
                </div>

                {/* 4. 미션 카드 */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#64748b', letterSpacing: '0.03em', marginBottom: 8 }}>
                        {t('freeTalk.preGuide.missionTitle') || '이 대화에서 이런 걸 해보세요'}
                    </div>
                    {missions.map((m, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: i ? 7 : 0 }}>
                            <Check size={16} style={{ color: 'var(--brand-accent)', flexShrink: 0, marginTop: 2 }} />
                            <span style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.4 }}>{m}</span>
                        </div>
                    ))}
                </div>

                {/* 6. 다시 보지 않음 */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14, fontSize: '0.82rem', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                        type="checkbox"
                        checked={dontShow}
                        onChange={(e) => setDontShow(e.target.checked)}
                        style={{ width: 15, height: 15, accentColor: 'var(--brand-accent)', cursor: 'pointer' }}
                    />
                    <span>{t('daily.dontShowAgain') || '다시 보지 않기'}</span>
                </label>

                {/* 7. CTA */}
                <button type="button" className="modal-btn-primary" onClick={handleStart}>
                    {t('freeTalk.preGuide.cta') || '시작하기'}
                </button>
            </div>
        </div>
    );
}
