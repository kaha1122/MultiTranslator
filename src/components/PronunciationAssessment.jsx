import React, { useState } from 'react';
import './PronunciationAssessment.css';

// 🎤 발음 평가 결과를 시각적으로 매력적이게 보여주는 전담 컴포넌트입니다.
// 이 컴포넌트는 Azure Speech API가 반환한 상세한 5가지 데이터를 해석하여
// 사용자에게 3가지 영역(게이지, 단어 신호등, 음소 현미경)으로 보여줍니다.
const PronunciationAssessment = ({ data, sourceLangCode }) => {
    // 사용자가 탭한 특정 단어의 데이터를 저장하여 음소 팝업에 보여주기 위한 상태입니다.
    const [selectedWord, setSelectedWord] = useState(null);

    // 평가 데이터가 없으면 아무것도 그리지 않습니다.
    if (!data) return null;

    // 데이터가 약간 누락되어도 앱이 죽지 않도록 기본값(0, 빈 배열)을 설정해 줍니다.
    const { pronunciationScore = 0, fluencyScore = 0, prosodyScore = 0, words = [] } = data;

    // 번역 딕셔너리: 출발 언어에 따라 UI 글자를 동적으로 바꿉니다.
    const labels = {
        ko: { accuracy: "🎯 정확도", fluency: "🌊 유창성", prosody: "🎭 운율감", listen: "🎧 내 목소리 다시 듣기", anatomy: "발음 해부도", noData: "이 단어는 세부 음소 데이터가 없습니다.", errOmission: "생략됨", errInsertion: "추가됨", errMispronunciation: "오발음" },
        en: { accuracy: "🎯 Accuracy", fluency: "🌊 Fluency", prosody: "🎭 Prosody", listen: "🎧 Listen to My Voice", anatomy: "Phoneme Anatomy", noData: "No detailed phoneme data for this word.", errOmission: "Omitted", errInsertion: "Inserted", errMispronunciation: "Mispronounced" },
        ja: { accuracy: "🎯 正確さ", fluency: "🌊 流暢さ", prosody: "🎭 抑揚", listen: "🎧 自分の声を聞く", anatomy: "発音の解剖図", noData: "この単語の詳細な音素データはありません。", errOmission: "省略", errInsertion: "追加", errMispronunciation: "誤発音" },
        zh: { accuracy: "🎯 准确度", fluency: "🌊 流利度", prosody: "🎭 韵律感", listen: "🎧 听我的声音", anatomy: "发音剖析图", noData: "该单词没有详细的音素数据。", errOmission: "省略", errInsertion: "多余", errMispronunciation: "发音错误" },
    };

    // zh-CN, zh-TW 등 파생 언어 코드를 위한 안전한 매핑 (기본값 ko)
    const lang = sourceLangCode?.split('-')[0] || 'ko';
    const t = labels[lang] || labels['ko'];

    // 점수에 따라 색상을 결정하는 함수 (80이상 초록, 60이상 주황, 이하 부드러운 빨강)
    const getScoreColor = (score) => {
        if (score >= 80) return '#10b981'; // 🟢 통과!
        if (score >= 60) return '#f59e0b'; // 🟠 조금 아쉬움
        return '#ef4444'; // 🔴 연습 필요 
    };

    // 에러 타입이 있을 경우 단어 위에 붙이는 '꼬리표(Badge)'를 만들어주는 함수
    const getErrorBadge = (errorType) => {
        if (!errorType || errorType === 'None') return null;

        // 에러 종류를 출발 언어에 맞게 번역해 줍니다.
        let displayError = errorType;
        if (errorType === 'Omission') displayError = t.errOmission;
        if (errorType === 'Insertion') displayError = t.errInsertion;
        if (errorType === 'Mispronunciation') displayError = t.errMispronunciation;

        return <span className="error-badge">{displayError}</span>;
    };

    return (
        <div className="pronunciation-assessment-container">
            {/* 🏆 영역 A: "오늘의 성적표" (종합 점수 대시보드) */}
            <div className="score-dashboard">
                <div className="score-card">
                    {/* CSS의 conic-gradient 기능을 활용하기 위해 CSS 변수(--score, --color)를 넘겨줍니다. */}
                    <div className="score-circle" style={{ '--score': pronunciationScore, '--color': getScoreColor(pronunciationScore) }}>
                        <span>{pronunciationScore}</span>
                    </div>
                    <span className="score-label">{t.accuracy}</span>
                </div>
                <div className="score-card">
                    <div className="score-circle" style={{ '--score': fluencyScore, '--color': getScoreColor(fluencyScore) }}>
                        <span>{fluencyScore}</span>
                    </div>
                    <span className="score-label">{t.fluency}</span>
                </div>
                <div className="score-card">
                    <div className="score-circle" style={{ '--score': prosodyScore, '--color': getScoreColor(prosodyScore) }}>
                        <span>{prosodyScore}</span>
                    </div>
                    <span className="score-label">{t.prosody}</span>
                </div>
            </div>

            {/* 내 목소리 다시 듣기 버튼 (업로드된 오디오가 있을 때만 표시) */}
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
                        {t.listen}
                    </button>
                </div>
            )}

            {/* 🚥 영역 B: "단어별 신호등" (문장 정밀 분석) */}
            <div className="words-traffic-light">
                {words.map((w, idx) => (
                    <div
                        key={idx}
                        // 점수에 따라 클래스를 분기하여 CSS에서 글자 아래 밑줄 색상을 바꿉니다.
                        className={`word-item ${w.accuracyScore >= 80 ? 'good' : w.accuracyScore >= 60 ? 'average' : 'poor'}`}
                        // 같은 단어를 또 누르면 팝업이 닫히도록 토글(Toggle) 로직을 넣었습니다.
                        onClick={() => setSelectedWord(selectedWord === w ? null : w)}
                    >
                        {getErrorBadge(w.errorType)}
                        <span className="word-text">{w.word}</span>
                    </div>
                ))}
            </div>

            {/* 🔍 영역 C: "발음 현미경" (음소 단위 상세 분석 팝업) */}
            {selectedWord && (
                <div className="phoneme-microscope">
                    <div className="phoneme-header">
                        <h4>🔍 "{selectedWord.word}" {t.anatomy}</h4>
                        <button className="close-btn" onClick={() => setSelectedWord(null)}>×</button>
                    </div>
                    <div className="phoneme-list">
                        {/* 음소 데이터가 있는지 확인하고, 있으면 리스트로 그려줍니다. */}
                        {selectedWord.phonemes && selectedWord.phonemes.length > 0 ? (
                            selectedWord.phonemes.map((p, i) => (
                                <div key={i} className="phoneme-item">
                                    <span className="phoneme-symbol">/{p.phoneme || p.symbol}/</span>
                                    {/* 점수에 비례하여 게이지 막대가 차오르게 inline style로 width를 설정합니다. */}
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
                            <p className="no-phoneme-data">{t.noData}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PronunciationAssessment;
