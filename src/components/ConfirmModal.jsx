import { motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

// 2026-06-09 모달 통일 Phase 1: 공통 토큰/클래스로 리팩토링.
//   - 오버레이/카드/버튼을 .modal-overlay / .modal-card / .modal-btn-* 클래스로 전환
//   - 색상: 확인 버튼 = --brand-primary(teal) / danger = --danger, 하드코딩 제거
//   - z-index: 3000(raw) → var(--z-modal)  (App.css .modal-overlay)
const ConfirmModal = ({ title, message, confirmText, cancelText, onConfirm, onCancel, danger = false }) => {
    return (
        <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
        >
            <motion.div
                className="modal-card"
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '340px', textAlign: 'center' }}
            >
                {/* 표준 닫기 버튼 — 우상단 lucide <X> (취소와 동일 동작) */}
                <button
                    type="button"
                    className="modal-close"
                    onClick={onCancel}
                    aria-label={cancelText || 'Close'}
                >
                    <X size={20} />
                </button>

                <div style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: danger ? '#fef2f2' : 'var(--primary-light)',
                    color: danger ? 'var(--danger)' : 'var(--brand-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 14px'
                }}>
                    <AlertTriangle size={24} />
                </div>

                {title && (
                    <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>
                        {title}
                    </h3>
                )}
                <p style={{ margin: '0 0 22px', fontSize: '0.88rem', color: '#64748b', lineHeight: 1.5 }}>
                    {message}
                </p>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        className="modal-btn-secondary"
                        onClick={onCancel}
                        style={{ flex: 1 }}
                    >
                        {cancelText || 'Cancel'}
                    </button>
                    <button
                        type="button"
                        className={danger ? 'modal-btn-danger' : 'modal-btn-primary'}
                        onClick={onConfirm}
                        style={{ flex: 1 }}
                    >
                        {confirmText || 'OK'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default ConfirmModal;
