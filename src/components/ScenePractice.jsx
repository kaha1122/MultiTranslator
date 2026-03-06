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

const SUPPORTED_SCENE_LANGS = ['ko','en','ja','zh-CN','vi','fr','de','es'];

const SCENES = {
    locations: [
        { id: 'airport',    icon: '✈️',  en: 'Airport & In-flight',     ko: '공항 & 기내',        ja: '空港・機内',          'zh-CN': '机场 & 航班',    vi: 'Sân bay & Máy bay',  fr: 'Aéroport & Vol',          de: 'Flughafen & Flug',         es: 'Aeropuerto & Vuelo'   },
        { id: 'hotel',      icon: '🏨',  en: 'Hotel & Stay',            ko: '호텔 & 숙소',        ja: 'ホテル・宿泊',        'zh-CN': '酒店 & 住宿',    vi: 'Khách sạn',          fr: 'Hôtel & Hébergement',     de: 'Hotel & Unterkunft',       es: 'Hotel & Alojamiento'  },
        { id: 'restaurant', icon: '🍽️', en: 'Restaurant & Cafe',       ko: '레스토랑 & 카페',    ja: 'レストラン & カフェ', 'zh-CN': '餐厅 & 咖啡厅',  vi: 'Nhà hàng & Cafe',    fr: 'Restaurant & Café',       de: 'Restaurant & Café',        es: 'Restaurante & Café'   },
        { id: 'transport',  icon: '🚌',  en: 'Public Transport',        ko: '대중교통',           ja: '公共交通',            'zh-CN': '公共交通',       vi: 'Giao thông',         fr: 'Transport public',        de: 'Öffentl. Verkehr',         es: 'Transporte público'   },
        { id: 'shopping',   icon: '🛍️', en: 'Shopping & Market',       ko: '쇼핑몰 & 마트',      ja: 'ショッピング',        'zh-CN': '购物 & 超市',    vi: 'Mua sắm',            fr: 'Shopping & Marché',       de: 'Einkaufen',                es: 'Compras & Mercado'    },
        { id: 'hospital',   icon: '🏥',  en: 'Hospital & Pharmacy',     ko: '병원 & 약국',        ja: '病院・薬局',          'zh-CN': '医院 & 药店',    vi: 'Bệnh viện',          fr: 'Hôpital & Pharmacie',     de: 'Krankenhaus & Apotheke',   es: 'Hospital & Farmacia'  },
        { id: 'tourist',    icon: '🗺️', en: 'Tourist Spots',           ko: '관광지',             ja: '観光地',              'zh-CN': '旅游景点',       vi: 'Du lịch',            fr: 'Sites touristiques',      de: 'Sehenswürdigkeiten',       es: 'Lugares turísticos'   },
        { id: 'office',     icon: '💼',  en: 'Office & Work',           ko: '회사 & 사무실',      ja: 'オフィス・職場',      'zh-CN': '办公室 & 职场',  vi: 'Văn phòng',          fr: 'Bureau & Travail',        de: 'Büro & Arbeitsplatz',      es: 'Oficina & Trabajo'    },
        { id: 'bank',       icon: '🏦',  en: 'Bank',                    ko: '은행',               ja: '銀行',                'zh-CN': '银行',           vi: 'Ngân hàng',          fr: 'Banque',                  de: 'Bank',                     es: 'Banco'                },
        { id: 'gym',        icon: '💪',  en: 'Gym',                     ko: '피트니스 센터',      ja: 'ジム',                'zh-CN': '健身房',         vi: 'Phòng tập',          fr: 'Salle de sport',          de: 'Fitnessstudio',            es: 'Gimnasio'             },
        { id: 'custom',     icon: '✏️',  en: 'Custom',                  ko: '직접입력',           ja: '直接入力',            'zh-CN': '自定义',         vi: 'Tùy chỉnh',          fr: 'Personnalisé',            de: 'Eigene Eingabe',           es: 'Personalizado'        },
    ],
    situations: [
        { id: 'smalltalk',  icon: '💬',  en: 'Small Talk',              ko: '스몰토크',           ja: '世間話',              'zh-CN': '闲聊',           vi: 'Nói chuyện',         fr: 'Discussion',              de: 'Small Talk',               es: 'Conversación'         },
        { id: 'lost',       icon: '🆘',  en: 'Lost Item',               ko: '물건 분실 & 신고',   ja: '落とし物',            'zh-CN': '失物报告',       vi: 'Đồ thất lạc',        fr: 'Objet perdu',             de: 'Fundsachen',               es: 'Objeto perdido'       },
        { id: 'reservation',icon: '📅',  en: 'Reservation Change',      ko: '예약 변경 & 취소',   ja: '予約変更',            'zh-CN': '预约变更',       vi: 'Đặt chỗ',            fr: 'Réservation',             de: 'Reservierung',             es: 'Reserva'              },
        { id: 'disagree',   icon: '🤝',  en: 'Negotiation',             ko: '의견 차이 조율',     ja: '意見調整',            'zh-CN': '协商分歧',       vi: 'Thương lượng',       fr: 'Négociation',             de: 'Verhandlung',              es: 'Negociación'          },
        { id: 'problem',    icon: '🔧',  en: 'Problem Solving',         ko: '문제 해결 요청',     ja: '問題解決',            'zh-CN': '解决问题',       vi: 'Giải quyết vấn đề', fr: 'Résolution',              de: 'Problemlösung',            es: 'Resolución'           },
        { id: 'directions', icon: '🧭',  en: 'Asking Directions',       ko: '길 찾기 & 방향 안내', ja: '道案内',             'zh-CN': '问路 & 导航',    vi: 'Hỏi đường',          fr: 'Demander le chemin',      de: 'Wegbeschreibung',          es: 'Pedir direcciones'    },
        { id: 'intro',      icon: '🎤',  en: 'Self-introduction',       ko: '자기소개 & 비전 공유', ja: '自己紹介',           'zh-CN': '自我介绍',       vi: 'Tự giới thiệu',      fr: 'Se présenter',            de: 'Selbstvorstellung',        es: 'Presentación'         },
        { id: 'compliment', icon: '🙏',  en: 'Compliments',             ko: '칭찬 & 감사 표현',   ja: '感謝・褒め言葉',      'zh-CN': '称赞 & 感谢',    vi: 'Khen ngợi',          fr: 'Compliments',             de: 'Komplimente',              es: 'Cumplidos'            },
        { id: 'decline',    icon: '🚫',  en: 'Declining Politely',      ko: '거절하기',           ja: '断り方',              'zh-CN': '礼貌拒绝',       vi: 'Từ chối lịch sự',   fr: 'Refuser poliment',        de: 'Höflich ablehnen',         es: 'Declinar'             },
        { id: 'advice',     icon: '💡',  en: 'Asking for Advice',       ko: '조언 구하기',        ja: 'アドバイス',          'zh-CN': '寻求建议',       vi: 'Xin lời khuyên',     fr: 'Demander conseil',        de: 'Um Rat bitten',            es: 'Pedir consejo'        },
        { id: 'custom',     icon: '✏️',  en: 'Custom',                  ko: '직접입력',           ja: '直接入力',            'zh-CN': '自定义',         vi: 'Tùy chỉnh',          fr: 'Personnalisé',            de: 'Eigene Eingabe',           es: 'Personalizado'        },
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
                    <Volume2 size={20} color="#64748b" />
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
                    <Star size={20} color={isSaved ? '#f59e0b' : '#94a3b8'} fill={isSaved ? '#f59e0b' : 'none'} />
                </button>
            </div>
        </div>
    );
}

// ── 메인 ScenePractice 컴포넌트 ───────────────────────────────────────────
const ScenePractice = ({ sourceLang, targetLangs, onTrialLimitReached, onSaveToLibrary, onSpeak }) => {
    const [category, setCategory]           = useState('locations');
    const [selectedScene, setSelectedScene] = useState(null);
    const [customInput, setCustomInput]     = useState('');
    const [selectedLang, setSelectedLang]   = useState(targetLangs?.[0] || 'en');
    const [generated, setGenerated]         = useState(null);
    const [loading, setLoading]             = useState(false);
    const [error, setError]                 = useState(null);
    const [isSaved, setIsSaved]             = useState(false);

    const t = useT(sourceLang);
    const { byokGeminiKey } = useAuth();
    const SERVER_URL = getServerUrl();

    const switchCategory = (cat) => {
        setCategory(cat);
        setSelectedScene(null);
        setCustomInput('');
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

    const isCustomSelected = selectedScene?.id === 'custom';
    const canRequest = selectedScene && (!isCustomSelected || customInput.trim().length > 0);

    const handleRequest = async () => {
        if (!canRequest) return;
        setLoading(true);
        setError(null);
        setGenerated(null);
        setIsSaved(false);
        try {
            const sceneText = isCustomSelected ? customInput.trim() : selectedScene.en;
            const res = await fetch(`${SERVER_URL}/api/scene-sentence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: sceneText,
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
        setTimeout(() => {
            setGenerated(null);
            setIsSaved(false);
        }, 1200);
    };

    const currentScenes = SCENES[category];
    const sceneLabelKey = SUPPORTED_SCENE_LANGS.includes(sourceLang) ? sourceLang : 'en';

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
                        className={`scene-item ${selectedScene?.id === scene.id ? 'selected' : ''} ${scene.id === 'custom' ? 'scene-item-custom' : ''}`}
                        onClick={() => selectScene(scene)}
                    >
                        <span className="scene-icon">{scene.icon}</span>
                        <span className="scene-name">{scene[sceneLabelKey]}</span>
                    </button>
                ))}
            </div>

            {/* 언어 선택 + Request 버튼 — 탭 진입 시 항상 표시 */}
            <div className="scene-controls">
                {/* 직접입력 선택 시 텍스트 입력 */}
                {isCustomSelected && (
                    <input
                        className="scene-custom-input"
                        type="text"
                        placeholder={t('scene.customPlaceholder')}
                        value={customInput}
                        onChange={e => setCustomInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && canRequest && !loading) handleRequest(); }}
                        autoFocus
                    />
                )}

                {!selectedScene && (
                    <p className="scene-prompt-inline">{t('scene.selectScene')}</p>
                )}

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
                    disabled={loading || !canRequest}
                >
                    {loading
                        ? <RotateCcw size={18} className="spin" />
                        : t('scene.requestBtn')
                    }
                </button>
            </div>

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
