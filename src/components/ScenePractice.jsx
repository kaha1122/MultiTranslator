import { useState, useEffect, useRef } from 'react';
import { Award, Mic, MicOff, Play, RotateCcw, Star, Volume2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAuth } from '../context/AuthContext';
import { useT } from '../utils/i18n';
import PronunciationAssessment from './PronunciationAssessment';
import { playStarSound } from '../utils/soundEffects';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import './ScenePractice.css';

// Firebase sceneHistory 문서 ID 생성 (특수문자 없는 복합키)
const makeHistoryKey = (sceneId, difficulty, style, lang) =>
    `${sceneId}--${difficulty}--${style}--${lang}`;

// Custom 씬 키: 입력 텍스트를 포함해 씬별로 이력 분리 (최대 30자, 공백→_)
const makeCustomSceneId = (text) =>
    `custom-${text.trim().slice(0, 30).replace(/\s+/g, '_')}`;

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
function ScenePracticeCard({ generated, langCode, sourceLang, onTrialLimitReached, onSave, isSaved, onSpeak, t, targetGoal = 80, onBookmarkPrompt }) {
    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        startRecording, stopRecording, errorMsg,
    } = useAudioRecorder(generated.sentence, langCode, sourceLang, onTrialLimitReached);

    const playMyRecording = () => {
        if (assessmentResult?.audioUrl) {
            new Audio(assessmentResult.audioUrl).play();
        }
    };

    // 발음 점수가 목표에 도달하면 북마크 유도 팝업 표시 (저장 시 카운트)
    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal && !isSaved) {
                onBookmarkPrompt?.(score, () => onSave(score));
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="library-card-wrapper">
            <div className="scene-card">
                {/* 카드 헤더: 씬 힌트(좌) + TTS 재생버튼(우) */}
                <div className="scene-card-header">
                    <div className="scene-card-hint">
                        <span className="scene-card-hint-icon">🎬</span>
                        <p>{generated.scene_hint}</p>
                    </div>
                    <button
                        className="speak-button"
                        onClick={() => onSpeak(generated.sentence, langCode)}
                        title="Listen"
                    >
                        <Play size={22} fill="white" stroke="white" />
                    </button>
                </div>

                {/* 생성 문장 */}
                <div className="scene-card-sentence">{generated.sentence}</div>

                {/* 발음 표기 (중국어 병음 / 일본어 히라가나) — 평가 전에만 표시 */}
                {generated.pronunciation && !assessmentResult && (
                    <p className="scene-card-pronunciation">{generated.pronunciation}</p>
                )}

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

                {/* 발음 연습 녹음 버튼 (중앙 배치) */}
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
            </div>

            {/* 하단 액션바 — Library와 동일한 구조 */}
            <div className="card-action-bar">
                <div className="action-left" style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="stat-text" title="목표 점수">🎯 <strong>{targetGoal}</strong></span>
                    <span className="stat-divider">·</span>
                    <span className="stat-text" title="내 점수">⭐️ <strong>{assessmentResult?.pronunciationScore ?? '-'}</strong></span>
                    <span className="stat-divider">·</span>
                    <span className="stat-text" title="달성 여부">
                        {assessmentResult?.pronunciationScore != null && assessmentResult.pronunciationScore >= targetGoal ? '✅' : '❌'}
                    </span>
                    <span className="stat-divider">·</span>
                    <button
                        className="stat-icon-btn"
                        title={assessmentResult?.audioUrl ? '내 발음 다시 듣기' : '녹음 후 활성화됩니다'}
                        onClick={playMyRecording}
                        disabled={!assessmentResult?.audioUrl}
                        style={{ background: 'none', border: 'none', outline: 'none', cursor: assessmentResult?.audioUrl ? 'pointer' : 'default', padding: 0, display: 'flex', alignItems: 'center', opacity: assessmentResult?.audioUrl ? 1 : 0.3, color: 'var(--text-secondary)' }}
                    >
                        <Volume2 size={16} />
                    </button>
                </div>
                <div className="action-right">
                    <button
                        className={`scene-star-btn ${isSaved ? 'saved' : ''}`}
                        onClick={() => onSave(assessmentResult?.pronunciationScore ?? null)}
                        disabled={isSaved}
                        title={isSaved ? t('scene.savedToLibrary') : t('scene.saveToLibrary')}
                    >
                        <Star size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── 메인 ScenePractice 컴포넌트 ───────────────────────────────────────────
const ScenePractice = ({ sourceLang, targetLangs, onTrialLimitReached, onSaveToLibrary, onSpeak, languageGoals = {}, onBookmarkPrompt }) => {
    const [category, setCategory]           = useState('locations');
    const [selectedScene, setSelectedScene] = useState(null);
    const [customInput, setCustomInput]     = useState('');
    const [selectedLang, setSelectedLang]   = useState(targetLangs?.[0] || 'en');
    const [difficulty, setDifficulty]       = useState('intermediate');
    const [speechStyle, setSpeechStyle]     = useState('formal');
    const [generated, setGenerated]         = useState(null);
    const [generatedAnswer, setGeneratedAnswer] = useState(null);
    const [loading, setLoading]             = useState(false);
    const [loadingAnswer, setLoadingAnswer] = useState(false);
    const [error, setError]                 = useState(null);
    const [isSaved, setIsSaved]             = useState(false);
    const [isAnswerSaved, setIsAnswerSaved] = useState(false);

    const t = useT(sourceLang);
    const { byokGeminiKey, user } = useAuth();
    const SERVER_URL = getServerUrl();

    // 세션 + Firebase 중복 방지 이력 캐시 — ref로 관리 (렌더 트리거 없음, 동기 읽기 보장)
    const historyCacheRef = useRef({});

    // Firebase에서 해당 키의 이력 읽어 ref에 저장 (생성 직전 호출)
    const loadHistory = async (key) => {
        if (!user) return [];
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key]; // 캐시 히트
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/sceneHistory`, key));
            const sentences = snap.exists() ? (snap.data().sentences || []) : [];
            historyCacheRef.current = { ...historyCacheRef.current, [key]: sentences };
            return sentences;
        } catch {
            return [];
        }
    };

    // 생성 성공 후 이력에 추가 (최신 30개 유지) — state updater 밖에서 setDoc 호출
    const appendHistory = (key, sentence) => {
        const existing = historyCacheRef.current[key] || [];
        const updated = [...existing, sentence].slice(-30);
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/sceneHistory`, key), {
                sentences: updated,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    const switchCategory = (cat) => {
        setCategory(cat);
        setSelectedScene(null);
        setCustomInput('');
        setGenerated(null);
        setGeneratedAnswer(null);
        setError(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
    };

    const selectScene = (scene) => {
        setSelectedScene(scene);
        setGenerated(null);
        setGeneratedAnswer(null);
        setError(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
    };

    const isCustomSelected = selectedScene?.id === 'custom';
    const canRequest = selectedScene && (!isCustomSelected || customInput.trim().length > 0);

    const handleRequest = async () => {
        if (!canRequest) return;
        setLoading(true);
        setError(null);
        setGenerated(null);
        setGeneratedAnswer(null);
        setIsSaved(false);
        setIsAnswerSaved(false);
        try {
            // Custom 씬은 입력 텍스트를 키에 포함 → 씬별 이력 분리
            const sceneId = isCustomSelected ? makeCustomSceneId(customInput) : selectedScene.id;
            const sceneText = isCustomSelected ? customInput.trim() : selectedScene.en;
            const historyKey = makeHistoryKey(sceneId, difficulty, speechStyle, selectedLang);
            const avoidSentences = await loadHistory(historyKey);

            const fetchSentence = () => fetch(`${SERVER_URL}/api/scene-sentence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: sceneText,
                    category,
                    targetLang: selectedLang,
                    sourceLang,
                    difficulty,
                    speechStyle,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidSentences: avoidSentences.length > 0 ? avoidSentences : undefined,
                }),
            });

            let res = await fetchSentence();
            if (!res.ok) throw new Error('Server error');
            let data = await res.json();

            // LLM이 avoid 지시를 무시하고 중복 생성한 경우 1회 재시도
            if (data.sentence && avoidSentences.includes(data.sentence)) {
                const res2 = await fetchSentence();
                if (res2.ok) data = await res2.json();
            }

            setGenerated(data);
            if (data.sentence) appendHistory(historyKey, data.sentence);
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoading(false);
        }
    };

    const handleAnswerRequest = async () => {
        if (!generated) return;
        setLoadingAnswer(true);
        setError(null);
        setGeneratedAnswer(null);
        setIsAnswerSaved(false);
        try {
            const sceneId = isCustomSelected ? makeCustomSceneId(customInput) : selectedScene.id;
            const sceneText = isCustomSelected ? customInput.trim() : selectedScene.en;
            // 답변은 별도 키 (scene--difficulty--style--lang--answer)
            const historyKey = makeHistoryKey(`${sceneId}-answer`, difficulty, speechStyle, selectedLang);
            const avoidSentences = await loadHistory(historyKey);

            const fetchAnswer = () => fetch(`${SERVER_URL}/api/scene-answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: generated.sentence,
                    scene: sceneText,
                    targetLang: selectedLang,
                    sourceLang,
                    difficulty,
                    speechStyle,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidSentences: avoidSentences.length > 0 ? avoidSentences : undefined,
                }),
            });

            let res = await fetchAnswer();
            if (!res.ok) throw new Error('Server error');
            let data = await res.json();

            // LLM이 avoid 지시를 무시하고 중복 생성한 경우 1회 재시도
            if (data.sentence && avoidSentences.includes(data.sentence)) {
                const res2 = await fetchAnswer();
                if (res2.ok) data = await res2.json();
            }

            setGeneratedAnswer(data);
            if (data.sentence) appendHistory(historyKey, data.sentence);
        } catch (e) {
            setError(t('scene.loadError'));
        } finally {
            setLoadingAnswer(false);
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
        setTimeout(() => setIsSaved(false), 1200);
    };

    const handleAnswerSave = async (pronunciationScore = null) => {
        if (!generatedAnswer || !selectedScene) return;
        await onSaveToLibrary({
            sentence:          generatedAnswer.sentence,
            translation:       generatedAnswer.translation,
            langCode:          selectedLang,
            scene:             selectedScene.id,
            sceneHint:         generatedAnswer.scene_hint,
            learningTip:       generatedAnswer.learning_tip,
            pronunciationScore,
        });
        playStarSound();
        setIsAnswerSaved(true);
        setTimeout(() => setIsAnswerSaved(false), 1200);
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

            {/* 난이도 + 말투 선택 */}
            <div className="scene-options">
                <div className="scene-option-row">
                    <span className="scene-option-label">{t('scene.diffTitle')}</span>
                    <div className="scene-option-pills">
                        {['basic', 'intermediate', 'high'].map(d => (
                            <button
                                key={d}
                                className={`scene-option-pill ${difficulty === d ? 'active' : ''}`}
                                onClick={() => setDifficulty(d)}
                            >
                                {t(`scene.diff${d.charAt(0).toUpperCase() + d.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="scene-option-row">
                    <span className="scene-option-label">{t('scene.styleTitle')}</span>
                    <div className="scene-option-pills">
                        {['casual', 'formal'].map(s => (
                            <button
                                key={s}
                                className={`scene-option-pill ${speechStyle === s ? 'active' : ''}`}
                                onClick={() => setSpeechStyle(s)}
                            >
                                {t(`scene.style${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                            </button>
                        ))}
                    </div>
                </div>
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
                <div className="scene-request-btns">
                    <button
                        className="scene-request-btn"
                        onClick={handleRequest}
                        disabled={loading || loadingAnswer || !canRequest}
                    >
                        {loading
                            ? <RotateCcw size={18} className="spin" />
                            : t('scene.questionBtn')
                        }
                    </button>
                    <button
                        className="scene-answer-btn"
                        onClick={handleAnswerRequest}
                        disabled={loadingAnswer || loading || !generated || !!generatedAnswer}
                    >
                        {loadingAnswer
                            ? <RotateCcw size={18} className="spin" />
                            : t('scene.answerBtn')
                        }
                    </button>
                </div>
            </div>

            {/* 에러 */}
            {error && <p className="scene-error">{error}</p>}

            {/* 질문 카드 */}
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
                    targetGoal={languageGoals[selectedLang] || 80}
                    onBookmarkPrompt={onBookmarkPrompt}
                />
            )}

            {/* 답변 카드 */}
            {generatedAnswer && (
                <ScenePracticeCard
                    generated={generatedAnswer}
                    langCode={selectedLang}
                    sourceLang={sourceLang}
                    onTrialLimitReached={onTrialLimitReached}
                    onSave={handleAnswerSave}
                    isSaved={isAnswerSaved}
                    onSpeak={onSpeak}
                    t={t}
                    targetGoal={languageGoals[selectedLang] || 80}
                    onBookmarkPrompt={onBookmarkPrompt}
                />
            )}
        </div>
    );
};

export default ScenePractice;
