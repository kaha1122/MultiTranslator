import { useState, useEffect, useRef } from 'react';
import { Sparkles, Volume2, Star, RefreshCw, Mic, MicOff, RotateCcw, Award, AlertCircle, CheckCircle, Pencil, BookOpen, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import CategorySlider from './CategorySlider';
import TopicPickerModal from './TopicPickerModal';
import { playStarSound, playSuccessSound, playAlertSound } from '../utils/soundEffects';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import PronunciationAssessment from './PronunciationAssessment';
import { authFetch } from '../utils/authFetch';
import { getLangName } from '../config/languages';
import './VocabTab.css';

// Vocab history 문서 ID: {topicId}--{level}--{lang}
const makeVocabHistoryKey = (topicId, level, lang) =>
    `${topicId}--${level}--${lang}`;

const SEED_PAGE = 5; // seed 페이지 크기(서버와 일치)

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

// ── VocabWordCard 서브 컴포넌트 ─────────────────────────────────────
// 각 단어별 독립적인 useAudioRecorder + 발음 연습 + Learning Tip
export function VocabWordCard({
    w, index, selectedLang, sourceLang, onSpeak, ttsSource = 'vocab',
    isSaved, onSave, onTrialLimitReached, onPronSuccess,
    targetGoal, onBookmarkPrompt,
    activeRecIdx, onRecordingStart,
    t,
    onTopicPass,            // Phase 1 단계학습: score>=goal 통과 시 itemKey와 함께 호출(없으면 standalone)
    ttsDurable = false,     // Phase 2 seed 콘텐츠: TTS를 Azure durable(저장·공유)로 — 무과금
    headlineBlock = false,  // 2026-06-09: true면 문장 카드 레이아웃 — 액션(🔊·⭐) 윗줄 / 본문(문장) 아래 전체폭
}) {
    // 듣기 포인트 차감 — 모든 카드 TTS(단어/예문/문장)에 ttsCost:1 부여(첫 청취 1점, 반복 무료=App 세션 추적).
    //   seed 콘텐츠는 durable:true 로 Azure 저장 음성 재생(Azure 무과금) — 단, 포인트는 동일하게 1점 차감.
    const speak = (text, lang, emotion, o) => onSpeak?.(text, lang, emotion, {
        ...(o || {}),
        ttsCost: 1,
        ...(ttsDurable ? { durable: true } : {}),
    });
    const [practiceMode, setPracticeMode] = useState('word'); // 'word' | 'example'
    const practiceText = practiceMode === 'word' ? w.word : (w.example || '');

    // 일본어(ja)만 한자 대신 히라가나(pronunciation/examplePronunciation)를 Azure 기준으로 사용.
    // 중국어/러시아어는 원문이 더 정확히 평가됨 → 치환하지 않음.
    const referenceText = (selectedLang === 'ja')
        ? (practiceMode === 'word'
            ? (w.pronunciation || w.word)
            : (w.examplePronunciation || w.example || ''))
        : practiceText;

    const {
        isRecording, isAnalyzing, assessmentResult, coachTip,
        errorMsg, saveMessage, micDenied, openAppSettings, startRecording, stopRecording, resetAssessment,
    } = useAudioRecorder(referenceText, selectedLang, sourceLang, onTrialLimitReached, onPronSuccess);

    // 발음 통과 표시 — 현재 평가가 목표 점수 이상이면 카드 상단에 ✓ 배지(학습 진행 가시화)
    // ※ assessmentResult가 useAudioRecorder에서 선언된 뒤에 계산해야 함 (TDZ 회피)
    const passed = !!assessmentResult && (assessmentResult.pronunciationScore || 0) >= targetGoal;

    // practiceMode 전환 시 이전 결과 초기화
    const handleModeChange = (mode) => {
        if (mode === practiceMode) return;
        resetAssessment();
        setPracticeMode(mode);
    };

    // 녹음 시작 시 부모에게 알려서 다른 카드 녹음 차단
    const handleStart = () => {
        onRecordingStart(index);
        startRecording();
    };

    // 다른 카드가 녹음 중이면 이 카드의 녹음 버튼 비활성화
    const isOtherRecording = activeRecIdx !== null && activeRecIdx !== index;

    // 녹음+분석 완료 후 activeRecIdx 해제
    useEffect(() => {
        if (activeRecIdx === index && !isRecording && !isAnalyzing) {
            onRecordingStart(null);
        }
    }, [isRecording, isAnalyzing]); // eslint-disable-line react-hooks/exhaustive-deps

    // 녹음 완료 후 점수 기반 효과음 + 북마크 안내
    const prevAnalyzing = useRef(isAnalyzing);
    useEffect(() => {
        if (prevAnalyzing.current && !isAnalyzing && assessmentResult) {
            const score = assessmentResult.pronunciationScore || 0;
            if (score >= targetGoal) {
                playSuccessSound();
                if (!isSaved) onBookmarkPrompt?.(score);
                // 단계학습 진행 기록 — 단어 텍스트를 itemKey로(멱등 dedup). preset 진입 시에만 제공됨.
                onTopicPass?.(practiceMode === 'word' ? w.word : (w.example || w.word));
            } else {
                playAlertSound();
            }
        }
        prevAnalyzing.current = isAnalyzing;
    }, [isAnalyzing, assessmentResult]); // eslint-disable-line react-hooks/exhaustive-deps

    const tips = w.learningTip || [];

    // 본문(단어/문장·발음·뜻) + 액션(🔊·⭐) — headlineBlock(문장 카드)이면 액션을 윗줄, 본문을 아래 전체폭으로 배치
    const mainBlock = (
        <div className="vocab-word-main">
            <p className="vocab-word-text">{w.word}</p>
            {w.pronunciation && (
                <p className="vocab-word-pronunciation">{w.pronunciation}</p>
            )}
            <p className="vocab-word-meaning">{w.meaning}</p>
        </div>
    );
    const actionsBlock = (
        <div className="vocab-word-actions">
            <button
                className="vocab-action-btn"
                onClick={() => speak?.(w.word, selectedLang, undefined, { source: `${ttsSource}.word` })}
                title="TTS"
            >
                <Volume2 size={16} />
            </button>
            <button
                className={`vocab-action-btn ${isSaved ? 'saved' : ''}`}
                onClick={() => onSave(assessmentResult?.pronunciationScore ?? null)}
                title={isSaved ? t('scene.savedToLibrary') : t('scene.saveToLibrary')}
            >
                <Star size={16} fill={isSaved ? '#f59e0b' : 'none'} />
            </button>
        </div>
    );

    return (
        <div className="vocab-word-card" style={{ position: 'relative' }}>
            {/* 발음 통과 배지 (목표 점수 이상) — 카드 상단 우측 */}
            {passed && (
                <div style={{
                    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
                    display: 'flex', alignItems: 'center', gap: '3px',
                    background: '#dcfce7', color: '#15803d', border: '1px solid #86efac',
                    borderRadius: '999px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 800,
                }}>
                    <CheckCircle size={12} strokeWidth={2.5} /> {t('learningPath.passed')}
                </div>
            )}
            {/* 상단: 단어/문장 + 발음 + 뜻 + 액션 */}
            <div className={`vocab-word-top ${headlineBlock ? 'vocab-word-top-block' : ''}`}>
                {headlineBlock
                    ? <>{actionsBlock}{mainBlock}</>
                    : <>{mainBlock}{actionsBlock}</>}
            </div>

            {/* 예문 */}
            {w.example && (
                <div className="vocab-word-example">
                    <p className="vocab-word-example-text">
                        {w.example}
                        <button
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#64748b', padding: '0 0 0 6px', verticalAlign: 'middle'
                            }}
                            onClick={() => speak?.(w.example, selectedLang, undefined, { source: `${ttsSource}.example` })}
                        >
                            <Volume2 size={14} />
                        </button>
                    </p>
                    {w.examplePronunciation && (
                        <p className="vocab-word-example-pron">{w.examplePronunciation}</p>
                    )}
                    {w.exampleTranslation && (
                        <p className="vocab-word-example-trans">{w.exampleTranslation}</p>
                    )}
                </div>
            )}

            {/* ── 발음 연습 섹션 ── */}
            <div className="vocab-pron-section">
                <div className="vocab-pron-header">
                    <span className="vocab-pron-label">PRONUNCIATION</span>
                    {assessmentResult && (
                        <div className="vocab-score-badge">
                            <Award size={14} />
                            {assessmentResult.pronunciationScore}Pt
                        </div>
                    )}
                </div>

                {/* 단어 ↔ 예문 토글 (LearningGauge 슬라이드 토글 스타일) */}
                {w.example && (
                    <div className="vocab-pron-toggle">
                        <span className={`vocab-pron-toggle-label ${practiceMode === 'word' ? 'active' : ''}`}>{t('vocab.practiceWord')}</span>
                        <button
                            className={`vocab-pron-toggle-track ${practiceMode === 'example' ? 'on' : ''}`}
                            onClick={() => handleModeChange(practiceMode === 'word' ? 'example' : 'word')}
                            disabled={isRecording || isAnalyzing}
                        >
                            <span className="vocab-pron-toggle-thumb" />
                        </button>
                        <span className={`vocab-pron-toggle-label ${practiceMode === 'example' ? 'active' : ''}`}>{t('vocab.practiceExample')}</span>
                    </div>
                )}

                <div className="vocab-pron-content">
                    {/* 연습 대상 텍스트 미리보기 */}
                    <p className="vocab-pron-target">
                        {practiceText}
                    </p>

                    {!assessmentResult && !isAnalyzing && !isRecording && (
                        <p className="vocab-pron-prompt">{t('card.practicePrompt')}</p>
                    )}
                    {isRecording && <p className="vocab-pron-status recording">{t('card.recording')}</p>}
                    {isAnalyzing && <p className="vocab-pron-status analyzing">{t('card.analyzing')}</p>}

                    {errorMsg && (
                        <div className="vocab-pron-error" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <AlertCircle size={14} />
                                {errorMsg}
                            </span>
                            {micDenied && window.Capacitor?.isNativePlatform?.() && (
                                <button onClick={openAppSettings} style={{ background: 'none', border: '1px solid #6366f1', color: '#6366f1', borderRadius: '8px', padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                                    {t('errors.openSettings')}
                                </button>
                            )}
                        </div>
                    )}
                    {saveMessage && !isAnalyzing && (
                        <div className="vocab-pron-save-msg">
                            <CheckCircle size={14} />
                            {saveMessage}
                        </div>
                    )}

                    <PronunciationAssessment data={assessmentResult} sourceLangCode={sourceLang} langCode={selectedLang} onSpeak={speak} ttsSource={ttsSource} />

                    {/* 녹음 버튼 */}
                    <div className="practice-actions">
                        <button
                            className={`record-button circle ${isRecording ? 'recording' : ''} ${isAnalyzing ? 'analyzing' : ''}`}
                            onClick={() => isRecording ? stopRecording() : handleStart()}
                            disabled={isAnalyzing || isOtherRecording}
                            title={t('card.practicePrompt')}
                        >
                            {isAnalyzing ? <RotateCcw size={20} className="spin" /> : isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                        </button>
                    </div>
                </div>

                {/* AI 코치 피드백 */}
                {coachTip && (
                    <div className="vocab-coach-area">
                        <span className="vocab-coach-label">AI PRO COACH</span>
                        <p className="vocab-coach-text">"{coachTip}"</p>
                    </div>
                )}
            </div>

            {/* ── Learning Tip 섹션 ── */}
            {tips.length > 0 && (
                <div className="vocab-tip-section">
                    <span className="vocab-tip-label">LEARNING TIP</span>
                    <div className="vocab-tip-list">
                        {tips.map((tip, idx) => (
                            <p key={idx} className="vocab-tip-item">• {typeof tip === 'object' ? (tip.content || '') : String(tip || '')}</p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── 메인 VocabTab ────────────────────────────────────────────────────
export default function VocabTab({
    sourceLang,
    targetLangs = [],
    onTrialLimitReached,
    onPronSuccess,
    onSaveToLibrary,
    onSpeak,
    languageGoals = {},
    onBookmarkPrompt,
    onGenerate,
    onCheckPoints,
    onNavigateToLibrary,
    userLevel,
    languageLevels = {},
    isActive = true,
    preset = null,          // Phase 1 단계학습 진입: { catId, subId, topicId, level, lang } — 토픽 고정+UI collapse
    onBack,                 // 단계학습 back 헤더 → TopicHub 복귀
    onTopicPass,            // 통과 기록: ({ topicId, lang, level, phase, itemKey }) => recordPass
    isProUser = true,       // 직접입력(custom)은 Pro 전용 — Trial은 잠금 표시(기본 true=미지정 시 비잠금)
    onProOnly,              // 잠긴 직접입력 탭 시 Pro 안내 모달 오픈
}) {
    const { byokGeminiKey, user } = useAuth();
    const t = useT(sourceLang);

    // ── State ────────────────────────────────────────────────────────
    // 랜덤 초기 토픽 선택
    const pickRandomTopic = () => {
        const cat = VOCAB_CATEGORIES[Math.floor(Math.random() * VOCAB_CATEGORIES.length)];
        const sub = cat.subs[Math.floor(Math.random() * cat.subs.length)];
        const topic = sub.topics[Math.floor(Math.random() * sub.topics.length)];
        return { catId: cat.id, subId: sub.id, topicId: topic.id };
    };
    const initialTopic = preset
        ? { catId: preset.catId, subId: preset.subId, topicId: preset.topicId }
        : pickRandomTopic();

    const [selectedLang, setSelectedLang] = useState(preset ? preset.lang : (sourceLang || targetLangs[0] || 'en'));
    // 난이도는 "선택 언어"의 설정값을 따름 (languageLevels[selectedLang]).
    // 언어 전환 또는 해당 언어 설정 변경 시 자동 반영. 같은 언어 내 수동 변경은 deps가
    // 안 바뀌어 보존됨(setLevel은 level만 바꾸므로 effect 재실행 트리거 아님).
    const [level, setLevel] = useState(() => preset ? preset.level : (languageLevels[selectedLang] || userLevel || 'basic'));
    useEffect(() => {
        if (preset) return; // 단계학습 진입 시 난이도는 preset/사용자 토글이 결정 — 자동 sync 비활성
        setLevel(languageLevels[selectedLang] || userLevel || 'basic');
    }, [selectedLang, languageLevels[selectedLang], userLevel]); // eslint-disable-line react-hooks/exhaustive-deps
    const [pickerCatId, setPickerCatId] = useState(null);
    const [selectedTopic, setSelectedTopic] = useState(initialTopic);
    const [customInput, setCustomInput] = useState('');
    const [words, setWords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [savedWords, setSavedWords] = useState(new Set());
    const [activeRecIdx, setActiveRecIdx] = useState(null); // 동시 녹음 방지
    const avoidWordsRef = useRef([]);
    const historyCacheRef = useRef({});
    const loadedPagesRef = useRef({}); // `${historyKey}--${offset}` → words[] (재진입 시 재fetch 생략)
    const generateBtnRef = useRef(null);
    const didInitialScrollRef = useRef(false);
    // 커스텀 입력 진입 직전의 토픽 보관 — 입력을 비우면 이 토픽으로 복구해
    // "한 번 커스텀 입력 → 이후 모든 생성이 custom으로 잠기는" 문제를 방지.
    const prevTopicRef = useRef(initialTopic);

    // 탭이 처음으로 보여질 때 Generate 버튼으로 스크롤
    //   - VocabTab 은 display:none 상태로 선마운트되므로 마운트 시점엔 요소가 숨겨져 측정 불가
    //   - isActive 가 true 로 전환되는 최초 1회에만 실행 (재진입 시 유저 스크롤 위치 존중)
    //   - scrollIntoView 는 중첩 스크롤 컨테이너 + Android WebView 조합에서 불안정 → getBoundingClientRect 직접 계산
    useEffect(() => {
        if (!isActive || didInitialScrollRef.current) return;
        didInitialScrollRef.current = true;

        // 여러 단계 지연 — display:none→block, 카테고리 확장 렌더, admob 배너 높이 반영 대기
        const tryScroll = (attempt = 0) => {
            const btn = generateBtnRef.current;
            if (!btn) return;
            const container = btn.closest('.app-container');
            if (!container) {
                btn.scrollIntoView({ block: 'center' });
                return;
            }
            const btnRect = btn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            // 버튼이 아직 레이아웃에 안 잡혔으면 (height 0) 재시도
            if (btnRect.height === 0 && attempt < 5) {
                setTimeout(() => tryScroll(attempt + 1), 100);
                return;
            }
            const target = container.scrollTop
                + (btnRect.top - containerRect.top)
                - (containerRect.height / 2)
                + (btnRect.height / 2);
            container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        };

        requestAnimationFrame(() => {
            setTimeout(() => tryScroll(0), 150);
        });
    }, [isActive]);

    // Firebase에서 해당 키의 이력 읽기 — { words, seedCursor(현재 페이지), chargedMax(차감 완료된 최대 offset) }
    //   chargedMax: 이미 포인트 차감된 최대 offset. 재진입(offset ≤ chargedMax)은 재차감 안 함(영속).
    const loadVocabHistory = async (key) => {
        if (!user) return { words: [], seedCursor: 0, chargedMax: -1 };
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key];
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/vocabHistory`, key));
            const d = snap.exists() ? snap.data() : {};
            const entry = { words: Array.isArray(d.words) ? d.words : [], seedCursor: d.seedCursor || 0, chargedMax: (d.chargedMax != null ? d.chargedMax : -1) };
            historyCacheRef.current = { ...historyCacheRef.current, [key]: entry };
            return entry;
        } catch {
            return { words: [], seedCursor: 0, chargedMax: -1 };
        }
    };

    // newWords: custom avoid 누적(seed 경로는 []), nextCursor: seed 현재 페이지 offset, nextChargedMax: 차감완료 최대 offset
    const appendVocabHistory = (key, newWords, nextCursor, nextChargedMax) => {
        const existing = historyCacheRef.current[key] || { words: [], seedCursor: 0, chargedMax: -1 };
        const updated = {
            words: [...existing.words, ...newWords],
            seedCursor: nextCursor != null ? nextCursor : existing.seedCursor,
            chargedMax: nextChargedMax != null ? Math.max(existing.chargedMax ?? -1, nextChargedMax) : (existing.chargedMax ?? -1),
        };
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/vocabHistory`, key), {
                words: updated.words,
                seedCursor: updated.seedCursor,
                chargedMax: updated.chargedMax,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    const visibleLanguages = targetLangs;

    // 기본 학습 언어(targetLangs[0])가 바뀌면 selectedLang도 새 default로 따라감.
    // 탭이 display:none으로 상시 마운트돼 초깃값이 stale해지므로, 단순 includes 체크만으로는
    // stale 값이 우연히 신규 배열에 포함된 경우 사용자가 의도한 default를 무시하게 됨.
    const prevDefaultLangRef = useRef(targetLangs?.[0]);
    useEffect(() => {
        if (preset) return; // 단계학습 진입 시 언어는 preset 고정 — default 따라가기 비활성
        if (visibleLanguages.length === 0) return;
        const newDefault = visibleLanguages[0];
        const defaultChanged = prevDefaultLangRef.current !== newDefault;
        if (defaultChanged) prevDefaultLangRef.current = newDefault;
        if (defaultChanged || !visibleLanguages.includes(selectedLang)) {
            setSelectedLang(newDefault);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    // preset 변경(다른 토픽으로 재진입) 시 토픽/언어/난이도 재동기화 — 탭이 상시 마운트라 init만으론 부족
    useEffect(() => {
        if (!preset) return;
        setSelectedLang(preset.lang);
        setLevel(preset.level);
        setSelectedTopic({ catId: preset.catId, subId: preset.subId, topicId: preset.topicId });
        setCustomInput('');
    }, [preset?.topicId, preset?.lang, preset?.level]); // eslint-disable-line react-hooks/exhaustive-deps

    // 토픽 변경 시 리셋
    useEffect(() => {
        setWords([]);
        setSavedWords(new Set());
        setActiveRecIdx(null);
        avoidWordsRef.current = [];
    }, [selectedTopic, selectedLang, level]);

    // 마지막으로 선택된 "실제 토픽"을 보관 (custom 진입으로 null이 된 동안에도 유지)
    useEffect(() => {
        if (selectedTopic) prevTopicRef.current = selectedTopic;
    }, [selectedTopic]);

    // ── Generate Words ───────────────────────────────────────────────
    // opts.advance: seed 경로에서 "다음 5장"(커서 +5). 기본 false = 현재 페이지 로드.
    const handleGenerate = async (opts = {}) => {
        if (!selectedTopic && !customInput.trim()) return;
        setIsLoading(true);
        setActiveRecIdx(null);

        const topicId = selectedTopic?.topicId || 'custom';
        const topicLabel = selectedTopic ? getT(selectedLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim();
        const categoryLabel = selectedTopic ? getT(selectedLang, `vocabCat.${selectedTopic.catId}`) : customInput.trim();
        const isSeed = !!selectedTopic; // 비-custom = seed(전역 공유 순차) 경로

        const historyKey = makeVocabHistoryKey(topicId, level, selectedLang);
        const { words: persistedWords, seedCursor, chargedMax } = await loadVocabHistory(historyKey);
        // seed offset: 현재 페이지(=seedCursor), advance면 다음 페이지(+5)
        const offset = isSeed ? ((seedCursor || 0) + (opts.advance ? SEED_PAGE : 0)) : 0;
        // 컴포넌트 페이지 캐시 — 재진입/같은 offset이면 네트워크 없이 즉시 복원
        const pageCacheKey = `${historyKey}--${offset}`;
        if (isSeed && loadedPagesRef.current[pageCacheKey]) {
            setWords(loadedPagesRef.current[pageCacheKey]);
            setSavedWords(new Set());
            appendVocabHistory(historyKey, [], offset); // 커서 동기화
            setIsLoading(false);
            return;
        }
        // 2026-06-16: 잔액 게이트 — 차감 대상(신규 생성)만 검사. 무료 재진입(offset ≤ chargedMax)은 통과.
        const willChargePts = !isSeed || offset > (chargedMax ?? -1);
        if (willChargePts && onCheckPoints && !onCheckPoints()) { setIsLoading(false); return; }
        const allAvoid = [...new Set([...persistedWords, ...avoidWordsRef.current])];
        const avoidForApi = allAvoid.slice(-30); // custom 경로용 (seed는 서버가 자체 회피)

        try {
            const res = await authFetch(`${getServerUrl()}/api/vocab-words`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: topicId,
                    topicLabel,
                    category: categoryLabel,
                    isCustom: !selectedTopic,
                    level,
                    targetLang: selectedLang,
                    sourceLang,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidWords: avoidForApi,
                    offset: isSeed ? offset : undefined, // seed 경로만 offset 전송
                }),
            });

            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            if (data.words && Array.isArray(data.words)) {
                setWords(data.words);
                setSavedWords(new Set());
                if (isSeed) loadedPagesRef.current[pageCacheKey] = data.words; // 페이지 캐시 저장
                // enh1: 이미 차감된 페이지(offset ≤ chargedMax) 재진입은 무차감. custom 은 항상 차감.
                const shouldCharge = !isSeed || offset > (chargedMax ?? -1);
                if (shouldCharge && onGenerate) onGenerate();
                if (isSeed) {
                    // seed: 커서=현재 offset 저장 + 차감했으면 chargedMax 갱신(영속 무차감)
                    appendVocabHistory(historyKey, [], offset, shouldCharge ? offset : undefined);
                } else {
                    const newWordTexts = data.words.map(w => w.word);
                    avoidWordsRef.current = [...avoidWordsRef.current, ...newWordTexts];
                    appendVocabHistory(historyKey, newWordTexts);
                }
            }
        } catch (e) {
            console.error('[VocabTab] Generate error:', e);
            alert(t('scene.loadError'));
        } finally {
            setIsLoading(false);
        }
    };

    // 단계학습(preset) 진입 시 현재 페이지 5장 자동 로드 (버튼 없이 카드 즉시 표시).
    // preset → selectedTopic/Lang/Level 동기화가 끝난 뒤 1회만(토픽별).
    const autoGenKeyRef = useRef(null);
    // #9(2026-06-15): 섹션 닫았다 재진입(preset 재설정) 시 자동로드 1회 재허용 →
    //   재진입 시에도 버튼 없이 캐시 페이지 자동 표시. handleGenerate 가 페이지 캐시 HIT 면 무차감(#8).
    useEffect(() => { autoGenKeyRef.current = null; }, [preset?.topicId, preset?.lang, preset?.level]);
    useEffect(() => {
        if (!preset || !isActive) return;
        if (selectedTopic?.topicId !== preset.topicId || selectedLang !== preset.lang || level !== preset.level) return;
        const k = `${preset.topicId}--${preset.level}--${preset.lang}`;
        if (autoGenKeyRef.current === k) return;
        if (words.length > 0 || isLoading) { autoGenKeyRef.current = k; return; }
        autoGenKeyRef.current = k;
        handleGenerate(); // advance 없음 = 현재 페이지(seedCursor) 로드
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preset?.topicId, preset?.lang, preset?.level, isActive, selectedTopic, selectedLang, level, words.length]);

    // ── Save to Library ──────────────────────────────────────────────
    const handleSave = async (wordObj, index, pronunciationScore = null) => {
        if (savedWords.has(index)) return;
        if (!onSaveToLibrary) return;

        const cardId = await onSaveToLibrary({
            word: wordObj.word,
            meaning: wordObj.meaning,
            example: wordObj.example,
            exampleTranslation: wordObj.exampleTranslation,
            examplePronunciation: wordObj.examplePronunciation,
            pronunciation: wordObj.pronunciation,
            learningTip: wordObj.learningTip || [],
            langCode: selectedLang,
            topic: selectedTopic ? getT(sourceLang, `vocabTopic.${selectedTopic.topicId}`) : customInput.trim(),
            categoryId: selectedTopic?.catId || 'custom',
            topicId: selectedTopic?.topicId || 'custom',
            difficulty: level,
            pronunciationScore,
        });

        if (!cardId) return;
        playStarSound();
        setSavedWords(prev => new Set([...prev, index]));
        // 단계학습 UX 보존: 저장해도 단어장으로 이동하지 않음(목표달성 팝업은 saveVocabCard에서 발화).
        // 그 자리에서 계속 학습. (onNavigateToLibrary는 더 이상 호출하지 않음)
    };

    // ── Render ───────────────────────────────────────────────────────
    return (
        <div className="vocab-container">
            {/* 단계학습 back 헤더 */}
            {preset && (
                <button
                    type="button"
                    className="vocab-step-back"
                    onClick={onBack}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#0d9488', fontWeight: 700, fontSize: '0.95rem', padding: '8px 4px 6px' }}
                >
                    ← {getT(sourceLang, `vocabTopic.${preset.topicId}`)}
                </button>
            )}

            {/* Language Pills — 단계학습 진입 시 언어 고정이라 숨김 */}
            {!preset && (
            <div className="vocab-lang-row">
                {visibleLanguages.map(code => (
                    <button
                        key={code}
                        className={`vocab-lang-pill ${selectedLang === code ? 'active' : ''}`}
                        onClick={() => setSelectedLang(code)}
                    >
                        {getT(sourceLang, `langNames.${code}`) || getLangName(code)}
                    </button>
                ))}
            </div>
            )}

            {/* Level Selector */}
            <div className="vocab-level-row">
                {[
                    { value: 'basic', key: 'diffBasic' },
                    { value: 'intermediate', key: 'diffIntermediate' },
                    { value: 'advanced', key: 'diffAdvanced' },
                ].map(lv => (
                    <button
                        key={lv.value}
                        className={`vocab-level-btn ${level === lv.value ? 'active' : ''}`}
                        onClick={() => setLevel(lv.value)}
                    >
                        {t(`scene.${lv.key}`)}
                    </button>
                ))}
            </div>

            {/* 단계학습 진입 시 토픽이 고정이라 카테고리/칩/커스텀 입력 collapse */}
            {!preset && (<>
            {/* ── Category Slider + 선택 칩 ──────────────────────── */}
            <CategorySlider
                sourceLang={sourceLang}
                selectedCatId={selectedTopic?.catId || null}
                onCategoryClick={(catId) => setPickerCatId(catId)}
            />

            {selectedTopic && (
                <button
                    type="button"
                    className="vocab-selected-chip"
                    onClick={() => setPickerCatId(selectedTopic.catId)}
                    aria-label={t('vocab.changeTopic') || 'change topic'}
                >
                    <span className="vocab-selected-chip__cat">
                        {t(`vocabCat.${selectedTopic.catId}`)}
                    </span>
                    <span className="vocab-selected-chip__sep">›</span>
                    <span className="vocab-selected-chip__topic">
                        {t(`vocabTopic.${selectedTopic.topicId}`)}
                    </span>
                </button>
            )}

            {/* Custom Input — Free Talking과 동일 UI (2줄 label + 2줄 textarea).
                직접입력은 Pro 전용 — Trial은 진입 시점부터 잠긴 상태 + "Pro 전용입니다" placeholder 상시 노출(탭 시 Pro 안내). */}
            <div
                className={`scene-custom-block${!isProUser ? ' locked' : ''}`}
                onClick={!isProUser ? () => onProOnly?.() : undefined}
            >
                <div className="scene-custom-label" role="presentation">
                    <span className="scene-custom-label__icon" aria-hidden="true">
                        {isProUser ? <Pencil size={11} strokeWidth={2.25} /> : <Lock size={11} strokeWidth={2.25} />}
                    </span>
                    <span className="scene-custom-label__text">{t('scene.customLabelTop')}</span>
                </div>
                <textarea
                    className="scene-custom-input"
                    rows={2}
                    placeholder={isProUser ? t('scene.customPlaceholder') : (t('scene.customProOnly') || '🔒 Pro 전용입니다')}
                    value={isProUser ? customInput : ''}
                    disabled={!isProUser}
                    readOnly={!isProUser}
                    onChange={evt => {
                        const v = evt.target.value;
                        setCustomInput(v);
                        // 입력이 있으면 custom 모드(토픽 해제), 비우면 직전 토픽으로 복구.
                        // 복구가 없으면 한 번 입력한 뒤 selectedTopic이 null로 굳어
                        // 이후 언어/난이도 전환·재생성이 전부 custom으로 기록됨.
                        if (v.trim()) setSelectedTopic(null);
                        else setSelectedTopic(prevTopicRef.current);
                    }}
                />
            </div>
            </>)}

            {/* Generate Button */}
            <div className="vocab-generate-row">
                <button
                    ref={generateBtnRef}
                    className="vocab-generate-btn"
                    onClick={() => handleGenerate({ advance: !!selectedTopic && words.length > 0 })}
                    disabled={isLoading || (!selectedTopic && !customInput.trim())}
                >
                    {isLoading ? (
                        <RefreshCw size={18} style={{ animation: 'vocab-spin 0.8s linear infinite' }} />
                    ) : (
                        <Sparkles size={18} />
                    )}
                    {isLoading
                        ? t('card.analyzing')
                        : words.length > 0
                            ? t('vocab.regenerate')
                            : t('vocab.generate')
                    }
                </button>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="vocab-loading">
                    <div className="vocab-spinner" />
                    {t('vocab.generating')}
                </div>
            )}

            {/* Word Cards */}
            {!isLoading && words.length > 0 && (
                <div className="vocab-words-list">
                    {words.map((w, i) => (
                        <VocabWordCard
                            key={i}
                            w={w}
                            index={i}
                            selectedLang={selectedLang}
                            sourceLang={sourceLang}
                            onSpeak={onSpeak}
                            isSaved={savedWords.has(i)}
                            onSave={(score) => handleSave(w, i, score)}
                            onTrialLimitReached={onTrialLimitReached}
                            onPronSuccess={onPronSuccess}
                            targetGoal={languageGoals[selectedLang] || 60}
                            onBookmarkPrompt={onBookmarkPrompt}
                            activeRecIdx={activeRecIdx}
                            onRecordingStart={setActiveRecIdx}
                            t={t}
                            ttsDurable={!!preset}
                            onTopicPass={preset && onTopicPass
                                ? (itemKey) => onTopicPass({ topicId: preset.topicId, lang: selectedLang, level, phase: 'word', itemKey })
                                : undefined}
                        />
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && words.length === 0 && (
                <div className="vocab-empty">
                    <div className="vocab-empty-icon"><BookOpen size={28} strokeWidth={1.5} /></div>
                    {t('vocab.selectTopic')}
                </div>
            )}

            {/* Topic Picker Modal — opens when slider/chip is clicked */}
            {pickerCatId && (
                <TopicPickerModal
                    catId={pickerCatId}
                    sourceLang={sourceLang}
                    selectedTopic={selectedTopic}
                    onTopicSelect={(catId, subId, topicId) => {
                        setCustomInput('');
                        setSelectedTopic({ catId, subId, topicId });
                    }}
                    onClose={() => setPickerCatId(null)}
                />
            )}
        </div>
    );
}
