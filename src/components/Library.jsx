import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, limit, serverTimestamp } from 'firebase/firestore';
import TranslationCard from './TranslationCard';
import { Search, Trash2, Volume2, PenLine, ChevronDown, ArrowLeft } from 'lucide-react';
import { useT } from '../utils/i18n';
import { getLangInfo } from '../config/languages';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import './Library.css';

// 7 vocab 카테고리 — vocab/listening 카드의 categoryId 필터링용
const LIB_CATEGORY_IDS = VOCAB_CATEGORIES.map(c => c.id);
const LIB_CATEGORY_ICONS = Object.fromEntries(VOCAB_CATEGORIES.map(c => [c.id, c.icon]));

// ── 이번주 월요일 00:00 (현지시간) 계산 ──
function getThisWeekMonday() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1; // Mon=0
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}

const Library = ({ user, sourceLang, onSpeak, languageGoals = {}, todayCount = 0, dailyGoal = 3, onTargetAchieved, onCardDeleted, focusCardId, onFocusCardHandled, libraryBackTo, onBack, progressPopupOpen, onTrialLimitReached, onPronSuccess }) => {
    const t = useT(sourceLang);
    const [savedCards, setSavedCards] = useState([]);

    // ── 필터 상태 ──
    // 정책: 앱 cold start(페이지 로드) 시 무조건 default — 이번주만 ON, 나머지 전체.
    //   동일 세션 내 사용자 변경은 React state로만 보존(다른 탭 다녀와도 display 토글뿐이라 유지),
    //   localStorage 영구 보존은 하지 않음.
    const [filterLang, setFilterLang] = useState('all');
    const [filterTypes, setFilterTypes] = useState(() => new Set(['W', 'S']));
    const [filterTargetMissed, setFilterTargetMissed] = useState(false);
    const [filterSource, setFilterSource] = useState('all');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterDifficulty, setFilterDifficulty] = useState('all');
    const [filterStarred, setFilterStarred] = useState(false);
    const [filterThisWeek, setFilterThisWeek] = useState(true);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [limitCount, setLimitCount] = useState(10);
    const observerTarget = useRef(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [sessionAudioUrls, setSessionAudioUrls] = useState({});
    const [memoOpenId, setMemoOpenId] = useState(null);

    // ── 바텀시트 상태 ──
    const [bottomSheet, setBottomSheet] = useState(null); // null | 'lang' | 'ws' | 'source' | 'difficulty'

    // ── Firebase 실시간 구독 ──
    // 필터/검색 결과의 정확한 카운트(예: "15/21")를 표시하기 위해 user의 모든 savedCards를
    // 한 번에 로드. 표시는 아래 visibleCards에서 limitCount만큼만 slice (화면 페이지네이션).
    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, "savedCards"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const cards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(card => !card.isDeleted);
            setSavedCards(cards);
            setIsLoading(false);
            setErrorMsg(null);
        }, (error) => {
            console.error("Error loading library:", error);
            setErrorMsg(t('library.loadError'));
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, [user]);

    // ── 다른 탭에서 별표 저장 후 자동 진입 시: 새 카드로 스크롤 포커스 ──
    // 정책: 동일 세션 내 필터 자동 reset 없음 — 사용자가 건 필터는 그대로 보존.
    //   새 카드가 사용자 필터에 안 걸리면 DOM 미생성 → 스크롤 SKIP (의도된 동작).
    const focusCardPending = useRef(null);
    useEffect(() => {
        if (!focusCardId) return;
        focusCardPending.current = focusCardId;
    }, [focusCardId]);

    useEffect(() => {
        if (!focusCardPending.current || savedCards.length === 0) return;
        if (progressPopupOpen) return; // 팝업이 열려 있으면 스크롤 대기
        const el = document.getElementById(`library-card-${focusCardPending.current}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.classList.add('library-card-highlight');
            setTimeout(() => el.classList.remove('library-card-highlight'), 2000);
            focusCardPending.current = null;
            if (onFocusCardHandled) onFocusCardHandled();
        }
    }, [savedCards, progressPopupOpen, focusCardId]); // focusCardId: setSavedCards가 먼저 commit돼도 재발화

    // (Back키는 App.jsx에서 전역 관리 — header Back 버튼으로 복귀)

    // ── 카드 삭제 ──
    const triggerDelete = (id) => setDeleteConfirmId(id);
    const confirmDelete = async () => {
        if (!deleteConfirmId) return;
        const card = savedCards.find(c => c.id === deleteConfirmId);
        try {
            await updateDoc(doc(db, "savedCards", deleteConfirmId), { isDeleted: true, deletedAt: serverTimestamp() });
            onCardDeleted?.(card?.langCode, card?.sourceText);
            setDeleteConfirmId(null);
        } catch (error) {
            console.error("Delete failed:", error);
            setDeleteConfirmId(null);
        }
    };
    const cancelDelete = () => setDeleteConfirmId(null);

    // ── 중요 마크 토글 ──
    const toggleStarred = async (cardId, currentVal) => {
        const newVal = !currentVal;
        setSavedCards(prev => prev.map(c => c.id === cardId ? { ...c, starred: newVal } : c));
        try {
            await updateDoc(doc(db, "savedCards", cardId), { starred: newVal });
        } catch (e) {
            console.error("Star toggle failed:", e);
            setSavedCards(prev => prev.map(c => c.id === cardId ? { ...c, starred: currentVal } : c));
        }
    };

    const handleMemoUpdate = (cardId, newMemos, newAnnotations, newUserNotes) => {
        setSavedCards(prev => prev.map(card => card.id === cardId ? { ...card, memos: newMemos, annotations: newAnnotations, userNotes: newUserNotes ?? card.userNotes } : card));
    };

    const handlePracticeResult = async (id, langCode, result) => {
        if (result.audioUrl) setSessionAudioUrls(prev => ({ ...prev, [id]: result.audioUrl }));
        if (result.pronunciationScore != null) {
            setSavedCards(prev => prev.map(card => card.id === id ? { ...card, pronunciationScore: result.pronunciationScore } : card));
            const targetGoal = languageGoals[langCode] || 80;
            if (result.pronunciationScore >= targetGoal) onTargetAchieved?.(`library-${id}`);
            try {
                await updateDoc(doc(db, "savedCards", id), { pronunciationScore: result.pronunciationScore });
            } catch (error) {
                console.error("Failed to update pronunciation score:", error);
            }
        }
    };

    const playPronunciationAudio = (url) => {
        if (!url) return;
        new Audio(url).play().catch(e => console.error("Audio play failed:", e));
    };

    // ── 필터링 로직 ──
    let filteredCards = savedCards;

    if (filterLang !== 'all') filteredCards = filteredCards.filter(card => card.langCode === filterLang);

    if (filterTypes.size === 1) filteredCards = filteredCards.filter(card => filterTypes.has(card.inputType || 'S'));

    if (filterSource !== 'all') {
        filteredCards = filteredCards.filter(card => {
            const src = card.sourceType || 'translation';
            return src === filterSource;
        });
    }

    // 카테고리 필터 — vocab/listening 카드만 통과 (categoryId 매칭). conversation/scene/translation/video 자동 제외
    if (filterCategory !== 'all') {
        filteredCards = filteredCards.filter(card => {
            const src = card.sourceType || '';
            if (src !== 'vocab' && src !== 'listening') return false;
            return card.categoryId === filterCategory;
        });
    }

    if (filterDifficulty !== 'all') {
        filteredCards = filteredCards.filter(card => {
            const d = card.difficulty === 'high' ? 'advanced' : (card.difficulty || 'basic');
            return d === filterDifficulty;
        });
    }

    if (searchTerm.trim() !== '') {
        const lowerSearch = searchTerm.toLowerCase();
        filteredCards = filteredCards.filter(card => {
            return card.sourceText?.toLowerCase().includes(lowerSearch) ||
                   card.translatedText?.toLowerCase().includes(lowerSearch) ||
                   card.pronunciation?.toLowerCase().includes(lowerSearch);
        });
    }

    if (filterTargetMissed) {
        filteredCards = filteredCards.filter(card => {
            const targetGoal = languageGoals[card.langCode] || 80;
            return !card.pronunciationScore || card.pronunciationScore < targetGoal;
        });
    }

    if (filterStarred) filteredCards = filteredCards.filter(card => card.starred);

    if (filterThisWeek) {
        const monday = getThisWeekMonday();
        filteredCards = filteredCards.filter(card => {
            if (!card.createdAt) return false;
            const cardDate = card.createdAt.toDate ? card.createdAt.toDate() : new Date(card.createdAt);
            return cardDate >= monday;
        });
    }

    if (dateFrom || dateTo) {
        filteredCards = filteredCards.filter(card => {
            if (!card.createdAt) return false;
            const cardDate = card.createdAt.toDate ? card.createdAt.toDate() : new Date(card.createdAt);
            if (dateFrom && cardDate < new Date(dateFrom)) return false;
            if (dateTo) {
                const toEnd = new Date(dateTo);
                toEnd.setHours(23, 59, 59, 999);
                if (cardDate > toEnd) return false;
            }
            return true;
        });
    }

    // 화면 페이지네이션: 필터/검색을 거친 전체 리스트에서 limitCount만큼만 렌더.
    // 검색어가 있을 때는 검색 결과 전체 노출 (검색은 사용자가 명확한 의도로 줄인 결과라 페이지 나누지 않음).
    const visibleCards = searchTerm ? filteredCards : filteredCards.slice(0, limitCount);
    const hasMore = !searchTerm && filteredCards.length > limitCount;

    // 무한 스크롤 — 하단 observer에 닿으면 limitCount를 10씩 증가
    // (DB에서 더 가져오는 게 아니라 이미 받아둔 filteredCards를 더 보여줌)
    useEffect(() => {
        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) setLimitCount(prev => prev + 10);
        }, { threshold: 1.0 });
        if (observerTarget.current) observer.observe(observerTarget.current);
        return () => { if (observerTarget.current) observer.unobserve(observerTarget.current); };
    }, [hasMore]);

    // 언어 목록 추출
    const availableLangs = ['all', ...new Set(savedCards.map(c => c.langCode))];

    // 소스 목록
    const SOURCE_OPTIONS = [
        { value: 'all', label: t('library.filterAll') },
        { value: 'scene', label: t('library.srcScene') },
        { value: 'vocab', label: t('library.srcVocab') },
        { value: 'listening', label: t('library.srcListening') },
        { value: 'translation', label: t('library.srcTranslation') },
    ];

    // 난이도 목록
    const DIFF_OPTIONS = [
        { value: 'all', label: t('library.filterAll') },
        { value: 'basic', label: t('scene.diffBasic') },
        { value: 'intermediate', label: t('scene.diffIntermediate') },
        { value: 'advanced', label: t('scene.diffAdvanced') },
    ];

    // 카테고리 목록 — 7 vocab 카테고리 + 전체 (vocab/listening 카드 카테고리 필터)
    const CATEGORY_OPTIONS = [
        { value: 'all', label: t('library.filterAllCategories') },
        ...LIB_CATEGORY_IDS.map(id => ({
            value: id,
            label: `${LIB_CATEGORY_ICONS[id]} ${t(`vocabCat.${id}`)}`,
        })),
    ];

    // W/S 옵션
    const WS_OPTIONS = [
        { value: 'all', label: t('library.filterAll') },
        { value: 'W', label: t('library.typeWord') },
        { value: 'S', label: t('library.typeSentence') },
    ];

    // 현재 선택된 드롭다운 라벨
    const getLangLabel = () => filterLang === 'all' ? t('library.filterAll') : filterLang.toUpperCase();
    const getWsLabel = () => {
        if (filterTypes.size === 2 || filterTypes.size === 0) return t('library.filterAll');
        if (filterTypes.has('W')) return t('library.typeWord');
        return t('library.typeSentence');
    };
    const getSourceLabel = () => SOURCE_OPTIONS.find(o => o.value === filterSource)?.label || t('library.filterAll');
    const getCategoryLabel = () => CATEGORY_OPTIONS.find(o => o.value === filterCategory)?.label || t('library.filterAllCategories');
    const getDiffLabel = () => DIFF_OPTIONS.find(o => o.value === filterDifficulty)?.label || t('library.filterAll');

    if (isLoading) return <div className="loading-container">{t('library.loading')}</div>;

    if (errorMsg) {
        return (
            <div className="error-container" style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>
                <p>⚠️ {errorMsg}</p>
                <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
                    {t('library.refresh')}
                </button>
            </div>
        );
    }

    return (
        <div className="library-container library-theme">
            {/* Back 버튼은 App 헤더 우측 상단으로 이동 */}
            {/* ── 필터 박스 ── */}
            <div className="lib-filter-box">
                {/* 1) 검색바 */}
                <div className="lib-search-wrap">
                    <Search size={16} className="lib-search-icon" />
                    <input
                        type="text"
                        className="lib-search-input"
                        placeholder={t('library.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Row 1: 드롭다운들 */}
                <div className="lib-filter-row">
                    {/* 2) 언어 */}
                    <button
                        className={`lib-dropdown-btn ${filterLang !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('lang')}
                    >
                        {t('library.filterLang')} : {getLangLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 3) W/S */}
                    <button
                        className={`lib-dropdown-btn ${(filterTypes.size === 1) ? 'active' : ''}`}
                        onClick={() => setBottomSheet('ws')}
                    >
                        W/S : {getWsLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 5) 소스 */}
                    <button
                        className={`lib-dropdown-btn ${filterSource !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('source')}
                    >
                        {t('library.filterSource')} : {getSourceLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 5-1) 카테고리 (vocab/listening 전용) */}
                    <button
                        className={`lib-dropdown-btn ${filterCategory !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('category')}
                    >
                        {t('library.filterCategory')} : {getCategoryLabel()} <ChevronDown size={12} className="chevron" />
                    </button>

                    {/* 6) 난이도 */}
                    <button
                        className={`lib-dropdown-btn ${filterDifficulty !== 'all' ? 'active' : ''}`}
                        onClick={() => setBottomSheet('difficulty')}
                    >
                        {t('library.filterDiff')} : {getDiffLabel()} <ChevronDown size={12} className="chevron" />
                    </button>
                </div>

                {/* Row 2: 토글 칩들 + 카드 수 */}
                <div className="lib-filter-row">
                    {/* 4) 목표 미달 */}
                    <button
                        className={`lib-toggle-chip target-miss ${filterTargetMissed ? 'on' : ''}`}
                        onClick={() => setFilterTargetMissed(v => !v)}
                    >
                        <span className="chip-dot" />
                        {t('library.filterTargetMiss')}
                    </button>

                    {/* 6) 중요 */}
                    <button
                        className={`lib-toggle-chip ${filterStarred ? 'on' : ''}`}
                        onClick={() => setFilterStarred(v => !v)}
                    >
                        <span className="chip-dot" />
                        {t('library.filterStarred')}
                    </button>

                    {/* 7) 이번주 */}
                    <button
                        className={`lib-toggle-chip this-week ${filterThisWeek ? 'on' : ''}`}
                        onClick={() => setFilterThisWeek(v => !v)}
                    >
                        <span className="chip-dot" />
                        {t('library.filterThisWeek')}
                    </button>

                    {/* 8) 필터링 카드 수 / 전체 카드 수 */}
                    <span className="lib-card-count">
                        {filteredCards.length}/{savedCards.length}
                    </span>
                </div>

                {/* Row 3: 기간 (이번주 OFF일 때만 표시) */}
                {!filterThisWeek && (
                    <div className="lib-date-row">
                        <input type="date" className="lib-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                        <span className="lib-date-sep">~</span>
                        <input type="date" className="lib-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                        {(dateFrom || dateTo) && (
                            <button className="lib-date-clear" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                                {t('library.dateClear')}
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── 카드 목록 ── */}
            <div className="cards-grid">
                {filteredCards.length > 0 ? (
                    visibleCards.map((card, idx) => {
                        // 카드 번호: serialNumber 필드(고정 번호) 우선. 없으면 기존 순번 계산 폴백.
                        const globalIndex = savedCards.indexOf(card);
                        const cardNumber = card.serialNumber
                            ?? (globalIndex >= 0 ? savedCards.length - globalIndex : filteredCards.length - idx);
                        return (
                        <div key={card.id} id={`library-card-${card.id}`} className="library-card-wrapper">
                            <TranslationCard
                                language={card.language}
                                langCode={card.langCode}
                                cardNumber={cardNumber}
                                sourceLangCode={card.sourceLang || 'ko'}
                                text={card.translatedText}
                                sourceTranslation={card.sourceTranslation || ''}
                                pronunciation={card.pronunciation}
                                learningTip={card.learningTip}
                                example={card.example || ''}
                                exampleTranslation={card.exampleTranslation || ''}
                                examplePronunciation={card.examplePronunciation || ''}
                                badgeColor={getLangInfo(card.langCode)?.color || '#f1f5f9'}
                                badgeTextColor={getLangInfo(card.langCode)?.textColor || '#475569'}
                                onSpeak={() => onSpeak(card.translatedText, card.langCode, card.selectedEmotion)}
                                onSpeakText={onSpeak}
                                isInSelectionMode={false}
                                isLibraryView={true}
                                onPracticeResult={(langCode, result) => handlePracticeResult(card.id, langCode, result)}
                                onTargetAchieved={onTargetAchieved}
                                targetGoal={languageGoals[card.langCode] || 80}
                                cardId={card.id}
                                memos={card.memos || []}
                                annotations={card.annotations || []}
                                userNotes={card.userNotes || []}
                                onMemoUpdate={(newMemos, newAnnotations, newUserNotes) => handleMemoUpdate(card.id, newMemos, newAnnotations, newUserNotes)}
                                starred={card.starred || false}
                                onToggleStarred={() => toggleStarred(card.id, card.starred)}
                                memoPopupOpen={memoOpenId === card.id}
                                onMemoClose={() => setMemoOpenId(null)}
                                selectedEmotion={card.selectedEmotion || ''}
                                interactionType={card.interactionType || ''}
                                onTrialLimitReached={onTrialLimitReached}
                                onPronSuccess={onPronSuccess}
                            />

                            {/* 하단 액션바 */}
                            <div className="card-action-bar">
                                <div className="action-left" style={{ display: 'flex', alignItems: 'center' }}>
                                    <span className="stat-text" title="목표 점수">🎯 <strong>{languageGoals[card.langCode] || 80}</strong></span>
                                    <span className="stat-divider">·</span>
                                    <span className="stat-text" title="내 점수">⭐️ <strong>{card.pronunciationScore || '-'}</strong></span>
                                    <span className="stat-divider">·</span>
                                    <span className="stat-text" title="달성 여부">
                                        {card.pronunciationScore && card.pronunciationScore >= (languageGoals[card.langCode] || 80) ? '✅' : '❌'}
                                    </span>
                                    <span className="stat-divider">·</span>
                                    <button
                                        className="stat-icon-btn"
                                        title={sessionAudioUrls[card.id] ? "내 발음 다시 듣기" : "녹음 후 활성화됩니다"}
                                        onClick={(e) => { e.stopPropagation(); playPronunciationAudio(sessionAudioUrls[card.id]); }}
                                        disabled={!sessionAudioUrls[card.id]}
                                        style={{ background: 'none', border: 'none', outline: 'none', cursor: sessionAudioUrls[card.id] ? 'pointer' : 'default', padding: 0, display: 'flex', alignItems: 'center', opacity: sessionAudioUrls[card.id] ? 1 : 0.3, color: 'var(--text-secondary)' }}
                                    >
                                        <Volume2 size={16} />
                                    </button>
                                    <span className="stat-divider">·</span>
                                    <button
                                        className="stat-icon-btn"
                                        title="메모 / 어노테이션"
                                        onClick={(e) => { e.stopPropagation(); setMemoOpenId(memoOpenId === card.id ? null : card.id); }}
                                        style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: (card.memos?.length || card.userNotes?.length) ? '#6366f1' : 'var(--text-secondary)' }}
                                    >
                                        <PenLine size={16} />
                                    </button>
                                </div>
                                <div className="action-right">
                                    <button
                                        className="action-icon-btn delete-action"
                                        onClick={(e) => { e.stopPropagation(); triggerDelete(card.id); }}
                                        title="Delete from Library"
                                    >
                                        <Trash2 size={22} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )})
                ) : (
                    <div className="empty-library">
                        <Search size={48} opacity={0.2} />
                        <p>{t('library.empty').split('\n').map((line, i) => i === 0 ? line : <><br key={i} />{line}</>)}</p>
                    </div>
                )}
            </div>

            {/* 무한 스크롤 */}
            {!searchTerm && hasMore && filteredCards.length > 0 && (
                <div ref={observerTarget} style={{ height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1rem' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{t('library.loadingMore')}</span>
                </div>
            )}
            {!hasMore && filteredCards.length > 0 && !searchTerm && (
                <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '1rem', fontSize: '0.875rem', paddingBottom: '1rem' }}>
                    {t('library.reachedEnd')}
                </div>
            )}

            {/* ── 바텀시트: 언어 선택 ── */}
            {bottomSheet === 'lang' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterLang')}</div>
                        {availableLangs.map(lang => (
                            <button key={lang} className={`lib-bs-option ${filterLang === lang ? 'selected' : ''}`}
                                onClick={() => { setFilterLang(lang); setBottomSheet(null); }}>
                                <span>{lang === 'all' ? t('library.filterAll') : lang.toUpperCase()}</span>
                                {filterLang === lang && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: W/S 선택 ── */}
            {bottomSheet === 'ws' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">W / S</div>
                        {WS_OPTIONS.map(opt => {
                            const isSelected = opt.value === 'all'
                                ? (filterTypes.size === 2 || filterTypes.size === 0)
                                : (filterTypes.size === 1 && filterTypes.has(opt.value));
                            return (
                                <button key={opt.value} className={`lib-bs-option ${isSelected ? 'selected' : ''}`}
                                    onClick={() => {
                                        if (opt.value === 'all') setFilterTypes(new Set(['W', 'S']));
                                        else setFilterTypes(new Set([opt.value]));
                                        setBottomSheet(null);
                                    }}>
                                    <span>{opt.label}</span>
                                    {isSelected && <span className="bs-check">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: 소스 선택 ── */}
            {bottomSheet === 'source' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterSource')}</div>
                        {SOURCE_OPTIONS.map(opt => (
                            <button key={opt.value} className={`lib-bs-option ${filterSource === opt.value ? 'selected' : ''}`}
                                onClick={() => { setFilterSource(opt.value); setBottomSheet(null); }}>
                                <span>{opt.label}</span>
                                {filterSource === opt.value && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: 카테고리 선택 ── */}
            {bottomSheet === 'category' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterCategory')}</div>
                        {CATEGORY_OPTIONS.map(opt => (
                            <button key={opt.value} className={`lib-bs-option ${filterCategory === opt.value ? 'selected' : ''}`}
                                onClick={() => { setFilterCategory(opt.value); setBottomSheet(null); }}>
                                <span>{opt.label}</span>
                                {filterCategory === opt.value && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── 바텀시트: 난이도 선택 ── */}
            {bottomSheet === 'difficulty' && (
                <div className="lib-bs-overlay" onClick={() => setBottomSheet(null)}>
                    <div className="lib-bs-sheet" onClick={e => e.stopPropagation()}>
                        <div className="lib-bs-handle" />
                        <div className="lib-bs-title">{t('library.filterDiff')}</div>
                        {DIFF_OPTIONS.map(opt => (
                            <button key={opt.value} className={`lib-bs-option ${filterDifficulty === opt.value ? 'selected' : ''}`}
                                onClick={() => { setFilterDifficulty(opt.value); setBottomSheet(null); }}>
                                <span>{opt.label}</span>
                                {filterDifficulty === opt.value && <span className="bs-check">✓</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 삭제 확인 모달 */}
            {deleteConfirmId && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="modal-content" style={{ backgroundColor: 'white', padding: '24px', borderRadius: '16px', maxWidth: '320px', width: '90%', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                        <p style={{ margin: '0 0 24px 0', fontSize: '1.05rem', color: '#1f2937', fontWeight: '600', lineHeight: '1.5' }}>
                            {t('library.deleteConfirm')}
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button onClick={cancelDelete} style={{ flex: 1, padding: '12px 0', borderRadius: '10px', border: '1px solid #e5e7eb', backgroundColor: 'white', color: '#4b5563', fontWeight: 'bold', cursor: 'pointer' }}>
                                {t('library.deleteCancel')}
                            </button>
                            <button onClick={confirmDelete} style={{ flex: 1, padding: '12px 0', borderRadius: '10px', border: 'none', backgroundColor: '#ef4444', color: 'white', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 4px rgba(239,68,68,0.3)' }}>
                                {t('library.deleteOk')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Library;
