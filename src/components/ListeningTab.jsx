import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Sparkles, Volume2, Pause, Repeat, Loader2, BookOpen, Pencil, Headphones } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import { VocabWordCard } from './VocabTab';
import CategorySlider from './CategorySlider';
import TopicPickerModal from './TopicPickerModal';
import { authFetch } from '../utils/authFetch';
import { playStarSound } from '../utils/soundEffects';
import { getLangName } from '../config/languages';
import './ListeningTab.css';

// 대화형 지문에서 A:/B: 레이블 제거 + 줄바꿈을 SSML pause로 변환 (단일 voice 폴백용)
const cleanDialogueForTTS = (text) => {
    if (!text) return text;
    // A: B: 등 화자 레이블 제거, 줄바꿈 유지 (TTS 엔진이 줄바꿈에서 자연스럽게 쉼)
    return text.replace(/^[A-Z]:\s*/gm, '\n').replace(/\n{2,}/g, '\n\n');
};

// 대화 텍스트를 A:/B: 턴 배열로 파싱
const parseDialogueTurns = (text) => {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const turns = [];
    for (const line of lines) {
        const m = line.match(/^([A-Z]):\s*(.+)$/);
        if (m) {
            turns.push({ speaker: m[1], text: m[2].trim() });
        } else if (turns.length > 0) {
            // 턴 연속(줄바꿈) — 직전 턴에 이어붙임
            turns[turns.length - 1].text += ' ' + line;
        }
    }
    return turns;
};

// 개별 문장 라인에서 speaker/text 분리 (개별 재생용)
const extractSpeaker = (line) => {
    if (!line) return { speaker: null, text: '' };
    const m = String(line).match(/^([A-Z]):\s*(.+)$/);
    return m ? { speaker: m[1], text: m[2].trim() } : { speaker: null, text: String(line).trim() };
};

// 간단한 deterministic 해시 (서버와 동일 규칙) — dialogueSeed 생성용
const simpleHashString = (str) => {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(Math.abs(h));
};

// 지문을 문장 단위로 분리 (대화: 줄 단위 / 에세이: 문장부호 기준)
const splitIntoSentences = (text, isDialogue) => {
    if (!text) return [];
    if (isDialogue) {
        // 대화: 줄바꿈 기준 분리, 빈 줄 제거
        return text.split('\n').filter(s => s.trim());
    }
    // 에세이: 문장 종결 부호 기준 분리 (마침표, 물음표, 느낌표 + CJK 구두점)
    // 부호 뒤에서 분리하되 부호는 앞 문장에 포함
    const parts = text.split(/(?<=[。．.！!？?\n])\s*/);
    return parts.filter(s => s.trim());
};

const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};

const makeHistoryKey = (topicId, type, level, lang) =>
    `${topicId}--${type}--${level}--${lang}`;

export default function ListeningTab({
    sourceLang,
    targetLangs = [],
    onTrialLimitReached,
    onPronSuccess,
    onSaveToLibrary,
    onSpeak,
    languageGoals = {},
    onBookmarkPrompt,
    onGenerate,
    onFirstPlay,                          // 2026-05-23: 첫 재생 시 추가 AdsPoint(15) 차감 — Azure TTS 비용 반영
    onNavigateToLibrary,
    userLevel,
    isActive = true,
    isTrialListenLimitReached = false,  // 2026-05-23: Trial 일일 3회 한도 enforcement
}) {
    const { byokGeminiKey, user } = useAuth();
    const t = useT(sourceLang);

    // ── State ────────────────────────────────────────────────────
    // 랜덤 초기 토픽 선택
    const pickRandomTopic = () => {
        const cat = VOCAB_CATEGORIES[Math.floor(Math.random() * VOCAB_CATEGORIES.length)];
        const sub = cat.subs[Math.floor(Math.random() * cat.subs.length)];
        const topic = sub.topics[Math.floor(Math.random() * sub.topics.length)];
        return { catId: cat.id, subId: sub.id, topicId: topic.id };
    };

    const [selectedLang, setSelectedLang] = useState(sourceLang || targetLangs[0] || 'en');
    const [level, setLevel] = useState(userLevel || 'basic');
    useEffect(() => { if (userLevel) setLevel(userLevel); }, [userLevel]);
    const [passageType, setPassageType] = useState('essay'); // 'essay' | 'dialogue'
    const [selectedTopic, setSelectedTopic] = useState(() => pickRandomTopic()); // { catId, subId, topicId }
    const [pickerCatId, setPickerCatId] = useState(null);
    const [customInput, setCustomInput] = useState(''); // 사용자가 직접 입력한 커스텀 주제

    const [passage, setPassage] = useState(null);
    const [keywords, setKeywords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [showPronunciation, setShowPronunciation] = useState(false);
    const [savedWords, setSavedWords] = useState(new Set());
    const [activeRecIdx, setActiveRecIdx] = useState(null);
    const [playingSentenceIdx, setPlayingSentenceIdx] = useState(null);

    // 장문 TTS 재생 관리
    const [passagePlaying, setPassagePlaying] = useState(false); // 재생 중 여부
    const [passageLoading, setPassageLoading] = useState(false); // TTS 로딩 중
    const [loopMode, setLoopMode] = useState(false); // 반복 재생 모드
    const passageAudioRef = useRef(null); // 현재 재생 중인 Audio 객체
    const passageAudioUrlRef = useRef(null); // blob URL (누수 방지용)
    const loopModeRef = useRef(false); // useCallback 내에서 최신 값 접근용
    const playGenRef = useRef(0); // 재생 세대 토큰 (stale fetch 응답 무효화)
    const ttsAbortRef = useRef(null); // 진행 중 TTS fetch 취소용

    // loopMode 최신 값 동기화
    useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);

    // 장문 재생 정리 — in-flight fetch 취소 + stale 응답 무효화 + audio/blob 정리
    const stopPassageAudio = useCallback(() => {
        playGenRef.current += 1; // 이후 도착할 fetch 응답은 stale 로 간주됨
        if (ttsAbortRef.current) {
            try { ttsAbortRef.current.abort(); } catch {}
            ttsAbortRef.current = null;
        }
        if (passageAudioRef.current) {
            try { passageAudioRef.current.pause(); } catch {}
            passageAudioRef.current.onended = null;
            try { passageAudioRef.current.src = ''; } catch {}
            passageAudioRef.current = null;
        }
        if (passageAudioUrlRef.current) {
            try { URL.revokeObjectURL(passageAudioUrlRef.current); } catch {}
            passageAudioUrlRef.current = null;
        }
        setPassagePlaying(false);
        setPassageLoading(false);
    }, []);

    // 장문 재생/일시정지 토글
    const handlePassagePlay = useCallback(async () => {
        if (!passage?.text || !onSpeak) return;

        // 재생 중 → 일시정지
        if (passagePlaying && passageAudioRef.current) {
            passageAudioRef.current.pause();
            setPassagePlaying(false);
            return;
        }

        // 일시정지 상태에서 재개
        if (passageAudioRef.current && passageAudioRef.current.paused && passageAudioRef.current.currentTime > 0) {
            passageAudioRef.current.play().catch(() => {});
            setPassagePlaying(true);
            return;
        }

        // 2026-05-23: 첫 재생 dedup safety net (daily 3-limit) — 정상 흐름에선 거의 안 타지만 fallback 유지.
        //   passage.counted=false 인 경우 (향후 "저장된 passage 재진입" 등) handleGenerate 의 onGenerate 누락 보완.
        if (passage && !passage.counted) {
            if (isTrialListenLimitReached) {
                onTrialLimitReached?.();
                return;
            }
            onGenerate?.();
            setPassage(p => p ? { ...p, counted: true } : p);
        }

        // 2026-05-23: 첫 재생 시 추가 AdsPoint(15) 차감 — Azure TTS 가 실제로 호출되는 시점 비용 반영.
        //   같은 passage 의 반복 재생(pause/resume/loop, Stop→Play 다시): 서버 텍스트 해시 캐시로 Azure 비용 0
        //   이므로 AdsPoint 추가 차감 안 함. 새 passage 가 생성될 때마다 adsCharged=false 로 리셋.
        if (passage && !passage.adsCharged) {
            onFirstPlay?.();
            setPassage(p => p ? { ...p, adsCharged: true } : p);
        }

        // 새로 재생 시작 — 세대 토큰 + AbortController 로 race 방지
        const isDialogue = passageType === 'dialogue';
        const dialogueTurns = isDialogue ? parseDialogueTurns(passage.text) : [];
        const hasTurns = dialogueTurns.length > 0;
        // 대화: turns 기반 다중 voice / 에세이(또는 turns 파싱 실패): 기존 단일 voice 경로
        const ttsText = isDialogue ? cleanDialogueForTTS(passage.text) : passage.text;
        const dialogueSeed = hasTurns ? simpleHashString(passage.text) : null;
        const SERVER_URL = getServerUrl();
        const myGen = ++playGenRef.current;
        const controller = new AbortController();
        ttsAbortRef.current = controller;
        setPassageLoading(true);

        let objectUrl = null;
        try {
            const res = await authFetch(`${SERVER_URL}/api/azure-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    hasTurns
                        ? { turns: dialogueTurns, dialogueSeed, langCode: selectedLang }
                        : { text: ttsText, langCode: selectedLang }
                ),
                signal: controller.signal,
            });
            if (myGen !== playGenRef.current) return; // stale
            if (!res.ok) throw new Error(`TTS ${res.status}`);
            const blob = await res.blob();
            if (myGen !== playGenRef.current) return; // stale

            objectUrl = URL.createObjectURL(blob);
            const audio = new Audio(objectUrl);

            audio.onended = () => {
                if (myGen !== playGenRef.current) return;
                if (loopModeRef.current) {
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                } else {
                    setPassagePlaying(false);
                    if (passageAudioUrlRef.current) {
                        try { URL.revokeObjectURL(passageAudioUrlRef.current); } catch {}
                        passageAudioUrlRef.current = null;
                    }
                    passageAudioRef.current = null;
                }
            };

            passageAudioRef.current = audio;
            passageAudioUrlRef.current = objectUrl;
            objectUrl = null; // ref 로 이전됨 — finally 에서 revoke 하지 않도록
            await audio.play();
            if (myGen !== playGenRef.current) return; // 재생 직후에도 체크 (중간에 stop 된 경우)
            setPassagePlaying(true);
        } catch (e) {
            if (e?.name === 'AbortError') return; // 정상 취소
            console.warn('[ListeningTab] TTS error:', e);
            // fallback: 기존 onSpeak 사용
            if (myGen === playGenRef.current) onSpeak(ttsText, selectedLang);
        } finally {
            if (objectUrl) {
                try { URL.revokeObjectURL(objectUrl); } catch {}
            }
            if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
            if (myGen === playGenRef.current) setPassageLoading(false);
        }
    }, [passage, passagePlaying, passageType, selectedLang, onSpeak, stopPassageAudio, isTrialListenLimitReached, onTrialLimitReached, onGenerate, onFirstPlay]);

    // 개별 문장 재생 — 대화 모드에서는 turns 단일 턴으로 speaker별 voice 사용 (전체 재생과 동일한 배치 유지)
    const playSentence = useCallback(async (sentence) => {
        const isDialogue = passageType === 'dialogue';
        if (isDialogue) {
            const { speaker, text } = extractSpeaker(sentence);
            if (speaker && text) {
                const SERVER_URL = getServerUrl();
                const dialogueSeed = simpleHashString(passage?.text || '');
                let objectUrl = null;
                try {
                    const res = await authFetch(`${SERVER_URL}/api/azure-tts`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ turns: [{ speaker, text }], dialogueSeed, langCode: selectedLang }),
                    });
                    if (!res.ok) throw new Error(`TTS ${res.status}`);
                    const blob = await res.blob();
                    objectUrl = URL.createObjectURL(blob);
                    const audio = new Audio(objectUrl);
                    const localUrl = objectUrl;
                    audio.onended = () => { try { URL.revokeObjectURL(localUrl); } catch {} };
                    objectUrl = null; // revoke 책임 onended로 이전
                    await audio.play();
                    return;
                } catch (e) {
                    console.warn('[ListeningTab] sentence TTS error, falling back:', e);
                    if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch {} }
                    // fallback → 아래 단일 voice onSpeak
                }
            }
        }
        // 폴백/에세이: 기존 onSpeak
        const ttsText = isDialogue ? String(sentence).replace(/^[A-Z]:\s*/, '') : sentence;
        onSpeak?.(ttsText, selectedLang);
    }, [passageType, passage, selectedLang, onSpeak]);

    const avoidTitlesRef = useRef([]);
    const historyCacheRef = useRef({});

    const visibleLanguages = targetLangs;

    // 기본 학습 언어(targetLangs[0])가 바뀌면 selectedLang도 새 default로 따라감.
    // 탭이 display:none으로 상시 마운트돼 초깃값이 stale해지므로, 단순 includes 체크만으로는
    // stale 값이 우연히 신규 배열에 포함된 경우 사용자가 의도한 default를 무시하게 됨.
    const prevDefaultLangRef = useRef(targetLangs?.[0]);
    useEffect(() => {
        if (visibleLanguages.length === 0) return;
        const newDefault = visibleLanguages[0];
        const defaultChanged = prevDefaultLangRef.current !== newDefault;
        if (defaultChanged) prevDefaultLangRef.current = newDefault;
        if (defaultChanged || !visibleLanguages.includes(selectedLang)) {
            setSelectedLang(newDefault);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    // 조건 변경 시 리셋
    useEffect(() => {
        stopPassageAudio();
        setPassage(null);
        setKeywords([]);
        setSavedWords(new Set());
        setActiveRecIdx(null);
        setShowTranslation(false);
        setShowPronunciation(false);
        avoidTitlesRef.current = [];
    }, [selectedTopic, selectedLang, level, passageType]); // eslint-disable-line react-hooks/exhaustive-deps

    // 탭 이탈 시 TTS 정지 (다른 탭의 Generate 등으로 이동하는 경우 대응)
    useEffect(() => {
        if (!isActive) stopPassageAudio();
    }, [isActive, stopPassageAudio]);

    // 언마운트 시 정리
    useEffect(() => () => stopPassageAudio(), [stopPassageAudio]);

    // ── Firestore History ────────────────────────────────────────
    // titles[] (기존) + passagesMeta[] (신규: title+keywords+angle) 병행 보관.
    // 캐시 shape: historyCacheRef.current[key] = { titles, passagesMeta }
    const loadHistory = async (key) => {
        if (!user) return { titles: [], passagesMeta: [] };
        if (historyCacheRef.current[key] !== undefined) return historyCacheRef.current[key];
        try {
            const snap = await getDoc(doc(db, `users/${user.uid}/listeningHistory`, key));
            const data = snap.exists() ? snap.data() : {};
            const cached = {
                titles: Array.isArray(data.titles) ? data.titles : [],
                passagesMeta: Array.isArray(data.passagesMeta) ? data.passagesMeta : [],
            };
            historyCacheRef.current = { ...historyCacheRef.current, [key]: cached };
            return cached;
        } catch {
            return { titles: [], passagesMeta: [] };
        }
    };

    const appendHistory = (key, newTitle, newMeta) => {
        const existing = historyCacheRef.current[key] || { titles: [], passagesMeta: [] };
        const updated = {
            titles: [...existing.titles, newTitle],
            passagesMeta: newMeta ? [...existing.passagesMeta, newMeta] : existing.passagesMeta,
        };
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/listeningHistory`, key), {
                titles: updated.titles,
                passagesMeta: updated.passagesMeta,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    // ── Generate Passage ─────────────────────────────────────────
    const handleGenerate = async () => {
        const hasCustom = customInput.trim().length > 0;
        if (!selectedTopic && !hasCustom) return;
        // 2026-05-23: Trial 일일 한도 enforcement — Pron/FreeTalk 와 동일 패턴
        if (isTrialListenLimitReached) {
            onTrialLimitReached?.();
            return;
        }
        stopPassageAudio();
        setIsLoading(true);
        setActiveRecIdx(null);

        const topicId = hasCustom ? 'custom' : selectedTopic.topicId;
        const topicLabel = hasCustom
            ? customInput.trim()
            : getT(selectedLang, `vocabTopic.${selectedTopic.topicId}`);
        const categoryLabel = hasCustom
            ? customInput.trim()
            : getT(selectedLang, `vocabCat.${selectedTopic.catId}`);
        const historyKey = makeHistoryKey(topicId, passageType, level, selectedLang);
        const { titles: persistedTitles, passagesMeta: persistedMeta } = await loadHistory(historyKey);
        const allAvoid = [...new Set([...persistedTitles, ...avoidTitlesRef.current])];
        // 50→20: long negative list 의 LLM 준수율 저하 회피 + 토큰 절감.
        // passagesMeta 도 동일하게 최근 20개만 전송 (서버에서 angle/keyword cluster rotation 강제).
        const avoidTitlesForApi = allAvoid.slice(-20);
        const passagesMetaForApi = (persistedMeta || []).slice(-20);

        try {
            const res = await authFetch(`${getServerUrl()}/api/listening-passage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: topicId,
                    topicLabel,
                    category: categoryLabel,
                    isCustom: hasCustom,
                    level,
                    type: passageType,
                    targetLang: selectedLang,
                    sourceLang,
                    byokGeminiKey: byokGeminiKey || undefined,
                    avoidTitles: avoidTitlesForApi,
                    passagesMeta: passagesMetaForApi,
                }),
            });

            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            if (data.passage || data.title) {
                setPassage({
                    title: data.title || '',
                    titleTranslation: data.titleTranslation || '',
                    text: data.passage || '',
                    pronunciation: data.passagePronunciation || '',
                    translation: data.passageTranslation || '',
                    counted: true,       // daily 3-limit: handleGenerate 에서 onGenerate 호출 → 첫 재생 dedup safety net
                    adsCharged: false,   // AdsPoint(15): 첫 재생 시 onFirstPlay 로 1회 더 차감 (Azure TTS 비용 반영)
                });
                setKeywords(data.words || []);
                setSavedWords(new Set());
                setShowTranslation(false);
                setShowPronunciation(false);
                if (onGenerate) onGenerate();
                if (data.title) {
                    avoidTitlesRef.current = [...avoidTitlesRef.current, data.title];
                    // 신규 응답에 passageKeywords + angle 이 포함된 경우만 meta 누적.
                    // 누락(이전 빌드 호환)이면 title 만 append → 기존 passagesMeta 그대로 보존.
                    const newMeta = (Array.isArray(data.passageKeywords) && data.angle)
                        ? { title: data.title, keywords: data.passageKeywords, angle: data.angle, createdAt: Date.now() }
                        : null;
                    appendHistory(historyKey, data.title, newMeta);
                }
            }
        } catch (e) {
            console.error('[ListeningTab] Generate error:', e);
            alert(t('scene.loadError'));
        } finally {
            setIsLoading(false);
        }
    };

    // ── Save Word to Library ─────────────────────────────────────
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
            topic: getT(sourceLang, `vocabTopic.${selectedTopic?.topicId}`),
            categoryId: selectedTopic?.catId || 'custom',
            topicId: selectedTopic?.topicId || 'custom',
            difficulty: level,
            pronunciationScore,
        });

        if (!cardId) return;
        playStarSound();
        setSavedWords(prev => new Set([...prev, index]));
        if (onNavigateToLibrary) onNavigateToLibrary(cardId);
    };

    // ── Topic selection from picker modal ─────────────────────────
    const handleTopicSelect = (catId, subId, topicId) => {
        setCustomInput('');
        setSelectedTopic({ catId, subId, topicId });
    };

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="listening-container">
            {/* Language Pills */}
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

            {/* Essay / Dialogue Toggle */}
            <div className="listening-type-row">
                <span
                    className={`listening-type-label ${passageType === 'essay' ? 'active' : ''}`}
                    onClick={() => setPassageType('essay')}
                >
                    {t('listening.essay')}
                </span>
                <button
                    className={`listening-type-track ${passageType === 'dialogue' ? 'on' : ''}`}
                    onClick={() => setPassageType(p => p === 'essay' ? 'dialogue' : 'essay')}
                >
                    <span className="listening-type-thumb" />
                </button>
                <span
                    className={`listening-type-label ${passageType === 'dialogue' ? 'active' : ''}`}
                    onClick={() => setPassageType('dialogue')}
                >
                    {t('listening.dialogue')}
                </span>
            </div>

            {/* Category Slider + 선택 칩 (VocabTab과 통일) */}
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
                    aria-label="change topic"
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

            {/* Custom Input — Free Talking과 동일 UI (왼쪽 2줄 label + 오른쪽 2줄 textarea) */}
            <div className="scene-custom-block">
                <div className="scene-custom-label" role="presentation">
                    <span className="scene-custom-label__icon" aria-hidden="true">
                        <Pencil size={11} strokeWidth={2.25} />
                    </span>
                    <span className="scene-custom-label__text">{t('scene.customLabelTop')}</span>
                </div>
                <textarea
                    className="scene-custom-input"
                    rows={2}
                    placeholder={t('scene.customPlaceholder')}
                    value={customInput}
                    onChange={evt => {
                        const v = evt.target.value;
                        setCustomInput(v);
                        if (v.trim()) setSelectedTopic(null);
                    }}
                />
            </div>

            {/* Generate Button */}
            <button
                className="listening-generate-btn"
                onClick={handleGenerate}
                disabled={isLoading || (!selectedTopic && !customInput.trim())}
            >
                {isLoading ? (
                    <><Loader2 size={18} className="spin" /> {t('listening.generating')}</>
                ) : (
                    <><Sparkles size={18} /> {passage ? t('listening.regenerate') : t('listening.generate')}</>
                )}
            </button>

            {/* Loading */}
            {isLoading && (
                <div className="listening-loading">
                    <Loader2 size={28} className="spin" style={{ color: '#00a884' }} />
                    {t('listening.generating')}
                </div>
            )}

            {/* Passage Card */}
            {passage && !isLoading && (
                <>
                    <div className="listening-passage-card">
                        <div className="listening-passage-header">
                            <div style={{ flex: 1 }}>
                                <h3 className="listening-passage-title">{passage.title}</h3>
                                {passage.titleTranslation && (
                                    <p className="listening-passage-title-trans">{passage.titleTranslation}</p>
                                )}
                            </div>
                            {/* 재생 ↔ 반복 토글 */}
                            <div className="listening-loop-toggle">
                                <span className={`listening-loop-label ${!loopMode ? 'active' : ''}`}>
                                    <Volume2 size={11} />
                                </span>
                                <button
                                    className={`listening-loop-track ${loopMode ? 'on' : ''}`}
                                    onClick={() => setLoopMode(m => !m)}
                                >
                                    <span className="listening-loop-thumb" />
                                </button>
                                <span className={`listening-loop-label ${loopMode ? 'active' : ''}`}>
                                    <Repeat size={11} />
                                </span>
                            </div>
                            {/* 재생/일시정지 버튼 */}
                            <button
                                className={`listening-tts-btn ${passagePlaying ? 'playing' : ''}`}
                                onClick={handlePassagePlay}
                                disabled={passageLoading}
                                title={passagePlaying ? 'Pause' : 'Play'}
                            >
                                {passageLoading
                                    ? <Loader2 size={18} className="spin" />
                                    : passagePlaying
                                        ? <Pause size={18} />
                                        : <Volume2 size={18} />}
                            </button>
                        </div>

                        <div className="listening-passage-text">
                            {splitIntoSentences(passage.text, passageType === 'dialogue').map((sentence, idx) => (
                                <span
                                    key={idx}
                                    className={`listening-sentence ${playingSentenceIdx === idx ? 'playing' : ''}`}
                                    onClick={() => {
                                        setPlayingSentenceIdx(idx);
                                        playSentence(sentence);
                                    }}
                                >
                                    {sentence}
                                    {passageType === 'dialogue' ? '\n' : ' '}
                                </span>
                            ))}
                        </div>

                        {passage.pronunciation && (
                            <>
                                <button
                                    className="listening-translation-toggle"
                                    onClick={() => setShowPronunciation(!showPronunciation)}
                                >
                                    {showPronunciation ? t('listening.hidePronunciation') : t('listening.showPronunciation')}
                                    <ChevronDown size={14} className={showPronunciation ? 'rotated' : ''} />
                                </button>
                                {showPronunciation && (
                                    <div className="listening-passage-pron">{passage.pronunciation}</div>
                                )}
                            </>
                        )}

                        <button
                            className="listening-translation-toggle"
                            onClick={() => setShowTranslation(!showTranslation)}
                        >
                            {showTranslation ? t('listening.hideTranslation') : t('listening.showTranslation')}
                            <ChevronDown size={14} className={showTranslation ? 'rotated' : ''} />
                        </button>
                        {showTranslation && (
                            <div className="listening-passage-translation">{passage.translation}</div>
                        )}
                    </div>

                    {/* Key Words */}
                    {keywords.length > 0 && (
                        <>
                            <div className="listening-keywords-label">
                                <BookOpen size={14} />
                                {t('listening.keywords')}
                            </div>
                            <div className="listening-keywords-list">
                                {keywords.map((w, i) => (
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
                                        targetGoal={languageGoals[selectedLang] || 80}
                                        onBookmarkPrompt={onBookmarkPrompt}
                                        activeRecIdx={activeRecIdx}
                                        onRecordingStart={setActiveRecIdx}
                                        t={t}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}

            {/* Empty State */}
            {!passage && !isLoading && (
                <div className="listening-empty">
                    <div className="listening-empty-icon"><Headphones size={28} strokeWidth={1.5} /></div>
                    <p>{t('listening.emptyState')}</p>
                </div>
            )}

            {/* Topic Picker Modal (VocabTab과 동일) */}
            {pickerCatId && (
                <TopicPickerModal
                    catId={pickerCatId}
                    sourceLang={sourceLang}
                    selectedTopic={selectedTopic}
                    onTopicSelect={(catId, subId, topicId) => {
                        handleTopicSelect(catId, subId, topicId);
                    }}
                    onClose={() => setPickerCatId(null)}
                />
            )}
        </div>
    );
}
