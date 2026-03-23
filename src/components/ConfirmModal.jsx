import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

const ConfirmModal = ({ title, message, confirmText, cancelText, onConfirm, onCancel, danger = false }) => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center',
                zIndex: 3000,
                padding: '20px 20px calc(20px + var(--admob-bottom, 0px))'
            }}
        >
            <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'white', borderRadius: '20px', padding: '28px 24px',
                    width: '100%', maxWidth: '340px', textAlign: 'center',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
                }}
            >
                <div style={{
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: danger ? '#fef2f2' : '#f0fdf4',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 14px'
                }}>
                    <AlertTriangle size={24} color={danger ? '#dc2626' : '#16a34a'} />
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
                        onClick={onCancel}
                        style={{
                            flex: 1, padding: '12px', borderRadius: '12px', border: '1.5px solid #e2e8f0',
                            background: 'white', color: '#64748b', fontSize: '0.88rem', fontWeight: 700,
                            cursor: 'pointer'
                        }}
                    >
                        {cancelText || 'Cancel'}
                    </button>
                    <button
                        onClick={onConfirm}
                        style={{
                            flex: 1, padding: '12px', borderRadius: '12px', border: 'none',
                            background: danger ? '#dc2626' : '#00a884', color: 'white',
                            fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer'
                        }}
                    >
                        {confirmText || 'OK'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default ConfirmModal;
