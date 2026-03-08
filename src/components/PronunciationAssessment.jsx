import { useState } from 'react';
import { useT } from '../utils/i18n';
import './PronunciationAssessment.css';

// 🎤 발음 평가 결과를 시각적으로 매력적이게 보여주는 전담 컴포넌트입니다.
// 이 컴포넌트는 Azure Speech API가 반환한 상세한 5가지 데이터를 해석하여
// 사용자에게 3가지 영역(게이지, 단어 신호등, 음소 현미경)으로 보여줍니다.
const PronunciationAssessment = ({ data, sourceLangCode }) => {
    const [selectedWord, setSelectedWord] = useState(null);
    const t = useT(sourceLangCode);

    if (!data) return null;

    // Azure 필드 매핑:
    // pronunciationScore = Azure 종합(Overall) 점수 → 배지(XPt)에 사용
    // accuracyScore      = 개별 발음 정확도 점수   → 정확도 게이지에 사용
    // fluencyScore       = 유창성 점수
    // prosodyScore       = 운율감 점수 (미지원 언어는 서버에서 추정값 제공)
    const { pronunciationScore = 0, accuracyScore = 0, fluencyScore = 0, prosodyScore = 0, words = [] } = data;

    const getScoreColor = (score) => {
        if (score >= 80) return '#10b981';
        if (score >= 60) return '#f59e0b';
        return '#ef4444';
    };

    const getErrorBadge = (errorType) => {
        if (!errorType || errorType === 'None') return null;

        let displayError = errorType;
        if (errorType === 'Omission') displayError = t('scores.errOmission');
        if (errorType === 'Insertion') displayError = t('scores.errInsertion');
        if (errorType === 'Mispronunciation') displayError = t('scores.errMispronunciation');

        return <span className="error-badge">{displayError}</span>;
    };

    return (
        <div className="pronunciation-assessment-container">
            {/* 🏆 영역 A: 종합 점수 대시보드 */}
            <div className="score-dashboard">
                <div className="score-card">
                    <div className="score-circle" style={{ '--score': accuracyScore, '--color': getScoreColor(accuracyScore) }}>
                        <span>{accuracyScore}</span>
                    </div>
                    <span className="score-label">{t('scores.accuracy')}</span>
                </div>
                <div className="score-card">
                    <div className="score-circle" style={{ '--score': fluencyScore, '--color': getScoreColor(fluencyScore) }}>
                        <span>{fluencyScore}</span>
                    </div>
                    <span className="score-label">{t('scores.fluency')}</span>
                </div>
                <div className="score-card">
                    <div className="score-circle" style={{ '--score': prosodyScore, '--color': getScoreColor(prosodyScore) }}>
                        <span>{prosodyScore}</span>
                    </div>
                    <span className="score-label">{t('scores.prosody')}</span>
                </div>
            </div>

            {/* 내 목소리 다시 듣기 버튼 */}
            {data.audioUrl && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
                    <button
                        onClick={() => {
                            const audio = new Audio(data.audioUrl);
                            audio.play();
                        }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            background: '#f8fafc', border: '1px solid #e2e8f0',
                            padding: '8px 16px', borderRadius: '24px',
                            color: '#475569', fontSize: '0.85rem', fontWeight: 'bold',
                            cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                        }}
                    >
                        {t('scores.listenMyVoice')}
                    </button>
                </div>
            )}

            {/* 🚥 영역 B: 단어별 신호등 */}
            <div className="words-traffic-light">
                {words.map((w, idx) => (
                    <div
                        key={idx}
                        className={`word-item ${w.accuracyScore >= 80 ? 'good' : w.accuracyScore >= 60 ? 'average' : 'poor'}`}
                        onClick={() => setSelectedWord(selectedWord === w ? null : w)}
                    >
                        {getErrorBadge(w.errorType)}
                        <span className="word-text">{w.word}</span>
                    </div>
                ))}
            </div>

            {/* 🔍 영역 C: 발음 현미경 (음소 단위 팝업) */}
            {selectedWord && (
                <div className="phoneme-microscope">
                    <div className="phoneme-header">
                        <h4>🔍 "{selectedWord.word}" {t('scores.anatomy')}</h4>
                        <button className="close-btn" onClick={() => setSelectedWord(null)}>×</button>
                    </div>
                    <div className="phoneme-list">
                        {selectedWord.phonemes && selectedWord.phonemes.length > 0 ? (
                            selectedWord.phonemes.map((p, i) => (
                                <div key={i} className="phoneme-item">
                                    <span className="phoneme-symbol">/{p.phoneme || p.symbol}/</span>
                                    <div className="phoneme-score-bar">
                                        <div
                                            className="phoneme-fill"
                                            style={{
                                                width: `${p.accuracyScore}%`,
                                                backgroundColor: getScoreColor(p.accuracyScore)
                                            }}
                                        ></div>
                                    </div>
                                    <span className="phoneme-score-text">{p.accuracyScore}</span>
                                </div>
                            ))
                        ) : (
                            <p className="no-phoneme-data">{t('scores.noPhonemeData')}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PronunciationAssessment;
