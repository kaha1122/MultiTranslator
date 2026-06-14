import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Sparkles, Volume2, Pause, Repeat, Loader2, Pencil, Headphones } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useT, getT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import { VocabWordCard } from './VocabTab';
import CategorySlider from './CategorySlider';
import TopicPickerModal from './TopicPickerModal';
import MessageCardModal from './MessageCardModal';
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
    onTtsGate,                            // 2026-06-07: 신규 합성 전 포인트 게이트 — true=허용(차감)/false=차단(0점 팝업). 캐시 hit 제외.
    ScenePracticeCardComp,                // 2026-06-09: 문장 클릭 → 카드 팝업(번역·발음·팁·TTS·발음연습·저장). App.jsx가 ScenePracticeCard 주입.
    onSaveSentence,                       // 2026-06-09: 문장 카드 라이브러리 저장(saveSceneCard sourceType=listening)
    languageGoals = {},
    onBookmarkPrompt,
    onGenerate,
    onFirstPlay,                          // 2026-06-07: no-op (TTS 차감은 onTtsGate로 일원화)
    onNavigateToLibrary,
    userLevel,
    languageLevels = {},
    isActive = true,
    isTrialListenLimitReached = false,  // 2026-05-23: Trial 일일 3회 한도 enforcement
    preset = null,          // Phase 1 단계학습 진입: { catId, subId, topicId, level, lang }
    onBack,                 // 단계학습 back 헤더 → TopicHub 복귀
    onTopicPass,            // 문장 통과 기록: ({ topicId, lang, level, phase, itemKey }) => recordPass
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

    const [selectedLang, setSelectedLang] = useState(preset ? preset.lang : (sourceLang || targetLangs[0] || 'en'));
    // 난이도는 "선택 언어"의 설정값(languageLevels[selectedLang])을 따름. 언어 전환/해당 언어
    // 설정 변경 시 자동 반영, 같은 언어 내 수동 변경은 보존(deps 미변경).
    const [level, setLevel] = useState(() => preset ? preset.level : (languageLevels[selectedLang] || userLevel || 'basic'));
    useEffect(() => {
        if (preset) return; // 단계학습 진입 시 난이도 자동 sync 비활성
        setLevel(languageLevels[selectedLang] || userLevel || 'basic');
    }, [selectedLang, languageLevels[selectedLang], userLevel]); // eslint-disable-line react-hooks/exhaustive-deps
    const [passageType, setPassageType] = useState('essay'); // 'essay' | 'dialogue'
    const [selectedTopic, setSelectedTopic] = useState(() =>
        preset ? { catId: preset.catId, subId: preset.subId, topicId: preset.topicId } : pickRandomTopic()); // { catId, subId, topicId }
    const [pickerCatId, setPickerCatId] = useState(null);
    const [customInput, setCustomInput] = useState(''); // 사용자가 직접 입력한 커스텀 주제

    const [passage, setPassage] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [showPronunciation, setShowPronunciation] = useState(false);
    const [activeRecIdx, setActiveRecIdx] = useState(null);
    // 2026-06-09: 문장 클릭 → 카드 팝업 (개별 문장 즉시재생 대체)
    const [cardMessage, setCardMessage] = useState(null);   // annotate 결과 {fullText, translation, pronunciation, learning_tip} — null이면 닫힘
    const [cardLoading, setCardLoading] = useState(false);  // annotate 진행 중
    const [savedSentences, setSavedSentences] = useState(new Set()); // 카드 저장된 문장 텍스트
    const annotateCacheRef = useRef(new Map());             // sentence → annotate 결과 (세션 캐시, 재오픈 무료)

    // 장문 TTS 재생 관리
    const [passagePlaying, setPassagePlaying] = useState(false); // 재생 중 여부
    const [passageLoading, setPassageLoading] = useState(false); // TTS 로딩 중
    const [loopMode, setLoopMode] = useState(false); // 반복 재생 모드
    const passageAudioRef = useRef(null); // 현재 재생 중인 Audio 객체
    const passageAudioUrlRef = useRef(null); // blob URL (누수 방지용)
    const loopModeRef = useRef(false); // useCallback 내에서 최신 값 접근용
    const playGenRef = useRef(0); // 재생 세대 토큰 (stale fetch 응답 무효화)
    const ttsAbortRef = useRef(null); // 진행 중 TTS fetch 취소용
    const sentenceCacheRef = useRef(new Map()); // 문장별 TTS objectURL 캐시 (key → blob URL) — 반복 재생 시 서버 재요청 0
    const SENT_CACHE_MAX = 40; // 문장 캐시 상한 (passage 변경 시 stopPassageAudio 에서 전체 정리)

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
        // 문장별 캐시 일괄 정리 — 다른 passage 의 문장 오디오는 무효이므로 revoke + clear
        if (sentenceCacheRef.current.size > 0) {
            for (const url of sentenceCacheRef.current.values()) {
                try { URL.revokeObjectURL(url); } catch {}
            }
            sentenceCacheRef.current.clear();
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

        // 보존된 오디오 재사용 — 일시정지 재개(중간 위치부터) 또는 재생완료 후 재청취(처음부터).
        // 서버 재요청 없이 로컬에서 즉시 재생 → Azure 재합성 비용 0 + 로딩 스피너 없음.
        // (오디오는 같은 passage 가 유지되는 동안만 보존 — stopPassageAudio 에서 정리)
        if (passageAudioRef.current && passageAudioRef.current.paused) {
            const a = passageAudioRef.current;
            // 재생이 끝난 상태면 처음으로 되감기 (ended 시 currentTime=duration 이라 그냥 play 하면 안 들림)
            if (a.ended || (a.duration && a.currentTime >= a.duration)) {
                try { a.currentTime = 0; } catch {}
            }
            a.play().catch(() => {});
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

        // 2026-06-07: 신규 합성 전 포인트 게이트 — 보존 오디오 재청취는 위에서 이미 return(무료).
        //   Trial 0점이면 차단 + 포인트부족 팝업(onTtsGate 내부), 새 TTS 합성 안 함.
        if (onTtsGate && !onTtsGate()) return;

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
                        ? { turns: dialogueTurns, dialogueSeed, langCode: selectedLang, durable: !!preset }
                        : { text: ttsText, langCode: selectedLang, durable: !!preset }
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
                    // 오디오/blob URL 보존 — 재청취 시 서버 재요청 없이 로컬 재생(Azure 비용 0).
                    // 정리는 stopPassageAudio(새 passage·조건변경·탭이탈·언마운트)에서 일괄 수행.
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
            // fallback: 기존 onSpeak 사용 — 230행 onTtsGate에서 이미 1점 차감됨 →
            // Azure 폴백 도달 시 재차감 방지(_skipGate). 이전엔 실패 1회에 2점 차감됐음.
            if (myGen === playGenRef.current) onSpeak(ttsText, selectedLang, undefined, { source: 'listening.fallback', _skipGate: true });
        } finally {
            if (objectUrl) {
                try { URL.revokeObjectURL(objectUrl); } catch {}
            }
            if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
            if (myGen === playGenRef.current) setPassageLoading(false);
        }
    }, [passage, passagePlaying, passageType, selectedLang, onSpeak, onTtsGate, stopPassageAudio, isTrialListenLimitReached, onTrialLimitReached, onGenerate, onFirstPlay, preset]);

    // 2026-06-09: 문장 클릭 → 카드 팝업 (개별 즉시재생 대체). 번역·발음·팁을 AI로 annotate 후
    //   MessageCardModal + ScenePracticeCard로 TTS(네이티브)·발음연습·저장 제공.
    //   annotate = 클릭당 Gemini 1회 + 1점 차감(onTtsGate), 세션 캐시 → 재오픈/같은 문장 무료.
    const openSentenceCard = useCallback(async (sentence) => {
        const isDialogue = passageType === 'dialogue';
        const cleanText = (isDialogue ? String(sentence).replace(/^[A-Z]:\s*/, '') : String(sentence)).trim();
        if (!cleanText) return;
        stopPassageAudio(); // 지문 재생 중이면 정지

        const key = `${selectedLang}:${cleanText}`;
        const cached = annotateCacheRef.current.get(key);
        if (cached) { setCardMessage(cached); return; } // 재오픈 무료

        // 신규 annotate → 1점 차감(Trial). 0점이면 차단+팝업. (Gemini 호출 비용 반영)
        if (onTtsGate && !onTtsGate()) return;

        setCardLoading(true);
        let generated = { fullText: cleanText, translation: '', pronunciation: '', learning_tip: '' };
        try {
            const SERVER_URL = getServerUrl();
            const res = await authFetch(`${SERVER_URL}/api/listening/annotate-sentence`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sentence: cleanText, langCode: selectedLang, sourceLang, byokGeminiKey }),
            });
            if (res.ok) {
                const data = await res.json();
                generated = {
                    fullText: cleanText,
                    translation: data.translation || '',
                    pronunciation: data.pronunciation || '',
                    learning_tip: data.learning_tip || '',
                };
            }
        } catch (e) {
            console.warn('[ListeningTab] annotate failed, opening minimal card:', e?.message);
        } finally {
            annotateCacheRef.current.set(key, generated); // 실패해도 캐시(재오픈 시 재과금 방지)
            setCardMessage(generated);
            setCardLoading(false);
        }
    }, [passageType, selectedLang, sourceLang, byokGeminiKey, onTtsGate, stopPassageAudio]);

    const handleSentenceCardSave = useCallback(async (pronunciationScore = null) => {
        if (!cardMessage) return;
        const sentenceText = cardMessage.fullText;
        try {
            const cardId = await onSaveSentence?.({
                sentence: sentenceText,
                translation: cardMessage.translation,
                learningTip: cardMessage.learning_tip,
                langCode: selectedLang,
                scene: passage?.title || '',
                pronunciationScore,
            });
            if (cardId !== null) { try { playStarSound(); } catch {} } // null=중복, 그 외=저장 성공
            setSavedSentences(prev => new Set(prev).add(sentenceText));
        } catch (e) {
            console.error('[ListeningTab] sentence save failed:', e?.message);
        }
    }, [cardMessage, onSaveSentence, selectedLang, passage]);

    const avoidTitlesRef = useRef([]);
    const historyCacheRef = useRef({});

    const visibleLanguages = targetLangs;

    // 기본 학습 언어(targetLangs[0])가 바뀌면 selectedLang도 새 default로 따라감.
    // 탭이 display:none으로 상시 마운트돼 초깃값이 stale해지므로, 단순 includes 체크만으로는
    // stale 값이 우연히 신규 배열에 포함된 경우 사용자가 의도한 default를 무시하게 됨.
    const prevDefaultLangRef = useRef(targetLangs?.[0]);
    useEffect(() => {
        if (preset) return; // 단계학습 진입 시 언어 preset 고정
        if (visibleLanguages.length === 0) return;
        const newDefault = visibleLanguages[0];
        const defaultChanged = prevDefaultLangRef.current !== newDefault;
        if (defaultChanged) prevDefaultLangRef.current = newDefault;
        if (defaultChanged || !visibleLanguages.includes(selectedLang)) {
            setSelectedLang(newDefault);
        }
    }, [targetLangs]); // eslint-disable-line react-hooks/exhaustive-deps

    // preset 변경(다른 토픽 재진입) 시 재동기화
    useEffect(() => {
        if (!preset) return;
        setSelectedLang(preset.lang);
        setLevel(preset.level);
        setSelectedTopic({ catId: preset.catId, subId: preset.subId, topicId: preset.topicId });
        setCustomInput('');
    }, [preset?.topicId, preset?.lang, preset?.level]); // eslint-disable-line react-hooks/exhaustive-deps

    // 조건 변경 시 리셋
    useEffect(() => {
        stopPassageAudio();
        setPassage(null);
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
                seedCursor: data.seedCursor || 0, // seed 경로: 현재 지문 페이지 offset
            };
            historyCacheRef.current = { ...historyCacheRef.current, [key]: cached };
            return cached;
        } catch {
            return { titles: [], passagesMeta: [], seedCursor: 0 };
        }
    };

    const appendHistory = (key, newTitle, newMeta, nextCursor) => {
        const existing = historyCacheRef.current[key] || { titles: [], passagesMeta: [], seedCursor: 0 };
        const updated = {
            titles: [...existing.titles, newTitle],
            passagesMeta: newMeta ? [...existing.passagesMeta, newMeta] : existing.passagesMeta,
            seedCursor: nextCursor != null ? nextCursor : (existing.seedCursor || 0),
        };
        historyCacheRef.current = { ...historyCacheRef.current, [key]: updated };
        if (user) {
            setDoc(doc(db, `users/${user.uid}/listeningHistory`, key), {
                titles: updated.titles,
                passagesMeta: updated.passagesMeta,
                seedCursor: updated.seedCursor,
                updatedAt: serverTimestamp(),
            }, { merge: true }).catch(console.error);
        }
    };

    // ── Generate Passage ─────────────────────────────────────────
    // opts.advance: seed 경로에서 "다음 지문"(커서 +1). 기본 false = 현재 페이지 로드.
    const handleGenerate = async (opts = {}) => {
        const hasCustom = customInput.trim().length > 0;
        if (!selectedTopic && !hasCustom) return;
        const isSeed = !hasCustom; // 비-custom = seed(전역 공유 순차) 경로
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
        const { titles: persistedTitles, passagesMeta: persistedMeta, seedCursor } = await loadHistory(historyKey);
        // seed offset(지문 페이지=1단위): 현재(seedCursor), advance면 다음(+1)
        const offset = isSeed ? ((seedCursor || 0) + (opts.advance ? 1 : 0)) : 0;
        const allAvoid = [...new Set([...persistedTitles, ...avoidTitlesRef.current])];
        // 50→20: long negative list 의 LLM 준수율 저하 회피 + 토큰 절감.
        // passagesMeta 도 동일하게 최근 20개만 전송 (서버에서 angle/keyword cluster rotation 강제).
        const avoidTitlesForApi = allAvoid.slice(-20);
        const passagesMetaForApi = (persistedMeta || []).slice(-20);

        // 단계학습 진입: 단어 단계에서 학습한 단어를 지문에 재등장시키도록 서버에 전달(vocabHistory에서 로드)
        let wordsToInclude = [];
        if (preset && user) {
            try {
                const vKey = `${topicId}--${level}--${selectedLang}`;
                const vSnap = await getDoc(doc(db, `users/${user.uid}/vocabHistory`, vKey));
                wordsToInclude = (vSnap.exists() ? (vSnap.data().words || []) : []).slice(-12);
            } catch { /* 무시 — 빈 값이면 서버는 기존 동작 */ }
        }

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
                    wordsToInclude, // seed 경로는 서버가 vocabSeed로 대체(전송값 무시)
                    offset: isSeed ? offset : undefined, // seed 경로만 offset 전송
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
                    sentences: Array.isArray(data.sentences) ? data.sentences : [], // seed 문장 카드(주석 포함)
                    counted: true,       // daily 3-limit: handleGenerate 에서 onGenerate 호출 → 첫 재생 dedup safety net
                    adsCharged: false,   // AdsPoint(15): 첫 재생 시 onFirstPlay 로 1회 더 차감 (Azure TTS 비용 반영)
                });
                setShowTranslation(false);
                setShowPronunciation(false);
                if (onGenerate) onGenerate();
                if (data.title) {
                    avoidTitlesRef.current = [...avoidTitlesRef.current, data.title];
                    const newMeta = (Array.isArray(data.passageKeywords) && data.angle)
                        ? { title: data.title, keywords: data.passageKeywords, angle: data.angle, createdAt: Date.now() }
                        : null;
                    // seed 경로: 커서를 현재 페이지 offset으로 저장
                    appendHistory(historyKey, data.title, newMeta, isSeed ? offset : undefined);
                }
            }
        } catch (e) {
            console.error('[ListeningTab] Generate error:', e);
            alert(t('scene.loadError'));
        } finally {
            setIsLoading(false);
        }
    };

    // ── Topic selection from picker modal ─────────────────────────
    const handleTopicSelect = (catId, subId, topicId) => {
        setCustomInput('');
        setSelectedTopic({ catId, subId, topicId });
    };

    // Phase 2: seed 문장 카드 저장 (자동 나열 카드용)
    const handleSeedSentenceSave = async (s, pronunciationScore = null) => {
        try {
            const cardId = await onSaveSentence?.({
                sentence: s.text,
                translation: s.translation,
                learningTip: s.learning_tip,
                langCode: selectedLang,
                scene: passage?.title || '',
                pronunciationScore,
            });
            if (cardId !== null) { try { playStarSound(); } catch {} }
            setSavedSentences(prev => new Set(prev).add(s.text));
        } catch (e) {
            console.error('[ListeningTab] seed sentence save failed:', e?.message);
        }
    };

    // 단계학습(preset) 진입 시 현재 페이지 지문 자동 로드 (버튼 없이). preset 동기화 후 1회(토픽/유형별).
    const autoGenKeyRef = useRef(null);
    useEffect(() => {
        if (!preset || !isActive) return;
        if (selectedTopic?.topicId !== preset.topicId || selectedLang !== preset.lang || level !== preset.level) return;
        const k = `${preset.topicId}--${passageType}--${preset.level}--${preset.lang}`;
        if (autoGenKeyRef.current === k) return;
        if (passage || isLoading) { autoGenKeyRef.current = k; return; }
        autoGenKeyRef.current = k;
        handleGenerate(); // 현재 페이지(seedCursor) 로드
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preset?.topicId, preset?.lang, preset?.level, passageType, isActive, selectedTopic, selectedLang, level, passage]);

    // ── Render ───────────────────────────────────────────────────
    return (
        <div className="listening-container">
            {/* 단계학습 back 헤더 */}
            {preset && (
                <button
                    type="button"
                    className="vocab-step-back"
                    onClick={onBack}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontWeight: 700, fontSize: '0.95rem', padding: '8px 4px 6px' }}
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

            {/* 단계학습 진입 시 토픽 고정 — 카테고리/칩/커스텀 입력 collapse */}
            {!preset && (<>
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
            </>)}

            {/* Generate Button */}
            <button
                className="listening-generate-btn"
                onClick={() => handleGenerate({ advance: !!selectedTopic && !!passage })}
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
                            {splitIntoSentences(passage.text, passageType === 'dialogue').map((sentence, idx) => {
                                const hasSeedCards = passage.sentences && passage.sentences.length > 0;
                                return (
                                    <span
                                        key={idx}
                                        className="listening-sentence"
                                        onClick={hasSeedCards ? undefined : () => openSentenceCard(sentence)}
                                        style={hasSeedCards ? { cursor: 'default' } : undefined}
                                    >
                                        {sentence}
                                        {passageType === 'dialogue' ? '\n' : ' '}
                                    </span>
                                );
                            })}
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

                    {/* Phase 2: 문장 카드 자동 나열 (seed 주석 기반 — per-user Gemini 0). 단계학습 진입 시. */}
                    {preset && passage.sentences && passage.sentences.length > 0 && (
                        <div className="listening-keywords-list">
                            {passage.sentences.map((s, i) => (
                                <VocabWordCard
                                    key={i}
                                    w={{ word: s.text, pronunciation: s.pronunciation || '', meaning: s.translation || '', example: '', examplePronunciation: '', exampleTranslation: '', learningTip: s.learning_tip ? [s.learning_tip] : [] }}
                                    index={i}
                                    selectedLang={selectedLang}
                                    sourceLang={sourceLang}
                                    onSpeak={onSpeak}
                                    ttsSource="listening"
                                    isSaved={savedSentences.has(s.text)}
                                    onSave={(score) => handleSeedSentenceSave(s, score)}
                                    onTrialLimitReached={onTrialLimitReached}
                                    onPronSuccess={onPronSuccess}
                                    targetGoal={languageGoals[selectedLang] || 80}
                                    onBookmarkPrompt={onBookmarkPrompt}
                                    activeRecIdx={activeRecIdx}
                                    onRecordingStart={setActiveRecIdx}
                                    headlineBlock
                                    t={t}
                                    ttsDurable={!!preset}
                                    onTopicPass={preset && onTopicPass
                                        ? (itemKey) => onTopicPass({ topicId: preset.topicId, lang: selectedLang, level, phase: 'passage', itemKey })
                                        : undefined}
                                />
                            ))}
                        </div>
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

            {/* 문장 카드 annotate 로딩 — 잠깐의 Gemini 호출 동안 스피너 */}
            {cardLoading && (
                <div className="listening-card-loading" role="status" aria-live="polite">
                    <div className="listening-card-loading-box">
                        <Loader2 size={22} className="spin" />
                    </div>
                </div>
            )}

            {/* 문장 클릭 카드 — TTS(네이티브) + 발음연습 + 저장 (ScenePracticeCard 재사용) */}
            <MessageCardModal
                open={!!cardMessage}
                message={cardMessage}
                langCode={selectedLang}
                sourceLang={sourceLang}
                onClose={() => setCardMessage(null)}
                onSpeak={onSpeak}
                onSave={handleSentenceCardSave}
                isSaved={cardMessage ? savedSentences.has(cardMessage.fullText) : false}
                onTrialLimitReached={onTrialLimitReached}
                onPronSuccess={onPronSuccess}
                onBookmarkPrompt={onBookmarkPrompt}
                targetGoal={languageGoals[selectedLang] || 80}
                t={t}
                ttsSource="listening"
                onTopicPass={preset && onTopicPass
                    ? (itemKey) => onTopicPass({ topicId: preset.topicId, lang: selectedLang, level, phase: 'passage', itemKey })
                    : undefined}
            />
        </div>
    );
}
