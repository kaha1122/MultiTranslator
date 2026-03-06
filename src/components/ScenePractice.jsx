import { useState } from 'react';
import { Award, Mic, MicOff, RotateCcw, Star, Volume2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import PronunciationAssessment from './PronunciationAssessment';
import { playStarSound } from '../utils/soundEffects';
import './ScenePractice.css';

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) {}
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const SCENES = {
    locations: [
        { id: 'airport',    icon: '✈️',  en: 'Airport & In-flight',        ko: '공항 & 기내' },
        { id: 'hotel',      icon: '🏨',  en: 'Hotel & Accommodation',       ko: '호텔 & 숙소' },
        { id: 'restaurant', icon: '🍽️', en: 'Restaurant & Cafe',            ko: '레스토랑 & 카페' },
        { id: 'transport',  icon: '🚌',  en: 'Public Transport',            ko: '대중교통' },
        { id: 'shopping',   icon: '🛍️', en: 'Shopping Mall & Grocery',      ko: '쇼핑몰 & 마트' },
        { id: 'hospital',   icon: '🏥',  en: 'Hospital & Pharmacy',         ko: '병원 & 약국' },
        { id: 'tourist',    icon: '🗺️', en: 'Tourist Attractions',          ko: '관광지' },
        { id: 'office',     icon: '💼',  en: 'Office & Workplace',          ko: '회사 & 사무실' },
        { id: 'bank',       icon: '🏦',  en: 'Bank',                        ko: '은행' },
        { id: 'gym',        icon: '💪',  en: 'Gym',                         ko: '피트니스 센터' },
    ],
    situations: [
        { id: 'smalltalk',  icon: '💬',  en: 'Small Talk',                  ko: '스몰토크' },
        { id: 'lost',       icon: '🆘',  en: 'Lost Item Report',            ko: '물건 분실 & 신고' },
        { id: 'reservation',icon: '📅',  en: 'Reservation Change & Cancel', ko: '예약 변경 & 취소' },
        { id: 'disagree',   icon: '🤝',  en: 'Negotiating Disagreements',   ko: '의견 차이 조율' },
        { id: 'problem',    icon: '🔧',  en: 'Problem Resolution',          ko: '문제 해결 요청' },
        { id: 'directions', icon: '🧭',  en: 'Asking Directions',           ko: '길 찾기 & 방향 안내' },
        { id: 'intro',      icon: '🎤',  en: 'Self-introduction & Vision',  ko: '자기소개 & 비전 공유' },
        { id: 'compliment', icon: '🙏',  en: 'Compliments & Gratitude',     ko: '칭찬 & 감사 표현' },
        { id: 'decline',    icon: '🚫',  en: 'Declining Politely',          ko: '거절하기' },
        { id: 'advice',     icon: '💡',  en: 'Asking for Advice',           ko: '조언 구하기' },
    ],
};

const LANG_NAMES = {
    ko: '한국어', en: 'English', ja: '日本語', 'zh-CN': '中文',
    vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español',
};

// ── 생성된 카드 + 발음 연습 ─────────────────────────────────────────────────
function ScenePracticeCard({ generated, langCode, sourceLang, onTrialLimitReached, onSave, isSaved, onSpeak, t }) {
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(generated.sentence, langCode, sourceLang, onTrialLimitReached);

    return (
        <div className="scene-card">
            {/* 씬 힌트 */}
            <div className="scene-card-hint">
                <span className="scene-card-hint-icon">🎬</span>
                <p>{generated.scene_hint}</p>
            </div>

            {/* 생성 문장 */}
            <div className="scene-card-sentence">{generated.sentence}</div>

            {/* 번역 */}
            <div className="scene-card-translation">{generated.translation}</div>

            {/* 학습 팁 */}
            {generated.learning_tip && (
                <div className="scene-card-tip">
                    <span>💡</span>
                    <p>{generated.learning_tip}</p>
                </div>
            )}

            {/* 발음 평가 결과 */}
            {assessmentResult && (
                <>
                    <div className="score-badge">
                        <Award size={12} /> {assessmentResult.pronunciationScore}Pt
                    </div>
                    <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} />
                </>
            )}

            {/* AI 코치 팁 */}
            {coachTip && (
                <div className="scene-coach-tip">
                    <span>🤖</span>
                    <p>{coachTip}</p>
                </div>
            )}

            {/* 에러 메시지 */}
            {errorMsg && <p className="scene-error-msg">{errorMsg}</p>}

            {/* 액션 버튼 */}
            <div className="scene-card-actions">
                <button
                    className="scene-tts-btn"
                    onClick={() => onSpeak(generated.sentence, langCode)}
                    title="Listen"
                >
                    <Volume2 size={20} />
                </button>

                <div className="scene-record-wrap">
                    {isRecording && <p className="scene-recording-status">{t('card.recording')}</p>}
                    {isAnalyzing && <p className="scene-analyzing-status">{t('card.analyzing')}</p>}
                    <button
                        className={`record-button circle ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
                        onClick={() => isRecording ? stopRecording() : startRecording()}
                        disabled={isAnalyzing}
                        title="Practice pronunciation"
                    >
                        {isAnalyzing
                            ? <RotateCcw size={20} className="spin" />
                            : isRecording
                                ? <MicOff size={20} />
                                : <Mic size={20} />
                        }
                    </button>
                </div>

                <button
                    className={`scene-star-btn ${isSaved ? 'saved' : ''}`}
                    onClick={() => onSave(assessmentResult?.pronunciationScore ?? null)}
                    disabled={isSaved}
                    title={isSaved ? t('scene.savedToLibrary') : t('scene.saveToLibrary')}
                >
                    <Star size={20} fill={isSaved ? 'currentColor' : 'none'} />
                </button>
            </div>
        </div>
    );
}

// ── 메인 ScenePractice 컴포넌트 ───────────────────────────────────────────
const ScenePractice = ({ sourceLang, targetLangs, onTrialLimitReached, onSaveToLibrary, onSpeak }) => {
    const [category, setCategory]       = useState('locations');
    const [selectedScene, setSelectedScene] = useState(null);
    const [selectedLang, setSelectedLang]   = useState(targetLangs?.[0] || 'en');
    const [generated, setGenerated]     = useState(null);
    const [loading, setLoading]         = useState(false);
    const [error, setError]             = useState(null);
    const [isSaved, setIsSaved]         = useState(false);

    const t = useT(sourceLang);
    const { byokGeminiKey } = useAuth();
    const SERVER_URL = getServerUrl();

    const switchCategory = (cat) => {
        setCategory(cat);
        setSelectedScene(null);
        setGenerated(null);
        setError(null);
        setIsSaved(false);
    };

    const selectScene = (scene) => {
        setSelectedScene(scene);
        setGenerated(null);
        setError(null);
        setIsSaved(false);
    };

    const handleRequest = async () => {
        if (!selectedScene) return;
        setLoading(true);
        setError(null);
        setGenerated(null);
        setIsSaved(false);
        try {
            const res = await fetch(`${SERVER_URL}/api/scene-sentence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: selectedScene.en,
                    category,
                    targetLang: selectedLang,
                    sourceLang,
                    byokGeminiKey: byokGeminiKey || undefined,
                }),
            });
            if (!res.ok) throw new Error('Server error');
            const data = await res.json();
            setGenerated(data);
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (pronunciationScore = null) => {
        if (!generated || !selectedScene) return;
        await onSaveToLibrary({
            sentence:          generated.sentence,
            translation:       generated.translation,
            langCode:          selectedLang,
            scene:             selectedScene.id,
            sceneHint:         generated.scene_hint,
            learningTip:       generated.learning_tip,
            pronunciationScore,
        });
        playStarSound();
        setIsSaved(true);
    };

    const currentScenes = SCENES[category];
    const sceneLabelKey = sourceLang === 'ko' ? 'ko' : 'en';

    return (
        <div className="scene-root">
            {/* 카테고리 토글 */}
            <div className="scene-category-toggle">
                <button
                    className={category === 'locations' ? 'active' : ''}
                    onClick={() => switchCategory('locations')}
                >
                    📍 {t('scene.locations')}
                </button>
                <button
                    className={category === 'situations' ? 'active' : ''}
                    onClick={() => switchCategory('situations')}
                >
                    🎭 {t('scene.situations')}
                </button>
            </div>

            {/* 씬 그리드 */}
            <div className="scene-grid">
                {currentScenes.map(scene => (
                    <button
                        key={scene.id}
                        className={`scene-item ${selectedScene?.id === scene.id ? 'selected' : ''}`}
                        onClick={() => selectScene(scene)}
                    >
                        <span className="scene-icon">{scene.icon}</span>
                        <span className="scene-name">{scene[sceneLabelKey]}</span>
                    </button>
                ))}
            </div>

            {/* 언어 선택 + Request 버튼 */}
            {selectedScene && (
                <div className="scene-controls">
                    <div className="scene-lang-pills">
                        {(targetLangs || []).map(code => (
                            <button
                                key={code}
                                className={`scene-lang-pill ${selectedLang === code ? 'active' : ''}`}
                                onClick={() => {
                                    setSelectedLang(code);
                                    setGenerated(null);
                                    setIsSaved(false);
                                }}
                            >
                                {LANG_NAMES[code] || code}
                            </button>
                        ))}
                    </div>
                    <button
                        className="scene-request-btn"
                        onClick={handleRequest}
                        disabled={loading}
                    >
                        {loading
                            ? <RotateCcw size={18} className="spin" />
                            : t('scene.requestBtn')
                        }
                    </button>
                </div>
            )}

            {/* 안내 (씬 미선택) */}
            {!selectedScene && (
                <p className="scene-prompt">{t('scene.selectScene')}</p>
            )}

            {/* 에러 */}
            {error && <p className="scene-error">{error}</p>}

            {/* 생성된 카드 */}
            {generated && (
                <ScenePracticeCard
                    generated={generated}
                    langCode={selectedLang}
                    sourceLang={sourceLang}
                    onTrialLimitReached={onTrialLimitReached}
                    onSave={handleSave}
                    isSaved={isSaved}
                    onSpeak={onSpeak}
                    t={t}
                />
            )}
        </div>
    );
};

export default ScenePractice;
