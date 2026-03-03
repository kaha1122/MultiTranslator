import { useState } from 'react';
import { useT } from '../utils/i18n';
import { useAuth } from '../context/AuthContext';
import { X, CheckCircle, AlertCircle, Loader } from 'lucide-react';

const ApiKeySetupWizard = ({ sourceLang, onClose, onComplete }) => {
    const t = useT(sourceLang);
    const { saveByokKeys, byokGeminiKey, byokAzureKey, byokAzureRegion } = useAuth();

    const [geminiKey, setGeminiKey]   = useState(byokGeminiKey  || '');
    const [azureKey, setAzureKey]     = useState(byokAzureKey   || '');
    const [azureRegion, setAzureRegion] = useState(byokAzureRegion || 'eastasia');
    const [geminiStatus, setGeminiStatus] = useState(null); // null | 'testing' | 'ok' | 'fail'
    const [azureStatus,  setAzureStatus]  = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    // Gemini 연결 테스트
    const testGemini = async () => {
        if (!geminiKey.trim()) return;
        setGeminiStatus('testing');
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey.trim()}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] })
                }
            );
            setGeminiStatus(resp.ok ? 'ok' : 'fail');
        } catch {
            setGeminiStatus('fail');
        }
    };

    // Azure 연결 테스트 (토큰 발급 endpoint로 키 유효성 확인)
    const testAzure = async () => {
        if (!azureKey.trim() || !azureRegion.trim()) return;
        setAzureStatus('testing');
        try {
            const resp = await fetch(
                `https://${azureRegion.trim()}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
                { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': azureKey.trim() } }
            );
            setAzureStatus(resp.ok ? 'ok' : 'fail');
        } catch {
            setAzureStatus('fail');
        }
    };

    const handleComplete = async () => {
        if (!geminiKey.trim() || !azureKey.trim() || !azureRegion.trim()) return;
        setIsSaving(true);
        await saveByokKeys(geminiKey.trim(), azureKey.trim(), azureRegion.trim());
        setIsSaving(false);
        onComplete?.();
        onClose();
    };

    const StatusIcon = ({ status }) => {
        if (status === 'testing') return <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />;
        if (status === 'ok')      return <CheckCircle size={16} color="#059669" />;
        if (status === 'fail')    return <AlertCircle size={16} color="#ef4444" />;
        return null;
    };

    const statusText = (status) => {
        if (status === 'ok')   return t('apiSetup.testSuccess');
        if (status === 'fail') return t('apiSetup.testFail');
        return null;
    };

    const inputStyle = {
        width: '100%', padding: '12px 14px', borderRadius: '10px',
        border: '1.5px solid #e2e8f0', fontSize: '0.9rem', outline: 'none',
        boxSizing: 'border-box', fontFamily: 'monospace'
    };
    const sectionStyle = {
        background: '#f8fafc', borderRadius: '14px', padding: '16px', marginBottom: '14px'
    };

    return (
        <div
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center',
                alignItems: 'center', zIndex: 2100, padding: '20px'
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'white', borderRadius: '24px', padding: '28px 24px',
                    width: '100%', maxWidth: '420px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
                    position: 'relative', maxHeight: '90vh', overflowY: 'auto'
                }}
            >
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}
                >
                    <X size={22} />
                </button>

                <h2 style={{ margin: '0 0 20px', fontSize: '1.2rem', color: '#1e293b', fontWeight: '800', textAlign: 'center' }}>
                    🔑 {t('apiSetup.title')}
                </h2>

                {/* Step 1: Gemini */}
                <div style={sectionStyle}>
                    <p style={{ margin: '0 0 4px', fontWeight: '700', color: '#1e293b', fontSize: '0.95rem' }}>
                        {t('apiSetup.step1Title')}
                    </p>
                    <p style={{ margin: '0 0 10px', color: '#64748b', fontSize: '0.8rem' }}>
                        {t('apiSetup.step1Desc')}
                    </p>
                    <input
                        type="password"
                        value={geminiKey}
                        onChange={e => { setGeminiKey(e.target.value); setGeminiStatus(null); }}
                        placeholder={t('apiSetup.inputPlaceholder')}
                        style={inputStyle}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                        <button
                            onClick={testGemini}
                            disabled={!geminiKey.trim() || geminiStatus === 'testing'}
                            style={{
                                padding: '8px 16px', background: geminiStatus === 'ok' ? '#059669' : '#6366f1',
                                color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold',
                                cursor: 'pointer', fontSize: '0.85rem', opacity: !geminiKey.trim() ? 0.5 : 1
                            }}
                        >
                            {t('apiSetup.testBtn')}
                        </button>
                        <StatusIcon status={geminiStatus} />
                        {statusText(geminiStatus) && (
                            <span style={{ fontSize: '0.8rem', color: geminiStatus === 'ok' ? '#059669' : '#ef4444' }}>
                                {statusText(geminiStatus)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Step 2: Azure */}
                <div style={sectionStyle}>
                    <p style={{ margin: '0 0 4px', fontWeight: '700', color: '#1e293b', fontSize: '0.95rem' }}>
                        {t('apiSetup.step2Title')}
                    </p>
                    <p style={{ margin: '0 0 10px', color: '#64748b', fontSize: '0.8rem' }}>
                        {t('apiSetup.step2Desc')}
                    </p>
                    <p style={{ margin: '0 0 10px', color: '#f59e0b', fontSize: '0.78rem', fontWeight: '600' }}>
                        💡 {t('apiSetup.step2AltTip')}
                    </p>
                    <input
                        type="password"
                        value={azureKey}
                        onChange={e => { setAzureKey(e.target.value); setAzureStatus(null); }}
                        placeholder={t('apiSetup.inputPlaceholder')}
                        style={{ ...inputStyle, marginBottom: '8px' }}
                    />
                    <input
                        type="text"
                        value={azureRegion}
                        onChange={e => { setAzureRegion(e.target.value); setAzureStatus(null); }}
                        placeholder={t('apiSetup.regionPlaceholder')}
                        style={inputStyle}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                        <button
                            onClick={testAzure}
                            disabled={!azureKey.trim() || !azureRegion.trim() || azureStatus === 'testing'}
                            style={{
                                padding: '8px 16px', background: azureStatus === 'ok' ? '#059669' : '#6366f1',
                                color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold',
                                cursor: 'pointer', fontSize: '0.85rem', opacity: (!azureKey.trim() || !azureRegion.trim()) ? 0.5 : 1
                            }}
                        >
                            {t('apiSetup.testBtn')}
                        </button>
                        <StatusIcon status={azureStatus} />
                        {statusText(azureStatus) && (
                            <span style={{ fontSize: '0.8rem', color: azureStatus === 'ok' ? '#059669' : '#ef4444' }}>
                                {statusText(azureStatus)}
                            </span>
                        )}
                    </div>
                </div>

                {/* 완료 버튼 */}
                <button
                    onClick={handleComplete}
                    disabled={!geminiKey.trim() || !azureKey.trim() || !azureRegion.trim() || isSaving}
                    style={{
                        width: '100%', padding: '14px', background: '#059669', color: 'white',
                        border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer',
                        fontSize: '1rem', opacity: (!geminiKey.trim() || !azureKey.trim() || !azureRegion.trim()) ? 0.5 : 1
                    }}
                >
                    {isSaving ? '...' : t('apiSetup.completeBtn')}
                </button>
            </div>
        </div>
    );
};

export default ApiKeySetupWizard;
